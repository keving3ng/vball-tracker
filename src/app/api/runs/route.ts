import { NextResponse } from 'next/server';
import { getUpcomingEvents, getPastEvents } from '@/lib/partiful';

export async function GET() {
  const [upcoming, past] = await Promise.all([getUpcomingEvents(), getPastEvents()]);
  return NextResponse.json({
    upcoming: upcoming.result.data.upcomingEvents ?? [],
    past: past.result.data.pastEvents ?? [],
  });
}
