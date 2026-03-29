'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface CalRun { id: string; title: string; startDate: string }

function buildWeeks(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  const dow = (firstDay.getDay() + 6) % 7; // Mon=0
  startDate.setDate(firstDay.getDate() - dow);

  const weeks: Date[][] = [];
  const cursor = new Date(startDate);
  while (cursor <= lastDay || weeks.length < 4) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor > lastDay && weeks.length >= 4) break;
  }
  return weeks;
}

export default function CalendarPage() {
  const [runs, setRuns] = useState<CalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-indexed

  useEffect(() => {
    fetch('/api/runs')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load runs: ${r.status}`);
        return r.json();
      })
      .then(data => {
        const all = [...data.upcoming, ...data.past];
        setRuns(all.filter((e: any) => e.startDate).map((e: any) => ({
          id: e.id, title: e.title, startDate: e.startDate,
        })));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); };

  // 3 months starting from the current state
  const displayMonths = [0, 1, 2].map(offset => {
    const total = month + offset;
    return { year: year + Math.floor(total / 12), month: total % 12 };
  });

  const runByDate = new Map<string, CalRun>();
  for (const r of runs) {
    runByDate.set(r.startDate.slice(0, 10), r);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  const firstLabel = new Date(year, month, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
  const last = displayMonths[2];
  const lastLabel = new Date(last.year, last.month, 1).toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{firstLabel} – {lastLabel}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={prevMonth}>←</Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="outline" size="sm" onClick={nextMonth}>→</Button>
        </div>
      </div>

      {/* Mobile: list view per month */}
      <div className="sm:hidden space-y-5">
        {displayMonths.map(dm => {
          const label = new Date(dm.year, dm.month, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
          const monthRuns = runs
            .filter(r => {
              const d = new Date(r.startDate);
              return d.getFullYear() === dm.year && d.getMonth() === dm.month;
            })
            .sort((a, b) => a.startDate.localeCompare(b.startDate));
          return (
            <div key={`${dm.year}-${dm.month}`} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{label}</h2>
              {monthRuns.length === 0 ? (
                <p className="text-muted-foreground text-sm">No runs.</p>
              ) : (
                monthRuns.map(run => {
                  const runDate = new Date(run.startDate).toLocaleDateString('en-CA', {
                    weekday: 'short', month: 'short', day: 'numeric',
                  });
                  return (
                    <Link
                      key={run.id}
                      href={`/runs/${run.id}`}
                      className="flex items-center justify-between px-4 py-3 rounded-lg border hover:bg-muted/50"
                    >
                      <span className="font-medium">{run.title}</span>
                      <span className="text-sm text-muted-foreground">{runDate}</span>
                    </Link>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: 3 month grids stacked */}
      <div className="hidden sm:block space-y-6">
        {displayMonths.map(dm => {
          const weeks = buildWeeks(dm.year, dm.month);
          const label = new Date(dm.year, dm.month, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
          return (
            <div key={`${dm.year}-${dm.month}`} className="space-y-1">
              <h2 className="font-semibold">{label}</h2>
              <div className="rounded-lg border overflow-hidden">
                <div className="grid grid-cols-7 bg-muted text-muted-foreground text-xs text-center border-b">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                    <div key={d} className="py-2 font-medium">{d}</div>
                  ))}
                </div>
                {weeks.map((week, wi) => (
                  <div key={wi} className={`grid grid-cols-7 ${wi > 0 ? 'border-t' : ''}`}>
                    {week.map((day, di) => {
                      const ds = day.toISOString().slice(0, 10);
                      const run = runByDate.get(ds);
                      const inMonth = day.getMonth() === dm.month;
                      const isToday = ds === todayStr;
                      return (
                        <div
                          key={di}
                          className={`min-h-[64px] p-1.5 ${di < 6 ? 'border-r' : ''} ${!inMonth ? 'bg-muted/20' : ''}`}
                        >
                          <span className={`inline-flex items-center justify-center text-xs w-6 h-6 rounded-full font-medium
                            ${isToday ? 'bg-primary text-primary-foreground' : !inMonth ? 'text-muted-foreground' : ''}`}>
                            {day.getDate()}
                          </span>
                          {run && (
                            <Link href={`/runs/${run.id}`}>
                              <div className="mt-1 px-1.5 py-0.5 rounded text-xs bg-primary text-primary-foreground truncate leading-tight">
                                {run.title}
                              </div>
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
