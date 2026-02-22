import { getSupabase } from './supabase';
import { loadCEO, getVaultEntryByService, getSetting, logAudit, saveMissionRound, updateMissionRound, getPrompt, type ChatMessageRow } from './database';
import { getMemories, queryMemories, extractCollateralMemories } from './memory';
import { executeSkill } from './skillExecutor';
import { resolveSkill, resolveSkills } from './skillResolver';
import { executeCLISkill, hasCLIHandler } from './cliSkillHandlers';
import { MODEL_SERVICE_MAP, MODEL_API_IDS } from './models';
import { recommendSkills } from './skillRecommender';

/** Safe window event dispatch — no-op in Node.js (sidecar) */
function emitEvent(name: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(name));
}

export interface ParsedMission {
  title: string;
  missionId?: string; // existing mission ID — activates instead of creating new
  toolCalls: { name: string; arguments: Record<string, unknown> }[];
}

export interface DispatchContext {
  /** Recent conversation messages leading to this dispatch */
  conversationExcerpt?: ChatMessageRow[];
  /** Conversation ID for tracing */
  conversationId?: string;
  /** True when dispatched from a live chat (founder is watching). Quick tasks auto-complete. */
  founderPresent?: boolean;
  /** Requesting agent ID (for agent-initiated work requests). Defaults to 'ceo'. */
  agentId?: string;
}

/** Parse <task_plan> or individual <tool_call> blocks from CEO response */
export function parseTaskPlan(text: string): ParsedMission[] {
  // Try <task_plan> first
  const planMatch = text.match(/<task_plan>\s*([\s\S]*?)\s*<\/task_plan>/);
  if (planMatch) {
    try {
      const plan = JSON.parse(planMatch[1]);
      return (plan.missions ?? []).map((m: Record<string, unknown>) => ({
        title: (m.title as string) ?? 'Untitled mission',
        missionId: (m.mission_id as string) ?? undefined,
        toolCalls: (m.tool_calls as { name: string; arguments: Record<string, unknown> }[]) ?? [],
      }));
    } catch { /* fall through */ }
  }

  // Fallback: individual <tool_call> blocks
  // Multiple tool_calls in one response = one mission (they came from the same request)
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const calls: { name: string; command?: string; mission_id?: string; arguments: Record<string, unknown> }[] = [];
  let match: RegExpExecArray | null;
  while ((match = toolCallRegex.exec(text)) !== null) {
    try {
      calls.push(JSON.parse(match[1]));
    } catch { /* skip unparseable */ }
  }

  if (calls.length === 0) return [];

  // Extract mission_id if the CEO attached one (for executing existing backlog items)
  const missionId = calls[0].mission_id;

  // Single call = title from the call; multiple calls = grouped mission
  if (calls.length === 1) {
    const call = calls[0];
    return [{
      title: `${call.name}: ${Object.values(call.arguments ?? {})[0] ?? 'execute'}`.slice(0, 100),
      missionId,
      toolCalls: [call],
    }];
  }

  // Multiple calls from one response → group into a single mission
  const firstArg = Object.values(calls[0].arguments ?? {})[0] ?? 'execute';
  return [{
    title: `${calls[0].name}: ${firstArg} (+${calls.length - 1} more)`.slice(0, 100),
    missionId,
    toolCalls: calls,
  }];
}

/** Strip task_plan/tool_call blocks from text, leaving the conversational parts */
export function stripTaskBlocks(text: string): string {
  return text
    .replace(/<task_plan>[\s\S]*?<\/task_plan>/g, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Agent work requests — agents request skill execution through the CEO
// ---------------------------------------------------------------------------

export interface WorkRequest {
  skill_id: string;
  command: string;
  arguments: Record<string, unknown>;
  reason: string;
}

/** Parse <work_request> blocks from agent response text */
export function parseWorkRequests(text: string): WorkRequest[] {
  const requests: WorkRequest[] = [];
  const regex = /<work_request>\s*([\s\S]*?)\s*<\/work_request>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      requests.push(JSON.parse(match[1]) as WorkRequest);
    } catch { /* skip unparseable */ }
  }
  return requests;
}

/** Strip <work_request> blocks from text, leaving the conversational parts */
export function stripWorkRequestBlocks(text: string): string {
  return text.replace(/<work_request>[\s\S]*?<\/work_request>/g, '').trim();
}

// ---------------------------------------------------------------------------
// Agent questions — agents can flag questions during task execution
// ---------------------------------------------------------------------------

/** Parse <question> blocks from agent task output */
export function parseQuestions(text: string): { question: string; context?: string }[] {
  const questions: { question: string; context?: string }[] = [];
  const regex = /<question>\s*([\s\S]*?)\s*<\/question>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.question) {
        questions.push({ question: parsed.question, context: parsed.context });
      }
    } catch {
      // Plain text question
      questions.push({ question: match[1].trim() });
    }
  }
  return questions;
}

/**
 * Build context payload for agent task execution.
 * CEO selects relevant memories + conversation context to include.
 */
async function buildTaskContext(
  mission: ParsedMission,
  context?: DispatchContext,
): Promise<Record<string, unknown>> {
  const taskContext: Record<string, unknown> = {};

  // Founder profile memories — always included
  const allMemories = await getMemories(40);
  const founderProfile = allMemories
    .filter(m => m.category === 'founder_profile')
    .map(m => m.content);
  if (founderProfile.length > 0) {
    taskContext.founder_profile = founderProfile;
  }

  // Query relevant org memories based on mission title + tool call args
  const searchText = [
    mission.title,
    ...mission.toolCalls.map(tc => Object.values(tc.arguments).join(' ')),
  ].join(' ');
  const relevantMemories = await queryMemories(searchText, 10);
  const orgMemories = relevantMemories
    .filter(m => m.category !== 'founder_profile')
    .map(m => ({ category: m.category, content: m.content, tags: m.tags }));
  if (orgMemories.length > 0) {
    taskContext.relevant_memories = orgMemories;
  }

  // Conversation excerpt — last 10 messages from the chat that spawned this
  if (context?.conversationExcerpt && context.conversationExcerpt.length > 0) {
    const excerpt = context.conversationExcerpt.slice(-10).map(m => ({
      sender: m.sender,
      text: m.text.slice(0, 500), // Truncate long messages
    }));
    taskContext.conversation_context = excerpt;
    taskContext.conversation_id = context.conversationId;
  }

  // Founder preferences and decisions from memory
  const preferences = allMemories
    .filter(m => m.category === 'preference' || m.category === 'decision')
    .map(m => m.content);
  if (preferences.length > 0) {
    taskContext.founder_preferences = preferences;
  }

  // Recent answered agent questions (cross-mission intelligence)
  try {
    const { data: answered } = await getSupabase()
      .from('agent_questions')
      .select('question, answer')
      .eq('status', 'answered')
      .order('answered_at', { ascending: false })
      .limit(5);
    if (answered && answered.length > 0) {
      taskContext.prior_qa = answered;
    }
  } catch { /* skip if table doesn't exist yet */ }

  return taskContext;
}

// ---------------------------------------------------------------------------
// Mission summary synthesizer — combines multi-task results into one artifact
// ---------------------------------------------------------------------------

export async function synthesizeMissionSummary(
  missionId: string,
  missionTitle: string,
): Promise<void> {
  const sb = getSupabase();

  try {
    // Fetch all completed task results
    const { data: tasks } = await sb
      .from('task_executions')
      .select('skill_id, command_name, result, status')
      .eq('mission_id', missionId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true });

    if (!tasks || tasks.length < 2) return; // Only synthesize multi-task missions

    // Build a combined text of all task outputs
    const taskOutputs = tasks.map((t, i) => {
      const output = (t.result as Record<string, unknown>)?.output as string ?? 'No output';
      const skill = t.skill_id ?? 'unknown';
      const cmd = t.command_name ?? '';
      return `--- Task ${i + 1}: ${skill} / ${cmd} ---\n${output}`;
    }).join('\n\n');

    // Try to get the CEO's LLM to synthesize
    const ceo = await loadCEO();
    if (!ceo?.model) {
      // No LLM available — create a simple concatenated summary
      const summaryId = `task-summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await sb.from('task_executions').insert({
        id: summaryId,
        mission_id: missionId,
        agent_id: 'ceo',
        skill_id: 'mission-summary',
        command_name: 'synthesize',
        params: { mission_title: missionTitle, task_count: tasks.length },
        model: 'none',
        status: 'completed',
        result: {
          output: `# ${missionTitle}\n\n${taskOutputs}`,
          summary: `Combined results from ${tasks.length} tasks for "${missionTitle}"`,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      emitEvent('task-executions-changed');
      return;
    }

    const service = MODEL_SERVICE_MAP[ceo.model] ?? '';
    const vaultEntry = service ? await getVaultEntryByService(service) : null;

    if (!service || !vaultEntry) {
      // No API key — fall back to concatenation
      const summaryId = `task-summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await sb.from('task_executions').insert({
        id: summaryId,
        mission_id: missionId,
        agent_id: 'ceo',
        skill_id: 'mission-summary',
        command_name: 'synthesize',
        params: { mission_title: missionTitle, task_count: tasks.length },
        model: 'none',
        status: 'completed',
        result: {
          output: `# ${missionTitle}\n\n${taskOutputs}`,
          summary: `Combined results from ${tasks.length} tasks for "${missionTitle}"`,
        },
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      emitEvent('task-executions-changed');
      return;
    }

    // Use LLM to synthesize
    const { anthropicProvider } = await import('./llm/providers/anthropic');
    const { openaiProvider, deepseekProvider, xaiProvider } = await import('./llm/providers/openai');
    const { googleProvider } = await import('./llm/providers/google');
    const providers: Record<string, typeof anthropicProvider> = {
      Anthropic: anthropicProvider, OpenAI: openaiProvider, Google: googleProvider,
      DeepSeek: deepseekProvider, xAI: xaiProvider,
    };
    const provider = providers[service];
    if (!provider) return;

    const apiModelId = MODEL_API_IDS[ceo.model] ?? ceo.model;

    const dbSynthesisPrompt = await getPrompt('mission-synthesis');
    let synthesisPrompt: string;
    if (dbSynthesisPrompt) {
      synthesisPrompt = dbSynthesisPrompt
        .replace(/\{\{MISSION_TITLE\}\}/g, missionTitle)
        .replace(/\{\{TASK_COUNT\}\}/g, String(tasks.length))
        .replace(/\{\{TASK_OUTPUTS\}\}/g, taskOutputs);
    } else {
      synthesisPrompt = `You are a CEO synthesizing the results of a multi-part mission.

Mission: "${missionTitle}"

Below are the outputs from ${tasks.length} individual research/analysis tasks that were part of this mission. Create a single, unified executive report that:

1. Opens with a brief executive summary (2-3 sentences)
2. Synthesizes the key findings across all tasks into a coherent narrative
3. Highlights the most important insights, data points, and recommendations
4. Ends with clear next steps or action items

Use markdown formatting (headers, bullet points, bold for emphasis). Be comprehensive but avoid redundancy — merge overlapping findings rather than repeating them.

---

${taskOutputs}`;
    }

    const messages = [
      { role: 'system' as const, content: 'You are an executive AI assistant creating a unified mission report from multiple research outputs.' },
      { role: 'user' as const, content: synthesisPrompt },
    ];

    const synthesized = await new Promise<string>((resolve, reject) => {
      provider.stream(messages, vaultEntry.key_value, apiModelId, {
        onToken: () => {},
        onDone: (fullText: string) => resolve(fullText),
        onError: (err: Error) => reject(err),
      });
    });

    // Store as a summary artifact
    const summaryId = `task-summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const inputTokens = Math.ceil(synthesisPrompt.length / 4);
    const outputTokens = Math.ceil(synthesized.length / 4);

    await sb.from('task_executions').insert({
      id: summaryId,
      mission_id: missionId,
      agent_id: 'ceo',
      skill_id: 'mission-summary',
      command_name: 'synthesize',
      params: { mission_title: missionTitle, task_count: tasks.length },
      model: ceo.model,
      status: 'completed',
      tokens_used: inputTokens + outputTokens,
      cost_usd: 0, // We could estimate but keeping it simple
      result: {
        output: synthesized,
        summary: `Unified report for "${missionTitle}" — synthesized from ${tasks.length} tasks`,
      },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    emitEvent('task-executions-changed');
  } catch (err) {
    console.warn('[TaskDispatcher] Mission summary synthesis failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Browser-side skill execution fallback
// ---------------------------------------------------------------------------

async function executeBrowserSide(
  taskId: string,
  missionId: string,
  skillId: string,
  commandName: string,
  params: Record<string, unknown>,
  model: string,
  founderPresent = false,
  conversationId?: string,
): Promise<void> {
  const sb = getSupabase();

  // Mark as running
  await sb.from('task_executions').update({
    status: 'running',
    started_at: new Date().toISOString(),
  }).eq('id', taskId);

  try {
    let resultText: string;
    let cost = 0;
    let tokensUsed = 0;
    let imageUrl: string | undefined;

    // Check for CLI handler first
    if (hasCLIHandler(skillId)) {
      const skill = await resolveSkill(skillId);
      const result = await executeCLISkill(skillId, commandName, params, skill?.apiConfig);
      if (!result) throw new Error(`CLI skill "${skillId}" handler returned null`);
      if (!result.success) throw new Error(result.text);
      resultText = result.text;
    } else {
      // LLM skill — use browser-side executor (handles CLI fallback too)
      const result = await executeSkill(skillId, commandName, params, {
        modelOverride: model,
        missionId,
      });

      if (!result.success) throw new Error(result.error ?? 'Skill execution failed');
      resultText = result.output;
      cost = result.cost_usd;
      tokensUsed = result.tokens_used;
      imageUrl = result.imageUrl;
    }

    // Extract and save agent questions from task output
    const questions = parseQuestions(resultText);
    if (questions.length > 0) {
      const { saveAgentQuestion } = await import('./database');
      for (const q of questions) {
        const qId = `question-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await saveAgentQuestion({
          id: qId,
          task_execution_id: taskId,
          mission_id: missionId,
          agent_id: 'ceo', // will be enhanced when agents dispatch their own tasks
          question: q.question,
          context: q.context ?? null,
        });
      }

      // Post questions to chat
      const { data: convos } = await sb.from('conversations')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);
      if (convos?.[0]) {
        for (const q of questions) {
          await sb.from('chat_messages').insert({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: convos[0].id,
            sender: 'ceo',
            text: `**Agent Question** (from task on "${skillId}"):\n> ${q.question}${q.context ? `\n\n_Context: ${q.context}_` : ''}`,
            metadata: { type: 'agent_question', skill_id: skillId, mission_id: missionId },
          });
        }
        if (typeof window !== 'undefined') {
          emitEvent('chat-messages-changed');
        }
      }
    }

    // Detect code blocks in output (supports both ```lang and bare ``` fences)
    const codeBlockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    const detectedLanguages: string[] = [];
    let codeMatch: RegExpExecArray | null;
    while ((codeMatch = codeBlockRegex.exec(resultText)) !== null) {
      let lang = codeMatch[1] || '';
      // Bare fence — heuristically detect language from content
      if (!lang) {
        const content = codeMatch[2];
        if (/^(def |import |from |class \w+[:(]|print\(|if __name__)/m.test(content)) {
          lang = 'python';
        } else if (/^(function |const |let |var |=>|export |import {)/m.test(content)) {
          lang = 'javascript';
        } else if (/<html|<!DOCTYPE/i.test(content)) {
          lang = 'html';
        } else if (/^(SELECT |INSERT |UPDATE |DELETE |CREATE TABLE|ALTER TABLE|DROP )/mi.test(content)) {
          lang = 'sql';
        } else {
          lang = 'code';
        }
      }
      if (!detectedLanguages.includes(lang)) {
        detectedLanguages.push(lang);
      }
    }

    // If no fenced code found, check if the skill itself is code-related
    if (detectedLanguages.length === 0) {
      const codeSkillPattern = /code|python|javascript|typescript|html|css|program|develop|script|coding/i;
      if (codeSkillPattern.test(skillId)) {
        // Scan for unfenced code patterns in the raw output
        if (/^(def |class \w+[:(]|import |from \w+ import)/m.test(resultText)) {
          detectedLanguages.push('python');
        } else if (/^(function |const |let |var |export (default )?|import \{)/m.test(resultText)) {
          detectedLanguages.push('javascript');
        } else if (/<html|<!DOCTYPE/i.test(resultText)) {
          detectedLanguages.push('html');
        } else if (/^(SELECT |CREATE TABLE|ALTER TABLE)/mi.test(resultText)) {
          detectedLanguages.push('sql');
        } else {
          // Skill is code-related but no specific language detected
          detectedLanguages.push('code');
        }
      }
    }

    const artifactMeta: Record<string, unknown> = {};
    if (detectedLanguages.length > 0) {
      artifactMeta.artifact_type = 'code';
      artifactMeta.language = detectedLanguages[0];
      if (detectedLanguages.length > 1) artifactMeta.languages = detectedLanguages;
    }

    // Upload text output as .md file for document-type skills
    if (!artifactMeta.artifact_type && resultText.length > 200) {
      try {
        const skill = await resolveSkill(skillId);
        if (skill?.outputType === 'text' && skill?.collateral) {
          const { uploadGeneratedDocument } = await import('./storageUpload');
          const docUrl = await uploadGeneratedDocument(
            resultText,
            `${skillId}-${commandName}-${Date.now()}.md`,
          );
          if (docUrl) {
            artifactMeta.artifact_type = 'document';
            artifactMeta.document_url = docUrl;
          }
        }
      } catch (err) {
        console.warn('[TaskDispatcher] Document upload failed:', err);
      }
    }

    // Detect image artifacts — from executeSkill imageUrl or skill outputType
    if (!artifactMeta.artifact_type && imageUrl) {
      artifactMeta.artifact_type = 'image';
      artifactMeta.image_url = imageUrl;
    } else if (!artifactMeta.artifact_type) {
      const skill = await resolveSkill(skillId);
      if (skill?.outputType === 'image') {
        artifactMeta.artifact_type = 'image';
        // Extract image URL from markdown output if present
        const imgMatch = resultText.match(/!\[.*?\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+)\)/);
        if (imgMatch) artifactMeta.image_url = imgMatch[1];
      }
    }

    // Read existing tokens (may include planning overhead seeded at creation)
    const { data: taskRow } = await sb.from('task_executions')
      .select('tokens_used').eq('id', taskId).maybeSingle();
    const existingTokens = (taskRow?.tokens_used as number) ?? 0;

    // Update task_execution
    await sb.from('task_executions').update({
      status: 'completed',
      result: { output: resultText, summary: resultText.slice(0, 200), ...artifactMeta },
      tokens_used: existingTokens + tokensUsed,
      cost_usd: cost,
      completed_at: new Date().toISOString(),
    }).eq('id', taskId);

    // If this child was spawned from a recurring template, save task_template for future replay
    try {
      const { data: missionData } = await sb.from('missions').select('created_by').eq('id', missionId).single();
      const createdBy = missionData?.created_by as string;
      if (createdBy?.startsWith('recurring:')) {
        const parentId = createdBy.replace('recurring:', '');
        const { data: parent } = await sb.from('missions').select('task_template').eq('id', parentId).single();
        if (parent && !parent.task_template) {
          await sb.from('missions').update({
            task_template: { skill_id: skillId, command: commandName, params, model },
          }).eq('id', parentId);
        }
      }
    } catch (err) {
      console.warn('[TaskDispatcher] Failed to save task_template:', err);
    }

    // Check if all tasks for this mission are complete
    const { data: siblings } = await sb
      .from('task_executions')
      .select('status, tokens_used, cost_usd, started_at, completed_at, result, skill_id')
      .eq('mission_id', missionId);

    const allComplete = siblings?.every(t => t.status === 'completed' || t.status === 'failed');

    if (allComplete) {
      const completedCount = siblings?.filter(t => t.status === 'completed').length ?? 0;
      const isSingle = (siblings?.length ?? 0) === 1 && completedCount === 1;

      // Check if CEO auto-summary is enabled (default: on) — if so, skip TELL ME NOW button
      const autoSummarySetting = await getSetting('ceo_auto_summary');
      const showTellMe = autoSummarySetting === 'false';

      // Scheduled/CEO-created missions auto-complete (founder already approved the schedule)
      // Founder present + quick task = auto-done (they see it in chat)
      // Founder away or complex multi-task = review (needs approval)
      const { data: missionMeta } = await sb.from('missions').select('created_by').eq('id', missionId).single();
      const createdBy = missionMeta?.created_by?.toLowerCase() ?? '';
      const ceoRow = await loadCEO();
      const wasScheduled = createdBy === 'ceo' || createdBy === 'scheduler' || createdBy === (ceoRow?.name ?? '').toLowerCase();
      const isTabVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
      const autoComplete = wasScheduled || (founderPresent && isTabVisible && isSingle);
      const missionStatus = autoComplete ? 'done' : 'review';

      await sb.from('missions').update({ status: missionStatus }).eq('id', missionId);

      // --- Scoring: Create/update mission round and evaluate ---
      try {
        const { data: missionForRound } = await sb.from('missions').select('current_round, title').eq('id', missionId).single();
        const currentRound = missionForRound?.current_round ?? 1;

        const roundId = `round-${missionId}-r${currentRound}`;
        const completedTaskData = siblings?.filter(t => t.status === 'completed') ?? [];
        const roundTokens = completedTaskData.reduce((sum, t) => sum + ((t as Record<string, unknown>).tokens_used as number ?? 0), 0);
        const roundCost = completedTaskData.reduce((sum, t) => sum + ((t as Record<string, unknown>).cost_usd as number ?? 0), 0);

        // Calculate duration from earliest start to latest completion
        const taskStarts = completedTaskData
          .map(t => (t as Record<string, unknown>).started_at as string | null)
          .filter((s): s is string => !!s)
          .map(s => new Date(s).getTime());
        const taskEnds = completedTaskData
          .map(t => (t as Record<string, unknown>).completed_at as string | null)
          .filter((s): s is string => !!s)
          .map(s => new Date(s).getTime());
        const roundDurationMs = taskStarts.length > 0 && taskEnds.length > 0
          ? Math.max(...taskEnds) - Math.min(...taskStarts)
          : null;

        await saveMissionRound({
          id: roundId,
          mission_id: missionId,
          round_number: currentRound,
          agent_id: null,
          status: 'completed',
          tokens_used: roundTokens,
          cost_usd: roundCost,
          duration_ms: roundDurationMs,
          task_count: siblings?.length ?? 0,
          started_at: taskStarts.length > 0 ? new Date(Math.min(...taskStarts)).toISOString() : null,
          completed_at: new Date().toISOString(),
        });

        // Fire-and-forget CEO evaluation
        import('./ceoEvaluator').then(({ evaluateMission }) => {
          const taskResults = completedTaskData.map(t => ({
            skill_id: (t as Record<string, unknown>).skill_id as string,
            output: (((t as Record<string, unknown>).result as Record<string, unknown>)?.output as string) ?? '',
            tokens: (t as Record<string, unknown>).tokens_used as number ?? 0,
            cost: (t as Record<string, unknown>).cost_usd as number ?? 0,
          }));
          const startMs = taskStarts.length > 0 ? Math.min(...taskStarts) : Date.now();
          const endMs = Date.now();

          evaluateMission(missionForRound?.title ?? 'Untitled', taskResults, endMs - startMs).then(score => {
            if (score) {
              updateMissionRound(roundId, {
                quality_score: score.quality,
                completeness_score: score.completeness,
                efficiency_score: score.efficiency,
                overall_score: score.overall,
                grade: score.grade,
                ceo_review: score.review,
                ceo_recommendation: score.recommendation,
              });
            }
          }).catch(err => console.warn('[TaskDispatcher] Mission evaluation failed:', err));
        }).catch(err => console.warn('[TaskDispatcher] Failed to load evaluator:', err));
      } catch (err) {
        console.warn('[TaskDispatcher] Round scoring failed:', err);
      }

      // For multi-task missions, synthesize a unified summary (awaited so we can use the output)
      let synthesizedSummaryText: string | null = null;
      if (!isSingle && completedCount >= 2) {
        const { data: missionRow } = await sb.from('missions').select('title').eq('id', missionId).single();
        try {
          await synthesizeMissionSummary(missionId, missionRow?.title ?? 'Untitled Mission');
          // Read the synthesized output back from the DB
          const { data: summaryTask } = await sb
            .from('task_executions')
            .select('result')
            .eq('mission_id', missionId)
            .eq('skill_id', 'mission-summary')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (summaryTask?.result && (summaryTask.result as Record<string, unknown>).output) {
            synthesizedSummaryText = (summaryTask.result as Record<string, unknown>).output as string;
          }
        } catch (err) {
          console.warn('[TaskDispatcher] Summary synthesis failed:', err);
        }
      }

      // Post CEO summary to chat — prefer conversationId from dispatch context, fall back to most recent active
      let convoId = conversationId;
      if (!convoId) {
        const { data: convos } = await sb
          .from('conversations')
          .select('id')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1);
        convoId = convos?.[0]?.id;
      }

      if (convoId) {
        const brief = resultText.slice(0, 300).replace(/\n+/g, ' ').trim();
        const ellipsis = resultText.length > 300 ? '...' : '';

        let summary: string;
        if (autoComplete) {
          // Quick task, founder watching — auto-summarize via LLM if enabled
          const autoSummaryEnabled = autoSummarySetting !== 'false';
          const trimmed = resultText.trim();
          const isRawData = (trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 100;

          if (autoSummaryEnabled && isRawData) {
            // LLM auto-summary: have the CEO summarize the raw data naturally
            try {
              const { getVaultEntryByService } = await import('./database');
              const vaultEntry = await getVaultEntryByService('Anthropic');
              if (vaultEntry) {
                const { anthropicProvider } = await import('./llm/providers/anthropic');
                const { MODEL_API_IDS } = await import('./models');
                const ceoName = ceoRow?.name ?? 'CEO';

                const summaryResult = await new Promise<string | null>((resolve) => {
                  let fullText = '';
                  anthropicProvider.stream(
                    [{
                      role: 'user',
                      content: `You are ${ceoName}, an AI CEO reporting results to the founder.
Summarize this data concisely in 2-5 sentences. Use natural language, include key numbers/names. No markdown tables. Be conversational.
IMPORTANT: Always preserve IDs (post IDs, channel slugs, instance IDs) in your summary — the founder may need them for follow-up actions.

Skill: ${skillId}:${commandName}
Raw result:
${resultText.slice(0, 2000)}`,
                    }],
                    vaultEntry.key_value,
                    MODEL_API_IDS['Claude Haiku 4.5'],
                    {
                      onToken: (token: string) => { fullText += token; },
                      onDone: (text: string) => { resolve(text || fullText); },
                      onError: () => { resolve(null); },
                    },
                  );
                });

                summary = summaryResult || `Done — ${brief}${ellipsis}`;
              } else {
                // No API key — fall back to basic count summary
                summary = `Done — ${brief}${ellipsis}`;
              }
            } catch {
              summary = `Done — ${brief}${ellipsis}`;
            }
          } else if (isRawData) {
            // Auto-summary disabled — show basic count
            try {
              const parsed = JSON.parse(trimmed);
              const keys = Object.keys(parsed);
              const counts = keys
                .filter(k => Array.isArray(parsed[k]))
                .map(k => `${parsed[k].length} ${k}`);
              summary = counts.length > 0
                ? `Done — ${counts.join(', ')} returned.`
                : `Done — ${brief}${ellipsis}`;
            } catch {
              summary = `Done — ${brief}${ellipsis}`;
            }
          } else {
            summary = resultText;
          }
        } else if (isSingle) {
          // Single task but founder not watching — brief summary + pointer
          summary = `Done — ${brief}${ellipsis}\n\nFull results in Collateral.`;
        } else {
          // Multi-task mission — use synthesized summary if available, fall back to generic
          summary = synthesizedSummaryText
            ?? `Mission complete — ${completedCount} task(s) finished. Full results in Collateral.`;
        }

        await sb.from('chat_messages').insert({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: convoId,
          sender: 'ceo',
          text: summary,
          metadata: autoComplete
            ? {
                type: 'skill_result',
                mission_id: missionId,
                skill_id: skillId,
                output_type: 'inline',
                auto_completed: true,
                actions: [
                  ...(showTellMe ? [{ id: 'tell_me', label: 'TELL ME NOW', action: 'auto_submit', text: 'Tell me about the results' }] : []),
                  { id: 'view', label: 'VIEW IN COLLATERAL', action: 'navigate', target: `/collateral?artifact=${taskId}` },
                ],
              }
            : {
                type: 'mission_complete',
                mission_id: missionId,
                skill_id: skillId,
                output_type: 'review',
                actions: [
                  ...(showTellMe ? [{ id: 'tell_me', label: 'TELL ME NOW', action: 'auto_submit', text: 'Tell me about the results' }] : []),
                  { id: 'approve', label: 'LOOKS GOOD', action: 'approve_mission' },
                  { id: 'review', label: 'REVIEW IN MISSIONS', action: 'navigate', target: `/missions/${missionId}` },
                  { id: 'collateral', label: 'VIEW COLLATERAL', action: 'navigate', target: `/collateral?artifact=${taskId}` },
                ],
              },
        });

        // Trigger UI update
        emitEvent('chat-messages-changed');
      }

      // Queue CEO proactive action for multi-task or review missions
      if (!autoComplete) {
        const mTitle = missionStatus === 'review'
          ? (await sb.from('missions').select('title').eq('id', missionId).single()).data?.title ?? missionId
          : missionId;
        try {
          const { queueCEOAction } = await import('./ceoActionQueue');
          await queueCEOAction(
            'mission_review',
            `Mission complete: ${mTitle}`,
            `I've finished ${completedCount} task(s). Ready for your review.`,
            { mission_id: missionId, task_count: completedCount },
          );
        } catch { /* ignore action queue errors */ }
      }
    }

    emitEvent('missions-changed');
    emitEvent('task-executions-changed');

    // Extract collateral memories from the result (fire-and-forget, after chat message is posted)
    Promise.resolve(
      sb.from('missions').select('title').eq('id', missionId).maybeSingle(),
    ).then(({ data: missionForTitle }) =>
      extractCollateralMemories(
        { output: resultText, summary: resultText.slice(0, 200) },
        missionForTitle?.title ?? 'Untitled Mission',
        skillId,
        missionId,
      ),
    ).catch((err: unknown) => console.warn('[TaskDispatcher] Collateral memory extraction failed:', err));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Browser-side skill execution failed [${skillId}]:`, errorMsg);

    await sb.from('task_executions').update({
      status: 'failed',
      result: { error: errorMsg },
      completed_at: new Date().toISOString(),
    }).eq('id', taskId);

    // Post error to chat — prefer conversationId from dispatch context
    let convoId = conversationId;
    if (!convoId) {
      const { data: convos } = await sb
        .from('conversations')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);
      convoId = convos?.[0]?.id;
    }
    if (convoId) {
      // Detect vault/API key errors and offer a shortcut to the Vault page
      const isVaultError = /api.?key|vault|credential/i.test(errorMsg);
      const isSessionLock = /session.?signing.?is.?locked|session.?key.?not.?available/i.test(errorMsg);
      const actions = isSessionLock
        ? [{ id: 'unlock-key', label: 'UNLOCK SESSION KEY', action: 'navigate', target: '/key' }]
        : isVaultError
          ? [{ id: 'vault', label: 'GO TO VAULT', action: 'navigate', target: '/vault' }]
          : [];

      await sb.from('chat_messages').insert({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversation_id: convoId,
        sender: 'ceo',
        text: `I ran into an issue executing ${skillId}: ${errorMsg}`,
        metadata: { type: 'skill_error', skill_id: skillId, mission_id: missionId, ...(actions.length > 0 ? { actions } : {}) },
      });
      emitEvent('chat-messages-changed');
    }

    await sb.from('missions').update({ status: 'review' }).eq('id', missionId);
    emitEvent('missions-changed');
    emitEvent('task-executions-changed');
  }
}

/** Create missions + task_executions and dispatch to edge function (with browser fallback) */
export async function dispatchTaskPlan(
  missions: ParsedMission[],
  model: string,
  context?: DispatchContext,
): Promise<string[]> {
  const sb = getSupabase();
  const ceo = await loadCEO();
  const missionIds: string[] = [];

  for (const mission of missions) {
    // Build context payload with relevant memories + conversation
    const taskContext = await buildTaskContext(mission, context);

    // Resolve mission: use explicit ID → match existing scheduled by title → create new
    let missionId = '';

    if (mission.missionId) {
      // CEO explicitly referenced an existing mission — activate it
      missionId = mission.missionId;
      await sb.from('missions').update({
        status: 'in_progress',
        scheduled_for: null,
        assignee: ceo?.name ?? 'CEO',
      }).eq('id', missionId);
    } else {
      // Check for existing scheduled mission with matching title
      const { data: existing } = await sb
        .from('missions')
        .select('id')
        .eq('status', 'scheduled')
        .ilike('title', mission.title.trim())
        .limit(1)
        .maybeSingle();

      if (existing) {
        missionId = existing.id;
        await sb.from('missions').update({
          status: 'in_progress',
          scheduled_for: null,
          assignee: ceo?.name ?? 'CEO',
        }).eq('id', missionId);
      } else {
        missionId = `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { error: missionErr } = await sb.from('missions').insert({
          id: missionId,
          title: mission.title,
          status: 'in_progress',
          assignee: ceo?.name ?? 'CEO',
          priority: 'medium',
          created_by: ceo?.name ?? 'CEO',
        });
        if (missionErr) {
          console.error('Failed to insert mission:', missionErr.message, missionErr.details);
          continue;
        }
      }
    }
    missionIds.push(missionId);

    // Create task_executions and dispatch
    for (const call of mission.toolCalls) {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // CEO format: { name, command, arguments } — command may be top-level or inside arguments
      const commandName = (call as Record<string, unknown>).command as string
        ?? call.arguments.command as string
        ?? call.name;

      // Block forum write commands that have no real params (hallucinated tool_calls).
      // When the founder explicitly asks and CEO provides actual params, let them through.
      const FORUM_WRITE_COMMANDS = new Set(['forum:reply', 'forum:vote', 'forum:create_post', 'forum:introduce']);
      const cmdKey = `${call.name}:${commandName}`;
      if (FORUM_WRITE_COMMANDS.has(cmdKey)) {
        const argKeys = Object.keys(call.arguments ?? {}).filter(k => k !== 'command');
        if (argKeys.length === 0) {
          console.warn(`[dispatchTaskPlan] Blocked empty-param forum command "${cmdKey}"`);
          continue;
        }
      }

      const { error: taskInsertErr } = await sb.from('task_executions').insert({
        id: taskId,
        mission_id: missionId,
        agent_id: context?.agentId ?? 'ceo',
        skill_id: call.name,
        command_name: commandName,
        params: call.arguments,
        model,
        status: 'pending',
        context: taskContext,
      });
      if (taskInsertErr) {
        console.error('Failed to insert task_execution:', taskInsertErr.message, taskInsertErr.details);
        continue; // skip this task
      }

      // Try edge function first, fall back to browser-side execution
      const supabaseUrl = (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : undefined)
        || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL ?? process.env?.SUPABASE_URL : undefined)
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('jarvis_supabase_url') : '')
        || '';
      const anonKey = (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_ANON_KEY : undefined)
        || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_ANON_KEY ?? process.env?.SUPABASE_ANON_KEY : undefined)
        || (typeof localStorage !== 'undefined' ? localStorage.getItem('jarvis_supabase_anon_key') : '')
        || '';

      const founderPresent = !!(context?.founderPresent);

      // CEO-direct tasks skip edge function entirely
      if (call.name === 'ceo-direct') {
        executeCEODirect(taskId, missionId, call.arguments, model, founderPresent, context?.conversationId)
          .catch(err => console.error('[dispatchTaskPlan] CEO-direct execution failed:', err));
        continue;
      }

      const runBrowserFallback = () =>
        executeBrowserSide(taskId, missionId, call.name, commandName, call.arguments, model, founderPresent, context?.conversationId);

      // Fast timeout: abort the edge function fetch after 3s to avoid 10-15s delays
      // when no edge function is deployed (common in self-hosted Supabase)
      const edgeAbort = new AbortController();
      const edgeTimeout = setTimeout(() => edgeAbort.abort(), 3_000);

      fetch(`${supabaseUrl}/functions/v1/execute-skill`, {
        method: 'POST',
        signal: edgeAbort.signal,
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ task_execution_id: taskId }),
      }).then(async (resp) => {
        clearTimeout(edgeTimeout);
        if (!resp.ok) {
          const errText = await resp.text().catch(() => 'Unknown error');
          console.warn(`Edge function returned ${resp.status}: ${errText}. Falling back to browser execution.`);
          await runBrowserFallback();
          return;
        }
        // Edge function returned 200 — check after 5s if it actually processed.
        setTimeout(async () => {
          try {
            const { data: check } = await sb
              .from('task_executions')
              .select('status')
              .eq('id', taskId)
              .single();
            if (check?.status === 'pending') {
              console.warn('Edge function returned 200 but task still pending after 5s. Running browser fallback.');
              await runBrowserFallback();
            } else if (founderPresent) {
              // Edge function completed it — check for founder-present auto-done
              const { data: siblings } = await sb
                .from('task_executions')
                .select('status')
                .eq('mission_id', missionId);
              const allDone = siblings?.every(t => t.status === 'completed' || t.status === 'failed');
              const isSingle = (siblings?.length ?? 0) === 1;
              const isTabVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
              if (allDone && isSingle && isTabVisible) {
                await sb.from('missions').update({ status: 'done' }).eq('id', missionId);
                emitEvent('missions-changed');
              }
            }
          } catch { /* ignore timeout check errors */ }
        }, 5_000);
      }).catch(async (err) => {
        clearTimeout(edgeTimeout);
        console.warn('Edge function unreachable:', err.message ?? err, '— falling back to browser execution.');
        await runBrowserFallback();
      });
    }
  }

  emitEvent('missions-changed');
  emitEvent('task-executions-changed');
  return missionIds;
}

// ---------------------------------------------------------------------------
// LLM-powered mission planning — CEO picks skill + params intelligently
// ---------------------------------------------------------------------------

/**
 * Ask the CEO's LLM to plan how to execute a mission.
 * Returns the chosen skill, command, params, and model — or null if LLM unavailable.
 */
async function planMissionWithLLM(
  missionTitle: string,
): Promise<{ skillId: string; commandName: string; params: Record<string, unknown>; model: string; planningTokens: number } | null> {
  // Check LLM availability inline (avoid circular import with chatService)
  const ceo = await loadCEO();
  if (!ceo?.model) return null;

  const service = MODEL_SERVICE_MAP[ceo.model] ?? '';
  if (!service) return null;

  const vaultEntry = await getVaultEntryByService(service);
  if (!vaultEntry) return null;

  const apiModelId = MODEL_API_IDS[ceo.model] ?? ceo.model;

  // Load enabled skills with full command definitions
  const allResolved = await resolveSkills();
  const enabled = allResolved.filter(s => s.enabled && s.commands && s.commands.length > 0);
  if (enabled.length === 0) return null;

  const skillLines = enabled.map(s => {
    const cmds = s.commands?.map(c => {
      const paramLines = c.parameters?.map(p => {
        const req = p.required ? 'REQUIRED' : `optional, default: ${p.default ?? 'none'}`;
        return `      ${p.name} (${p.type}, ${req}): ${p.description}`;
      }).join('\n') ?? '';
      return `  - ${c.name}: ${c.description ?? ''}\n    Parameters:\n${paramLines}`;
    }).join('\n') ?? '';
    return `- ${s.id}: ${s.name} — ${s.description ?? ''}\n${cmds}`;
  }).join('\n');

  // Relevant memories for context
  const memories = await getMemories(20);
  const memoryLines = memories
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 15)
    .map(m => `- [${m.category}] ${m.content}`)
    .join('\n');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const localTime = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  // DB-first prompt with hardcoded fallback
  const dbPlanningPrompt = await getPrompt('ceo-mission-planning');
  const prompt = dbPlanningPrompt
    ? dbPlanningPrompt
        .replace(/\{\{MISSION_TITLE\}\}/g, missionTitle)
        .replace(/\{\{TODAY\}\}/g, today)
        .replace(/\{\{LOCAL_TIME\}\}/g, localTime)
        .replace(/\{\{SKILL_LIST\}\}/g, skillLines)
        .replace(/\{\{MEMORY_LINES\}\}/g, memoryLines || 'No memories yet.')
    : `You are an AI CEO planning how to execute a mission. Pick the best skill and command, and fill in ALL parameters with meaningful, specific values.

Mission: "${missionTitle}"
Today: ${today} at ${localTime}

## Available Skills
${skillLines}

## Special Option: ceo-direct
Use "ceo-direct" for tasks that DON'T need external tools — tasks about YOUR OWN organization's internal data:
- Memory summaries ("what do we know about X", "summarize our memories")
- Org reports ("team report", "org review", "what has the team done")
- Internal analysis ("review our decisions", "what are our priorities")
- Founder profile questions ("what does the founder care about")

## Org Memory (context for better parameters)
${memoryLines || 'No memories yet.'}

## Instructions
1. Choose the single best skill and command for this mission
2. If the mission is about internal org data/memory/team review, use "ceo-direct" with command "synthesize" and argument "topic" containing the specific question
3. Fill in ALL required parameters with specific, actionable values derived from the mission title and your memory context
4. For research queries, make the query detailed and specific — include date context if relevant
5. For document writing, include the full topic and any relevant context from memory
6. Output EXACTLY one tool_call block, nothing else:

<tool_call>{"name":"skill-id","command":"command_name","arguments":{"param":"value"}}</tool_call>`;

  // Get provider
  const { anthropicProvider } = await import('./llm/providers/anthropic');
  const { openaiProvider, deepseekProvider, xaiProvider } = await import('./llm/providers/openai');
  const { googleProvider } = await import('./llm/providers/google');
  const providers: Record<string, typeof anthropicProvider> = {
    Anthropic: anthropicProvider, OpenAI: openaiProvider, Google: googleProvider,
    DeepSeek: deepseekProvider, xAI: xaiProvider,
  };
  const provider = providers[service];
  if (!provider) return null;

  const messages = [
    { role: 'system' as const, content: prompt },
    { role: 'user' as const, content: `Execute this mission now: "${missionTitle}"` },
  ];

  const responseText = await new Promise<string>((resolve, reject) => {
    provider.stream(messages, vaultEntry.key_value, apiModelId, {
      onToken: () => {},
      onDone: (fullText: string) => resolve(fullText),
      onError: (err: Error) => reject(err),
    });
  });

  // Parse tool_call from response
  const parsed = parseTaskPlan(responseText);
  if (parsed.length === 0 || parsed[0].toolCalls.length === 0) {
    console.warn('[planMissionWithLLM] LLM did not produce a tool_call:', responseText.slice(0, 200));
    return null;
  }

  const call = parsed[0].toolCalls[0];
  const commandName = (call as Record<string, unknown>).command as string
    ?? call.arguments.command as string
    ?? call.name;

  // Log usage (fire-and-forget)
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.ceil(responseText.length / 4);
  import('./llmUsage').then(({ logUsage }) =>
    logUsage({
      provider: service,
      model: ceo.model,
      inputTokens,
      outputTokens,
      context: 'mission_planning',
      agentId: 'ceo',
    }).catch(err => console.warn('[planMissionWithLLM] Usage log failed:', err)),
  );

  console.log(`[planMissionWithLLM] CEO planned: ${call.name}/${commandName}`, call.arguments);

  return {
    skillId: call.name,
    commandName,
    params: call.arguments,
    model: ceo.model,
    planningTokens: inputTokens + outputTokens,
  };
}

/**
 * CEO-direct execution: synthesize org memory/data without external skill.
 * Used for memory summaries, org reports, team reviews — internal data tasks.
 */
async function executeCEODirect(
  taskId: string,
  missionId: string,
  params: Record<string, unknown>,
  model: string,
  founderPresent = false,
  conversationId?: string,
): Promise<void> {
  const sb = getSupabase();

  await sb.from('task_executions').update({
    status: 'running',
    started_at: new Date().toISOString(),
  }).eq('id', taskId);

  try {
    const ceo = await loadCEO();
    const service = MODEL_SERVICE_MAP[model] ?? MODEL_SERVICE_MAP[ceo?.model ?? ''] ?? '';
    const vaultEntry = service ? await getVaultEntryByService(service) : null;

    if (!service || !vaultEntry) {
      throw new Error('No LLM API key available for CEO-direct execution');
    }

    // Load rich org context
    const orgMemories = await getMemories(50);
    const archivedMemories = await queryMemories(String(params.topic ?? ''), 20);

    // Load recent collateral (task results)
    const { data: recentCollateral } = await sb
      .from('task_executions')
      .select('skill_id, command_name, result, created_at')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(15);

    const topic = String(params.topic ?? params.query ?? 'organizational summary');

    const memoryBlock = orgMemories
      .sort((a, b) => b.importance - a.importance)
      .map(m => `- [${m.category}] (importance: ${m.importance}) ${m.content}`)
      .join('\n');

    const collateralBlock = (recentCollateral ?? [])
      .map(t => {
        const output = (t.result as Record<string, unknown>)?.output as string ?? '';
        return `- ${t.skill_id}/${t.command_name} (${t.created_at?.slice(0, 10)}): ${output.slice(0, 200)}`;
      })
      .join('\n');

    const synthesisPrompt = `You are an AI CEO synthesizing internal organizational data.

Topic: "${topic}"

## Organizational Memory (${orgMemories.length} entries)
${memoryBlock || 'No memories recorded yet.'}

## Recent Task Results (${recentCollateral?.length ?? 0} entries)
${collateralBlock || 'No recent task outputs.'}

## Instructions
Create a comprehensive, well-structured response about "${topic}" using ONLY the organizational data above.
- Organize by theme or relevance
- Highlight key insights, decisions, and patterns
- Note any gaps in knowledge
- Use markdown formatting (headers, bullets, bold)
- Be thorough but avoid repetition`;

    const { anthropicProvider } = await import('./llm/providers/anthropic');
    const { openaiProvider, deepseekProvider, xaiProvider } = await import('./llm/providers/openai');
    const { googleProvider } = await import('./llm/providers/google');
    const providers: Record<string, typeof anthropicProvider> = {
      Anthropic: anthropicProvider, OpenAI: openaiProvider, Google: googleProvider,
      DeepSeek: deepseekProvider, xAI: xaiProvider,
    };
    const provider = providers[service];
    if (!provider) throw new Error(`No provider for service: ${service}`);

    const apiModelId = MODEL_API_IDS[model] ?? model;
    const messages = [
      { role: 'system' as const, content: 'You are an executive AI assistant providing internal organizational intelligence.' },
      { role: 'user' as const, content: synthesisPrompt },
    ];

    const resultText = await new Promise<string>((resolve, reject) => {
      provider.stream(messages, vaultEntry.key_value, apiModelId, {
        onToken: () => {},
        onDone: (fullText: string) => resolve(fullText),
        onError: (err: Error) => reject(err),
      });
    });

    const inputTokens = Math.ceil(synthesisPrompt.length / 4);
    const outputTokens = Math.ceil(resultText.length / 4);

    // Log usage
    import('./llmUsage').then(({ logUsage }) =>
      logUsage({
        provider: service,
        model,
        inputTokens,
        outputTokens,
        context: 'ceo_direct',
        agentId: 'ceo',
      }).catch(err => console.warn('[executeCEODirect] Usage log failed:', err)),
    );

    // Store result — then delegate to executeBrowserSide's completion logic
    // by updating the task and letting the shared completion flow handle it
    await sb.from('task_executions').update({
      status: 'completed',
      result: {
        output: resultText,
        summary: resultText.slice(0, 200),
        artifact_type: 'document',
      },
      tokens_used: inputTokens + outputTokens,
      cost_usd: 0,
      completed_at: new Date().toISOString(),
    }).eq('id', taskId);

    // Reuse the completion flow from executeBrowserSide for scoring, chat, etc.
    // We'll trigger the same post-completion checks
    const { data: siblings } = await sb
      .from('task_executions')
      .select('status, tokens_used, cost_usd, started_at, completed_at, result, skill_id')
      .eq('mission_id', missionId);

    const allComplete = siblings?.every(t => t.status === 'completed' || t.status === 'failed');

    if (allComplete) {
      const { data: missionMeta } = await sb.from('missions').select('created_by, title').eq('id', missionId).single();
      const ceoRow2 = await loadCEO();
      const createdBy2 = missionMeta?.created_by?.toLowerCase() ?? '';
      const wasScheduled = createdBy2 === 'ceo' || createdBy2 === 'scheduler' || createdBy2 === (ceoRow2?.name ?? '').toLowerCase();
      const isTabVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
      const autoComplete = wasScheduled || (founderPresent && isTabVisible);

      await sb.from('missions').update({ status: autoComplete ? 'done' : 'review' }).eq('id', missionId);

      // Post to chat
      let convoId = conversationId;
      if (!convoId) {
        const { data: convos } = await sb.from('conversations')
          .select('id').eq('status', 'active')
          .order('created_at', { ascending: false }).limit(1);
        convoId = convos?.[0]?.id;
      }

      if (convoId) {
        const autoSummarySetting = await getSetting('ceo_auto_summary');
        const showTellMe = autoSummarySetting === 'false';

        await sb.from('chat_messages').insert({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          conversation_id: convoId,
          sender: 'ceo',
          text: autoComplete ? resultText : `Done — ${resultText.slice(0, 300).replace(/\n+/g, ' ').trim()}...\n\nFull results in Collateral.`,
          metadata: autoComplete
            ? {
                type: 'skill_result',
                mission_id: missionId,
                skill_id: 'ceo-direct',
                output_type: 'inline',
                auto_completed: true,
                actions: [
                  ...(showTellMe ? [{ id: 'tell_me', label: 'TELL ME NOW', action: 'auto_submit', text: 'Tell me about the results' }] : []),
                  { id: 'view', label: 'VIEW IN COLLATERAL', action: 'navigate', target: `/collateral?artifact=${taskId}` },
                ],
              }
            : {
                type: 'mission_complete',
                mission_id: missionId,
                skill_id: 'ceo-direct',
                output_type: 'review',
                actions: [
                  ...(showTellMe ? [{ id: 'tell_me', label: 'TELL ME NOW', action: 'auto_submit', text: 'Tell me about the results' }] : []),
                  { id: 'approve', label: 'LOOKS GOOD', action: 'approve_mission' },
                  { id: 'review', label: 'REVIEW IN MISSIONS', action: 'navigate', target: `/missions/${missionId}` },
                  { id: 'collateral', label: 'VIEW COLLATERAL', action: 'navigate', target: `/collateral?artifact=${taskId}` },
                ],
              },
        });
        emitEvent('chat-messages-changed');
      }

      // Fire-and-forget CEO evaluation
      try {
        const completedTaskData = siblings?.filter(t => t.status === 'completed') ?? [];
        const roundId = `round-${missionId}-r1`;
        const roundTokens = completedTaskData.reduce((sum, t) => sum + ((t as Record<string, unknown>).tokens_used as number ?? 0), 0);

        await saveMissionRound({
          id: roundId,
          mission_id: missionId,
          round_number: 1,
          agent_id: null,
          status: 'completed',
          tokens_used: roundTokens,
          cost_usd: 0,
          duration_ms: null,
          task_count: siblings?.length ?? 0,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });

        import('./ceoEvaluator').then(({ evaluateMission }) => {
          evaluateMission(missionMeta?.title ?? 'Untitled', [{
            skill_id: 'ceo-direct',
            output: resultText,
            tokens: inputTokens + outputTokens,
            cost: 0,
          }], 0).then(score => {
            if (score) {
              updateMissionRound(roundId, {
                quality_score: score.quality,
                completeness_score: score.completeness,
                efficiency_score: score.efficiency,
                overall_score: score.overall,
                grade: score.grade,
                ceo_review: score.review,
                ceo_recommendation: score.recommendation,
              });
            }
          }).catch(err => console.warn('[executeCEODirect] Evaluation failed:', err));
        }).catch(err => console.warn('[executeCEODirect] Failed to load evaluator:', err));
      } catch (err) {
        console.warn('[executeCEODirect] Round scoring failed:', err);
      }
    }

    emitEvent('missions-changed');
    emitEvent('task-executions-changed');

    // Extract collateral memories
    extractCollateralMemories(
      { output: resultText, summary: resultText.slice(0, 200) },
      topic,
      'ceo-direct',
      missionId,
    ).catch((err: unknown) => console.warn('[executeCEODirect] Collateral memory extraction failed:', err));

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[executeCEODirect] Failed:', errorMsg);

    await sb.from('task_executions').update({
      status: 'failed',
      result: { error: errorMsg },
      completed_at: new Date().toISOString(),
    }).eq('id', taskId);

    await sb.from('missions').update({ status: 'review' }).eq('id', missionId);
    emitEvent('missions-changed');
    emitEvent('task-executions-changed');
  }
}

/**
 * Auto-dispatch a mission that's in_progress but has no task_executions.
 * Uses CEO LLM intelligence to pick the right skill + params, with
 * keyword-matching fallback if LLM is unavailable.
 * Returns true if a task was dispatched, false otherwise.
 */
export async function autoDispatchMission(missionId: string): Promise<boolean> {
  const sb = getSupabase();

  // Skip if mission already has tasks
  const { data: existingTasks } = await sb
    .from('task_executions')
    .select('id')
    .eq('mission_id', missionId)
    .limit(1);

  if (existingTasks && existingTasks.length > 0) return false;

  // Load mission
  const { data: mission } = await sb
    .from('missions')
    .select('*')
    .eq('id', missionId)
    .single();

  if (!mission) return false;

  // Try LLM-powered planning first (CEO intelligence)
  let plan: { skillId: string; commandName: string; params: Record<string, unknown>; model: string; planningTokens: number } | null = null;
  try {
    plan = await planMissionWithLLM(mission.title);
  } catch (err) {
    console.warn('[autoDispatchMission] LLM planning failed, falling back to keyword matching:', err);
  }

  // Fallback: keyword matching if LLM unavailable or failed
  if (!plan) {
    const recommended = recommendSkills(mission.title);
    if (recommended.length === 0) {
      console.warn(`[autoDispatchMission] No skills matched for "${mission.title}"`);
      return false;
    }
    const skillId = recommended[0];
    const skill = await resolveSkill(skillId);
    if (!skill?.commands?.length) return false;
    const command = skill.commands[0];
    const model = skill.model ?? skill.defaultModel ?? 'Claude Sonnet 4.5';
    const params: Record<string, unknown> = {};
    for (const p of command.parameters ?? []) {
      if (p.required) params[p.name] = mission.title;
    }
    plan = { skillId, commandName: command.name, params, model, planningTokens: 0 };
  }

  // Build task context with memories (same context the task executor receives)
  const taskContext = await buildTaskContext(
    { title: mission.title, toolCalls: [{ name: plan.skillId, arguments: plan.params }] },
  );

  // Create task_execution
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: insertErr } = await sb.from('task_executions').insert({
    id: taskId,
    mission_id: missionId,
    agent_id: mission.assignee ?? 'ceo',
    skill_id: plan.skillId,
    command_name: plan.commandName,
    params: plan.params,
    model: plan.model,
    status: 'pending',
    context: taskContext,
    tokens_used: plan.planningTokens ?? 0,
  });

  if (insertErr) {
    console.error('[autoDispatchMission] Failed to insert task:', insertErr);
    return false;
  }

  if (typeof window !== 'undefined') {
    emitEvent('task-executions-changed');
  }

  logAudit(
    mission.assignee ?? 'CEO',
    'TASK_AUTO_DISPATCHED',
    `Auto-dispatched "${plan.skillId}/${plan.commandName}" for mission "${mission.title}" (${plan === null ? 'keyword' : 'LLM-planned'})`,
    'info',
  );

  // Fire off execution — route ceo-direct to its own handler
  if (plan.skillId === 'ceo-direct') {
    executeCEODirect(taskId, missionId, plan.params, plan.model, false)
      .catch(err => console.error('[autoDispatchMission] CEO-direct execution failed:', err));
  } else {
    executeBrowserSide(taskId, missionId, plan.skillId, plan.commandName, plan.params, plan.model, false)
      .catch(err => console.error('[autoDispatchMission] Execution failed:', err));
  }

  return true;
}

/** Execute a single pre-created task execution (for recurring replays) */
export async function executeTask(
  taskId: string,
  missionId: string,
  skillId: string,
  commandName: string,
  params: Record<string, unknown>,
  model: string,
): Promise<void> {
  return executeBrowserSide(taskId, missionId, skillId, commandName, params, model, false);
}

/**
 * Re-run a failed/review mission: resets its failed task_executions to pending
 * and immediately re-dispatches them browser-side.
 */
export async function rerunMission(missionId: string): Promise<void> {
  const sb = getSupabase();

  // Move mission back to in_progress
  await sb.from('missions').update({ status: 'in_progress' }).eq('id', missionId);

  // Get all task_executions for this mission (only failed ones need re-running)
  const { data: tasks } = await sb
    .from('task_executions')
    .select('*')
    .eq('mission_id', missionId)
    .in('status', ['failed', 'pending']);

  if (!tasks || tasks.length === 0) {
    emitEvent('missions-changed');
    return;
  }

  for (const task of tasks) {
    // Reset task to pending
    await sb.from('task_executions').update({
      status: 'pending',
      started_at: null,
      completed_at: null,
      result: null,
    }).eq('id', task.id);

    // Fire off execution immediately
    const skillId = task.skill_id as string;
    const commandName = task.command_name as string;
    const params = (task.params as Record<string, unknown>) ?? {};
    const model = (task.model as string) ?? 'Claude Sonnet 4.5';

    executeBrowserSide(task.id, missionId, skillId, commandName, params, model, true)
      .catch(err => console.error(`Rerun failed for task ${task.id}:`, err));
  }

  emitEvent('missions-changed');
  emitEvent('task-executions-changed');
}

/**
 * Reject a mission and start a new round.
 * Updates the current round, creates a new round row, and re-dispatches.
 */
export async function rejectAndRedoMission(
  missionId: string,
  options: { feedback: string; strategy: 'include_collateral' | 'start_fresh' },
): Promise<void> {
  const sb = getSupabase();

  // Load current mission state
  const { data: missionData } = await sb.from('missions')
    .select('current_round, title, assignee')
    .eq('id', missionId)
    .single();
  if (!missionData) return;

  const currentRound = missionData.current_round ?? 1;
  const newRound = currentRound + 1;

  // Update current round in mission_rounds (if exists)
  const { data: existingRounds } = await sb.from('mission_rounds')
    .select('id')
    .eq('mission_id', missionId)
    .eq('round_number', currentRound);

  if (existingRounds && existingRounds.length > 0) {
    await sb.from('mission_rounds').update({
      status: 'rejected',
      rejection_feedback: options.feedback,
      redo_strategy: options.strategy,
      completed_at: new Date().toISOString(),
    }).eq('id', existingRounds[0].id);
  }

  // Create new round row
  const newRoundId = `round-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await sb.from('mission_rounds').insert({
    id: newRoundId,
    mission_id: missionId,
    round_number: newRound,
    agent_id: missionData.assignee ?? null,
    status: 'in_progress',
  });

  // Update mission: increment round, back to in_progress
  await sb.from('missions').update({
    current_round: newRound,
    status: 'in_progress',
  }).eq('id', missionId);

  // Get failed/completed tasks from previous round for context
  const { data: previousTasks } = await sb.from('task_executions')
    .select('*')
    .eq('mission_id', missionId)
    .in('status', ['completed', 'failed']);

  if (!previousTasks || previousTasks.length === 0) {
    emitEvent('missions-changed');
    return;
  }

  // Re-dispatch: reset failed tasks and re-run them
  for (const task of previousTasks.filter(t => t.status === 'failed')) {
    await sb.from('task_executions').update({
      status: 'pending',
      started_at: null,
      completed_at: null,
      result: null,
    }).eq('id', task.id);

    executeBrowserSide(task.id, missionId, task.skill_id, task.command_name, task.params ?? {}, task.model ?? 'Claude Sonnet 4.5', false)
      .catch(err => console.error(`Redo failed for task ${task.id}:`, err));
  }

  // For completed tasks in include_collateral mode — they stay as-is (agent can reference)
  // For start_fresh — reset completed tasks too
  if (options.strategy === 'start_fresh') {
    for (const task of previousTasks.filter(t => t.status === 'completed')) {
      await sb.from('task_executions').update({
        status: 'pending',
        started_at: null,
        completed_at: null,
        result: null,
      }).eq('id', task.id);

      executeBrowserSide(task.id, missionId, task.skill_id, task.command_name, task.params ?? {}, task.model ?? 'Claude Sonnet 4.5', false)
        .catch(err => console.error(`Redo failed for task ${task.id}:`, err));
    }
  }

  await logAudit('Founder', 'MISSION_REJECTED', `Rejected round ${currentRound} of "${missionData.title}": ${options.feedback}`, 'warning');

  emitEvent('missions-changed');
  emitEvent('task-executions-changed');
}
