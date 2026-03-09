import type { LLMProvider, LLMMessage, StreamCallbacks } from '../types';

const API_URL = 'https://api.anthropic.com/v1/messages';

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',

  stream(messages: LLMMessage[], apiKey: string, modelId: string, cb: StreamCallbacks): AbortController {
    const controller = new AbortController();

    // Extract system prompt from messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    const systemPrompt = systemMessages.map(m => m.content).join('\n\n') || undefined;

    const body = JSON.stringify({
      model: modelId,
      max_tokens: 2048,
      stream: true,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
    });

    (async () => {
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          cb.onError(new Error(`Anthropic API ${response.status}: ${errText}`));
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
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6);
              try {
                const event = JSON.parse(jsonStr);
                if (event.type === 'content_block_delta' && event.delta?.text) {
                  fullText += event.delta.text;
                  cb.onToken(event.delta.text);
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
