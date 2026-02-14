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

// ── CLI-over-HTTP Handlers (CLI skills that wrap public HTTP APIs) ──

interface CliHttpResult {
  text: string;
  result: Record<string, unknown>;
  cost: number; // always 0 for free APIs
}

async function handleWeatherGetForecast(params: Record<string, unknown>): Promise<CliHttpResult> {
  const location = params.location as string;
  if (!location) throw new Error("Weather forecast requires a 'location' parameter");
  const days = Number(params.days ?? 3);
  const format = (params.format as string) ?? "json";

  if (format === "oneline") {
    const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=3`, {
      headers: { "User-Agent": "jarvis-inc/1.0" },
    });
    if (!resp.ok) throw new Error(`wttr.in ${resp.status}: ${await resp.text()}`);
    const text = (await resp.text()).trim();
    return { text, result: { output: text, format: "oneline" }, cost: 0 };
  }

  if (format === "text") {
    const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?T&n&${days}`, {
      headers: { "User-Agent": "jarvis-inc/1.0" },
    });
    if (!resp.ok) throw new Error(`wttr.in ${resp.status}: ${await resp.text()}`);
    const text = (await resp.text()).trim();
    return { text, result: { output: text, format: "text" }, cost: 0 };
  }

  // JSON format (default)
  const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
    headers: { "User-Agent": "jarvis-inc/1.0" },
  });
  if (!resp.ok) throw new Error(`wttr.in ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();

  // Extract readable summary from JSON
  const current = data.current_condition?.[0];
  const tempF = current?.temp_F ?? "?";
  const tempC = current?.temp_C ?? "?";
  const desc = current?.weatherDesc?.[0]?.value ?? "Unknown";
  const humidity = current?.humidity ?? "?";
  const windMph = current?.windspeedMiles ?? "?";
  const feelsLikeF = current?.FeelsLikeF ?? tempF;
  const area = data.nearest_area?.[0];
  const cityName = area?.areaName?.[0]?.value ?? location;
  const region = area?.region?.[0]?.value ?? "";
  const country = area?.country?.[0]?.value ?? "";

  let summary = `**${cityName}${region ? `, ${region}` : ""}${country ? ` (${country})` : ""}** — ${desc}\n`;
  summary += `Temperature: ${tempF}°F (${tempC}°C), feels like ${feelsLikeF}°F\n`;
  summary += `Humidity: ${humidity}%, Wind: ${windMph} mph\n`;

  // Add forecast days
  const forecasts = (data.weather ?? []).slice(0, days);
  if (forecasts.length > 0) {
    summary += `\n**${forecasts.length}-Day Forecast:**\n`;
    for (const day of forecasts) {
      const date = day.date ?? "";
      const maxF = day.maxtempF ?? "?";
      const minF = day.mintempF ?? "?";
      const dayDesc = day.hourly?.[4]?.weatherDesc?.[0]?.value ?? "—";
      const chanceOfRain = day.hourly?.[4]?.chanceofrain ?? "0";
      summary += `- ${date}: ${dayDesc}, ${minF}–${maxF}°F, ${chanceOfRain}% rain\n`;
    }
  }

  return {
    text: summary,
    result: { output: summary, raw: data, format: "json" },
    cost: 0,
  };
}

async function handleWeatherGetCurrent(params: Record<string, unknown>): Promise<CliHttpResult> {
  const location = params.location as string;
  if (!location) throw new Error("Current weather requires a 'location' parameter");

  const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
    headers: { "User-Agent": "jarvis-inc/1.0" },
  });
  if (!resp.ok) throw new Error(`wttr.in ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();

  const current = data.current_condition?.[0];
  const tempF = current?.temp_F ?? "?";
  const tempC = current?.temp_C ?? "?";
  const desc = current?.weatherDesc?.[0]?.value ?? "Unknown";
  const humidity = current?.humidity ?? "?";
  const windMph = current?.windspeedMiles ?? "?";
  const feelsLikeF = current?.FeelsLikeF ?? tempF;
  const area = data.nearest_area?.[0];
  const cityName = area?.areaName?.[0]?.value ?? location;

  const summary = `${desc} in ${cityName}: ${tempF}°F (${tempC}°C), feels like ${feelsLikeF}°F. Humidity ${humidity}%, wind ${windMph} mph.`;

  return { text: summary, result: { output: summary, raw: current }, cost: 0 };
}

async function handleWeatherMoonPhase(params: Record<string, unknown>): Promise<CliHttpResult> {
  const location = params.location as string;
  if (!location) throw new Error("Moon phase requires a 'location' parameter");

  const resp = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=%m`, {
    headers: { "User-Agent": "jarvis-inc/1.0" },
  });
  if (!resp.ok) throw new Error(`wttr.in ${resp.status}: ${await resp.text()}`);
  const text = (await resp.text()).trim();

  return { text: `Moon phase for ${location}: ${text}`, result: { output: text }, cost: 0 };
}

// Registry: "skill_id/command_name" → handler
type CliHttpHandler = (params: Record<string, unknown>) => Promise<CliHttpResult>;

const CLI_HTTP_HANDLERS: Record<string, CliHttpHandler> = {
  "weather-cli/get_forecast": handleWeatherGetForecast,
  "weather-cli/get_current": handleWeatherGetCurrent,
  "weather-cli/get_moon_phase": handleWeatherMoonPhase,
};

// ── API Key Skill Handlers (direct API calls, not LLM) ─────────

// Display name → API model ID for image generation models
const IMAGE_MODEL_MAP: Record<string, string> = {
  "DALL-E 3": "dall-e-3",
  "DALL-E 2": "dall-e-2",
  "GPT-Image-1": "gpt-image-1",
};

// Cost per image: [model_id]: { [size]: { standard: cost, hd: cost } }
// Prices in USD per image
const IMAGE_COST_TABLE: Record<string, Record<string, Record<string, number>>> = {
  "dall-e-3": {
    "1024x1024": { standard: 0.040, hd: 0.080 },
    "1024x1792": { standard: 0.080, hd: 0.120 },
    "1792x1024": { standard: 0.080, hd: 0.120 },
  },
  "dall-e-2": {
    "1024x1024": { standard: 0.020, hd: 0.020 },
    "512x512":   { standard: 0.018, hd: 0.018 },
    "256x256":   { standard: 0.016, hd: 0.016 },
  },
  "gpt-image-1": {
    "1024x1024": { standard: 0.040, hd: 0.080 },
    "1024x1792": { standard: 0.080, hd: 0.120 },
    "1792x1024": { standard: 0.080, hd: 0.120 },
  },
};

function estimateImageCost(apiModelId: string, size: string, quality: string, count: number): number {
  const modelCosts = IMAGE_COST_TABLE[apiModelId];
  if (!modelCosts) return 0.040 * count; // fallback: assume DALL-E 3 standard
  const sizeCosts = modelCosts[size] ?? modelCosts["1024x1024"] ?? { standard: 0.040, hd: 0.080 };
  const perImage = quality === "hd" ? sizeCosts.hd : sizeCosts.standard;
  return perImage * count;
}

// Result from an api_key skill execution
interface ApiKeyResult {
  text: string;
  result: Record<string, unknown>;
  cost: number;
  provider: string;
  model: string;
}

// ── Image Generation Handler ────────────────────────────────────

async function handleImageGenerate(
  apiKey: string,
  model: string,
  definition: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<ApiKeyResult> {
  // Resolve the API model ID
  const apiModelId = IMAGE_MODEL_MAP[model] ?? model.toLowerCase().replace(/\s+/g, "-");

  // Extract parameters with defaults from the skill definition commands
  const prompt = params.prompt as string;
  if (!prompt) throw new Error("Image generation requires a 'prompt' parameter");

  const size = (params.size as string) ?? "1024x1024";
  const quality = (params.quality as string) ?? "standard";
  const style = (params.style as string) ?? "vivid";
  const n = Number(params.count ?? params.n ?? 1);

  // Determine base URL: prefer api_config if present, else default OpenAI
  const apiConfig = definition.api_config as Record<string, string> | undefined;
  const baseUrl = apiConfig?.base_url ?? "https://api.openai.com/v1";
  const authHeader = apiConfig?.auth_header ?? "Authorization";
  const authPrefix = apiConfig?.auth_prefix ?? "Bearer";

  // Build request body
  const body: Record<string, unknown> = {
    model: apiModelId,
    prompt,
    n,
    size,
    response_format: "url",
  };

  // DALL-E 3 and gpt-image-1 support quality and style; DALL-E 2 does not
  if (apiModelId !== "dall-e-2") {
    body.quality = quality;
    body.style = style;
  }

  const resp = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [authHeader]: `${authPrefix} ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Image API ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const images = data.data as Array<{ url: string; revised_prompt?: string; b64_json?: string }>;

  if (!images || images.length === 0) {
    throw new Error("Image API returned no images");
  }

  const firstImage = images[0];
  const revisedPrompt = firstImage.revised_prompt ?? prompt;
  const imageUrl = firstImage.url ?? "";

  // Build summary text
  const summaryText = images.length === 1
    ? `Generated image: ${revisedPrompt}. URL: ${imageUrl}`
    : `Generated ${images.length} images. First: ${revisedPrompt}. URL: ${imageUrl}`;

  const cost = estimateImageCost(apiModelId, size, quality, n);

  return {
    text: summaryText,
    result: {
      text: summaryText,
      image_url: imageUrl,
      images: images.map((img) => ({ url: img.url, revised_prompt: img.revised_prompt })),
      revised_prompt: revisedPrompt,
      media_type: "image/png",
      output_type: "image",
    },
    cost,
    provider: "OpenAI",
    model,
  };
}

// ── API Key Skill Router ────────────────────────────────────────
// Dispatches to specific handler functions based on skill_id + command_name.
// New api_key skills can be added here without modifying the main handler.

type ApiKeyHandler = (
  apiKey: string,
  model: string,
  definition: Record<string, unknown>,
  params: Record<string, unknown>,
) => Promise<ApiKeyResult>;

// Registry: "skill_id/command_name" → handler
const API_KEY_HANDLERS: Record<string, ApiKeyHandler> = {
  "create-images/generate": handleImageGenerate,
  // Future: "generate-video/generate": handleVideoGenerate,
};

async function executeApiKeySkill(
  supabase: ReturnType<typeof createClient>,
  skillId: string,
  commandName: string,
  model: string,
  definition: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<ApiKeyResult> {
  // Determine which vault service to query for the API key
  const apiConfig = definition.api_config as Record<string, string> | undefined;
  const fixedService = definition.fixed_service as string | undefined;
  const vaultService = apiConfig?.vault_service ?? fixedService ?? "OpenAI";

  // Look up the API key from the vault
  const { data: vaultEntry } = await supabase
    .from("vault")
    .select("key_value")
    .eq("service", vaultService)
    .limit(1)
    .single();
  if (!vaultEntry?.key_value) {
    throw new Error(`No API key found for service "${vaultService}" in vault`);
  }

  // Find the specific handler
  const handlerKey = `${skillId}/${commandName}`;
  const handler = API_KEY_HANDLERS[handlerKey];

  if (!handler) {
    // Fallback: check if there is a handler for just the skill with any command
    const fallbackKey = Object.keys(API_KEY_HANDLERS).find((k) => k.startsWith(`${skillId}/`));
    if (fallbackKey) {
      return API_KEY_HANDLERS[fallbackKey](vaultEntry.key_value, model, definition, params);
    }
    throw new Error(`No handler for api_key skill "${skillId}" command "${commandName}". Supported: ${Object.keys(API_KEY_HANDLERS).join(", ")}`);
  }

  return handler(vaultEntry.key_value, model, definition, params);
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

    // 4. Parse skill definition JSON
    const definition = typeof skill.definition === "string" ? JSON.parse(skill.definition) : (skill.definition ?? {});
    const connectionType: string = definition.connection_type ?? "llm";
    const commands = definition.commands ?? [];
    const command = commands.find((c: Record<string, unknown>) => c.name === task.command_name) ?? commands[0];
    const params = task.params ?? {};

    // ── Route by connection type ──────────────────────────────────
    let resultText: string;
    let resultPayload: Record<string, unknown>;
    let cost: number;
    let tokensUsed: number;
    let inputTokens: number;
    let outputTokens: number;
    let provider: string;
    let model: string;
    let conversation: Array<Record<string, string>> | null;

    if (connectionType === "cli") {
      // Check if this CLI skill has an HTTP-compatible handler
      const cliKey = `${skill.id}/${task.command_name}`;
      const cliHandler = CLI_HTTP_HANDLERS[cliKey]
        ?? Object.values(CLI_HTTP_HANDLERS).length > 0
          ? CLI_HTTP_HANDLERS[Object.keys(CLI_HTTP_HANDLERS).find((k) => k.startsWith(`${skill.id}/`)) ?? ""]
          : undefined;

      if (cliHandler) {
        const cliResult = await cliHandler(params);
        resultText = cliResult.text;
        resultPayload = cliResult.result;
        cost = cliResult.cost;
        provider = "cli-http";
        model = "wttr.in"; // for audit display
        tokensUsed = 0;
        inputTokens = 0;
        outputTokens = 0;
        conversation = null;
      } else {
        // CLI skills without HTTP handlers require a workspace gateway
        throw new Error(
          `CLI skill "${skill.id}" requires a workspace gateway. ` +
          `No HTTP handler registered for "${cliKey}". ` +
          `Supported CLI-over-HTTP skills: ${Object.keys(CLI_HTTP_HANDLERS).join(", ") || "none"}`
        );
      }
    } else if (connectionType === "api_key") {
      // ── API Key flow: direct API call (image generation, etc.) ──
      model = task.model || skill.model || definition.default_model || "DALL-E 3";
      const apiResult = await executeApiKeySkill(supabase, skill.id, task.command_name, model, definition, params);

      resultText = apiResult.text;
      resultPayload = apiResult.result;
      cost = apiResult.cost;
      provider = apiResult.provider;
      model = apiResult.model;
      tokensUsed = 0;
      inputTokens = 0;
      outputTokens = 0;
      conversation = null; // no LLM conversation for direct API calls
    } else {
      // ── LLM flow: build prompt and call LLM provider (existing behavior) ──
      model = task.model || skill.model || "Claude Sonnet 4.5";
      const service = MODEL_SERVICE_MAP[model] ?? "Anthropic";
      const apiModelId = MODEL_API_IDS[model] ?? model;

      // Get API key from vault
      const { data: vaultEntry } = await supabase
        .from("vault")
        .select("key_value")
        .eq("service", service)
        .limit(1)
        .single();
      if (!vaultEntry?.key_value) throw new Error(`No API key for ${service}`);

      // Build prompt from skill command
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

      // Call LLM (non-streaming)
      const llmResult = await callLLM(service, vaultEntry.key_value, apiModelId, systemPrompt, userPrompt);

      resultText = llmResult.text;
      resultPayload = { output: llmResult.text, summary: llmResult.text.slice(0, 200) };
      cost = estimateCost(model, llmResult.inputTokens, llmResult.outputTokens);
      provider = service;
      tokensUsed = llmResult.inputTokens + llmResult.outputTokens;
      inputTokens = llmResult.inputTokens;
      outputTokens = llmResult.outputTokens;
      conversation = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        { role: "assistant", content: llmResult.text },
      ];
    }

    // ── Common post-execution steps ─────────────────────────────

    // 5. Update task_execution with result
    const updatePayload: Record<string, unknown> = {
      status: "completed",
      result: resultPayload,
      tokens_used: tokensUsed,
      cost_usd: cost,
      completed_at: new Date().toISOString(),
    };
    if (conversation) {
      updatePayload.conversation = conversation;
    }
    await supabase
      .from("task_executions")
      .update(updatePayload)
      .eq("id", task_execution_id);

    // 6. Log to llm_usage (tracks both LLM and API costs)
    const usageId = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await supabase.from("llm_usage").insert({
      id: usageId,
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost: cost,
      context: "skill_execution",
      mission_id: task.mission_id ?? null,
      agent_id: task.agent_id ?? null,
    });

    // 7. Log to audit
    const auditDetail = tokensUsed > 0
      ? `${skill.id}/${task.command_name} via ${model} (${tokensUsed} tokens, $${cost.toFixed(4)})`
      : `${skill.id}/${task.command_name} via ${model} ($${cost.toFixed(4)})`;
    await supabase.from("audit_log").insert({
      agent: task.agent_id ?? "ceo",
      action: "SKILL_EXECUTE",
      details: auditDetail,
      severity: "info",
    });

    // 8. Check if all tasks for this mission are complete
    if (task.mission_id) {
      const { data: siblings } = await supabase
        .from("task_executions")
        .select("status, skill_id, result")
        .eq("mission_id", task.mission_id);

      const allComplete = siblings?.every((t: Record<string, unknown>) => t.status === "completed" || t.status === "failed");

      if (allComplete) {
        await supabase
          .from("missions")
          .update({ status: "review" })
          .eq("id", task.mission_id);

        // 9. Post CEO summary in chat
        const { data: convos } = await supabase
          .from("conversations")
          .select("id")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1);

        const convoId = convos?.[0]?.id;
        if (convoId) {
          const completedTasks = siblings?.filter((t: Record<string, unknown>) => t.status === "completed") ?? [];
          const failedTasks = siblings?.filter((t: Record<string, unknown>) => t.status === "failed") ?? [];
          const isSingleTask = (siblings?.length ?? 0) === 1 && completedTasks.length === 1;

          let summary: string;
          if (isSingleTask) {
            // Quick task — include a brief result excerpt
            const brief = resultText.slice(0, 150).replace(/\n+/g, " ").trim();
            const ellipsis = resultText.length > 150 ? "..." : "";
            summary = `Done — ${brief}${ellipsis} Full results are in Collateral.`;
          } else {
            // Multi-task mission
            summary = `Mission complete — ${completedTasks.length} task(s) finished`;
            if (failedTasks.length > 0) summary += `, ${failedTasks.length} failed`;
            summary += `. Head to Missions to review the results.`;
          }

          // For image results, include the image URL in the chat message metadata
          const msgMetadata: Record<string, unknown> = {
            type: "mission_complete",
            mission_id: task.mission_id,
            skill_id: task.skill_id,
            output_type: isSingleTask ? "quick" : "multi",
          };
          if (connectionType === "api_key" && resultPayload.output_type === "image") {
            msgMetadata.image_url = resultPayload.image_url;
            msgMetadata.media_type = resultPayload.media_type;
          }

          await supabase.from("chat_messages").insert({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            conversation_id: convoId,
            sender: "ceo",
            text: summary,
            metadata: msgMetadata,
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
