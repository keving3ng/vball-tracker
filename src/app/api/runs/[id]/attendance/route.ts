import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId, attended } = await req.json();
  queries.setAttended.run({ eventId: params.id, userId, attended: attended ? 1 : 0 });
  return NextResponse.json({ ok: true });
}
