import { NextResponse } from 'next/server';
import { getEventGuests } from '@keg/partiful-api';
import { queries } from '@/lib/db';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guests = await getEventGuests(params.id);

  const run = queries.getRunBasic.get(params.id) as any;
  let totalCost: number | null = run?.totalCost ?? null;
  let splitCount: number = run?.splitCount ?? 12;

  if (totalCost == null) {
    const last = queries.getLastRunCost.get() as any;
    if (last?.totalCost != null) {
      totalCost = last.totalCost;
      splitCount = last.splitCount ?? 12;
      queries.updateRunCost.run({ eventId: params.id, totalCost, splitCount });
    }
  }

  const amountOwed = totalCost != null ? totalCost / splitCount : 0;

  for (const guest of guests) {
    queries.upsertPlayer.run({ userId: guest.userId, name: guest.name });
    queries.upsertAttendance.run({
      eventId: params.id,
      userId: guest.userId,
      rsvpStatus: guest.status,
    });

    if (guest.status === 'GOING' && amountOwed > 0) {
      queries.upsertPaymentOwed.run({
        eventId: params.id,
        userId: guest.userId,
        amount: amountOwed,
      });
    } else if (guest.status !== 'GOING') {
      queries.deleteUnpaidPayment.run(params.id, guest.userId);
    }
  }

  return NextResponse.json({ synced: guests.length });
}
