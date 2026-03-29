export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key') ?? 'costPresets';
  const row = queries.getSetting.get(key) as any;
  return NextResponse.json(row ? JSON.parse(row.value) : []);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { key = 'costPresets', value } = body;
  queries.upsertSetting.run({ key, value: JSON.stringify(value) });
  return NextResponse.json({ ok: true });
}
