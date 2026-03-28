import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 });
  }

  const userId = `manual-${Date.now()}`;
  queries.upsertPlayer.run({ userId, name: name.trim() });
  queries.upsertAttendance.run({ eventId: params.id, userId, rsvpStatus: 'GOING' });

  const run = queries.getRunBasic.get(params.id) as any;
  if (run?.totalCost != null) {
    const amount = run.totalCost / (run.splitCount ?? 12);
    queries.upsertPaymentOwed.run({ eventId: params.id, userId, amount });
  }

  return NextResponse.json({ ok: true, userId });
}
