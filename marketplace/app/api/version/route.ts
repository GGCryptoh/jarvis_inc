import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    latest_app_version: '0.1.0',
    marketplace_version: '0.1.0',
    updated_at: new Date().toISOString(),
  });
}
