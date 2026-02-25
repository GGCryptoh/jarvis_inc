// Storage Upload — Supabase Storage helper for generated images
// ==============================================================

import { getSupabase } from './supabase';

const BUCKET = 'generated-images';

/**
 * Upload an image (Blob or ArrayBuffer) to Supabase Storage.
 * Returns the public URL on success, null on failure.
 */
export async function uploadGeneratedImage(
  imageData: Blob | ArrayBuffer,
  filename: string,
  contentType = 'image/png',
): Promise<string | null> {
  try {
    const sb = getSupabase();
    const path = `${Date.now()}-${filename}`;

    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, imageData, { contentType, upsert: false });

    if (error) {
      console.error('[Storage] Upload failed:', error.message);
      return null;
    }

    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.error('[Storage] Upload error:', err);
    return null;
  }
}

/**
 * Upload a text document (markdown, plain text, JSON) to Supabase Storage.
 * Returns the public URL on success, null on failure.
 */
export async function uploadGeneratedDocument(
  content: string,
  filename: string,
  contentType = 'text/markdown',
): Promise<string | null> {
  try {
    const sb = getSupabase();
    const path = `${Date.now()}-${filename}`;
    const blob = new Blob([content], { type: contentType });

    const { error } = await sb.storage
      .from('generated-documents')
      .upload(path, blob, { contentType, upsert: false });

    if (error) {
      console.error('[Storage] Doc upload failed:', error.message);
      return null;
    }

    const { data } = sb.storage.from('generated-documents').getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (err) {
    console.error('[Storage] Doc upload error:', err);
    return null;
  }
}

/**
 * Upload a binary document (Blob) to Supabase Storage.
 * Returns the public URL on success, null on failure.
 */
export async function uploadBinaryDocument(
  data: Blob,
  filename: string,
  contentType: string,
): Promise<string | null> {
  try {
    const sb = getSupabase();
    const path = `${Date.now()}-${filename}`;

    const { error } = await sb.storage
      .from('generated-documents')
      .upload(path, data, { contentType, upsert: false });

    if (error) {
      console.error('[Storage] Binary doc upload failed:', error.message);
      return null;
    }

    const { data: urlData } = sb.storage.from('generated-documents').getPublicUrl(path);
    return urlData?.publicUrl ?? null;
  } catch (err) {
    console.error('[Storage] Binary doc upload error:', err);
    return null;
  }
}

/**
 * Convert a base64 string to a Blob for upload.
 */
export function base64ToBlob(b64: string, mimeType = 'image/png'): Blob {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}
