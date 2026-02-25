import type { LLMProvider, LLMMessage, StreamCallbacks } from '../types';

// In browser: route through Vite dev proxy to avoid CORS
// In Node.js (sidecar): use direct API URLs
const isBrowser = typeof window !== 'undefined';
const SERVICE_BASE_URLS: Record<string, string> = {
  openai:   isBrowser ? '/api/openai/v1/chat/completions'   : 'https://api.openai.com/v1/chat/completions',
  deepseek: isBrowser ? '/api/deepseek/v1/chat/completions' : 'https://api.deepseek.com/v1/chat/completions',
  xai:      isBrowser ? '/api/xai/v1/chat/completions'      : 'https://api.x.ai/v1/chat/completions',
};

function createOpenAICompatibleProvider(serviceId: string): LLMProvider {
  return {
    id: serviceId,

    stream(messages: LLMMessage[], apiKey: string, modelId: string, cb: StreamCallbacks): AbortController {
      const controller = new AbortController();
      const url = SERVICE_BASE_URLS[serviceId];

      if (!url) {
        cb.onError(new Error(`No endpoint configured for service: ${serviceId}`));
        return controller;
      }

      // Newer OpenAI models (o1, o3, gpt-4o, etc.) require max_completion_tokens
      const useNewParam = /^(o[0-9]|gpt-4o|gpt-4\.5)/.test(modelId);
      const tokenParam = useNewParam
        ? { max_completion_tokens: 2048 }
        : { max_tokens: 2048 };

      const body = JSON.stringify({
        model: modelId,
        ...tokenParam,
        stream: true,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });

      (async () => {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body,
            signal: controller.signal,
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => response.statusText);
            cb.onError(new Error(`${serviceId} API ${response.status}: ${errText}`));
            return;
          }

          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop()!;

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed === 'data: [DONE]') continue;
              if (trimmed.startsWith('data: ')) {
                try {
                  const event = JSON.parse(trimmed.slice(6));
                  const content = event.choices?.[0]?.delta?.content;
                  if (content) {
                    fullText += content;
                    cb.onToken(content);
                  }
                } catch {
                  // skip non-JSON lines
                }
              }
            }
          }

          cb.onDone(fullText);
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return;
          cb.onError(err instanceof Error ? err : new Error(String(err)));
        }
      })();

      return controller;
    },
  };
}

export const openaiProvider = createOpenAICompatibleProvider('openai');
export const deepseekProvider = createOpenAICompatibleProvider('deepseek');
export const xaiProvider = createOpenAICompatibleProvider('xai');
