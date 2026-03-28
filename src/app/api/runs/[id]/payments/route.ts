import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  queries.upsertPayment.run({
    eventId: params.id,
    userId: body.userId,
    amount: body.amount ?? 0,
    paid: body.paid ? 1 : 0,
    method: body.method ?? null,
    note: body.note ?? null,
  });
  return NextResponse.json({ ok: true });
}
