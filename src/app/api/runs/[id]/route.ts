import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rows = queries.getRunWithGuests.all(params.id) as any[];
  if (!rows.length) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const r0 = rows[0];
  const splitCount = r0.splitCount ?? 12;
  const costPerHead = r0.totalCost != null
    ? r0.totalCost / splitCount
    : (r0.costPerHead ?? null);

  const run = {
    eventId: r0.eventId,
    title: r0.title,
    startDate: r0.startDate,
    capacity: r0.capacity,
    totalCost: r0.totalCost,
    splitCount,
    costPerHead,
    notes: r0.notes,
    syncedAt: r0.syncedAt,
    guests: rows
      .filter(r => r.userId)
      .map(r => ({
        userId: r.userId,
        name: r.displayName ?? r.name,
        partifulName: r.name,
        rsvpStatus: r.rsvpStatus,
        payment: {
          amount: r.amount,
          amountPaid: r.amountPaid,
          paid: r.amountPaid != null || Boolean(r.paid),
          method: r.method,
          note: r.note,
        },
      })),
  };

  return NextResponse.json(run);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();

  if (body.title) {
    queries.upsertRun.run({
      eventId: params.id,
      title: body.title,
      startDate: body.startDate ?? null,
    });
  }
  if (body.totalCost !== undefined || body.splitCount !== undefined) {
    queries.updateRunCost.run({
      eventId: params.id,
      totalCost: body.totalCost ?? null,
      splitCount: body.splitCount ?? 12,
    });
  }
  if (body.notes !== undefined) {
    queries.updateRunNotes.run({ eventId: params.id, notes: body.notes });
  }

  return NextResponse.json({ ok: true });
}
