'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Guest {
  userId: string;
  name: string;
  rsvpStatus: string;
  payment: { amount: number; paid: boolean; method: string | null; note: string | null };
}

interface Run {
  eventId: string;
  title: string;
  startDate: string | null;
  capacity: number | null;
  costPerHead: number | null;
  syncedAt: string | null;
  guests: Guest[];
}

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const sync = useCallback(async () => {
    setSyncing(true);
    // Upsert run metadata from Partiful events list
    try {
      const runsData = await fetch('/api/runs').then(r => r.json());
      const all = [...runsData.upcoming, ...runsData.past];
      const event = all.find((e: any) => e.id === params.id);
      if (event) {
        await fetch(`/api/runs/${params.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: event.title, startDate: event.startDate }),
        });
      }
      await fetch(`/api/runs/${params.id}/sync`, { method: 'POST' });
      const res = await fetch(`/api/runs/${params.id}`);
      if (res.ok) setRun(await res.json());
    } finally {
      setSyncing(false);
    }
  }, [params.id]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/runs/${params.id}`);
    if (res.ok) {
      setRun(await res.json());
    } else {
      // Run not in DB yet — seed it from Partiful
      await sync();
    }
    setLoading(false);
  }, [params.id, sync]);

  useEffect(() => { load(); }, [load]);

  const togglePaid = async (userId: string, paid: boolean, amount: number) => {
    await fetch(`/api/runs/${params.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, paid, amount }),
    });
    setRun(prev => prev ? {
      ...prev,
      guests: prev.guests.map(g =>
        g.userId === userId ? { ...g, payment: { ...g.payment, paid } } : g
      ),
    } : prev);
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!run) return <p className="text-destructive">Run not found</p>;

  const going = run.guests.filter(g => g.rsvpStatus === 'GOING');
  const paid = going.filter(g => g.payment?.paid);
  const costPerHead = run.costPerHead ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{run.title}</h1>
          <p className="text-muted-foreground">
            {run.startDate ? new Date(run.startDate).toLocaleDateString('en-CA', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            }) : 'Date TBD'}
          </p>
        </div>
        <Button onClick={sync} disabled={syncing} variant="outline" size="sm">
          {syncing ? 'Syncing...' : 'Sync Partiful'}
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Going" value={`${going.length}${run.capacity ? ` / ${run.capacity}` : ''}`} />
        <StatCard label="Paid" value={`${paid.length} / ${going.length}`} />
      </div>

      <Tabs defaultValue="guests">
        <TabsList>
          <TabsTrigger value="guests">Guest List</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="guests" className="space-y-2 mt-4">
          {going.map(guest => (
            <GuestRow
              key={guest.userId}
              guest={guest}
              costPerHead={costPerHead}
              onTogglePaid={togglePaid}
            />
          ))}
          {run.guests.filter(g => g.rsvpStatus !== 'GOING').map(guest => (
            <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onTogglePaid={togglePaid} dim />
          ))}
        </TabsContent>

        <TabsContent value="payments" className="space-y-2 mt-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Cost per head: </span>
            <CostInput
              value={costPerHead}
              onSave={val => fetch(`/api/runs/${params.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ costPerHead: val, capacity: run.capacity }),
              }).then(() => setRun(prev => prev ? { ...prev, costPerHead: val } : prev))}
            />
          </div>
          {going.map(guest => (
            <PaymentRow
              key={guest.userId}
              guest={guest}
              costPerHead={costPerHead}
              onTogglePaid={togglePaid}
            />
          ))}
        </TabsContent>
      </Tabs>

      {run.syncedAt && (
        <p className="text-xs text-muted-foreground">
          Last synced: {new Date(run.syncedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function GuestRow({
  guest, costPerHead, onTogglePaid, dim
}: {
  guest: Guest;
  costPerHead: number;
  onTogglePaid: (userId: string, paid: boolean, amount: number) => void;
  dim?: boolean;
}) {
  const amount = guest.payment?.amount || costPerHead;
  return (
    <div className={`flex items-center justify-between px-4 py-2 rounded-lg border ${dim ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="font-medium">{guest.name}</span>
        <RsvpBadge status={guest.rsvpStatus} />
      </div>
      <Button
        variant={guest.payment?.paid ? 'default' : 'outline'}
        size="sm"
        onClick={() => onTogglePaid(guest.userId, !guest.payment?.paid, amount)}
      >
        {guest.payment?.paid ? '✓ Paid' : 'Mark Paid'}
      </Button>
    </div>
  );
}

function PaymentRow({
  guest, costPerHead, onTogglePaid
}: {
  guest: Guest;
  costPerHead: number;
  onTogglePaid: (userId: string, paid: boolean, amount: number) => void;
}) {
  const amount = guest.payment?.amount || costPerHead;
  return (
    <div className="flex items-center justify-between px-4 py-2 rounded-lg border">
      <div className="flex items-center gap-3">
        <span className="font-medium">{guest.name}</span>
        <span className="text-sm text-muted-foreground">${amount.toFixed(2)}</span>
      </div>
      <Button
        variant={guest.payment?.paid ? 'default' : 'outline'}
        size="sm"
        onClick={() => onTogglePaid(guest.userId, !guest.payment?.paid, amount)}
      >
        {guest.payment?.paid ? '✓ Paid' : 'Mark Paid'}
      </Button>
    </div>
  );
}

function RsvpBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
    GOING: 'default', MAYBE: 'secondary', NOT_GOING: 'destructive',
  };
  return <Badge variant={variants[status] ?? 'secondary'}>{status}</Badge>;
}

function CostInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  if (!editing) return (
    <button onClick={() => setEditing(true)} className="text-sm font-medium underline decoration-dotted">
      ${value.toFixed(2)}
    </button>
  );
  return (
    <div className="flex gap-2">
      <input
        type="number"
        value={val}
        onChange={e => setVal(e.target.value)}
        className="w-20 border rounded px-2 py-0.5 text-sm"
        autoFocus
      />
      <Button size="sm" onClick={() => { onSave(parseFloat(val)); setEditing(false); }}>Save</Button>
    </div>
  );
}
