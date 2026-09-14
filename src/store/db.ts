import { createClient } from '@libsql/client';
import type { Client, InStatement, InValue } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

-- Warehouse / storage-unit rent tracking.
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

-- Free-standing description library: past/pasted FB listings kept as style
-- references, independent of inventory items.
CREATE TABLE IF NOT EXISTS listing_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The running work timer (at most one, server-side so it survives page closes).
CREATE TABLE IF NOT EXISTS timer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL,
  note TEXT,
  lot_id INTEGER
);
`;

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
  try {
    await db.exec('ALTER TABLE line_items ADD COLUMN current_retail REAL');
  } catch {
    // column already exists
  }
  try {
    await db.exec('ALTER TABLE inventory ADD COLUMN listing_text TEXT');
  } catch {
    // column already exists
  }
  try {
    await db.exec('ALTER TABLE inventory ADD COLUMN item_condition TEXT');
  } catch {
    // column already exists
  }
  return db;
}
