import { NextResponse } from 'next/server';
import { getLatestRelease } from '@/lib/db';

const GITHUB_RAW_URL =
  'https://raw.githubusercontent.com/GGCryptoh/jarvis_inc/main/package.json';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { version: string; fetchedAt: number } | null = null;

async function getLatestVersion(): Promise<string> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.version;
  }
  try {
    const res = await fetch(GITHUB_RAW_URL, {
      headers: { 'User-Agent': 'jarvisinc-marketplace' },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
    const pkg = await res.json();
    const version = pkg.version || '0.0.0';
    cached = { version, fetchedAt: Date.now() };
    return version;
  } catch {
    return cached?.version ?? '0.1.2';
  }
}

export async function GET() {
  const [version, latestRelease] = await Promise.all([
    getLatestVersion(),
    getLatestRelease(),
  ]);
  return NextResponse.json({
    latest_app_version: version,
    changelog: latestRelease?.changelog ?? null,
    released_at: latestRelease?.released_at ?? null,
    marketplace_version: '0.1.2',
    updated_at: new Date().toISOString(),
  });
}
