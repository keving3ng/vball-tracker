'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Payment {
  amount: number;
  amountPaid: number | null;
  paid: boolean;
  method: string | null;
  note: string | null;
}

interface Guest {
  userId: string;
  name: string;
  partifulName: string;
  rsvpStatus: string;
  payment: Payment;
}

interface Run {
  eventId: string;
  title: string;
  startDate: string | null;
  capacity: number | null;
  totalCost: number | null;
  splitCount: number;
  costPerHead: number | null;
  notes: string | null;
  syncedAt: string | null;
  guests: Guest[];
}

interface Preset { name: string; totalCost: number; splitCount: number }

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [newGuestName, setNewGuestName] = useState('');
  const [activeTab, setActiveTab] = useState<'guests' | 'payments'>('guests');

  const sync = useCallback(async () => {
    setSyncing(true);
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
    const [runRes, presetsRes] = await Promise.all([
      fetch(`/api/runs/${params.id}`),
      fetch('/api/settings?key=costPresets'),
    ]);
    if (runRes.ok) {
      setRun(await runRes.json());
    } else {
      await sync();
    }
    if (presetsRes.ok) setPresets(await presetsRes.json());
    setLoading(false);
  }, [params.id, sync]);

  useEffect(() => { load(); }, [load]);

  const recordPayment = async (userId: string, amountOwed: number, amountPaid: number | null) => {
    await fetch(`/api/runs/${params.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount: amountOwed, amountPaid }),
    });
    setRun(prev => prev ? {
      ...prev,
      guests: prev.guests.map(g =>
        g.userId === userId
          ? { ...g, payment: { ...g.payment, amount: amountOwed, amountPaid, paid: amountPaid != null } }
          : g
      ),
    } : prev);
  };

  const updateCost = async (totalCost: number, splitCount: number) => {
    await fetch(`/api/runs/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalCost, splitCount }),
    });
    setRun(prev => prev
      ? { ...prev, totalCost, splitCount, costPerHead: totalCost / splitCount }
      : prev);
  };

  const updateNotes = async (notes: string) => {
    await fetch(`/api/runs/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    setRun(prev => prev ? { ...prev, notes } : prev);
  };

  const savePreset = async () => {
    if (!run?.totalCost) return;
    const name = window.prompt('Preset name (e.g. "Weekday $90 / 12"):');
    if (!name) return;
    const newPresets = [...presets, { name, totalCost: run.totalCost, splitCount: run.splitCount }];
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'costPresets', value: newPresets }),
    });
    setPresets(newPresets);
  };

  const addGuest = async () => {
    if (!newGuestName.trim()) return;
    await fetch(`/api/runs/${params.id}/guests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGuestName.trim() }),
    });
    setNewGuestName('');
    setShowAddGuest(false);
    const res = await fetch(`/api/runs/${params.id}`);
    if (res.ok) setRun(await res.json());
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!run) return <p className="text-destructive">Run not found</p>;

  const going = run.guests.filter(g => g.rsvpStatus === 'GOING');
  const maybe = run.guests.filter(g => g.rsvpStatus === 'MAYBE');
  const waitlist = run.guests.filter(g => g.rsvpStatus === 'WAITLIST');
  const other = run.guests.filter(g => !['GOING', 'MAYBE', 'WAITLIST'].includes(g.rsvpStatus));
  const paid = going.filter(g => g.payment?.amountPaid != null);
  const costPerHead = run.costPerHead ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{run.title}</h1>
          <p className="text-muted-foreground text-sm">
            {run.startDate ? new Date(run.startDate).toLocaleDateString('en-CA', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            }) : 'Date TBD'}
          </p>
          <NotesField value={run.notes} onSave={updateNotes} />
        </div>
        <Button onClick={sync} disabled={syncing} variant="outline" size="sm" className="self-start">
          {syncing ? 'Syncing...' : 'Sync Partiful'}
        </Button>
      </div>

      {/* Compact stats */}
      <div className="flex gap-5 text-sm">
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">Going</span>
          <span className="font-semibold text-base">
            {going.length}{run.capacity ? ` / ${run.capacity}` : ''}
          </span>
        </div>
        <div className="w-px bg-border" />
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">Paid</span>
          <span className="font-semibold text-base">{paid.length} / {going.length}</span>
        </div>
      </div>

      {/* Custom tab nav */}
      <div className="space-y-4">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('guests')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'guests'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Guest List
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'payments'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Payments
          </button>
        </div>

        {activeTab === 'guests' && (
          <div className="space-y-3">
            {going.length > 0 && (
              <div className="rounded-lg border overflow-hidden divide-y">
                {going.map(guest => (
                  <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onRecord={recordPayment} />
                ))}
              </div>
            )}

            {(maybe.length > 0 || waitlist.length > 0 || other.length > 0) && (
              <div className="rounded-lg border overflow-hidden divide-y opacity-60">
                {maybe.map(guest => (
                  <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onRecord={recordPayment} showBadge />
                ))}
                {waitlist.length > 0 && waitlist.map(guest => (
                  <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onRecord={recordPayment} showBadge />
                ))}
                {other.map(guest => (
                  <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onRecord={recordPayment} showBadge />
                ))}
              </div>
            )}

            <div>
              {showAddGuest ? (
                <div className="flex gap-2">
                  <input
                    value={newGuestName}
                    onChange={e => setNewGuestName(e.target.value)}
                    placeholder="Guest name"
                    className="border rounded px-2 py-1 text-sm flex-1 min-w-0"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') addGuest();
                      if (e.key === 'Escape') setShowAddGuest(false);
                    }}
                  />
                  <Button size="sm" onClick={addGuest}>Add</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddGuest(false)}>✕</Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setShowAddGuest(true)}>
                  + Add Guest
                </Button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="space-y-3">
            <CostSection
              totalCost={run.totalCost}
              splitCount={run.splitCount}
              presets={presets}
              onUpdate={updateCost}
              onSavePreset={savePreset}
              onApplyPreset={p => updateCost(p.totalCost, p.splitCount)}
            />
            {going.length > 0 && (
              <div className="rounded-lg border overflow-hidden divide-y">
                {going.map(guest => (
                  <PaymentRow
                    key={guest.userId}
                    guest={guest}
                    costPerHead={costPerHead}
                    onRecord={recordPayment}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {run.syncedAt && (
        <p className="text-xs text-muted-foreground">
          Last synced: {new Date(run.syncedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function GuestRow({
  guest, costPerHead, onRecord, showBadge,
}: {
  guest: Guest; costPerHead: number;
  onRecord: (userId: string, amountOwed: number, amountPaid: number | null) => void;
  showBadge?: boolean;
}) {
  const amountOwed = guest.payment?.amount ?? costPerHead;
  const isPaid = guest.payment?.amountPaid != null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-2.5 gap-2 bg-background">
      <div className="flex items-center gap-2.5">
        <span className="font-medium">{guest.name}</span>
        {showBadge && <RsvpBadge status={guest.rsvpStatus} />}
        {guest.userId.startsWith('manual-') && (
          <span className="text-xs text-muted-foreground bg-muted px-1 rounded">manual</span>
        )}
      </div>
      <Button
        variant={isPaid ? 'default' : 'outline'} size="sm"
        className="self-start sm:self-auto"
        onClick={() => onRecord(guest.userId, amountOwed, isPaid ? null : amountOwed)}
      >
        {isPaid ? '✓ Paid' : 'Mark Paid'}
      </Button>
    </div>
  );
}

function PaymentRow({
  guest, costPerHead, onRecord,
}: {
  guest: Guest; costPerHead: number;
  onRecord: (userId: string, amountOwed: number, amountPaid: number | null) => void;
}) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const amountOwed = guest.payment?.amount ?? costPerHead;
  const amountPaid = guest.payment?.amountPaid;
  const isPaid = guest.payment?.amountPaid != null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-2.5 gap-2 bg-background">
      <div className="flex items-center gap-3">
        <span className="font-medium">{guest.name}</span>
        <span className="text-sm text-muted-foreground">${amountOwed.toFixed(2)}</span>
        {isPaid && amountPaid != null && amountPaid !== amountOwed && (
          <span className="text-xs text-muted-foreground">(paid ${amountPaid.toFixed(2)})</span>
        )}
      </div>
      <div className="flex items-center gap-2 self-start sm:self-auto">
        {!isPaid && editingAmount ? (
          <>
            <input
              type="number" value={customAmount} onChange={e => setCustomAmount(e.target.value)}
              className="w-20 border rounded px-2 py-0.5 text-sm"
              placeholder={amountOwed.toFixed(2)} autoFocus
            />
            <Button size="sm" onClick={() => {
              onRecord(guest.userId, amountOwed, parseFloat(customAmount) || amountOwed);
              setEditingAmount(false);
            }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingAmount(false)}>✕</Button>
          </>
        ) : (
          <>
            {!isPaid && (
              <button
                onClick={() => setEditingAmount(true)}
                className="text-xs text-muted-foreground underline decoration-dotted"
              >
                custom
              </button>
            )}
            <Button
              variant={isPaid ? 'default' : 'outline'} size="sm"
              onClick={() => onRecord(guest.userId, amountOwed, isPaid ? null : amountOwed)}
            >
              {isPaid ? '✓ Paid' : 'Mark Paid'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function CostSection({
  totalCost, splitCount, presets, onUpdate, onSavePreset, onApplyPreset,
}: {
  totalCost: number | null; splitCount: number; presets: Preset[];
  onUpdate: (t: number, s: number) => void;
  onSavePreset: () => void;
  onApplyPreset: (p: Preset) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [cost, setCost] = useState(String(totalCost ?? ''));
  const [split, setSplit] = useState(String(splitCount));
  useEffect(() => {
    setCost(String(totalCost ?? ''));
    setSplit(String(splitCount));
  }, [totalCost, splitCount]);
  const costPerHead = totalCost != null ? (totalCost / splitCount).toFixed(2) : null;

  if (!editing) return (
    <div className="flex items-center gap-3 flex-wrap text-sm">
      <span className="text-muted-foreground">Run cost:</span>
      <button onClick={() => setEditing(true)} className="font-medium underline decoration-dotted">
        {totalCost != null ? `$${totalCost.toFixed(2)} ÷ ${splitCount}` : 'Set cost'}
      </button>
      {costPerHead && (
        <span className="text-muted-foreground">= ${costPerHead} / head</span>
      )}
      {presets.length > 0 && (
        <select
          className="text-xs border rounded px-1 py-0.5 text-muted-foreground"
          defaultValue=""
          onChange={e => {
            const p = presets[parseInt(e.target.value)];
            if (p) onApplyPreset(p);
            e.target.value = '';
          }}
        >
          <option value="">Apply preset…</option>
          {presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
        </select>
      )}
      {totalCost != null && (
        <button onClick={onSavePreset} className="text-xs text-muted-foreground underline decoration-dotted">
          Save as preset
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">$</span>
      <input
        type="number" value={cost} onChange={e => setCost(e.target.value)}
        className="w-20 border rounded px-2 py-0.5" placeholder="120" autoFocus
      />
      <span className="text-muted-foreground">÷</span>
      <input
        type="number" value={split} onChange={e => setSplit(e.target.value)}
        className="w-16 border rounded px-2 py-0.5"
      />
      <Button size="sm" onClick={() => {
        onUpdate(parseFloat(cost), parseInt(split) || 12);
        setEditing(false);
      }}>Save</Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>✕</Button>
    </div>
  );
}

function NotesField({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  if (!editing) return (
    <p
      className="text-sm text-muted-foreground cursor-pointer hover:text-foreground min-h-[1.25rem]"
      onClick={() => setEditing(true)}
    >
      {value || <em>Add run notes…</em>}
    </p>
  );
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={val} onChange={e => setVal(e.target.value)}
        className="w-full border rounded px-2 py-1 text-sm min-h-[60px]" autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { onSave(val); setEditing(false); }}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function RsvpBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
    GOING: 'default', MAYBE: 'secondary', NOT_GOING: 'destructive',
  };
  return <Badge variant={variants[status] ?? 'secondary'}>{status}</Badge>;
}
