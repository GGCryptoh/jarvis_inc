import type { LLMProvider, LLMMessage, StreamCallbacks } from '../types';

// Base URLs routed through Vite dev proxy to avoid CORS
const SERVICE_BASE_URLS: Record<string, string> = {
  openai:   '/api/openai/v1/chat/completions',
  deepseek: '/api/deepseek/v1/chat/completions',
  xai:      '/api/xai/v1/chat/completions',
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

      const body = JSON.stringify({
        model: modelId,
        max_tokens: 4096,
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
