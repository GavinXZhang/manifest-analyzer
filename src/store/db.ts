import { createClient } from '@libsql/client';
import type { Client, InStatement, InValue } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runDataMigrations } from './migrate.ts';

/**
 * Thin async adapter over libSQL. Works against three backends with one API:
 *   - ':memory:'                    (tests)
 *   - 'file:data/analyzer.db'       (local dev — plain SQLite file)
 *   - 'libsql://<db>.turso.io'      (hosted on Turso, with an auth token)
 *
 * Referential cleanup (cascades / set-null) is done explicitly in the store
 * modules rather than via SQLite foreign-key pragmas, so behavior is identical
 * across all three backends.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_rates (
  grade TEXT PRIMARY KEY,
  rate REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_mappings (
  seller TEXT PRIMARY KEY,
  mapping_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  seller TEXT NOT NULL,
  unmanifested INTEGER NOT NULL DEFAULT 0,
  mapping_status TEXT NOT NULL DEFAULT 'pending',
  context_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lot_files (
  lot_id INTEGER PRIMARY KEY,
  filename TEXT,
  headers_json TEXT NOT NULL,
  rows_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  identifier TEXT,
  quantity INTEGER NOT NULL,
  unit_msrp REAL,
  condition_raw TEXT NOT NULL DEFAULT '',
  condition_grade TEXT NOT NULL,
  category TEXT,
  unverifiable INTEGER NOT NULL DEFAULT 0,
  current_retail REAL
);
CREATE INDEX IF NOT EXISTS idx_line_items_lot ON line_items(lot_id);

CREATE TABLE IF NOT EXISTS comps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  sold_price REAL NOT NULL,
  note TEXT,
  entered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comps_item ON comps(item_id);

CREATE TABLE IF NOT EXISTS outcomes (
  lot_id INTEGER PRIMARY KEY,
  won INTEGER NOT NULL,
  final_price REAL,
  gross_recovered REAL,
  predicted_revenue REAL,
  predicted_max_bid REAL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segment_rate_overrides (
  seller TEXT NOT NULL,
  category TEXT NOT NULL,
  multiplier REAL NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (seller, category)
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER,
  amount REAL NOT NULL,
  note TEXT,
  sold_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sold_at);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  auto INTEGER NOT NULL DEFAULT 0,
  spent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(spent_at);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  cost REAL,
  current_retail REAL,
  status TEXT NOT NULL DEFAULT 'in-stock',
  acquired_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT,
  contact TEXT,
  note TEXT,
  inventory_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

-- Legacy tables (storage_units, work_hours, timer) are still created so the
-- one-time migration in migrate.ts can read them on older databases; nothing
-- writes to them anymore.
CREATE TABLE IF NOT EXISTS storage_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  monthly_cost REAL NOT NULL,
  due_day INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

-- Hours spent working the business (for true $/hour profitability).
CREATE TABLE IF NOT EXISTS work_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  hours REAL NOT NULL,
  note TEXT,
  lot_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_hours_date ON work_hours(date);

-- The running work timer (at most one, server-side so it survives page closes).
CREATE TABLE IF NOT EXISTS timer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL,
  note TEXT,
  lot_id INTEGER
);

-- One-time data migrations that have already run (see migrate.ts).
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Lifecycle: every stage change a lot goes through, for funnel + cycle-time reports.
CREATE TABLE IF NOT EXISTS lot_stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  at TEXT NOT NULL,
  inferred INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stage_events_lot ON lot_stage_events(lot_id);

-- Check-in tallies, one row per manifest line of a won lot.
CREATE TABLE IF NOT EXISTS receipts (
  line_item_id INTEGER PRIMARY KEY,
  lot_id INTEGER NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  works INTEGER NOT NULL DEFAULT 0,
  incomplete INTEGER NOT NULL DEFAULT 0,
  weak_battery INTEGER NOT NULL DEFAULT 0,
  dead INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_lot ON receipts(lot_id);

-- Salvage parts book: product family -> match rules + parts with value ranges.
CREATE TABLE IF NOT EXISTS parts_book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL UNIQUE,
  match_json TEXT NOT NULL,
  parts_json TEXT NOT NULL,
  estimated INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Selling channels (fee rules only — no marketplace APIs are ever called).
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  fee_percent REAL NOT NULL DEFAULT 0,
  fee_fixed REAL NOT NULL DEFAULT 0,
  shipped_fee_percent REAL,
  shipped_fee_fixed REAL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  draft_style TEXT NOT NULL DEFAULT 'casual',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

-- An inventory item listed on a channel.
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  ask REAL NOT NULL,
  url TEXT,
  shipped INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  listed_at TEXT NOT NULL,
  ended_at TEXT,
  last_cut_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_listings_inventory ON listings(inventory_id);

-- Time card: a punch is a clock-in with (eventually) a clock-out.
CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  lot_id INTEGER,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'clock'
);
CREATE INDEX IF NOT EXISTS idx_punches_start ON punches(started_at);

-- Recurring costs (storage rent etc.) that post to the ledger on their due day.
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'storage',
  due_day INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_period TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
`;

/** Columns added after a table first shipped; each ALTER is a no-op once applied. */
const COLUMN_MIGRATIONS = [
  'ALTER TABLE line_items ADD COLUMN current_retail REAL',
  'ALTER TABLE inventory ADD COLUMN listing_text TEXT',
  'ALTER TABLE inventory ADD COLUMN item_condition TEXT',
  "ALTER TABLE lots ADD COLUMN stage TEXT NOT NULL DEFAULT 'analyzing'",
  "ALTER TABLE inventory ADD COLUMN kind TEXT NOT NULL DEFAULT 'unit'",
  'ALTER TABLE inventory ADD COLUMN family TEXT',
  'ALTER TABLE inventory ADD COLUMN line_item_id INTEGER',
  'ALTER TABLE inventory ADD COLUMN received_at TEXT',
  'ALTER TABLE inventory ADD COLUMN qty_sold INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE inventory ADD COLUMN last_cut_at TEXT',
  'ALTER TABLE sales ADD COLUMN inventory_id INTEGER',
  'ALTER TABLE sales ADD COLUMN channel_id INTEGER',
  'ALTER TABLE sales ADD COLUMN fees REAL NOT NULL DEFAULT 0',
  'ALTER TABLE sales ADD COLUMN qty INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE expenses ADD COLUMN recurring_id INTEGER',
];

export class Db {
  readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async get<T>(sql: string, args: InValue[] = []): Promise<T | undefined> {
    const rs = await this.client.execute({ sql, args });
    return rs.rows[0] as unknown as T | undefined;
  }

  async all<T>(sql: string, args: InValue[] = []): Promise<T[]> {
    const rs = await this.client.execute({ sql, args });
    return rs.rows as unknown as T[];
  }

  async run(sql: string, args: InValue[] = []): Promise<{ lastInsertRowid: number; rowsAffected: number }> {
    const rs = await this.client.execute({ sql, args });
    return { lastInsertRowid: Number(rs.lastInsertRowid ?? 0), rowsAffected: rs.rowsAffected };
  }

  /** Statements run in order inside one transaction — one network round trip on Turso. */
  async batch(statements: InStatement[]): Promise<void> {
    if (statements.length > 0) await this.client.batch(statements, 'write');
  }

  async exec(sql: string): Promise<void> {
    await this.client.executeMultiple(sql);
  }

  close(): void {
    this.client.close();
  }
}

export async function openDb(url: string, authToken?: string): Promise<Db> {
  if (url.startsWith('file:')) {
    const dir = dirname(url.slice('file:'.length));
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
  }
  const db = new Db(createClient({ url, authToken }));
  await db.exec(SCHEMA);
  // Additive migrations for databases created before these columns existed.
  for (const sql of COLUMN_MIGRATIONS) {
    try {
      await db.exec(sql);
    } catch {
      // column already exists
    }
  }
  await runDataMigrations(db);
  return db;
}
