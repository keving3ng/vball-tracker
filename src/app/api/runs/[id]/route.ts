import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rows = queries.getRunWithGuests.all(params.id) as any[];
  if (!rows.length) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const run = {
    eventId: rows[0].eventId,
    title: rows[0].title,
    startDate: rows[0].startDate,
    capacity: rows[0].capacity,
    costPerHead: rows[0].costPerHead,
    syncedAt: rows[0].syncedAt,
    guests: rows
      .filter(r => r.userId)
      .map(r => ({
        userId: r.userId,
        name: r.name,
        rsvpStatus: r.rsvpStatus,
        payment: { amount: r.amount, paid: Boolean(r.paid), method: r.method, note: r.note },
      })),
  };

  return NextResponse.json(run);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  if (body.title) {
    queries.upsertRun.run({ eventId: params.id, title: body.title, startDate: body.startDate ?? null });
  }
  if (body.totalCost !== undefined || body.splitCount !== undefined) {
    queries.updateRunCost.run({ eventId: params.id, totalCost: body.totalCost ?? null, splitCount: body.splitCount ?? 12 });
  }
  return NextResponse.json({ ok: true });
}
