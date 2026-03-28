import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rows = queries.getPlayerProfile.all(params.id) as any[];
  if (!rows.length) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const p = rows[0];

  const runs = rows
    .filter(r => r.eventId)
    .map(r => {
      const splitCount = r.splitCount ?? 12;
      const amountOwed = r.amount ?? (r.totalCost != null ? r.totalCost / splitCount : 0);
      const amountPaid: number | null = r.amountPaid ?? (r.paid ? amountOwed : null);
      return {
        eventId: r.eventId,
        title: r.title,
        startDate: r.startDate,
        amountOwed,
        amountPaid,
        paid: amountPaid != null,
        method: r.method,
        note: r.note,
      };
    });

  const balance = runs.reduce((sum, r) => sum + (r.amountPaid ?? 0) - r.amountOwed, 0);

  const history = queries.getPlayerAttendanceHistory.all(params.id) as any[];
  let currentStreak = 0;
  for (const row of history) {
    if (row.attended) currentStreak++;
    else break;
  }
  let bestStreak = 0;
  let temp = 0;
  for (const row of history) {
    if (row.attended) { temp++; bestStreak = Math.max(bestStreak, temp); }
    else temp = 0;
  }

  return NextResponse.json({
    userId: p.userId,
    name: p.name,
    displayName: p.displayName,
    notes: p.notes,
    balance,
    currentStreak,
    bestStreak,
    runs,
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const existing = queries.getPlayerProfile.all(params.id)[0] as any;
  if (!existing) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  queries.updatePlayerProfile.run({
    userId: params.id,
    displayName: body.displayName !== undefined ? body.displayName : existing.displayName,
    notes: body.notes !== undefined ? body.notes : existing.notes,
  });

  return NextResponse.json({ ok: true });
}
