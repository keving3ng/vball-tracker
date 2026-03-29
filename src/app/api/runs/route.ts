export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getUpcomingEvents, getPastEvents } from '@keg/partiful-api';

const VBALL_RE = /vball|volley|🏐/i;

function isVballEvent(event: { title?: string }) {
  return VBALL_RE.test(event.title ?? '');
}

export async function GET() {
  const [upcoming, past] = await Promise.all([getUpcomingEvents(), getPastEvents()]);
  return NextResponse.json({
    upcoming: (upcoming.result.data.upcomingEvents ?? []).filter(isVballEvent),
    past: (past.result.data.pastEvents ?? []).filter(isVballEvent),
  });
}
