export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET() {
  const players = queries.getPlayerStats.all();
  return NextResponse.json(players);
}
