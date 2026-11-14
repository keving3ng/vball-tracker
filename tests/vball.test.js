'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

/**
 * Minimal better-sqlite3 compatibility shim backed by Node's built-in node:sqlite
 * so src/lib/db.ts, src/lib/gmail.ts, and src/lib/utils.ts can be executed
 * directly in isolated temporary SQLite databases without external native binaries.
 */
class StatementShim {
  constructor(stmt, sql) {
    this.stmt = stmt;
    this.namedParams = new Set([...sql.matchAll(/@([A-Za-z0-9_]+)/g)].map(m => m[1]));
  }
  _normalizeArgs(args) {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const filtered = {};
      for (const [k, v] of Object.entries(args[0])) {
        if (this.namedParams.size === 0 || this.namedParams.has(k)) filtered[k] = v;
      }
      return [filtered];
    }
    return args;
  }
  run(...args) {
    return this.stmt.run(...this._normalizeArgs(args));
  }
  get(...args) {
    return this.stmt.get(...this._normalizeArgs(args));
  }
  all(...args) {
    return this.stmt.all(...this._normalizeArgs(args));
  }
}

class DatabaseShim {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this._txDepth = 0;
  }
  pragma(str) {
    this.db.exec(`PRAGMA ${str}`);
  }
  exec(sql) {
    this.db.exec(sql);
  }
  prepare(sql) {
    return new StatementShim(this.db.prepare(sql), sql);
  }
  transaction(fn) {
    return (...args) => {
      const sp = `sp_${++this._txDepth}`;
      this.db.exec(this._txDepth === 1 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
      try {
        const res = fn(...args);
        this.db.exec(this._txDepth === 1 ? 'COMMIT' : `RELEASE SAVEPOINT ${sp}`);
        return res;
      } catch (err) {
        try {
          this.db.exec(this._txDepth === 1 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${sp}`);
          if (this._txDepth > 1) this.db.exec(`RELEASE SAVEPOINT ${sp}`);
        } catch {}
        throw err;
      } finally {
        this._txDepth--;
      }
    };
  }
}

function stripTypes(tsSource) {
  const stripped = require('node:module').stripTypeScriptTypes(tsSource, { mode: 'strip' });
  return stripped
    .replace(/import\s+([A-Za-z0-9_$]+)\s+from\s+["']([^"']+)["'];?/g, 'const $1 = require("$2");')
    .replace(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?/g, (_, names, pkg) => {
      const cleaned = names.replace(/\btype\s+[A-Za-z0-9_$]+\s*,?/g, '').trim();
      return cleaned ? `const { ${cleaned} } = require("${pkg}");` : '';
    })
    .replace(/export\s+const\s+([A-Za-z0-9_$]+)\s*=/g, 'const $1 = exports.$1 =')
    .replace(/export\s+async\s+function\s+([A-Za-z0-9_$]+)/g, 'exports.$1 = async function $1')
    .replace(/export\s+function\s+([A-Za-z0-9_$]+)/g, 'exports.$1 = function $1')
    .replace(/export\s+default\s+([A-Za-z0-9_$]+);?/g, 'module.exports.default = $1;');
}

function loadVballEnv(dataDir, envOverrides = {}) {
  const rootDir = path.resolve(__dirname, '..');
  const moduleCache = new Map();

  const customProcess = Object.create(process);
  customProcess.env = { ...process.env, DATA_DIR: dataDir, ...envOverrides };

  function customRequire(specifier) {
    if (specifier === 'better-sqlite3') return DatabaseShim;
    if (specifier === 'path') return path;
    if (specifier === 'fs') return fs;
    if (specifier === 'crypto') return crypto;
    if (specifier === 'clsx') return (...args) => args.flat().filter(Boolean).join(' ');
    if (specifier === 'tailwind-merge') return { twMerge: s => s };
    if (specifier === 'next/server') {
      return {
        NextResponse: {
          json: (body, init = {}) => ({
            status: init.status ?? 200,
            async json() { return body; }
          })
        }
      };
    }
    if (specifier === '@keg/partiful-api') {
      return envOverrides.__partifulMock || {};
    }
    if (specifier.startsWith('@/lib/')) {
      const modName = specifier.slice('@/lib/'.length);
      return loadTsModule(path.join(rootDir, 'src', 'lib', `${modName}.ts`));
    }
    return require(specifier);
  }

  function loadTsModule(filePath) {
    if (moduleCache.has(filePath)) return moduleCache.get(filePath).exports;
    const raw = fs.readFileSync(filePath, 'utf8');
    const js = stripTypes(raw);
    const mod = { exports: {} };
    moduleCache.set(filePath, mod);
    const context = vm.createContext({
      module: mod,
      exports: mod.exports,
      require: customRequire,
      process: customProcess,
      Buffer,
      URLSearchParams,
      console,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Map,
      Set,
      RegExp,
      Error
    });
    vm.runInContext(js, context, { filename: filePath });
    return mod.exports;
  }

  return {
    dbMod: loadTsModule(path.join(rootDir, 'src', 'lib', 'db.ts')),
    gmailMod: loadTsModule(path.join(rootDir, 'src', 'lib', 'gmail.ts')),
    utilsMod: loadTsModule(path.join(rootDir, 'src', 'lib', 'utils.ts')),
    runsRoute: loadTsModule(path.join(rootDir, 'src', 'app', 'api', 'runs', 'route.ts')),
    syncRoute: loadTsModule(path.join(rootDir, 'src', 'app', 'api', 'runs', '[id]', 'sync', 'route.ts'))
  };
}

test('Partiful run filtering, cancellation handling, and attendee split tallying', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vball-sync-'));
  try {
    const partifulMock = {
      getUpcomingEvents: async () => ({
        result: {
          data: {
            upcomingEvents: [
              { id: 'evt-owned', title: 'WE (V)BALL 🏐', startDate: '2026-12-01T18:00:00Z', status: 'PUBLISHED', ownerIds: ['uFItaBptDMVmeXFHhw1Rhma8FOq1'] },
              { id: 'evt-invited', title: 'Someone else vball', startDate: '2026-12-02T18:00:00Z', status: 'PUBLISHED', ownerIds: ['other-owner'] },
              { id: 'evt-dinner', title: 'Birthday Dinner', startDate: '2026-12-03T18:00:00Z', status: 'PUBLISHED', ownerIds: ['uFItaBptDMVmeXFHhw1Rhma8FOq1'] }
            ]
          }
        }
      }),
      getPastEvents: async () => ({
        result: {
          data: {
            pastEvents: [
              { id: 'evt-1', title: 'WE (V)BALL 🏐', startDate: '2026-01-10T18:00:00Z', status: 'PUBLISHED', ownerIds: ['uFItaBptDMVmeXFHhw1Rhma8FOq1'] },
              { id: 'evt-cancelled', title: 'Cancelled Vball', startDate: '2026-01-05T18:00:00Z', status: 'CANCELED', ownerIds: ['uFItaBptDMVmeXFHhw1Rhma8FOq1'] }
            ]
          }
        }
      }),
      getEventGuests: async () => [
        { userId: 'u-host', name: 'Kevin Host', status: 'GOING', count: 1 },
        { userId: 'u-alice', name: 'Alice', status: 'GOING', count: 2 },
        { userId: 'u-bob', name: 'Bob', status: 'GOING', count: 1 },
        { userId: 'u-flaker', name: 'Flaker', status: 'NOT_GOING', count: 1 }
      ]
    };

    const { dbMod, runsRoute, syncRoute } = loadVballEnv(tmpDir, { __partifulMock: partifulMock });
    const { queries } = dbMod;

    // Seed evt-1 and evt-cancelled in DB
    queries.upsertRun.run({ eventId: 'evt-1', title: 'WE (V)BALL 🏐', startDate: '2026-01-10T18:00:00.000Z' });
    queries.updateRunCost.run({ eventId: 'evt-1', totalCost: 120, splitCount: 12 });
    queries.updateRunHost.run({ eventId: 'evt-1', hostUserId: 'u-host' });
    queries.upsertRun.run({ eventId: 'evt-cancelled', title: 'Cancelled Vball', startDate: '2026-01-05T18:00:00.000Z' });

    // 1. GET /api/runs filters to Kevin-owned vball events and auto-marks CANCELED events as isHosting=0
    const runsRes = await (await runsRoute.GET()).json();
    assert.deepEqual(Array.from(runsRes.upcoming, e => e.id), ['evt-owned']);
    assert.deepEqual(Array.from(runsRes.past, e => e.id), ['evt-1', 'evt-cancelled']);
    assert.equal(runsRes.past.find(e => e.id === 'evt-cancelled').isHosting, false);
    assert.equal(queries.getRunBasic.get('evt-cancelled').isHosting, 0);

    // 2. POST /api/runs/[id]/sync syncs guests, creates +1s, updates splitCount to 4, and computes $30 per head
    const syncRes = await (await syncRoute.POST({}, { params: { id: 'evt-1' } })).json();
    assert.equal(syncRes.synced, 4);
    assert.equal(queries.getRunBasic.get('evt-1').splitCount, 4);

    const eventId = 'evt-1';

    // Verify run guest rows & payment tallies
    const rows = queries.getRunWithGuests.all(eventId);
    assert.equal(rows.length, 5); // 4 named + 1 anon +1
    assert.equal(queries.getGoingCount.get(eventId).count, 4);

    const stats = queries.getPlayerStats.all();
    const aliceStats = stats.find(s => s.userId === 'u-alice');
    const hostStats = stats.find(s => s.userId === 'u-host');
    const flakerStats = stats.find(s => s.userId === 'u-flaker');
    assert.equal(aliceStats.totalRuns, 1);
    assert.equal(aliceStats.owingRuns, 1);
    assert.equal(aliceStats.balance, -30);
    assert.equal(hostStats.paidRuns, 1);
    assert.equal(hostStats.balance, 0);
    assert.equal(flakerStats.totalRuns, 0);
    assert.equal(flakerStats.balance, 0);

    // Reconcile query includes Alice's own unpaid fee AND her +1's unpaid fee
    const unpaidMain = queries.getUnpaidRunsForReconcile.all();
    const unpaidP1 = queries.getUnpaidPlusOnesForReconcile.all();
    assert.equal(unpaidMain.filter(r => r.userId === 'u-alice').length, 1);
    assert.equal(unpaidP1.filter(r => r.hostUserId === 'u-alice').length, 1);
    assert.equal(unpaidP1[0].amountOwed, 30);

    // Cancelled / non-hosted run (isHosting = 0) is excluded from financial balances and unpaid queries
    queries.updateRunHosting.run({ eventId, isHosting: 0 });
    assert.equal(queries.getPlayerBalancesExcludingRun.all('other-run').length, 0);
    assert.equal(queries.getUnpaidRunsForReconcile.all().length, 0);
    assert.equal(queries.getUnpaidPlusOnesForReconcile.all().length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Roster management: player merge and +1 removal preserve payment and attendance integrity', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vball-roster-'));
  try {
    const { dbMod } = loadVballEnv(tmpDir);
    const { queries, mergePlayerIntoTarget, removeSinglePlusOne } = dbMod;

    queries.upsertRun.run({ eventId: 'evt-1', title: 'Run 1', startDate: '2026-01-01T18:00:00Z' });
    queries.upsertRun.run({ eventId: 'evt-2', title: 'Run 2', startDate: '2026-01-08T18:00:00Z' });

    queries.upsertPlayer.run({ userId: 'manual-1', name: 'Alex Manual' });
    queries.upsertPlayer.run({ userId: 'partiful-1', name: 'Alex Partiful' });

    // manual-1 attended evt-1 and evt-2; partiful-1 also attended evt-2
    queries.upsertAttendance.run({ eventId: 'evt-1', userId: 'manual-1', rsvpStatus: 'GOING' });
    queries.upsertPayment.run({ eventId: 'evt-1', userId: 'manual-1', amount: 15, amountPaid: 15, paid: 1, method: 'cash', note: null });
    queries.upsertAttendance.run({ eventId: 'evt-2', userId: 'manual-1', rsvpStatus: 'GOING' });
    queries.upsertAttendance.run({ eventId: 'evt-2', userId: 'partiful-1', rsvpStatus: 'GOING' });

    mergePlayerIntoTarget('manual-1', 'partiful-1');

    assert.equal(queries.getPlayerBasic.get('manual-1'), undefined);
    const profile = queries.getPlayerProfile.all('partiful-1');
    assert.equal(profile.length, 2);
    assert.deepEqual(profile.map(r => r.eventId).sort(), ['evt-1', 'evt-2']);

    // Add and remove an anonymous +1
    const p1Id = 'partiful-1__plus1__evt-1__0';
    queries.upsertAnonPlusOnePlayer.run({ userId: p1Id });
    queries.upsertAttendancePlusOne.run({ eventId: 'evt-1', userId: p1Id, rsvpStatus: 'GOING', plusOneOf: 'partiful-1' });
    queries.upsertPaymentOwed.run({ eventId: 'evt-1', userId: p1Id, amount: 15 });
    assert.equal(queries.countPlusOnesForHost.get('partiful-1', 'evt-1').count, 1);

    removeSinglePlusOne('evt-1', p1Id);
    assert.equal(queries.countPlusOnesForHost.get('partiful-1', 'evt-1').count, 0);
    assert.equal(queries.getPlayerBasic.get(p1Id), undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Payment audit logging, Gmail e-Transfer receipt parsing, and atomic allocation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vball-gmail-'));
  const key = crypto.randomBytes(32).toString('base64');
  try {
    const { dbMod, gmailMod, utilsMod } = loadVballEnv(tmpDir, { GMAIL_TOKEN_ENCRYPTION_KEY: key });
    const { queries, applyGmailReceiptAllocations } = dbMod;

    // 1. Token encryption round-trip
    const encrypted = gmailMod.encryptToken('refresh-token-xyz');
    assert.equal(gmailMod.decryptToken(encrypted), 'refresh-token-xyz');

    // 2. Interac receipt parsing & anti-spoofing gate
    const validBody = Buffer.from('Hi Kevin, Alice Smith sent you $30.00 via Interac e-Transfer.').toString('base64url');
    const parsed = gmailMod.parseInteracReceipt({
      id: 'msg-101',
      internalDate: String(Date.parse('2026-02-15T12:00:00Z')),
      payload: {
        headers: [
          { name: 'From', value: 'Interac <notify@payments.interac.ca>' },
          { name: 'Subject', value: 'INTERAC e-Transfer: Alice Smith sent you money' }
        ],
        body: { data: validBody }
      }
    });
    assert.ok(parsed);
    assert.equal(parsed.senderName, 'Alice Smith');
    assert.equal(parsed.amount, 30);
    assert.equal(parsed.transferDate, '2026-02-15');

    // Reject non-interac sender
    const spoofed = gmailMod.parseInteracReceipt({
      id: 'msg-102',
      internalDate: String(Date.now()),
      payload: {
        headers: [
          { name: 'From', value: 'attacker@example.com' },
          { name: 'Subject', value: 'INTERAC e-Transfer: Alice Smith sent you $30.00' }
        ],
        body: { data: validBody }
      }
    });
    assert.equal(spoofed, null);

    // 3. Atomic receipt allocation across two unpaid runs + audit log verification
    queries.upsertPlayer.run({ userId: 'u-alice', name: 'Alice Smith' });
    queries.upsertRun.run({ eventId: 'run-a', title: 'Vball A', startDate: '2026-02-01T18:00:00Z' });
    queries.upsertRun.run({ eventId: 'run-b', title: 'Vball B', startDate: '2026-02-08T18:00:00Z' });
    queries.upsertAttendance.run({ eventId: 'run-a', userId: 'u-alice', rsvpStatus: 'GOING' });
    queries.upsertAttendance.run({ eventId: 'run-b', userId: 'u-alice', rsvpStatus: 'GOING' });
    queries.upsertPaymentOwed.run({ eventId: 'run-a', userId: 'u-alice', amount: 15 });
    queries.upsertPaymentOwed.run({ eventId: 'run-b', userId: 'u-alice', amount: 15 });

    queries.insertGmailReceipt.run(parsed);
    const receipt = queries.getGmailReceipts.all()[0];
    assert.equal(receipt.status, 'pending');
    assert.equal(receipt.unallocatedAmount, 30);

    // Partial allocation ($15 of $30)
    applyGmailReceiptAllocations(receipt.id, [{ eventId: 'run-a', userId: 'u-alice', amountOwed: 15 }]);
    const afterPartial = queries.getGmailReceipt.get(receipt.id);
    assert.equal(afterPartial.status, 'partial');
    assert.equal(afterPartial.unallocatedAmount, 15);

    // Remaining allocation ($15 of $30 -> applied)
    applyGmailReceiptAllocations(receipt.id, [{ eventId: 'run-b', userId: 'u-alice', amountOwed: 15 }]);
    const afterFull = queries.getGmailReceipt.get(receipt.id);
    assert.equal(afterFull.status, 'applied');
    assert.equal(afterFull.unallocatedAmount, 0);

    // Re-applying an already applied receipt throws and rolls back
    assert.throws(() => {
      applyGmailReceiptAllocations(receipt.id, [{ eventId: 'run-b', userId: 'u-alice', amountOwed: 15 }]);
    }, /already been applied/);

    const auditLogs = queries.getGlobalPaymentAuditLog.all();
    assert.equal(auditLogs.length, 2);
    assert.equal(auditLogs[0].action, 'marked_paid');

    // 4. Owed reminder formatting
    assert.match(utilsMod.buildOwedReminder(-30, ['- Feb 1 ($15.00)', '- Feb 8 ($15.00)']), /Hey, you owe me \$30\.00 from:/);
    assert.equal(utilsMod.buildOwedReminder(-15, []), 'Hey, you owe me $15.00. if this is incorrect lmk tyty');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
