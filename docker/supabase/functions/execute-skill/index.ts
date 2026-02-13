import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
};

// Provider endpoint configs
const PROVIDER_ENDPOINTS: Record<string, string> = {
  Anthropic: "https://api.anthropic.com/v1/messages",
  OpenAI: "https://api.openai.com/v1/chat/completions",
  Google: "https://generativelanguage.googleapis.com/v1beta/models",
  DeepSeek: "https://api.deepseek.com/v1/chat/completions",
  xAI: "https://api.x.ai/v1/chat/completions",
};

// Model display name → service mapping (duplicated from browser code for standalone use)
const MODEL_SERVICE_MAP: Record<string, string> = {
  "Claude Opus 4.6": "Anthropic",
  "Claude Opus 4.5": "Anthropic",
  "Claude Sonnet 4.5": "Anthropic",
  "Claude Haiku 4.5": "Anthropic",
  "GPT-5.2": "OpenAI",
  "o3-pro": "OpenAI",
  "o4-mini": "OpenAI",
  "Gemini 3 Pro": "Google",
  "Gemini 2.5 Flash": "Google",
  "DeepSeek R1": "DeepSeek",
  "Llama 3.3": "Meta",
  "Grok 4": "xAI",
};

const MODEL_API_IDS: Record<string, string> = {
  "Claude Opus 4.6": "claude-opus-4-6",
  "Claude Opus 4.5": "claude-opus-4-5-20251101",
  "Claude Sonnet 4.5": "claude-sonnet-4-5-20250929",
  "Claude Haiku 4.5": "claude-haiku-4-5-20251001",
  "GPT-5.2": "gpt-5.2",
  "o3-pro": "o3-pro",
  "o4-mini": "o4-mini",
  "Gemini 3 Pro": "gemini-3.0-pro",
  "Gemini 2.5 Flash": "gemini-2.5-flash",
  "DeepSeek R1": "deepseek-reasoner",
  "Llama 3.3": "llama-3.3-70b",
  "Grok 4": "grok-4",
};

const MODEL_COSTS: Record<string, [number, number]> = {
  "Claude Opus 4.6": [5, 25],
  "Claude Opus 4.5": [5, 25],
  "Claude Sonnet 4.5": [3, 15],
  "Claude Haiku 4.5": [0.8, 4],
  "GPT-5.2": [10, 30],
  "o3-pro": [20, 80],
  "o4-mini": [1.1, 4.4],
  "Gemini 3 Pro": [1.25, 5],
  "Gemini 2.5 Flash": [0.15, 0.6],
  "DeepSeek R1": [0.55, 2.19],
  "Llama 3.3": [0.6, 0.6],
  "Grok 4": [3, 15],
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model] ?? [0, 0];
  return (inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1];
}

// ── LLM Provider Calls ──────────────────────────────────────────

interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callAnthropic(apiKey: string, modelId: string, systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  const resp = await fetch(PROVIDER_ENDPOINTS.Anthropic, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return {
    text: data.content?.[0]?.text ?? "",
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

async function callOpenAICompatible(endpoint: string, apiKey: string, modelId: string, systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 4096,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI-compatible ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

async function callGoogle(apiKey: string, modelId: string, systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  const url = `${PROVIDER_ENDPOINTS.Google}/${modelId}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function callLLM(service: string, apiKey: string, modelId: string, systemPrompt: string, userPrompt: string): Promise<LLMResult> {
  switch (service) {
    case "Anthropic":
      return callAnthropic(apiKey, modelId, systemPrompt, userPrompt);
    case "OpenAI":
      return callOpenAICompatible(PROVIDER_ENDPOINTS.OpenAI, apiKey, modelId, systemPrompt, userPrompt);
    case "DeepSeek":
      return callOpenAICompatible(PROVIDER_ENDPOINTS.DeepSeek, apiKey, modelId, systemPrompt, userPrompt);
    case "xAI":
      return callOpenAICompatible("https://api.x.ai/v1/chat/completions", apiKey, modelId, systemPrompt, userPrompt);
    case "Google":
      return callGoogle(apiKey, modelId, systemPrompt, userPrompt);
    default:
      throw new Error(`Unsupported service: ${service}`);
  }
}

// ── Main Handler ─────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { task_execution_id } = await req.json();
    if (!task_execution_id) {
      return new Response(JSON.stringify({ error: "task_execution_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Load task execution
    const { data: task, error: taskErr } = await supabase
      .from("task_executions")
      .select("*")
      .eq("id", task_execution_id)
      .single();
    if (taskErr || !task) throw new Error(`Task not found: ${taskErr?.message}`);

    // 2. Mark as running
    await supabase
      .from("task_executions")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", task_execution_id);

    // 3. Load skill definition
    const { data: skill } = await supabase
      .from("skills")
      .select("*")
      .eq("id", task.skill_id)
      .single();
    if (!skill) throw new Error(`Skill not found: ${task.skill_id}`);

    // 4. Determine model and service
    const model = task.model || skill.model || "Claude Sonnet 4.5";
    const service = MODEL_SERVICE_MAP[model] ?? "Anthropic";
    const apiModelId = MODEL_API_IDS[model] ?? model;

    // 5. Get API key from vault
    const { data: vaultEntry } = await supabase
      .from("vault")
      .select("key_value")
      .eq("service", service)
      .limit(1)
      .single();
    if (!vaultEntry?.key_value) throw new Error(`No API key for ${service}`);

    // 6. Build prompt from skill command
    const definition = typeof skill.definition === "string" ? JSON.parse(skill.definition) : (skill.definition ?? {});
    const commands = definition.commands ?? [];
    const command = commands.find((c: any) => c.name === task.command_name) ?? commands[0];
    const params = task.params ?? {};

    let systemPrompt = `You are an AI agent executing the "${skill.id}" skill.\n`;
    if (command?.prompt_template) {
      systemPrompt += command.prompt_template;
    } else {
      systemPrompt += `Execute the "${command?.name ?? task.command_name}" command.\n`;
      systemPrompt += `Skill description: ${definition.description ?? skill.id}\n`;
    }

    let userPrompt = "";
    for (const [key, val] of Object.entries(params)) {
      userPrompt += `${key}: ${val}\n`;
    }
    if (!userPrompt) userPrompt = task.command_name ?? "Execute";

    // 7. Call LLM (non-streaming)
    const result = await callLLM(service, vaultEntry.key_value, apiModelId, systemPrompt, userPrompt);

    // 8. Calculate cost
    const cost = estimateCost(model, result.inputTokens, result.outputTokens);

    // 9. Update task_execution with result
    await supabase
      .from("task_executions")
      .update({
        status: "completed",
        result: { output: result.text, summary: result.text.slice(0, 200) },
        tokens_used: result.inputTokens + result.outputTokens,
        cost_usd: cost,
        completed_at: new Date().toISOString(),
        conversation: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
          { role: "assistant", content: result.text },
        ],
      })
      .eq("id", task_execution_id);

    // 10. Log to llm_usage
    const usageId = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await supabase.from("llm_usage").insert({
      id: usageId,
      provider: service,
      model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      estimated_cost: cost,
      context: "skill_execution",
      mission_id: task.mission_id ?? null,
      agent_id: task.agent_id ?? null,
    });

    // 11. Log to audit
    await supabase.from("audit_log").insert({
      agent: task.agent_id ?? "ceo",
      action: "SKILL_EXECUTE",
      details: `${skill.id}/${task.command_name} via ${model} (${result.inputTokens + result.outputTokens} tokens, $${cost.toFixed(4)})`,
      severity: "info",
    });

    // 12. Check if all tasks for this mission are complete
    if (task.mission_id) {
      const { data: siblings } = await supabase
        .from("task_executions")
        .select("status")
        .eq("mission_id", task.mission_id);

      const allComplete = siblings?.every((t: any) => t.status === "completed" || t.status === "failed");

      if (allComplete) {
        await supabase
          .from("missions")
          .update({ status: "review" })
          .eq("id", task.mission_id);

        // 13. Post CEO summary in chat
        const { data: ceo } = await supabase.from("ceo").select("name").limit(1).single();
        const ceoName = ceo?.name ?? "CEO";

        const { data: convos } = await supabase
          .from("conversations")
          .select("id")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1);

        const convoId = convos?.[0]?.id;
        if (convoId) {
          const completedTasks = siblings?.filter((t: any) => t.status === "completed") ?? [];
          const failedTasks = siblings?.filter((t: any) => t.status === "failed") ?? [];
          let summary = `Mission complete — ${completedTasks.length} task(s) finished`;
          if (failedTasks.length > 0) summary += `, ${failedTasks.length} failed`;
          summary += `. Head to Missions to review the results.`;

          await supabase.from("chat_messages").insert({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: convoId,
            sender: "ceo",
            text: summary,
            metadata: { type: "mission_complete", mission_id: task.mission_id },
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, task_execution_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Update task as failed
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.task_execution_id) {
        await supabase
          .from("task_executions")
          .update({
            status: "failed",
            result: { error: String(err) },
            completed_at: new Date().toISOString(),
          })
          .eq("id", body.task_execution_id);
      }
    } catch { /* best effort */ }

    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
