import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { userId, amount, amountPaid, method, note } = body;

  const resolvedAmountPaid: number | null = amountPaid !== undefined ? amountPaid : null;

  queries.upsertPayment.run({
    eventId: params.id,
    userId,
    amount: amount ?? 0,
    amountPaid: resolvedAmountPaid,
    paid: resolvedAmountPaid != null ? 1 : 0,
    method: method ?? null,
    note: note ?? null,
  });

  return NextResponse.json({ ok: true });
}
