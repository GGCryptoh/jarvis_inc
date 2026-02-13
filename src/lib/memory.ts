/**
 * Jarvis Inc -- Memory Service
 * ============================
 * CRUD operations for org_memory + conversation_summaries tables.
 * Provides memory extraction from conversations via LLM and
 * keyword-based memory querying (pgvector cosine distance planned later).
 */

import { getSupabase } from './supabase';
import type { ChatMessageRow } from './database';
import { loadCEO, getVaultEntryByService } from './database';
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

function buildExtractionPrompt(archetype?: string | null): string {
  const focusBlock = archetype && ARCHETYPE_FOCUS[archetype]
    ? `\n\n${ARCHETYPE_FOCUS[archetype]}`
    : '';

  return `You are a memory extraction system for an AI-run organization. Analyze the following conversation and extract important facts, decisions, preferences, insights, and reminders that should be remembered for future interactions.

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

Only extract genuinely important information. Do NOT extract greetings, small talk, or trivial exchanges.
If there is nothing worth remembering, return an empty array: []

Return ONLY the JSON array, no other text.`;
}

export async function extractMemories(
  messages: ChatMessageRow[],
  conversationId: string,
): Promise<MemoryRow[]> {
  if (messages.length === 0) return [];

  // Load CEO archetype for personality-aware extraction
  const ceo = await loadCEO();
  const archetype = ceo?.archetype ?? null;

  // Format conversation for the LLM
  const conversationText = messages
    .map(m => `[${m.sender.toUpperCase()}]: ${m.text}`)
    .join('\n');

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: buildExtractionPrompt(archetype) },
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

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: SUMMARIZE_PROMPT },
    { role: 'user', content: conversationText },
  ];

  const summary = await callLLM(llmMessages);
  if (!summary) return null;

  await saveConversationSummary(conversationId, summary, fromId, toId, chunkSize);
  return summary;
}
