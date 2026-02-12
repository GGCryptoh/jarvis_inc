export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface LLMProvider {
  id: string;
  stream(messages: LLMMessage[], apiKey: string, modelId: string, cb: StreamCallbacks): AbortController;
}
