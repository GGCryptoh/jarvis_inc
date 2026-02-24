import { loadCEO, getVaultEntryByService, getPrompt } from './database';
import { MODEL_SERVICE_MAP, MODEL_API_IDS, MODEL_COSTS } from './models';
import { logUsage } from './llmUsage';

const MAX_EVAL_CHARS = 48_000; // ~12K tokens — fits any 128K+ model with room for system prompt

/** Find the cheapest model for a given service (by total per-1M cost) */
function cheapestModelForService(service: string): string | null {
  let best: string | null = null;
  let bestCost = Infinity;
  for (const [model, svc] of Object.entries(MODEL_SERVICE_MAP)) {
    if (svc !== service) continue;
    const [inp, out] = MODEL_COSTS[model] ?? [Infinity, Infinity];
    const total = inp + out;
    if (total < bestCost) { bestCost = total; best = model; }
  }
  return best;
}

export interface MissionScore {
  quality: number;        // 0-100
  completeness: number;   // 0-100
  efficiency: number;     // 0-100
  overall: number;        // 0-100
  grade: string;          // A+, A, B+, B, B-, C+, C, C-, D, F
  review: string;         // 2-3 sentence evaluation
  recommendation: 'approve' | 'reject' | 'needs_revision';
}

export async function evaluateMission(
  missionTitle: string,
  taskResults: { skill_id: string; output: string; tokens: number; cost: number }[],
  durationMs: number,
): Promise<MissionScore | null> {
  try {
    const ceo = await loadCEO();
    if (!ceo?.model) return null;

    const service = MODEL_SERVICE_MAP[ceo.model] ?? '';
    const vaultEntry = service ? await getVaultEntryByService(service) : null;
    if (!service || !vaultEntry) return null;

    // Dynamic provider imports — same pattern as synthesizeMissionSummary
    const { anthropicProvider } = await import('./llm/providers/anthropic');
    const { openaiProvider, deepseekProvider, xaiProvider } = await import('./llm/providers/openai');
    const { googleProvider } = await import('./llm/providers/google');
    const providers: Record<string, typeof anthropicProvider> = {
      Anthropic: anthropicProvider, OpenAI: openaiProvider, Google: googleProvider,
      DeepSeek: deepseekProvider, xAI: xaiProvider,
    };
    const provider = providers[service];
    if (!provider) return null;

    // Use cheapest model for the same service — evaluation doesn't need the CEO's main model
    const evalModel = cheapestModelForService(service) ?? ceo.model;
    const apiModelId = MODEL_API_IDS[evalModel] ?? evalModel;

    const hardcodedEvalPrompt = `You are a CEO evaluating mission results. Score the work on four dimensions (0-100 each):
- Quality: How good is the output? Is it thorough, accurate, well-structured?
- Completeness: Did the agent fully address what was asked?
- Efficiency: Was the work done with reasonable token/cost usage for its complexity?
- Overall: Your holistic assessment combining all factors.

IMPORTANT SCORING GUIDELINES:
- For very low-cost tasks (under $0.05): Be lenient. If the task was completed and produced a result, don't fail it. A simple lookup or list operation costing a penny is fine — grade C+ or above if it returned useful data.
- For moderate-cost tasks ($0.05-$0.50): Normal scoring. Expect solid output proportional to cost.
- For expensive tasks ($0.50+): High standards. Expect thorough, well-structured, comprehensive results.
- If output is marked as [OUTPUT TRUNCATED], the full result WAS delivered to the user successfully. Score completeness based on what IS shown — do not penalize for truncation. The task completed fully.

Assign a letter grade: A+ (95-100), A (90-94), B+ (85-89), B (80-84), B- (75-79), C+ (70-74), C (65-69), C- (60-64), D (50-59), F (0-49).

Recommend one of: approve (good work), needs_revision (minor issues), reject (significant problems).

Respond ONLY with a JSON object, no markdown fences:
{"quality":N,"completeness":N,"efficiency":N,"overall":N,"grade":"X","review":"2-3 sentences","recommendation":"approve|reject|needs_revision"}`;

    const systemPrompt = (await getPrompt('mission-evaluation')) ?? hardcodedEvalPrompt;

    const totalCost = taskResults.reduce((sum, t) => sum + t.cost, 0);
    const userPrompt = `Mission: "${missionTitle}"
Duration: ${Math.round(durationMs / 1000)}s
Tasks completed: ${taskResults.length}
Total cost: $${totalCost.toFixed(4)}

Results:
${taskResults.map((t, i) => {
  const outputText = t.output.length > MAX_EVAL_CHARS
    ? t.output.slice(0, MAX_EVAL_CHARS) + `\n\n[OUTPUT TRUNCATED — showing ${MAX_EVAL_CHARS} of ${t.output.length} chars. The full output was delivered successfully.]`
    : t.output;
  return `--- Task ${i + 1}: ${t.skill_id} (${t.tokens} tokens, $${t.cost.toFixed(4)}) ---\n${outputText}`;
}).join('\n\n')}

Score this mission.`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    const rawResponse = await new Promise<string>((resolve, reject) => {
      provider.stream(messages, vaultEntry.key_value, apiModelId, {
        onToken: () => {},
        onDone: (fullText: string) => resolve(fullText),
        onError: (err: Error) => reject(err),
      });
    });

    // Log LLM usage
    const inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
    const outputTokens = Math.ceil(rawResponse.length / 4);
    logUsage({
      provider: service,
      model: evalModel,
      inputTokens,
      outputTokens,
      context: 'skill_execution',
      agentId: 'ceo',
    }).catch(() => {}); // fire-and-forget

    // Parse JSON response
    const score = parseScoreResponse(rawResponse);
    return score;
  } catch (err) {
    console.warn('[CEOEvaluator] Mission evaluation failed:', err);
    return null;
  }
}

function parseScoreResponse(raw: string): MissionScore | null {
  let jsonStr = raw.trim();

  // Try direct parse first
  try {
    return validateScore(JSON.parse(jsonStr));
  } catch {
    // Fall through to fence extraction
  }

  // Try extracting from markdown fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return validateScore(JSON.parse(fenceMatch[1].trim()));
    } catch {
      // Fall through
    }
  }

  // Try finding a JSON object in the text
  const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return validateScore(JSON.parse(braceMatch[0]));
    } catch {
      // Fall through
    }
  }

  console.warn('[CEOEvaluator] Could not parse score JSON from response:', raw.slice(0, 200));
  return null;
}

function clamp(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function validateScore(obj: Record<string, unknown>): MissionScore | null {
  if (!obj || typeof obj !== 'object') return null;

  const quality = clamp(obj.quality, 0, 100);
  const completeness = clamp(obj.completeness, 0, 100);
  const efficiency = clamp(obj.efficiency, 0, 100);
  const overall = clamp(obj.overall, 0, 100);

  const validGrades = ['A+', 'A', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'];
  const grade = validGrades.includes(obj.grade as string) ? (obj.grade as string) : gradeFromScore(overall);

  const validRecs = ['approve', 'reject', 'needs_revision'] as const;
  const recommendation = validRecs.includes(obj.recommendation as typeof validRecs[number])
    ? (obj.recommendation as typeof validRecs[number])
    : (overall >= 70 ? 'approve' : overall >= 50 ? 'needs_revision' : 'reject');

  const review = typeof obj.review === 'string' && obj.review.length > 0
    ? obj.review
    : 'No review provided.';

  return { quality, completeness, efficiency, overall, grade, review, recommendation };
}

function gradeFromScore(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 75) return 'B-';
  if (score >= 70) return 'C+';
  if (score >= 65) return 'C';
  if (score >= 60) return 'C-';
  if (score >= 50) return 'D';
  return 'F';
}
