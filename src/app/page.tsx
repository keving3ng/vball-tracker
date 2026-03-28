'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface PartifulEvent {
  id: string;
  title: string;
  startDate: string | null;
  status: string;
}

export default function Dashboard() {
  const [upcoming, setUpcoming] = useState<PartifulEvent[]>([]);
  const [past, setPast] = useState<PartifulEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/runs')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load runs: ${r.status}`);
        return r.json();
      })
      .then(data => { setUpcoming(data.upcoming); setPast(data.past); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading runs...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-4">Upcoming Runs</h1>
        {upcoming.length === 0 && <p className="text-muted-foreground">No upcoming runs.</p>}
        <div className="grid gap-3">
          {upcoming.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-4">Past Runs</h2>
        {past.length === 0 && <p className="text-muted-foreground">No past runs.</p>}
        <div className="grid gap-3">
          {past.slice(0, 10).map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: PartifulEvent }) {
  const date = event.startDate ? new Date(event.startDate).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
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
