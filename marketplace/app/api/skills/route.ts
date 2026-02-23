import { NextResponse } from 'next/server';
import { fetchAllSkills } from '@/lib/github';

export async function GET() {
  try {
    const skills = await fetchAllSkills();
    const res = NextResponse.json({ skills });
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res;
  } catch (error) {
    console.error('Skills fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch skills' },
      { status: 500 }
    );
  }
}
