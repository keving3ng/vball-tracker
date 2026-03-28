import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR ?? '.';
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'vball.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    userId      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    eventId     TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    startDate   TEXT,
    capacity    INTEGER,
    costPerHead REAL,
    syncedAt    TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance (
    eventId   TEXT NOT NULL REFERENCES runs(eventId),
    userId    TEXT NOT NULL REFERENCES players(userId),
    rsvpStatus TEXT NOT NULL DEFAULT 'GOING',
    attended  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (eventId, userId)
  );

  CREATE TABLE IF NOT EXISTS payments (
    eventId  TEXT NOT NULL REFERENCES runs(eventId),
    userId   TEXT NOT NULL REFERENCES players(userId),
    amount   REAL NOT NULL DEFAULT 0,
    paid     INTEGER NOT NULL DEFAULT 0,
    method   TEXT,
    note     TEXT,
    PRIMARY KEY (eventId, userId)
  );
`);

export interface Player { userId: string; name: string }
export interface Run { eventId: string; title: string; startDate: string | null; capacity: number | null; costPerHead: number | null; syncedAt: string | null }
export interface AttendanceRow { eventId: string; userId: string; rsvpStatus: string; attended: boolean }
export interface PaymentRow { eventId: string; userId: string; amount: number; paid: boolean; method: string | null; note: string | null }

export const queries = {
  upsertPlayer: db.prepare(`
    INSERT INTO players (userId, name, updatedAt)
    VALUES (@userId, @name, datetime('now'))
    ON CONFLICT(userId) DO UPDATE SET name=excluded.name, updatedAt=excluded.updatedAt
  `),

  upsertRun: db.prepare(`
    INSERT INTO runs (eventId, title, startDate, syncedAt)
    VALUES (@eventId, @title, @startDate, datetime('now'))
    ON CONFLICT(eventId) DO UPDATE SET title=excluded.title, startDate=excluded.startDate, syncedAt=excluded.syncedAt
  `),

  updateRunSettings: db.prepare(`
    UPDATE runs SET capacity=@capacity, costPerHead=@costPerHead WHERE eventId=@eventId
  `),

  upsertAttendance: db.prepare(`
    INSERT INTO attendance (eventId, userId, rsvpStatus)
    VALUES (@eventId, @userId, @rsvpStatus)
    ON CONFLICT(eventId, userId) DO UPDATE SET rsvpStatus=excluded.rsvpStatus
  `),

  setAttended: db.prepare(`
    UPDATE attendance SET attended=@attended WHERE eventId=@eventId AND userId=@userId
  `),

  upsertPayment: db.prepare(`
    INSERT INTO payments (eventId, userId, amount, paid, method, note)
    VALUES (@eventId, @userId, @amount, @paid, @method, @note)
    ON CONFLICT(eventId, userId) DO UPDATE SET
      amount=excluded.amount, paid=excluded.paid, method=excluded.method, note=excluded.note
  `),

  getRunWithGuests: db.prepare(`
    SELECT
      r.*,
      a.userId, a.rsvpStatus, a.attended,
      p.name,
      pay.amount, pay.paid, pay.method, pay.note
    FROM runs r
    LEFT JOIN attendance a ON a.eventId = r.eventId
    LEFT JOIN players p ON p.userId = a.userId
    LEFT JOIN payments pay ON pay.eventId = r.eventId AND pay.userId = a.userId
    WHERE r.eventId = ?
    ORDER BY a.rsvpStatus, p.name
  `),

  getPlayerStats: db.prepare(`
    SELECT
      p.userId,
      p.name,
      COUNT(a.eventId) as totalRuns,
      SUM(a.attended) as attended,
      SUM(CASE WHEN pay.paid = 1 THEN 1 ELSE 0 END) as paidRuns,
      SUM(CASE WHEN pay.paid = 0 AND pay.amount > 0 THEN 1 ELSE 0 END) as owingRuns,
      SUM(CASE WHEN pay.paid = 0 THEN pay.amount ELSE 0 END) as totalOwing
    FROM players p
    LEFT JOIN attendance a ON a.userId = p.userId
    LEFT JOIN payments pay ON pay.userId = p.userId AND pay.eventId = a.eventId
    GROUP BY p.userId
    ORDER BY attended DESC, totalRuns DESC
  `),
};

export default db;
