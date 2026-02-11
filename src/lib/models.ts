export const MODEL_OPTIONS = [
  'Claude Opus 4.6',
  'Claude Opus 4.5',
  'Claude Sonnet 4.5',
  'Claude Haiku 4.5',
  'GPT-5.2',
  'o3-pro',
  'o4-mini',
  'Gemini 3 Pro',
  'Gemini 2.5 Flash',
  'DeepSeek R1',
  'Llama 3.3',
  'Grok 4',
];

export const MODEL_SERVICE_MAP: Record<string, string> = {
  'Claude Opus 4.6': 'Anthropic',
  'Claude Opus 4.5': 'Anthropic',
  'Claude Sonnet 4.5': 'Anthropic',
  'Claude Haiku 4.5': 'Anthropic',
  'GPT-5.2': 'OpenAI',
  'o3-pro': 'OpenAI',
  'o4-mini': 'OpenAI',
  'Gemini 3 Pro': 'Google',
  'Gemini 2.5 Flash': 'Google',
  'DeepSeek R1': 'DeepSeek',
  'Llama 3.3': 'Meta',
  'Grok 4': 'xAI',
};

export const SERVICE_KEY_HINTS: Record<string, { url: string; steps: string[] }> = {
  'Anthropic': {
    url: 'console.anthropic.com',
    steps: ['Go to console.anthropic.com', 'Settings → API Keys', 'Create new key'],
  },
  'OpenAI': {
    url: 'platform.openai.com',
    steps: ['Go to platform.openai.com', 'API Keys section', 'Create new secret key'],
  },
  'Google': {
    url: 'aistudio.google.com',
    steps: ['Go to aistudio.google.com', 'Get API Key', 'Create key in new project'],
  },
  'DeepSeek': {
    url: 'platform.deepseek.com',
    steps: ['Go to platform.deepseek.com', 'API Keys', 'Create new key'],
  },
  'Meta': {
    url: 'llama.meta.com',
    steps: ['Go to llama.meta.com', 'Request API access', 'Generate API token'],
  },
  'xAI': {
    url: 'console.x.ai',
    steps: ['Go to console.x.ai', 'API Keys', 'Generate new key'],
  },
};

export function getServiceForModel(model: string): string {
  return MODEL_SERVICE_MAP[model] ?? 'Unknown';
}

export const SERVICE_KEY_VALIDATORS: Record<string, { prefixes: string[]; minLength: number }> = {
  'Anthropic': { prefixes: ['sk-ant-'], minLength: 40 },
  'OpenAI': { prefixes: ['sk-'], minLength: 30 },
  'Google': { prefixes: ['AIza'], minLength: 30 },
  'DeepSeek': { prefixes: ['sk-'], minLength: 30 },
  'Meta': { prefixes: [], minLength: 20 },
  'xAI': { prefixes: ['xai-'], minLength: 30 },
};

export function validateApiKeyFormat(service: string, key: string): { valid: boolean; message: string } {
  const trimmed = key.trim();
  if (trimmed.length === 0) return { valid: false, message: '' };
  const spec = SERVICE_KEY_VALIDATORS[service];
  if (!spec) return { valid: trimmed.length >= 10, message: trimmed.length >= 10 ? 'Format OK' : 'Key too short' };
  if (trimmed.length < spec.minLength) {
    return { valid: false, message: `Too short (need ${spec.minLength}+ chars)` };
  }
  if (spec.prefixes.length > 0) {
    const hasValidPrefix = spec.prefixes.some(p => trimmed.startsWith(p));
    if (!hasValidPrefix) {
      return { valid: false, message: `Expected prefix: ${spec.prefixes.join(' or ')}` };
    }
  }
  return { valid: true, message: 'Format OK' };
}
