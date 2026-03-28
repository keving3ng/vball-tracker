'use client';

import { useEffect, useState } from 'react';

interface PlayerStats {
  userId: string;
  name: string;
  totalRuns: number;
  paidRuns: number;
  owingRuns: number;
  totalOwing: number;
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/players')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load players: ${r.status}`);
        return r.json();
      })
      .then(setPlayers)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading players...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Players</h1>
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Player</th>
              <th className="text-center px-4 py-2 font-medium">Runs</th>
              <th className="text-center px-4 py-2 font-medium">Owing</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={p.userId} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-center">{p.totalRuns}</td>
                <td className="px-4 py-2 text-center">
                  {p.totalOwing > 0 ? (
                    <span className="text-destructive font-medium">${p.totalOwing.toFixed(2)}</span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
