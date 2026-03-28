'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface PartifulEvent { id: string; title: string; startDate: string | null; status: string }
interface PlayerBalance { userId: string; name: string; displayName: string | null; balance: number }

export default function Dashboard() {
  const [upcoming, setUpcoming] = useState<PartifulEvent[]>([]);
  const [past, setPast] = useState<PartifulEvent[]>([]);
  const [players, setPlayers] = useState<PlayerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch('/api/runs'), fetch('/api/players')])
      .then(async ([runsRes, playersRes]) => {
        if (!runsRes.ok) throw new Error(`Failed to load runs: ${runsRes.status}`);
        const d = await runsRes.json();
        setUpcoming(d.upcoming);
        setPast(d.past);
        if (playersRes.ok) setPlayers(await playersRes.json());
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading runs...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  const owing = players.filter(p => p.balance < 0);
  const totalOutstanding = owing.reduce((sum, p) => sum + Math.abs(p.balance), 0);
  const followUp = owing.filter(p => p.balance < -10);

  return (
    <div className="space-y-8">
      {owing.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Outstanding</h2>
            <span className="text-destructive font-bold">${totalOutstanding.toFixed(2)}</span>
            <span className="text-sm text-muted-foreground">
              ({owing.length} player{owing.length !== 1 ? 's' : ''})
            </span>
          </div>
          {followUp.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-1">
              <p className="text-sm font-medium text-destructive">Needs follow-up (&gt;$10)</p>
              {followUp.map(p => (
                <div key={p.userId} className="flex items-center justify-between text-sm">
                  <Link href={`/players/${p.userId}`} className="hover:underline">
                    {p.displayName ?? p.name}
                  </Link>
                  <span className="text-destructive font-medium">
                    ${Math.abs(p.balance).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold mb-4">Upcoming Runs</h1>
        {upcoming.length === 0 && <p className="text-muted-foreground">No upcoming runs.</p>}
        <div className="grid gap-3">
          {upcoming.map(event => <EventCard key={event.id} event={event} />)}
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold mb-4">Past Runs</h2>
        {past.length === 0 && <p className="text-muted-foreground">No past runs.</p>}
        <div className="grid gap-3">
          {past.slice(0, 10).map(event => <EventCard key={event.id} event={event} />)}
        </div>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: PartifulEvent }) {
  const date = event.startDate ? new Date(event.startDate).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : 'TBD';
  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{event.title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">{date}</p>
          </div>
          <Link href={`/runs/${event.id}`}>
            <Button variant="outline" size="sm">Manage</Button>
          </Link>
        </div>
      </CardHeader>
    </Card>
  );
}
