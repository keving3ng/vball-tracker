import { NextResponse } from 'next/server';
import { getEventGuests } from '@/lib/partiful';
import { queries } from '@/lib/db';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guests = await getEventGuests(params.id);

  for (const guest of guests) {
    queries.upsertPlayer.run({ userId: guest.userId, name: guest.name });
    queries.upsertAttendance.run({ eventId: params.id, userId: guest.userId, rsvpStatus: guest.status });
  }

  return NextResponse.json({ synced: guests.length });
}
