'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface CalRun { id: string; title: string; startDate: string }

export default function CalendarPage() {
  const [runs, setRuns] = useState<CalRun[]>([]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-indexed

  useEffect(() => {
    fetch('/api/runs')
      .then(r => r.json())
      .then(data => {
        const all = [...data.upcoming, ...data.past];
        setRuns(all.filter((e: any) => e.startDate).map((e: any) => ({
          id: e.id, title: e.title, startDate: e.startDate,
        })));
      });
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

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-CA', {
    month: 'long', year: 'numeric',
  });

  // Build week rows: start from Monday of the week containing the 1st
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  const dow = (firstDay.getDay() + 6) % 7; // Mon=0, Sun=6
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

  // Map dateStr (YYYY-MM-DD) -> run
  const runByDate = new Map<string, CalRun>();
  for (const r of runs) {
    runByDate.set(r.startDate.slice(0, 10), r);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{monthLabel}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={prevMonth}>←</Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="outline" size="sm" onClick={nextMonth}>→</Button>
        </div>
      </div>

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
              const inMonth = day.getMonth() === month;
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
}
