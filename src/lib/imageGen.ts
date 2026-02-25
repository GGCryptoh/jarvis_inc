/**
 * Provider-agnostic AI image generation
 * ======================================
 * Uses whatever image-capable API key is available in the vault:
 * 1. OpenAI → gpt-image-1 / dall-e-3
 * 2. Google → Imagen 3
 * Returns null if no provider is available.
 */

import { getVaultEntryByService } from './database';

export interface ImageGenResult {
  base64: string;
  content_type: string;
}

/**
 * Generate an image from a text prompt using the best available provider.
 * Returns base64 image data or null if generation fails or no provider is available.
 */
export async function generateImage(prompt: string): Promise<ImageGenResult | null> {
  // 1. Try OpenAI (gpt-image-1 / dall-e-3)
  const openaiEntry = await getVaultEntryByService('OpenAI');
  if (openaiEntry) {
    try {
      const result = await generateWithOpenAI(openaiEntry.key_value, prompt);
      if (result) return result;
    } catch (err) {
      console.warn('[imageGen] OpenAI generation failed:', err);
    }
  }

  // 2. Try Google (Imagen 3)
  const googleEntry = await getVaultEntryByService('Google');
  if (googleEntry) {
    try {
      const result = await generateWithGoogle(googleEntry.key_value, prompt);
      if (result) return result;
    } catch (err) {
      console.warn('[imageGen] Google generation failed:', err);
    }
  }

  return null;
}

/**
 * Check if any image-capable API key exists in the vault.
 */
export async function isImageGenAvailable(): Promise<boolean> {
  const openai = await getVaultEntryByService('OpenAI');
  if (openai) return true;
  const google = await getVaultEntryByService('Google');
  if (google) return true;
  return false;
}

async function generateWithOpenAI(apiKey: string, prompt: string): Promise<ImageGenResult | null> {
  // Try gpt-image-1 first (newer), fall back to dall-e-3
  for (const model of ['gpt-image-1', 'dall-e-3']) {
    try {
      const body: Record<string, unknown> = {
        model,
        prompt: `${prompt}\n\nStyle: Clean, digital art style suitable for a forum post. No text overlays unless specifically requested.`,
        n: 1,
        size: '1024x1024',
      };

      if (model === 'gpt-image-1') {
        body.output_format = 'png';
      } else {
        body.response_format = 'b64_json';
      }

      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[imageGen] OpenAI ${model} returned ${res.status}: ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json();

      // gpt-image-1 returns base64 in data[0].b64_json
      // dall-e-3 also returns b64_json when response_format is set
      const b64 = data.data?.[0]?.b64_json;
      if (b64) {
        return { base64: b64, content_type: 'image/png' };
      }
    } catch (err) {
      console.warn(`[imageGen] OpenAI ${model} error:`, err);
      continue;
    }
  }

  return null;
}

async function generateWithGoogle(apiKey: string, prompt: string): Promise<ImageGenResult | null> {
  try {
    // Gemini Imagen 3 API
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{
            prompt: `${prompt}\n\nStyle: Clean, digital art style suitable for a forum post.`,
          }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '1:1',
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[imageGen] Google Imagen returned ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (b64) {
      return { base64: b64, content_type: 'image/png' };
    }

    return null;
  } catch (err) {
    console.warn('[imageGen] Google Imagen error:', err);
    return null;
  }
}
