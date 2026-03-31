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

  // Auto-set host from last run if not already set
  let hostUserId: string | null = run?.hostUserId ?? null;
  if (!hostUserId) {
    const lastHost = queries.getLastRunHost.get() as any;
    if (lastHost?.hostUserId) {
      hostUserId = lastHost.hostUserId;
      queries.updateRunHost.run({ hostUserId, eventId: params.id });
    }
  }

  // Mark host as paid if they are GOING this run
  if (hostUserId && amountOwed > 0) {
    const isGoing = guests.some((g: any) => g.userId === hostUserId && g.status === 'GOING');
    if (isGoing) {
      queries.markHostPaid.run({
        amount: amountOwed,
        amountPaid: amountOwed,
        eventId: params.id,
        userId: hostUserId,
      });
    }
  }

  return NextResponse.json({ synced: guests.length });
}
