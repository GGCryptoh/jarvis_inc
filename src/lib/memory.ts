/**
 * Jarvis Inc -- Memory Service
 * ============================
 * CRUD operations for org_memory + conversation_summaries tables.
 * Provides memory extraction from conversations via LLM and
 * keyword-based memory querying (pgvector cosine distance planned later).
 */

import { getSupabase } from './supabase';
import type { ChatMessageRow } from './database';
import { loadCEO, getVaultEntryByService, saveArchivedMemory, logAudit, getPrompt, type ArchivedMemoryRow } from './database';
import { MODEL_SERVICE_MAP, MODEL_API_IDS } from './models';
import type { LLMMessage, LLMProvider } from './llm/types';
import { anthropicProvider } from './llm/providers/anthropic';
import { openaiProvider, deepseekProvider, xaiProvider } from './llm/providers/openai';
import { googleProvider } from './llm/providers/google';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryRow {
  id: string;
  category: string;
  content: string;
  source: string | null;
  tags: string[];
  importance: number;
  embedding: unknown | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface MemoryInput {
  id?: string;
  category: string;
  content: string;
  source?: string | null;
  tags?: string[];
  importance?: number;
}

export interface ConversationSummaryRow {
  id: string;
  conversation_id: string;
  summary: string;
  message_range: { from_id: string; to_id: string; count: number };
  created_at: string;
}

// ---------------------------------------------------------------------------
// Provider registry (mirrors chatService.ts)
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, LLMProvider> = {
  Anthropic: anthropicProvider,
  OpenAI:    openaiProvider,
  Google:    googleProvider,
  DeepSeek:  deepseekProvider,
  xAI:       xaiProvider,
};

// ---------------------------------------------------------------------------
// Internal: call LLM non-streaming (collect full text via stream callbacks)
// ---------------------------------------------------------------------------

async function callLLM(messages: LLMMessage[]): Promise<string | null> {
  const ceo = await loadCEO();
  if (!ceo) return null;

  const service = MODEL_SERVICE_MAP[ceo.model] ?? '';
  if (!service || !PROVIDERS[service]) return null;

  const vaultEntry = await getVaultEntryByService(service);
  if (!vaultEntry) return null;

  const apiModelId = MODEL_API_IDS[ceo.model] ?? ceo.model;
  const provider = PROVIDERS[service];

  return new Promise<string | null>((resolve) => {
    let fullText = '';
    provider.stream(messages, vaultEntry.key_value, apiModelId, {
      onToken: (token) => { fullText += token; },
      onDone: (text) => { resolve(text || fullText); },
      onError: (err) => {
        console.warn('Memory LLM call failed:', err);
        resolve(null);
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Memory CRUD
// ---------------------------------------------------------------------------

export async function saveMemory(memory: MemoryInput): Promise<MemoryRow> {
  const id = memory.id ?? `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const row = {
    id,
    category: memory.category,
    content: memory.content,
    source: memory.source ?? null,
    tags: memory.tags ?? [],
    importance: memory.importance ?? 5,
    updated_at: now,
  };

  await getSupabase()
    .from('org_memory')
    .upsert(row, { onConflict: 'id' });

  // Re-read to get full row with server defaults
  const { data } = await getSupabase()
    .from('org_memory')
    .select('id, category, content, source, tags, importance, embedding, created_at, updated_at, expires_at')
    .eq('id', id)
    .single();

  if (data) return data as MemoryRow;

  // Fallback: return constructed row if read-back fails
  return {
    id,
    category: row.category,
    content: row.content,
    source: row.source,
    tags: row.tags,
    importance: row.importance,
    embedding: null,
    created_at: now,
    updated_at: now,
    expires_at: null,
  };
}

export async function getMemories(limit = 50): Promise<MemoryRow[]> {
  const { data } = await getSupabase()
    .from('org_memory')
    .select('id, category, content, source, tags, importance, embedding, created_at, updated_at, expires_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as MemoryRow[];
}

export async function getMemoriesByCategory(category: string, limit = 50): Promise<MemoryRow[]> {
  const { data } = await getSupabase()
    .from('org_memory')
    .select('id, category, content, source, tags, importance, embedding, created_at, updated_at, expires_at')
    .eq('category', category)
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as MemoryRow[];
}

export async function getMemoriesByTags(tags: string[], limit = 50): Promise<MemoryRow[]> {
  const { data } = await getSupabase()
    .from('org_memory')
    .select('id, category, content, source, tags, importance, embedding, created_at, updated_at, expires_at')
    .overlaps('tags', tags)
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as MemoryRow[];
}

export async function queryMemories(text: string, limit = 20): Promise<MemoryRow[]> {
  // MVP: keyword search via ilike on content.
  // Future: pgvector cosine distance on embedding column.
  const keywords = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (keywords.length === 0) return getMemories(limit);

  // Search content for any keyword match
  // Use OR filter: content ilike any of the keywords
  const { data } = await getSupabase()
    .from('org_memory')
    .select('id, category, content, source, tags, importance, embedding, created_at, updated_at, expires_at')
    .or(keywords.map(k => `content.ilike.%${k}%`).join(','))
    .order('importance', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as MemoryRow[];
}

export async function deleteMemory(id: string): Promise<void> {
  await getSupabase().from('org_memory').delete().eq('id', id);
}

// ---------------------------------------------------------------------------
// LLM-Powered Memory Chat
// ---------------------------------------------------------------------------

export async function chatWithMemories(query: string): Promise<{ answer: string; relevantMemories: MemoryRow[] }> {
  // 1. Load top memories by importance
  const allMemories = await getMemories(100);

  // 2. Build memory context
  const memoryContext = allMemories.map(m =>
    `[${m.category}] (importance: ${m.importance}) ${m.content} [tags: ${m.tags?.join(', ') ?? ''}]`
  ).join('\n');

  // 3. Call LLM with system prompt + memories + user question
  const dbMemoryChatSystem = await getPrompt('memory-chat-system');
  const systemPrompt = dbMemoryChatSystem ?? `You are an organizational memory assistant. You have access to the following organizational memories. Answer the user's question based on these memories. If the answer isn't in the memories, say so. Be concise and direct.

MEMORIES:
${memoryContext}`;

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: query },
  ];

  const answer = await callLLM(messages) ?? 'Unable to process your question — no LLM key configured.';

  // 4. Return which memories are likely relevant (keyword match for highlighting)
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const relevantMemories = keywords.length > 0
    ? allMemories.filter(m =>
        keywords.some(k => m.content.toLowerCase().includes(k) || m.tags?.some(t => t.toLowerCase().includes(k)))
      )
    : allMemories.slice(0, 10);

  return { answer, relevantMemories };
}

// ---------------------------------------------------------------------------
// Memory Extraction from Conversations
// ---------------------------------------------------------------------------

const ARCHETYPE_FOCUS: Record<string, string> = {
  wharton_mba: `Pay special attention to: market positioning, competitive strategy, ROI discussions, resource allocation decisions, framework references, business metrics.`,
  wall_street: `Pay special attention to: financial targets, cost concerns, risk/reward trade-offs, portfolio allocation, revenue goals, budget constraints, opportunity costs.`,
  mit_engineer: `Pay special attention to: technical decisions, architecture choices, optimization trade-offs, system constraints, engineering requirements, data-driven reasoning.`,
  sv_founder: `Pay special attention to: product-market fit signals, user feedback, shipping velocity, pivot decisions, growth metrics, iteration speed, competitive landscape.`,
  beach_bum: `Pay special attention to: work-life balance preferences, sustainable pace discussions, long-term vision over short-term urgency, team wellbeing, creative approaches.`,
  military_cmd: `Pay special attention to: mission objectives, operational constraints, chain of command decisions, resource deployment, contingency planning, situational awareness.`,
  creative_dir: `Pay special attention to: design preferences, aesthetic choices, quality standards, user experience priorities, brand voice, creative direction.`,
  professor: `Pay special attention to: evidence-based decisions, analytical frameworks, uncertainty acknowledgments, research priorities, methodology choices, structured reasoning.`,
};

async function buildExtractionPrompt(archetype?: string | null): Promise<string> {
  const focusBlock = archetype && ARCHETYPE_FOCUS[archetype]
    ? `\n\n${ARCHETYPE_FOCUS[archetype]}`
    : '';

  const hardcodedPrompt = `You are a memory extraction system for an AI-run organization. Analyze the following conversation and extract important facts, decisions, preferences, insights, and reminders that should be remembered for future interactions.

Return a JSON array of objects with these fields:
- "category": one of "fact", "decision", "preference", "insight", "reminder", "founder_profile"
- "content": a clear, concise statement of the memory (one sentence)
- "tags": array of 1-3 relevant keyword tags
- "importance": integer 1-10 (10 = critical organizational knowledge, 1 = trivial)

Focus on:
- **Founder personal details** (location, timezone, industry, background, communication style) → category: "founder_profile", importance: 8-10
- **Founder stated preferences** (likes, dislikes, priorities, how they want things done) → category: "preference", importance: 7-9
- **Decisions made** by the founder or CEO → category: "decision"
- **Key facts** about the organization, its goals, constraints, or market → category: "fact"
- **Strategic insights** discussed → category: "insight"
- **Action items or reminders** mentioned → category: "reminder"
${focusBlock}

IMPORTANT: Personal details about the founder (where they live, their background, their style preferences) are HIGH importance — these shape every future interaction. "The founder lives in Philadelphia" is importance 9, not 3.

When task results are discussed (research findings, generated content, analysis), extract the SPECIFIC findings (company names, numbers, rankings, conclusions, URLs), NOT just "research was done." These are organizational knowledge — importance: 7-9.

Only extract genuinely important information. Do NOT extract greetings, small talk, or trivial exchanges.
If there is nothing worth remembering, return an empty array: []

Return ONLY the JSON array, no other text.`;

  const dbPrompt = await getPrompt('memory-extraction');
  return dbPrompt ?? hardcodedPrompt;
}

export async function extractMemories(
  messages: ChatMessageRow[],
  conversationId: string,
): Promise<MemoryRow[]> {
  if (messages.length === 0) return [];

  // Load CEO archetype for personality-aware extraction
  const ceo = await loadCEO();
  const archetype = ceo?.archetype ?? null;

  // Format conversation for the LLM (strip base64 to avoid token explosion)
  const stripBase64 = (t: string) => t.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]{200,}/g, '[image]');
  const conversationText = messages
    .map(m => `[${m.sender.toUpperCase()}]: ${stripBase64(m.text)}`)
    .join('\n');

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: await buildExtractionPrompt(archetype) },
    { role: 'user', content: conversationText },
  ];

  const response = await callLLM(llmMessages);
  if (!response) return [];

  // Parse JSON from response (handle potential markdown code blocks)
  let parsed: Array<{ category: string; content: string; tags: string[]; importance: number }>;
  try {
    const jsonStr = response.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
  } catch (err) {
    console.warn('Failed to parse memory extraction response:', err);
    return [];
  }

  // Load existing memories for dedup check
  const existing = await getMemories(200);
  const existingContentLower = existing.map(m => m.content.toLowerCase().trim());

  // Save each extracted memory (skip duplicates)
  const validCategories = new Set(['fact', 'decision', 'preference', 'insight', 'reminder', 'founder_profile']);
  const saved: MemoryRow[] = [];

  for (const item of parsed) {
    if (!item.content || typeof item.content !== 'string') continue;

    const contentLower = item.content.toLowerCase().trim();

    // Skip if we already have a very similar memory (exact match or substring containment)
    const isDuplicate = existingContentLower.some(existing =>
      existing === contentLower ||
      existing.includes(contentLower) ||
      contentLower.includes(existing)
    );
    if (isDuplicate) {
      // If the new one has higher importance, update the existing one
      const existingMatch = existing.find(m =>
        m.content.toLowerCase().trim() === contentLower ||
        m.content.toLowerCase().trim().includes(contentLower) ||
        contentLower.includes(m.content.toLowerCase().trim())
      );
      if (existingMatch) {
        const newImportance = typeof item.importance === 'number'
          ? Math.max(1, Math.min(10, Math.round(item.importance)))
          : 5;
        if (newImportance > existingMatch.importance) {
          await saveMemory({
            id: existingMatch.id,
            category: existingMatch.category,
            content: existingMatch.content,
            source: existingMatch.source,
            tags: existingMatch.tags,
            importance: newImportance,
          });
        }
      }
      continue;
    }

    const category = validCategories.has(item.category) ? item.category : 'fact';
    const tags = Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : [];
    const importance = typeof item.importance === 'number'
      ? Math.max(1, Math.min(10, Math.round(item.importance)))
      : 5;

    const row = await saveMemory({
      category,
      content: item.content,
      source: conversationId,
      tags,
      importance,
    });
    saved.push(row);

    // Add to dedup list for this batch
    existingContentLower.push(contentLower);
  }

  if (saved.length > 0) {
    logAudit('CEO', 'MEMORY_EXTRACTED', `Extracted ${saved.length} memories from conversation`, 'info');
  }

  return saved;
}

// ---------------------------------------------------------------------------
// Conversation Summaries
// ---------------------------------------------------------------------------

export async function saveConversationSummary(
  conversationId: string,
  summary: string,
  fromId: string,
  toId: string,
  count: number,
): Promise<void> {
  const id = `summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await getSupabase()
    .from('conversation_summaries')
    .insert({
      id,
      conversation_id: conversationId,
      summary,
      message_range: { from_id: fromId, to_id: toId, count },
    });
}

export async function getConversationSummaries(
  conversationId: string,
): Promise<ConversationSummaryRow[]> {
  const { data } = await getSupabase()
    .from('conversation_summaries')
    .select('id, conversation_id, summary, message_range, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at');
  return (data ?? []) as ConversationSummaryRow[];
}

const SUMMARIZE_PROMPT = `You are a conversation summarizer. Summarize the following conversation messages into a concise paragraph that captures the key points, decisions made, topics discussed, and any action items. Keep it under 200 words. Return ONLY the summary text, no other formatting.`;

export async function summarizeOldMessages(
  conversationId: string,
  messages: ChatMessageRow[],
): Promise<string | null> {
  if (messages.length < 50) return null;

  // Summarize the oldest chunk (first 30 messages)
  const chunkSize = 30;
  const chunk = messages.slice(0, chunkSize);
  const fromId = chunk[0].id;
  const toId = chunk[chunkSize - 1].id;

  const conversationText = chunk
    .map(m => `[${m.sender.toUpperCase()}]: ${m.text}`)
    .join('\n');

  const summarizePrompt = (await getPrompt('memory-summarization')) ?? SUMMARIZE_PROMPT;

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: summarizePrompt },
    { role: 'user', content: conversationText },
  ];

  const summary = await callLLM(llmMessages);
  if (!summary) return null;

  await saveConversationSummary(conversationId, summary, fromId, toId, chunkSize);
  return summary;
}

// ---------------------------------------------------------------------------
// Collateral → Memory Extraction
// ---------------------------------------------------------------------------

const COLLATERAL_EXTRACTION_PROMPT = `You are a memory extraction system for an AI-run organization. Analyze the following task execution result and extract key SUBSTANTIVE findings that should be remembered.

Return a JSON array of objects with these fields:
- "category": one of "fact", "insight", "decision"
- "content": a clear, concise statement of a specific finding (one sentence)
- "tags": array of 1-3 relevant keyword tags
- "importance": integer 7-9 (these are organizational research findings)

CRITICAL RULES:
- Extract SPECIFIC entities: company names, people, numbers, rankings, dates, URLs, conclusions
- Do NOT extract meta-descriptions like "research was done" or "analysis was performed"
- Each memory should be a standalone fact someone could reference later
- Maximum 7 entries — prioritize the most important findings
- If the result is too vague or has no substantive findings, return: []

Return ONLY the JSON array, no other text.`;

export async function extractCollateralMemories(
  result: { output: string; summary?: string },
  missionTitle: string,
  skillId: string,
  missionId: string,
): Promise<void> {
  const text = result.output ?? result.summary ?? '';
  if (text.length < 100) return; // Too short to contain substantive findings

  // Strip base64 data URIs
  const cleanText = text.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]{200,}/g, '[image]');

  const collateralPrompt = (await getPrompt('memory-collateral-extraction')) ?? COLLATERAL_EXTRACTION_PROMPT;

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: collateralPrompt },
    { role: 'user', content: `Mission: "${missionTitle}"\nSkill: ${skillId}\n\n--- Task Result ---\n${cleanText.slice(0, 4000)}` },
  ];

  const response = await callLLM(llmMessages);
  if (!response) return;

  let parsed: Array<{ category: string; content: string; tags: string[]; importance: number }>;
  try {
    const jsonStr = response.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return;
  } catch {
    console.warn('[Memory] Failed to parse collateral extraction response');
    return;
  }

  // Load existing for dedup
  const existing = await getMemories(200);
  const existingContentLower = existing.map(m => m.content.toLowerCase().trim());

  const validCategories = new Set(['fact', 'insight', 'decision']);
  let savedCount = 0;

  for (const item of parsed) {
    if (savedCount >= 7) break;
    if (!item.content || typeof item.content !== 'string') continue;

    const contentLower = item.content.toLowerCase().trim();
    const isDuplicate = existingContentLower.some(e =>
      e === contentLower || e.includes(contentLower) || contentLower.includes(e),
    );
    if (isDuplicate) continue;

    const category = validCategories.has(item.category) ? item.category : 'fact';
    const tags = Array.isArray(item.tags)
      ? ['collateral', skillId, ...item.tags.filter((t): t is string => typeof t === 'string')]
      : ['collateral', skillId];
    const importance = typeof item.importance === 'number'
      ? Math.max(7, Math.min(9, Math.round(item.importance)))
      : 7;

    await saveMemory({
      category,
      content: item.content,
      source: missionId,
      tags,
      importance,
    });

    existingContentLower.push(contentLower);
    savedCount++;
  }

  if (savedCount > 0) {
    console.log(`[Memory] Extracted ${savedCount} collateral memories from mission "${missionTitle}"`);
  }
}

// ---------------------------------------------------------------------------
// Daily Memory Consolidation
// ---------------------------------------------------------------------------

const TOPIC_CONSOLIDATION_PROMPT = `You are a memory deduplication system. You will receive a list of organizational memories in the same category. Your job is to merge them into the FEWEST possible distinct entries by eliminating redundancy.

RULES:
1. If two memories say the same thing in different words, MERGE them into one.
2. If one memory is a subset of another (e.g., "Geoff" vs "Geoff Hopkins"), keep only the more complete version.
3. If memories contain GENUINELY DIFFERENT facts, keep them as separate entries.
4. Preserve specific details: names, numbers, locations, dates, URLs.
5. Drop vague or trivial memories that are implied by more specific ones.

Return a JSON array of consolidated memory strings. Each string is one distinct fact/decision/preference.

Example input:
- The founder's name is Geoff.
- The founder's name is Geoff Hopkins and their title is Principal.
- The founder lives in Philadelphia.
- The founder is located in Philadelphia, Pennsylvania.

Example output:
["The founder is Geoff Hopkins, title Principal.", "The founder lives in Philadelphia, Pennsylvania."]

Return ONLY the JSON array. No commentary.`;

const DAILY_DIGEST_PROMPT = `Write a one-line daily digest summarizing these topic summaries. Format: "key event 1; key event 2; key event 3". Max 200 chars.

Return ONLY the digest line. No formatting.`;

export async function consolidateDailyMemories(): Promise<{
  consolidated: number; deleted: number; topicCount: number;
  beforeCounts: Record<string, number>; afterCounts: Record<string, number>;
}> {
  const sb = getSupabase();

  // Get ALL memories (no date filter — manual consolidation should clean everything)
  const { data: oldMemories } = await sb
    .from('org_memory')
    .select('id, category, content, source, tags, importance, updated_at')
    .order('updated_at', { ascending: false });

  // Compute beforeCounts from ALL memories (including today's)
  const { data: allMemsBefore } = await sb
    .from('org_memory')
    .select('category');
  const beforeCounts: Record<string, number> = {};
  for (const m of allMemsBefore ?? []) {
    beforeCounts[m.category] = (beforeCounts[m.category] ?? 0) + 1;
  }

  if (!oldMemories || oldMemories.length === 0) {
    return { consolidated: 0, deleted: 0, topicCount: 0, beforeCounts, afterCounts: { ...beforeCounts } };
  }

  // Group memories by category
  const groups = new Map<string, typeof oldMemories>();
  for (const mem of oldMemories) {
    const cat = mem.category as string;
    const list = groups.get(cat) ?? [];
    list.push(mem);
    groups.set(cat, list);
  }

  const categoryResults: { category: string; entries: string[]; sourceIds: string[]; importance: number; tags: string[] }[] = [];
  let deletedCount = 0;

  const consolidationPrompt = (await getPrompt('memory-consolidation')) ?? TOPIC_CONSOLIDATION_PROMPT;

  for (const [category, mems] of groups) {
    if (mems.length < 2) {
      // Single memory — keep it in org_memory, don't consolidate
      continue;
    }

    // Build memory text for LLM
    const memoryText = mems.map(m => `- ${m.content}`).join('\n');

    const llmMessages: LLMMessage[] = [
      { role: 'system', content: consolidationPrompt },
      { role: 'user', content: `Category: ${category}\n\n${memoryText}` },
    ];

    const response = await callLLM(llmMessages);
    if (!response) continue; // LLM failed — skip this group, try next time

    // Parse JSON array of deduplicated entries
    let entries: string[];
    try {
      const jsonStr = response.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        entries = parsed.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
      } else {
        // Fallback: treat as single summary string
        entries = [response.trim()];
      }
    } catch {
      // Fallback: treat as single summary string
      entries = [response.trim()];
    }

    if (entries.length === 0) continue;

    const sourceIds = mems.map(m => m.id as string);
    const maxImportance = Math.max(...mems.map(m => (m.importance as number) ?? 5));
    const allTags = [...new Set(mems.flatMap(m => (m.tags as string[]) ?? []))];

    categoryResults.push({
      category,
      entries,
      sourceIds,
      importance: maxImportance,
      tags: allTags,
    });
  }

  if (categoryResults.length === 0) {
    return { consolidated: 0, deleted: 0, topicCount: 0, beforeCounts, afterCounts: { ...beforeCounts } };
  }

  // Determine the day for archiving (use the most recent memory's date)
  const archiveDay = oldMemories[0].updated_at.slice(0, 10);

  // Save per-category consolidated text to archived_memories (full text for history)
  for (const cr of categoryResults) {
    const id = `arch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveArchivedMemory({
      id,
      day: archiveDay,
      topic: cr.category,
      consolidated: cr.entries.join(' | '),
      source_count: cr.sourceIds.length,
      source_ids: cr.sourceIds,
      importance: cr.importance,
      tags: cr.tags,
    });
  }

  // Delete originals from org_memory
  const allSourceIds = categoryResults.flatMap(cr => cr.sourceIds);
  for (const id of allSourceIds) {
    await deleteMemory(id);
    deletedCount++;
  }

  // Insert deduplicated entries back into org_memory (one row per distinct fact)
  for (const cr of categoryResults) {
    for (const entry of cr.entries) {
      await saveMemory({
        category: cr.category,
        content: entry,
        source: 'consolidation',
        tags: ['consolidated', ...cr.tags.filter(t => t !== 'consolidated')],
        importance: cr.importance,
      });
    }
  }

  // Generate daily digest
  const dailyDigestPrompt = (await getPrompt('memory-daily-digest')) ?? DAILY_DIGEST_PROMPT;
  const digestInput = categoryResults.map(cr => `[${cr.category}]: ${cr.entries.join('; ')}`).join('\n');
  const digestMessages: LLMMessage[] = [
    { role: 'system', content: dailyDigestPrompt },
    { role: 'user', content: digestInput },
  ];
  const digest = await callLLM(digestMessages);

  if (digest) {
    const digestId = `arch-digest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveArchivedMemory({
      id: digestId,
      day: archiveDay,
      topic: null, // null = daily digest
      consolidated: digest.trim().slice(0, 200),
      source_count: categoryResults.reduce((sum, cr) => sum + cr.sourceIds.length, 0),
      source_ids: [],
      importance: 8,
      tags: ['daily-digest'],
    });
  }

  // Compute afterCounts from current org_memory state
  const { data: allMemsAfter } = await sb
    .from('org_memory')
    .select('category');
  const afterCounts: Record<string, number> = {};
  for (const m of allMemsAfter ?? []) {
    afterCounts[m.category] = (afterCounts[m.category] ?? 0) + 1;
  }

  const newEntryCount = categoryResults.reduce((sum, cr) => sum + cr.entries.length, 0);
  console.log(`[Memory] Consolidated ${deletedCount} memories into ${newEntryCount} deduplicated entries across ${categoryResults.length} categories`);
  logAudit('CEO', 'MEMORY_CONSOLIDATED', `Consolidated ${deletedCount} memories into ${newEntryCount} entries across ${categoryResults.length} categories`, 'info');

  return {
    consolidated: deletedCount,
    deleted: deletedCount,
    topicCount: categoryResults.length,
    beforeCounts,
    afterCounts,
  };
}

// ---------------------------------------------------------------------------
// Smart Memory Cleanup (LLM-powered dedup, merge, re-score, prune)
// ---------------------------------------------------------------------------

/**
 * Smart memory cleanup — LLM-powered dedup, merge, re-score, and prune.
 * Returns an audit report string.
 */
export async function smartMemoryCleanup(mode: 'smart' | 'consolidate' | 'report' = 'smart'): Promise<string> {
  // If mode is 'consolidate', just run existing consolidation
  if (mode === 'consolidate') {
    const result = await consolidateDailyMemories();
    return `## Memory Consolidation Report\n\n- Consolidated: ${result.consolidated} memories\n- Deleted: ${result.deleted} originals\n- Categories: ${result.topicCount}\n`;
  }

  const sb = getSupabase();

  // Load all memories
  const { data: allMemories, error } = await sb
    .from('org_memory')
    .select('*')
    .order('created_at', { ascending: true });

  if (error || !allMemories || allMemories.length === 0) {
    return '## Memory Cleanup Report\n\nNo memories to analyze.';
  }

  const totalBefore = allMemories.length;

  // Format memories for LLM analysis
  const memoryList = allMemories.map(m => ({
    id: m.id,
    category: m.category,
    content: m.content,
    importance: m.importance,
    tags: m.tags,
    created_at: m.created_at,
  }));

  // Build prompt
  const dbPrompt = await getPrompt('memory-cleanup');
  const systemPrompt = dbPrompt ?? 'You are an AI memory management system. Analyze organizational memories and identify duplicates, related entries to merge, importance re-scoring needs, and low-value entries to prune. Be conservative — when in doubt, keep the memory. Founder profile memories are HIGH priority.';

  const userPrompt = `Analyze these ${totalBefore} organizational memories and return a JSON cleanup plan:\n\n${JSON.stringify(memoryList, null, 2)}\n\nReturn ONLY valid JSON:\n{"merge": [{"keep_id": "id", "remove_ids": ["id2"], "merged_content": "text", "new_importance": 7}], "rescore": [{"id": "id", "old_importance": 5, "new_importance": 8, "reason": "why"}], "prune": [{"id": "id", "reason": "why"}], "summary": "Brief audit"}`;

  // Call LLM via the shared callLLM helper
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const responseText = await callLLM(messages);
  if (!responseText) {
    return '## Memory Cleanup Report\n\nLLM analysis failed — no LLM key configured or call errored.';
  }

  // Parse LLM response — extract JSON from potential markdown fences
  let plan: {
    merge?: { keep_id: string; remove_ids: string[]; merged_content: string; new_importance: number }[];
    rescore?: { id: string; old_importance: number; new_importance: number; reason: string }[];
    prune?: { id: string; reason: string }[];
    summary?: string;
  };

  try {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, responseText];
    plan = JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return `## Memory Cleanup Report\n\nFailed to parse LLM cleanup plan. Raw response:\n\n${responseText.slice(0, 500)}`;
  }

  // If report mode, just return what would happen
  if (mode === 'report') {
    const mergeCount = plan.merge?.length ?? 0;
    const rescoreCount = plan.rescore?.length ?? 0;
    const pruneCount = plan.prune?.length ?? 0;
    const removeCount = (plan.merge?.reduce((sum, m) => sum + m.remove_ids.length, 0) ?? 0) + pruneCount;

    let report = `## Memory Cleanup Report (DRY RUN)\n\n`;
    report += `**${totalBefore} memories analyzed**\n\n`;
    report += `### Would merge: ${mergeCount} groups\n`;
    for (const m of plan.merge ?? []) {
      report += `- Keep \`${m.keep_id}\`, remove ${m.remove_ids.length} duplicate(s) → "${m.merged_content.slice(0, 80)}..."\n`;
    }
    report += `\n### Would re-score: ${rescoreCount} memories\n`;
    for (const r of plan.rescore ?? []) {
      report += `- \`${r.id}\`: ${r.old_importance} → ${r.new_importance} (${r.reason})\n`;
    }
    report += `\n### Would prune: ${pruneCount} memories\n`;
    for (const p of plan.prune ?? []) {
      report += `- \`${p.id}\`: ${p.reason}\n`;
    }
    report += `\n### Net reduction: ${removeCount} memories (${totalBefore} → ${totalBefore - removeCount}), ${Math.round((removeCount / totalBefore) * 100)}% reduction\n`;
    report += `\n${plan.summary ?? ''}`;
    return report;
  }

  // Execute the plan
  let mergedCount = 0;
  let removedCount = 0;
  let rescoredCount = 0;
  let prunedCount = 0;

  // 1. Merge groups
  for (const group of plan.merge ?? []) {
    // Update the kept memory with merged content
    await sb.from('org_memory').update({
      content: group.merged_content,
      importance: group.new_importance,
      updated_at: new Date().toISOString(),
    }).eq('id', group.keep_id);

    // Delete the duplicates
    for (const removeId of group.remove_ids) {
      await sb.from('org_memory').delete().eq('id', removeId);
      removedCount++;
    }
    mergedCount++;
  }

  // 2. Re-score
  for (const entry of plan.rescore ?? []) {
    await sb.from('org_memory').update({
      importance: entry.new_importance,
      updated_at: new Date().toISOString(),
    }).eq('id', entry.id);
    rescoredCount++;
  }

  // 3. Prune
  for (const entry of plan.prune ?? []) {
    await sb.from('org_memory').delete().eq('id', entry.id);
    prunedCount++;
    removedCount++;
  }

  const totalAfter = totalBefore - removedCount;
  const reductionPct = totalBefore > 0 ? Math.round((removedCount / totalBefore) * 100) : 0;

  // Build audit report
  let report = `## Memory Cleanup Report\n\n`;
  report += `**${totalBefore} memories analyzed → ${totalAfter} remaining (${reductionPct}% reduction)**\n\n`;
  report += `| Action | Count |\n|--------|-------|\n`;
  report += `| Merge groups | ${mergedCount} |\n`;
  report += `| Duplicates removed | ${removedCount - prunedCount} |\n`;
  report += `| Re-scored | ${rescoredCount} |\n`;
  report += `| Pruned (low-value) | ${prunedCount} |\n`;
  report += `| **Total removed** | **${removedCount}** |\n\n`;
  report += plan.summary ? `### AI Summary\n${plan.summary}\n` : '';

  // Log audit
  await logAudit('CEO', 'MEMORY_CLEANUP', `Smart cleanup: ${removedCount} removed, ${mergedCount} merged, ${rescoredCount} re-scored (${totalBefore} → ${totalAfter}, ${reductionPct}% reduction)`, 'info');

  return report;
}
