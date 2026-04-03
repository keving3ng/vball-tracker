import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR ?? ".";
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "vball.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
    eventId    TEXT NOT NULL REFERENCES runs(eventId),
    userId     TEXT NOT NULL REFERENCES players(userId),
    rsvpStatus TEXT NOT NULL DEFAULT 'GOING',
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

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Additive schema migrations — safe to run on every startup
for (const sql of [
	`ALTER TABLE runs ADD COLUMN totalCost REAL`,
	`ALTER TABLE runs ADD COLUMN splitCount INTEGER DEFAULT 12`,
	`ALTER TABLE runs ADD COLUMN notes TEXT`,
	`ALTER TABLE players ADD COLUMN displayName TEXT`,
	`ALTER TABLE players ADD COLUMN notes TEXT`,
	`ALTER TABLE payments ADD COLUMN amountPaid REAL`,
	`ALTER TABLE runs ADD COLUMN hostUserId TEXT`,
]) {
	try {
		db.exec(sql);
	} catch {}
}

export interface Player {
	userId: string;
	name: string;
	displayName: string | null;
	notes: string | null;
}
export interface Run {
	eventId: string;
	title: string;
	startDate: string | null;
	capacity: number | null;
	totalCost: number | null;
	splitCount: number;
	costPerHead: number | null;
	notes: string | null;
	syncedAt: string | null;
	hostUserId: string | null;
}
export interface AttendanceRow {
	eventId: string;
	userId: string;
	rsvpStatus: string;
}
export interface PaymentRow {
	eventId: string;
	userId: string;
	amount: number;
	amountPaid: number | null;
	paid: boolean;
	method: string | null;
	note: string | null;
}

export const queries = {
	upsertPlayer: db.prepare(`
    INSERT INTO players (userId, name, updatedAt)
    VALUES (@userId, @name, datetime('now'))
    ON CONFLICT(userId) DO UPDATE SET name=excluded.name, updatedAt=excluded.updatedAt
  `),

	upsertRun: db.prepare(`
    INSERT INTO runs (eventId, title, startDate, syncedAt)
    VALUES (@eventId, @title, @startDate, datetime('now'))
    ON CONFLICT(eventId) DO UPDATE SET
      title=excluded.title, startDate=excluded.startDate, syncedAt=excluded.syncedAt
  `),

	insertManualRun: db.prepare(`
    INSERT INTO runs (eventId, title, startDate) VALUES (@eventId, @title, @startDate)
  `),

	getManualRuns: db.prepare(`
    SELECT eventId, title, startDate FROM runs WHERE eventId LIKE 'manual-%' ORDER BY startDate DESC
  `),

	getRunBasic: db.prepare(`SELECT * FROM runs WHERE eventId = ?`),

	updateRunCost: db.prepare(`
    UPDATE runs SET totalCost=@totalCost, splitCount=@splitCount WHERE eventId=@eventId
  `),

	updateRunNotes: db.prepare(`
    UPDATE runs SET notes=@notes WHERE eventId=@eventId
  `),

	getLastRunCost: db.prepare(`
    SELECT totalCost, splitCount FROM runs
    WHERE totalCost IS NOT NULL ORDER BY startDate DESC LIMIT 1
  `),

	upsertAttendance: db.prepare(`
    INSERT INTO attendance (eventId, userId, rsvpStatus)
    VALUES (@eventId, @userId, @rsvpStatus)
    ON CONFLICT(eventId, userId) DO UPDATE SET rsvpStatus=excluded.rsvpStatus
  `),

	upsertPayment: db.prepare(`
    INSERT INTO payments (eventId, userId, amount, amountPaid, paid, method, note)
    VALUES (@eventId, @userId, @amount, @amountPaid, @paid, @method, @note)
    ON CONFLICT(eventId, userId) DO UPDATE SET
      amount=excluded.amount, amountPaid=excluded.amountPaid, paid=excluded.paid,
      method=excluded.method, note=excluded.note
  `),

	upsertPaymentOwed: db.prepare(`
    INSERT INTO payments (eventId, userId, amount, paid)
    VALUES (@eventId, @userId, @amount, 0)
    ON CONFLICT(eventId, userId) DO UPDATE SET amount=excluded.amount
  `),

	deleteUnpaidPayment: db.prepare(`
    DELETE FROM payments WHERE eventId = ? AND userId = ? AND amountPaid IS NULL
  `),

	updateRunHost: db.prepare(`
    UPDATE runs SET hostUserId = @hostUserId WHERE eventId = @eventId
  `),

	getLastRunHost: db.prepare(`
    SELECT hostUserId FROM runs WHERE hostUserId IS NOT NULL ORDER BY startDate DESC LIMIT 1
  `),

	markHostPaid: db.prepare(`
    UPDATE payments SET amount = @amount, amountPaid = @amountPaid, paid = 1
    WHERE eventId = @eventId AND userId = @userId
  `),

	clearHostPayment: db.prepare(`
    UPDATE payments SET amountPaid = NULL, paid = 0
    WHERE eventId = ? AND userId = ? AND amountPaid IS NOT NULL AND amountPaid = amount
  `),

	getGoingAttendance: db.prepare(`
    SELECT userId FROM attendance WHERE eventId = ? AND rsvpStatus = 'GOING'
  `),

	getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
	upsertSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `),

	getRunWithGuests: db.prepare(`
    SELECT
      r.*,
      a.userId, a.rsvpStatus,
      p.name, p.displayName,
      pay.amount, pay.amountPaid, pay.method, pay.note
    FROM runs r
    LEFT JOIN attendance a ON a.eventId = r.eventId
    LEFT JOIN players p ON p.userId = a.userId
    LEFT JOIN payments pay ON pay.eventId = r.eventId AND pay.userId = a.userId
    WHERE r.eventId = ?
    ORDER BY a.rsvpStatus, COALESCE(p.displayName, p.name)
  `),

	getPlayerStats: db.prepare(`
    SELECT
      p.userId,
      p.name,
      p.displayName,
      COUNT(DISTINCT a.eventId) as totalRuns,
      COALESCE(SUM(CASE WHEN pay.amountPaid IS NOT NULL THEN 1 ELSE 0 END), 0) as paidRuns,
      COALESCE(SUM(CASE WHEN pay.amountPaid IS NULL AND COALESCE(pay.amount, CASE WHEN r.totalCost IS NOT NULL THEN r.totalCost / COALESCE(r.splitCount, 12) ELSE 0 END) > 0 THEN 1 ELSE 0 END), 0) as owingRuns,
      COALESCE(SUM(
        COALESCE(pay.amountPaid, 0) -
        COALESCE(pay.amount, CASE WHEN r.totalCost IS NOT NULL THEN r.totalCost / COALESCE(r.splitCount, 12) ELSE 0 END)
      ), 0) as balance
    FROM players p
    LEFT JOIN attendance a ON a.userId = p.userId AND a.rsvpStatus = 'GOING'
    LEFT JOIN runs r ON r.eventId = a.eventId
    LEFT JOIN payments pay ON pay.userId = p.userId AND pay.eventId = a.eventId
    GROUP BY p.userId
    ORDER BY totalRuns DESC
  `),

	getPlayerProfile: db.prepare(`
    SELECT
      p.userId, p.name, p.displayName, p.notes,
      r.eventId, r.title, r.startDate, r.totalCost, r.splitCount,
      pay.amount, pay.amountPaid, pay.method, pay.note
    FROM players p
    LEFT JOIN attendance a ON a.userId = p.userId AND a.rsvpStatus = 'GOING'
    LEFT JOIN runs r ON r.eventId = a.eventId
    LEFT JOIN payments pay ON pay.userId = p.userId AND pay.eventId = a.eventId
    WHERE p.userId = ?
    ORDER BY r.startDate DESC
  `),

	getPlayerAttendanceHistory: db.prepare(`
    SELECT r.eventId, r.startDate,
      CASE WHEN a.userId IS NOT NULL THEN 1 ELSE 0 END as attended
    FROM runs r
    LEFT JOIN attendance a
      ON a.eventId = r.eventId AND a.userId = ? AND a.rsvpStatus = 'GOING'
    WHERE r.startDate IS NOT NULL
    ORDER BY r.startDate DESC
  `),

	updatePlayerProfile: db.prepare(`
    UPDATE players SET displayName=@displayName, notes=@notes, updatedAt=datetime('now')
    WHERE userId=@userId
  `),

	getAllPlayersBasic: db.prepare(`
    SELECT userId, name, displayName FROM players ORDER BY COALESCE(displayName, name) COLLATE NOCASE
  `),

	getPlayerBasic: db.prepare(
		`SELECT userId, name, displayName FROM players WHERE userId = ?`,
	),

	// Merge helpers — used by mergePlayerIntoTarget transaction below
	getAttendanceEventIds: db.prepare(
		`SELECT eventId FROM attendance WHERE userId = ?`,
	),
	getPaymentEventIds: db.prepare(
		`SELECT eventId FROM payments WHERE userId = ?`,
	),
	checkAttendance: db.prepare(
		`SELECT 1 FROM attendance WHERE eventId = ? AND userId = ?`,
	),
	checkPayment: db.prepare(
		`SELECT 1 FROM payments WHERE eventId = ? AND userId = ?`,
	),
	updateAttendanceUser: db.prepare(
		`UPDATE attendance SET userId = ? WHERE userId = ? AND eventId = ?`,
	),
	deleteAttendanceRow: db.prepare(
		`DELETE FROM attendance WHERE userId = ? AND eventId = ?`,
	),
	updatePaymentUser: db.prepare(
		`UPDATE payments SET userId = ? WHERE userId = ? AND eventId = ?`,
	),
	deletePaymentRow: db.prepare(
		`DELETE FROM payments WHERE userId = ? AND eventId = ?`,
	),
	updateRunHostUser: db.prepare(
		`UPDATE runs SET hostUserId = ? WHERE hostUserId = ?`,
	),
	deletePlayer: db.prepare(`DELETE FROM players WHERE userId = ?`),

	// Returns a player's balance across all runs except the given eventId.
	// Used to detect credit that can auto-cover a new run.
	getPlayerBalanceExcludingRun: db.prepare(`
    SELECT COALESCE(SUM(COALESCE(amountPaid, 0) - COALESCE(amount, 0)), 0) AS balance
    FROM payments WHERE userId = ? AND eventId != ?
  `),

	// Batch version: all players' prior balances excluding a specific run.
	getPlayerBalancesExcludingRun: db.prepare(`
    SELECT userId, COALESCE(SUM(COALESCE(amountPaid, 0) - COALESCE(amount, 0)), 0) AS balance
    FROM payments WHERE eventId != ?
    GROUP BY userId
  `),
};

// Merges sourceId (manual player) into targetId (Partiful player).
// Attendance and payment records move to target; conflicts favour target.
export const mergePlayerIntoTarget = db.transaction(
	(sourceId: string, targetId: string) => {
		const attendance = queries.getAttendanceEventIds.all(sourceId) as {
			eventId: string;
		}[];
		for (const { eventId } of attendance) {
			if (queries.checkAttendance.get(eventId, targetId)) {
				queries.deleteAttendanceRow.run(sourceId, eventId);
			} else {
				queries.updateAttendanceUser.run(targetId, sourceId, eventId);
			}
		}

		const payments = queries.getPaymentEventIds.all(sourceId) as {
			eventId: string;
		}[];
		for (const { eventId } of payments) {
			if (queries.checkPayment.get(eventId, targetId)) {
				queries.deletePaymentRow.run(sourceId, eventId);
			} else {
				queries.updatePaymentUser.run(targetId, sourceId, eventId);
			}
		}

		queries.updateRunHostUser.run(targetId, sourceId);
		queries.deletePlayer.run(sourceId);
	},
);

export default db;
