import type { LLMProvider, LLMMessage, StreamCallbacks } from '../types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const googleProvider: LLMProvider = {
  id: 'google',

  stream(messages: LLMMessage[], apiKey: string, modelId: string, cb: StreamCallbacks): AbortController {
    const controller = new AbortController();

    // Extract system prompt
    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    const systemPrompt = systemMessages.map(m => m.content).join('\n\n') || undefined;

    // Convert to Gemini format
    const contents = chatMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: 2048 },
    };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const url = `${BASE_URL}/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;

    (async () => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          cb.onError(new Error(`Google API ${response.status}: ${errText}`));
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
            if (trimmed.startsWith('data: ')) {
              try {
                const event = JSON.parse(trimmed.slice(6));
                const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  fullText += text;
                  cb.onToken(text);
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
