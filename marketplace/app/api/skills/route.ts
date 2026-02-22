import { NextResponse } from 'next/server';
import { fetchAllSkills } from '@/lib/github';

export async function GET() {
  try {
    const skills = await fetchAllSkills();
    return NextResponse.json({ skills });
  } catch (error) {
    console.error('Skills fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch skills' },
      { status: 500 }
    );
  }
}
