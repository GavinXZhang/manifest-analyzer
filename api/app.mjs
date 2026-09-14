// src/vercel-entry.ts
import { join as join2 } from "node:path";

// src/store/db.ts
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
var SCHEMA = `
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
var Db = class {
  client;
  constructor(client) {
    this.client = client;
  }
  async get(sql, args = []) {
    const rs = await this.client.execute({ sql, args });
    return rs.rows[0];
  }
  async all(sql, args = []) {
    const rs = await this.client.execute({ sql, args });
    return rs.rows;
  }
  async run(sql, args = []) {
    const rs = await this.client.execute({ sql, args });
    return { lastInsertRowid: Number(rs.lastInsertRowid ?? 0), rowsAffected: rs.rowsAffected };
  }
  /** Statements run in order inside one transaction — one network round trip on Turso. */
  async batch(statements) {
    if (statements.length > 0) await this.client.batch(statements, "write");
  }
  async exec(sql) {
    await this.client.executeMultiple(sql);
  }
  close() {
    this.client.close();
  }
};
async function openDb(url, authToken) {
  if (url.startsWith("file:")) {
    const dir = dirname(url.slice("file:".length));
    if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  }
  const db = new Db(createClient({ url, authToken }));
  await db.exec(SCHEMA);
  try {
    await db.exec("ALTER TABLE line_items ADD COLUMN current_retail REAL");
  } catch {
  }
  try {
    await db.exec("ALTER TABLE inventory ADD COLUMN listing_text TEXT");
  } catch {
  }
  try {
    await db.exec("ALTER TABLE inventory ADD COLUMN item_condition TEXT");
  } catch {
  }
  return db;
}

// src/ui/server.ts
import express from "express";
import { join } from "node:path";

// src/ui/api.ts
import { Router, json, raw } from "express";

// src/types.ts
var CONDITION_GRADES = [
  "new",
  "like-new",
  "customer-returns",
  "salvage",
  "unknown"
];
var CANONICAL_FIELDS = [
  "description",
  "upc",
  "asin",
  "model",
  "quantity",
  "unit_msrp",
  "condition",
  "category"
];
var REQUIRED_FIELDS = ["description", "quantity", "unit_msrp"];
function hardAmount(amount) {
  return { amount, isEstimate: false, estimateReasons: [] };
}
function estimatedAmount(amount, reason) {
  return { amount, isEstimate: true, estimateReasons: [reason] };
}
var DEFAULT_BUYERS_PREMIUM = 0.1;
function emptyListingContext() {
  return {
    currentBid: null,
    bidCount: null,
    endTime: null,
    shippingType: null,
    freightQuote: null,
    sellerZip: null,
    palletCount: null,
    weightClass: null,
    marketplace: null,
    buyersPremiumRate: DEFAULT_BUYERS_PREMIUM
  };
}
function defaultProfile() {
  return {
    homeZip: null,
    maxSpendPerLot: null,
    requiredProfit: { kind: "percent", percent: 0.3 },
    acceptableConditions: ["new", "like-new", "customer-returns", "unknown"],
    categoriesOfInterest: [],
    preferredSellers: [],
    sellingFeeRate: 0.15,
    defaultBuyersPremiumRate: DEFAULT_BUYERS_PREMIUM,
    conservativeFloorRate: 0.1,
    sellThroughProbability: 0.9,
    estimatedFederalRate: 0.12
  };
}
var DEFAULT_RECOVERY_RATES = {
  "new": 0.55,
  "like-new": 0.45,
  "customer-returns": 0.35,
  "salvage": 0.1,
  "unknown": 0.2
};

// src/store/profile.ts
async function getProfile(db) {
  const row = await db.get("SELECT json FROM profile WHERE id = 1");
  if (!row) return defaultProfile();
  return { ...defaultProfile(), ...JSON.parse(row.json) };
}
async function saveProfile(db, profile) {
  const merged = { ...defaultProfile(), ...profile };
  validateProfile(merged);
  await db.run(
    "INSERT INTO profile (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
    [JSON.stringify(merged)]
  );
  return merged;
}
async function updateProfile(db, patch) {
  return saveProfile(db, { ...await getProfile(db), ...patch });
}
function assertRate(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1, got ${value}`);
  }
}
function validateProfile(p) {
  assertRate("sellingFeeRate", p.sellingFeeRate);
  assertRate("defaultBuyersPremiumRate", p.defaultBuyersPremiumRate);
  assertRate("conservativeFloorRate", p.conservativeFloorRate);
  assertRate("sellThroughProbability", p.sellThroughProbability);
  assertRate("estimatedFederalRate", p.estimatedFederalRate);
  if (p.maxSpendPerLot !== null && (!Number.isFinite(p.maxSpendPerLot) || p.maxSpendPerLot < 0)) {
    throw new Error("maxSpendPerLot must be a non-negative number or null");
  }
  if (p.requiredProfit.kind === "absolute") {
    if (!Number.isFinite(p.requiredProfit.amount) || p.requiredProfit.amount < 0) {
      throw new Error("requiredProfit.amount must be a non-negative number");
    }
  } else {
    assertRate("requiredProfit.percent", p.requiredProfit.percent);
  }
}

// src/store/rates.ts
async function getRecoveryRates(db) {
  const rates = { ...DEFAULT_RECOVERY_RATES };
  const rows = await db.all("SELECT grade, rate FROM recovery_rates");
  for (const row of rows) {
    if (CONDITION_GRADES.includes(row.grade)) {
      rates[row.grade] = row.rate;
    }
  }
  return rates;
}
async function saveRecoveryRates(db, rates) {
  const entries = Object.entries(rates);
  for (const [grade, rate] of entries) {
    if (!CONDITION_GRADES.includes(grade)) {
      throw new Error(`Unknown condition grade: ${grade}`);
    }
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error(`Recovery rate for ${grade} must be between 0 and 1, got ${rate}`);
    }
  }
  await db.batch(
    entries.map(([grade, rate]) => ({
      sql: "INSERT INTO recovery_rates (grade, rate) VALUES (?, ?) ON CONFLICT(grade) DO UPDATE SET rate = excluded.rate",
      args: [grade, rate]
    }))
  );
  return getRecoveryRates(db);
}
async function getSegmentOverride(db, seller, category) {
  const row = await db.get(
    "SELECT seller, category, multiplier, confirmed_at FROM segment_rate_overrides WHERE seller = ? AND category = ?",
    [seller, category]
  );
  if (!row) return null;
  return {
    seller: row.seller,
    category: row.category,
    multiplier: row.multiplier,
    confirmedAt: row.confirmed_at
  };
}
async function saveSegmentOverride(db, seller, category, multiplier) {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 3) {
    throw new Error(`Segment multiplier must be in (0, 3], got ${multiplier}`);
  }
  await db.run(
    `INSERT INTO segment_rate_overrides (seller, category, multiplier, confirmed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(seller, category) DO UPDATE SET multiplier = excluded.multiplier, confirmed_at = excluded.confirmed_at`,
    [seller, category, multiplier, (/* @__PURE__ */ new Date()).toISOString()]
  );
}

// src/store/mappings.ts
async function getSellerMapping(db, seller) {
  const row = await db.get(
    "SELECT mapping_json FROM seller_mappings WHERE seller = ?",
    [seller.trim().toLowerCase()]
  );
  return row ? JSON.parse(row.mapping_json) : null;
}
async function saveSellerMapping(db, seller, mapping) {
  await db.run(
    `INSERT INTO seller_mappings (seller, mapping_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(seller) DO UPDATE SET mapping_json = excluded.mapping_json, updated_at = excluded.updated_at`,
    [seller.trim().toLowerCase(), JSON.stringify(mapping), (/* @__PURE__ */ new Date()).toISOString()]
  );
}

// src/store/lots.ts
function rowToLot(row) {
  return {
    id: row.id,
    name: row.name,
    seller: row.seller,
    unmanifested: row.unmanifested === 1,
    mappingStatus: row.mapping_status,
    context: row.context_json ? { ...emptyListingContext(), ...JSON.parse(row.context_json) } : emptyListingContext(),
    createdAt: row.created_at
  };
}
async function createLot(db, input) {
  const result = await db.run(
    "INSERT INTO lots (name, seller, unmanifested, mapping_status, created_at) VALUES (?, ?, ?, ?, ?)",
    [
      input.name,
      input.seller,
      input.unmanifested ? 1 : 0,
      input.unmanifested ? "confirmed" : "pending",
      (/* @__PURE__ */ new Date()).toISOString()
    ]
  );
  return await getLot(db, result.lastInsertRowid);
}
async function getLot(db, id) {
  const row = await db.get("SELECT * FROM lots WHERE id = ?", [id]);
  return row ? rowToLot(row) : null;
}
async function listLots(db) {
  const rows = await db.all("SELECT * FROM lots ORDER BY created_at DESC, id DESC");
  return rows.map(rowToLot);
}
async function deleteLot(db, id) {
  await db.batch([
    { sql: "DELETE FROM comps WHERE item_id IN (SELECT id FROM line_items WHERE lot_id = ?)", args: [id] },
    { sql: "DELETE FROM line_items WHERE lot_id = ?", args: [id] },
    { sql: "DELETE FROM lot_files WHERE lot_id = ?", args: [id] },
    { sql: "DELETE FROM outcomes WHERE lot_id = ?", args: [id] },
    { sql: "UPDATE sales SET lot_id = NULL WHERE lot_id = ?", args: [id] },
    { sql: "UPDATE expenses SET lot_id = NULL WHERE lot_id = ?", args: [id] },
    { sql: "UPDATE inventory SET lot_id = NULL WHERE lot_id = ?", args: [id] },
    { sql: "DELETE FROM lots WHERE id = ?", args: [id] }
  ]);
}
async function saveContext(db, lotId, context) {
  await db.run("UPDATE lots SET context_json = ? WHERE id = ?", [JSON.stringify(context), lotId]);
}
async function setMappingStatus(db, lotId, status) {
  await db.run("UPDATE lots SET mapping_status = ? WHERE id = ?", [status, lotId]);
}
async function setUnmanifested(db, lotId, value) {
  await db.run("UPDATE lots SET unmanifested = ? WHERE id = ?", [value ? 1 : 0, lotId]);
}
async function saveRawFile(db, lotId, filename, headers, rows) {
  await db.run(
    `INSERT INTO lot_files (lot_id, filename, headers_json, rows_json) VALUES (?, ?, ?, ?)
     ON CONFLICT(lot_id) DO UPDATE SET filename = excluded.filename,
       headers_json = excluded.headers_json, rows_json = excluded.rows_json`,
    [lotId, filename, JSON.stringify(headers), JSON.stringify(rows)]
  );
}
async function getRawFile(db, lotId) {
  const row = await db.get(
    "SELECT filename, headers_json, rows_json FROM lot_files WHERE lot_id = ?",
    [lotId]
  );
  if (!row) return null;
  return {
    filename: row.filename,
    headers: JSON.parse(row.headers_json),
    rows: JSON.parse(row.rows_json)
  };
}
var INSERT_ITEM_SQL = `INSERT INTO line_items
  (lot_id, description, identifier_type, identifier, quantity, unit_msrp, condition_raw, condition_grade, category, unverifiable)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
var itemArgs = (lotId, item) => [
  lotId,
  item.description,
  item.identifierType,
  item.identifier,
  item.quantity,
  item.unitMsrp,
  item.conditionRaw,
  item.conditionGrade,
  item.category,
  item.unverifiable ? 1 : 0
];
async function replaceLineItems(db, lotId, items) {
  await db.batch([
    { sql: "DELETE FROM comps WHERE item_id IN (SELECT id FROM line_items WHERE lot_id = ?)", args: [lotId] },
    { sql: "DELETE FROM line_items WHERE lot_id = ?", args: [lotId] },
    ...items.map((item) => ({ sql: INSERT_ITEM_SQL, args: itemArgs(lotId, item) }))
  ]);
  return getLineItems(db, lotId);
}
async function addLineItem(db, lotId, item) {
  const result = await db.run(INSERT_ITEM_SQL, itemArgs(lotId, item));
  return await getLineItem(db, result.lastInsertRowid);
}
function rowToItem(r) {
  return {
    id: r.id,
    lotId: r.lot_id,
    description: r.description,
    identifierType: r.identifier_type,
    identifier: r.identifier,
    quantity: r.quantity,
    unitMsrp: r.unit_msrp,
    conditionRaw: r.condition_raw,
    conditionGrade: r.condition_grade,
    category: r.category,
    unverifiable: r.unverifiable === 1,
    currentRetail: r.current_retail
  };
}
async function getLineItems(db, lotId) {
  const rows = await db.all("SELECT * FROM line_items WHERE lot_id = ? ORDER BY id", [lotId]);
  return rows.map(rowToItem);
}
async function getLineItem(db, itemId) {
  const r = await db.get("SELECT * FROM line_items WHERE id = ?", [itemId]);
  return r ? rowToItem(r) : null;
}
async function setCurrentRetail(db, itemId, value) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`currentRetail must be a non-negative number or null, got ${value}`);
  }
  await db.run("UPDATE line_items SET current_retail = ? WHERE id = ?", [value, itemId]);
}
async function setComps(db, itemId, soldPrices) {
  for (const { price } of soldPrices) {
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Comp price must be a non-negative number, got ${price}`);
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await db.batch([
    { sql: "DELETE FROM comps WHERE item_id = ?", args: [itemId] },
    ...soldPrices.map(({ price, note }) => ({
      sql: "INSERT INTO comps (item_id, sold_price, note, entered_at) VALUES (?, ?, ?, ?)",
      args: [itemId, price, note ?? null, now]
    }))
  ]);
  return getComps(db, itemId);
}
var rowToComp = (r) => ({
  id: r.id,
  itemId: r.item_id,
  soldPrice: r.sold_price,
  note: r.note,
  enteredAt: r.entered_at
});
async function getComps(db, itemId) {
  const rows = await db.all("SELECT * FROM comps WHERE item_id = ? ORDER BY id", [itemId]);
  return rows.map(rowToComp);
}
async function getCompsForLot(db, lotId) {
  const rows = await db.all(
    "SELECT c.* FROM comps c JOIN line_items li ON li.id = c.item_id WHERE li.lot_id = ? ORDER BY c.id",
    [lotId]
  );
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    list.push(rowToComp(r));
    map.set(r.item_id, list);
  }
  return map;
}

// src/store/outcomes.ts
function rowToOutcome(r) {
  return {
    lotId: r.lot_id,
    won: r.won === 1,
    finalPrice: r.final_price,
    grossRecovered: r.gross_recovered,
    predictedRevenue: r.predicted_revenue,
    predictedMaxBid: r.predicted_max_bid,
    recordedAt: r.recorded_at
  };
}
async function recordOutcome(db, outcome) {
  await db.run(
    `INSERT INTO outcomes (lot_id, won, final_price, gross_recovered, predicted_revenue, predicted_max_bid, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lot_id) DO UPDATE SET won = excluded.won, final_price = excluded.final_price,
       gross_recovered = excluded.gross_recovered,
       predicted_revenue = COALESCE(excluded.predicted_revenue, outcomes.predicted_revenue),
       predicted_max_bid = COALESCE(excluded.predicted_max_bid, outcomes.predicted_max_bid),
       recorded_at = excluded.recorded_at`,
    [
      outcome.lotId,
      outcome.won ? 1 : 0,
      outcome.finalPrice,
      outcome.grossRecovered,
      outcome.predictedRevenue,
      outcome.predictedMaxBid,
      (/* @__PURE__ */ new Date()).toISOString()
    ]
  );
  return await getOutcome(db, outcome.lotId);
}
async function getOutcome(db, lotId) {
  const row = await db.get("SELECT * FROM outcomes WHERE lot_id = ?", [lotId]);
  return row ? rowToOutcome(row) : null;
}
async function listSegmentOutcomes(db) {
  const rows = await db.all(
    `SELECT o.*, l.seller, l.name AS lot_name,
       COALESCE((
         SELECT li.category FROM line_items li WHERE li.lot_id = l.id AND li.category IS NOT NULL
         GROUP BY li.category ORDER BY SUM(li.quantity * COALESCE(li.unit_msrp, 0)) DESC LIMIT 1
       ), 'uncategorized') AS category,
       COALESCE((SELECT SUM(li.quantity * COALESCE(li.unit_msrp, 0)) FROM line_items li WHERE li.lot_id = l.id), 0) AS extended_retail
     FROM outcomes o JOIN lots l ON l.id = o.lot_id
     ORDER BY o.recorded_at DESC`
  );
  return rows.map((r) => ({
    ...rowToOutcome(r),
    seller: r.seller,
    category: r.category,
    extendedRetail: r.extended_retail,
    lotName: r.lot_name
  }));
}

// src/store/ledger.ts
var EXPENSE_CATEGORIES = [
  "lot-purchase",
  "freight",
  "selling-fees",
  "supplies",
  "storage",
  "mileage",
  "other"
];
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertEntry(amount, date) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`amount must be positive, got ${amount}`);
  if (!DATE_RE.test(date)) throw new Error(`date must be YYYY-MM-DD, got "${date}"`);
}
var rowToSale = (r) => ({ id: r.id, lotId: r.lot_id, amount: r.amount, note: r.note, soldAt: r.sold_at });
async function addSale(db, input) {
  assertEntry(input.amount, input.soldAt);
  const r = await db.run("INSERT INTO sales (lot_id, amount, note, sold_at) VALUES (?, ?, ?, ?)", [
    input.lotId ?? null,
    input.amount,
    input.note ?? null,
    input.soldAt
  ]);
  const row = await db.get("SELECT * FROM sales WHERE id = ?", [r.lastInsertRowid]);
  return rowToSale(row);
}
async function deleteSale(db, id) {
  await db.run("DELETE FROM sales WHERE id = ?", [id]);
}
async function listSales(db) {
  const rows = await db.all("SELECT * FROM sales ORDER BY sold_at, id");
  return rows.map(rowToSale);
}
var rowToExpense = (r) => ({
  id: r.id,
  lotId: r.lot_id,
  amount: r.amount,
  category: r.category,
  note: r.note,
  auto: r.auto === 1,
  spentAt: r.spent_at
});
async function addExpense(db, input) {
  assertEntry(input.amount, input.spentAt);
  if (!EXPENSE_CATEGORIES.includes(input.category)) {
    throw new Error(`Unknown expense category "${input.category}"`);
  }
  const r = await db.run(
    "INSERT INTO expenses (lot_id, amount, category, note, auto, spent_at) VALUES (?, ?, ?, ?, ?, ?)",
    [input.lotId ?? null, input.amount, input.category, input.note ?? null, input.auto ? 1 : 0, input.spentAt]
  );
  const row = await db.get("SELECT * FROM expenses WHERE id = ?", [r.lastInsertRowid]);
  return rowToExpense(row);
}
async function deleteExpense(db, id) {
  await db.run("DELETE FROM expenses WHERE id = ?", [id]);
}
async function deleteAutoExpenses(db, lotId) {
  await db.run("DELETE FROM expenses WHERE lot_id = ? AND auto = 1", [lotId]);
}
async function listExpenses(db) {
  const rows = await db.all("SELECT * FROM expenses ORDER BY spent_at, id");
  return rows.map(rowToExpense);
}
async function ledgerSummary(db) {
  const rev = (await db.get("SELECT COALESCE(SUM(amount), 0) AS s FROM sales")).s;
  const exp = (await db.get("SELECT COALESCE(SUM(amount), 0) AS s FROM expenses")).s;
  const round25 = (n) => Math.round(n * 100) / 100;
  return { totalRevenue: round25(rev), totalExpenses: round25(exp), netProfit: round25(rev - exp) };
}
async function lotPerformance(db, limit = 10) {
  const rows = await db.all(
    `SELECT l.id, l.name, l.seller, o.final_price, o.gross_recovered, o.recorded_at,
       COALESCE((SELECT SUM(s.amount) FROM sales s WHERE s.lot_id = l.id), 0) AS sales_sum,
       COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.lot_id = l.id), 0) AS expense_sum
     FROM outcomes o JOIN lots l ON l.id = o.lot_id
     WHERE o.won = 1
     ORDER BY o.recorded_at DESC
     LIMIT ?`,
    [limit]
  );
  const round25 = (n) => Math.round(n * 100) / 100;
  return rows.map((r) => {
    const revenue = r.sales_sum > 0 ? r.sales_sum : r.gross_recovered ?? 0;
    const profit = round25(revenue - r.expense_sum);
    return {
      lotId: r.id,
      name: r.name,
      seller: r.seller,
      wonAt: r.recorded_at,
      finalPrice: r.final_price,
      revenue: round25(revenue),
      revenueSource: r.sales_sum > 0 ? "sales-ledger" : r.gross_recovered !== null ? "outcome-gross" : "none",
      cost: round25(r.expense_sum),
      profit,
      roi: r.expense_sum > 0 ? Math.round(profit / r.expense_sum * 1e3) / 1e3 : null
    };
  });
}

// src/store/inventory.ts
var INVENTORY_STATUSES = ["in-stock", "listed", "sold"];
var ITEM_CONDITIONS = ["like-new", "good", "fair", "poor"];
var toItem = (r) => ({
  id: r.id,
  lotId: r.lot_id,
  name: r.name,
  description: r.description,
  qty: r.qty,
  cost: r.cost,
  currentRetail: r.current_retail,
  status: r.status,
  acquiredAt: r.acquired_at,
  listingText: r.listing_text,
  condition: r.item_condition,
  createdAt: r.created_at
});
function validate(input) {
  if (input.name !== void 0 && input.name.trim() === "") throw new Error("name is required");
  for (const key of ["cost", "currentRetail"]) {
    const v = input[key];
    if (v !== void 0 && v !== null && (!Number.isFinite(v) || v < 0)) {
      throw new Error(`${key} must be a non-negative number or null`);
    }
  }
  if (input.qty !== void 0 && (!Number.isInteger(input.qty) || input.qty < 1)) {
    throw new Error("qty must be a positive integer");
  }
  if (input.status !== void 0 && !INVENTORY_STATUSES.includes(input.status)) {
    throw new Error(`status must be one of ${INVENTORY_STATUSES.join(", ")}`);
  }
  if (input.condition !== void 0 && input.condition !== null && !ITEM_CONDITIONS.includes(input.condition)) {
    throw new Error(`condition must be one of ${ITEM_CONDITIONS.join(", ")} or null`);
  }
}
async function addInventoryItem(db, input) {
  validate(input);
  const r = await db.run(
    `INSERT INTO inventory (lot_id, name, description, qty, cost, current_retail, status, acquired_at, listing_text, item_condition, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.lotId ?? null,
      input.name.trim(),
      input.description ?? null,
      input.qty ?? 1,
      input.cost ?? null,
      input.currentRetail ?? null,
      input.status ?? "in-stock",
      input.acquiredAt ?? null,
      input.listingText ?? null,
      input.condition ?? null,
      (/* @__PURE__ */ new Date()).toISOString()
    ]
  );
  return await getInventoryItem(db, r.lastInsertRowid);
}
async function updateInventoryItem(db, id, patch) {
  const existing = await getInventoryItem(db, id);
  if (!existing) throw new Error(`No inventory item ${id}`);
  const merged = { ...existing, ...patch };
  validate(merged);
  await db.run(
    `UPDATE inventory SET lot_id = ?, name = ?, description = ?, qty = ?, cost = ?,
       current_retail = ?, status = ?, acquired_at = ?, listing_text = ?, item_condition = ? WHERE id = ?`,
    [
      merged.lotId,
      merged.name.trim(),
      merged.description,
      merged.qty,
      merged.cost,
      merged.currentRetail,
      merged.status,
      merged.acquiredAt,
      merged.listingText,
      merged.condition,
      id
    ]
  );
  return await getInventoryItem(db, id);
}
async function deleteInventoryItem(db, id) {
  await db.batch([
    { sql: "UPDATE events SET inventory_id = NULL WHERE inventory_id = ?", args: [id] },
    { sql: "DELETE FROM inventory WHERE id = ?", args: [id] }
  ]);
}
async function getInventoryItem(db, id) {
  const r = await db.get("SELECT * FROM inventory WHERE id = ?", [id]);
  return r ? toItem(r) : null;
}
async function listInventory(db) {
  const rows = await db.all(
    `SELECT * FROM inventory ORDER BY CASE status WHEN 'sold' THEN 1 ELSE 0 END, created_at DESC, id DESC`
  );
  return rows.map(toItem);
}

// src/store/events.ts
var EVENT_KINDS = ["delivery", "viewing", "pickup", "other"];
var toEvent = (r) => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  date: r.date,
  time: r.time,
  contact: r.contact,
  note: r.note,
  inventoryId: r.inventory_id,
  createdAt: r.created_at
});
var DATE_RE2 = /^\d{4}-\d{2}-\d{2}$/;
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
async function addEvent(db, input) {
  if (!input.title.trim()) throw new Error("title is required");
  if (!EVENT_KINDS.includes(input.kind)) throw new Error(`kind must be one of ${EVENT_KINDS.join(", ")}`);
  if (!DATE_RE2.test(input.date)) throw new Error(`date must be YYYY-MM-DD, got "${input.date}"`);
  if (input.time != null && input.time !== "" && !TIME_RE.test(input.time)) {
    throw new Error(`time must be HH:MM, got "${input.time}"`);
  }
  const r = await db.run(
    `INSERT INTO events (title, kind, date, time, contact, note, inventory_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title.trim(),
      input.kind,
      input.date,
      input.time || null,
      input.contact ?? null,
      input.note ?? null,
      input.inventoryId ?? null,
      (/* @__PURE__ */ new Date()).toISOString()
    ]
  );
  const row = await db.get("SELECT * FROM events WHERE id = ?", [r.lastInsertRowid]);
  return toEvent(row);
}
async function deleteEvent(db, id) {
  await db.run("DELETE FROM events WHERE id = ?", [id]);
}
async function listEvents(db, from, to) {
  const rows = from !== void 0 && to !== void 0 ? await db.all("SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date, time, id", [from, to]) : await db.all("SELECT * FROM events ORDER BY date, time, id");
  return rows.map(toEvent);
}

// src/store/workspace.ts
var toUnit = (r) => ({
  id: r.id,
  name: r.name,
  monthlyCost: r.monthly_cost,
  dueDay: r.due_day,
  note: r.note,
  createdAt: r.created_at
});
async function addStorageUnit(db, input) {
  if (!input.name.trim()) throw new Error("name is required");
  if (!Number.isFinite(input.monthlyCost) || input.monthlyCost < 0) {
    throw new Error("monthlyCost must be a non-negative number");
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28) {
    throw new Error("dueDay must be 1\u201328 (so every month has one)");
  }
  const r = await db.run(
    "INSERT INTO storage_units (name, monthly_cost, due_day, note, created_at) VALUES (?, ?, ?, ?, ?)",
    [input.name.trim(), input.monthlyCost, input.dueDay, input.note ?? null, (/* @__PURE__ */ new Date()).toISOString()]
  );
  const row = await db.get("SELECT * FROM storage_units WHERE id = ?", [r.lastInsertRowid]);
  return toUnit(row);
}
async function deleteStorageUnit(db, id) {
  await db.run("DELETE FROM storage_units WHERE id = ?", [id]);
}
async function listStorageUnits(db) {
  const rows = await db.all("SELECT * FROM storage_units ORDER BY id");
  return rows.map(toUnit);
}
async function getStorageUnit(db, id) {
  const row = await db.get("SELECT * FROM storage_units WHERE id = ?", [id]);
  return row ? toUnit(row) : null;
}
var toEntry = (r) => ({
  id: r.id,
  date: r.date,
  hours: r.hours,
  note: r.note,
  lotId: r.lot_id,
  createdAt: r.created_at
});
var DATE_RE3 = /^\d{4}-\d{2}-\d{2}$/;
async function addWorkEntry(db, input) {
  if (!DATE_RE3.test(input.date)) throw new Error(`date must be YYYY-MM-DD, got "${input.date}"`);
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 24) {
    throw new Error("hours must be between 0 and 24");
  }
  const r = await db.run(
    "INSERT INTO work_hours (date, hours, note, lot_id, created_at) VALUES (?, ?, ?, ?, ?)",
    [input.date, input.hours, input.note ?? null, input.lotId ?? null, (/* @__PURE__ */ new Date()).toISOString()]
  );
  const row = await db.get("SELECT * FROM work_hours WHERE id = ?", [r.lastInsertRowid]);
  return toEntry(row);
}
async function deleteWorkEntry(db, id) {
  await db.run("DELETE FROM work_hours WHERE id = ?", [id]);
}
async function listWorkEntries(db) {
  const rows = await db.all("SELECT * FROM work_hours ORDER BY date DESC, id DESC");
  return rows.map(toEntry);
}
async function totalHours(db) {
  const row = await db.get("SELECT COALESCE(SUM(hours), 0) AS s FROM work_hours");
  return Math.round(row.s * 100) / 100;
}
async function getTimer(db) {
  const row = await db.get(
    "SELECT started_at, note, lot_id FROM timer WHERE id = 1"
  );
  return row ? { startedAt: row.started_at, note: row.note, lotId: row.lot_id } : null;
}
async function startTimer(db, input = {}) {
  if (await getTimer(db)) throw new Error("A timer is already running \u2014 stop it first");
  await db.run("INSERT INTO timer (id, started_at, note, lot_id) VALUES (1, ?, ?, ?)", [
    (/* @__PURE__ */ new Date()).toISOString(),
    input.note ?? null,
    input.lotId ?? null
  ]);
  return await getTimer(db);
}
async function clearTimer(db) {
  await db.run("DELETE FROM timer WHERE id = 1");
}

// src/ui/api.ts
import Anthropic from "@anthropic-ai/sdk";

// src/store/library.ts
var toEntry2 = (r) => ({
  id: r.id,
  title: r.title,
  text: r.text,
  createdAt: r.created_at
});
async function addLibraryEntry(db, title, text) {
  if (!title.trim()) throw new Error("title is required");
  if (!text.trim()) throw new Error("text is required");
  const r = await db.run("INSERT INTO listing_library (title, text, created_at) VALUES (?, ?, ?)", [
    title.trim(),
    text,
    (/* @__PURE__ */ new Date()).toISOString()
  ]);
  const row = await db.get("SELECT * FROM listing_library WHERE id = ?", [r.lastInsertRowid]);
  return toEntry2(row);
}
async function deleteLibraryEntry(db, id) {
  await db.run("DELETE FROM listing_library WHERE id = ?", [id]);
}
async function listLibraryEntries(db) {
  const rows = await db.all("SELECT * FROM listing_library ORDER BY created_at DESC, id DESC");
  return rows.map(toEntry2);
}

// src/ui/ics.ts
function escapeText(s) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function basicDate(iso) {
  return iso.replace(/-/g, "");
}
function nextDay(iso) {
  const d = /* @__PURE__ */ new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function buildIcs(events, now = /* @__PURE__ */ new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Manifest Analyzer//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Manifest Analyzer"
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:evt-${e.id}@manifest-analyzer.local`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SUMMARY:${escapeText(`[${e.kind}] ${e.title}`)}`);
    if (e.time) {
      const start = `${basicDate(e.date)}T${e.time.replace(":", "")}00`;
      const [h, m] = e.time.split(":").map(Number);
      const endDate = new Date(Date.UTC(2e3, 0, 1, h, m));
      endDate.setUTCHours(endDate.getUTCHours() + 1);
      const endDay = endDate.getUTCDate() > 1 ? nextDay(e.date) : e.date;
      const end = `${basicDate(endDay)}T${String(endDate.getUTCHours()).padStart(2, "0")}${String(endDate.getUTCMinutes()).padStart(2, "0")}00`;
      lines.push(`DTSTART:${start}`);
      lines.push(`DTEND:${end}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${basicDate(e.date)}`);
      lines.push(`DTEND;VALUE=DATE:${basicDate(nextDay(e.date))}`);
    }
    const details = [e.contact, e.note].filter(Boolean).join(" \u2014 ");
    if (details) lines.push(`DESCRIPTION:${escapeText(details)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// src/ingest/csv.ts
function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r|\n|$/));
  let best = ",";
  let bestCount = -1;
  for (const d of [",", "	", ";"]) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}
function parseCsv(text) {
  if (text.charCodeAt(0) === 65279) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === delim) {
      endField();
      i += 1;
    } else if (ch === "\n") {
      endRow();
      i += 1;
    } else if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

// src/ingest/xlsx.ts
import ExcelJS from "exceljs";
var MAX_ROWS = 2e4;
var MAX_COLS = 100;
function cellToString(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((rt) => rt.text).join("");
    if ("text" in value) return typeof value.text === "string" ? value.text : cellToString(value.text);
    if ("result" in value && value.result !== void 0) return cellToString(value.result);
    if ("error" in value) return "";
  }
  return String(value);
}
async function parseXlsx(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  if (!ws) return [];
  const rows = [];
  const rowCount = Math.min(ws.rowCount, MAX_ROWS);
  const colCount = Math.min(Math.max(ws.columnCount, 1), MAX_COLS);
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(cellToString(row.getCell(c).value).trim());
    }
    if (cells.some((c) => c !== "")) rows.push(cells);
  }
  return rows;
}

// src/ingest/mapping.ts
var FIELD_ALIASES = {
  description: [
    "item description",
    "description",
    "product description",
    "product name",
    "item name",
    "item",
    "product",
    "title",
    "desc"
  ],
  upc: ["upc", "upc code", "upc ean", "ean", "barcode", "gtin", "upc a"],
  asin: ["asin", "amazon asin"],
  model: ["model", "model number", "model no", "mpn", "part number", "part no", "sku", "item no", "style"],
  quantity: ["qty", "quantity", "units", "unit count", "count", "pieces", "pcs", "total units"],
  unit_msrp: [
    "unit retail",
    "unit msrp",
    "msrp",
    "retail",
    "retail price",
    "orig retail",
    "original retail",
    "unit price",
    "price",
    "ext retail unit"
  ],
  condition: ["condition", "item condition", "cond", "grade", "condition grade"],
  category: ["category", "department", "dept", "cat", "product category", "subcategory", "product group", "product type"]
};
function normalizeHeader(h) {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokenOverlap(a, b) {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}
function scoreHeaderAgainstField(header, field) {
  const h = normalizeHeader(header);
  if (h === "") return 0;
  let best = 0;
  for (const alias of FIELD_ALIASES[field]) {
    if (h === alias) return 1;
    if (h.length >= 3 && alias.length >= 3 && (h.includes(alias) || alias.includes(h))) {
      best = Math.max(best, 0.8);
    }
    const overlap = tokenOverlap(h, alias);
    if (overlap >= 0.5) best = Math.max(best, 0.5 + 0.2 * overlap);
  }
  return best;
}
function headerLikeScore(cells) {
  let score = 0;
  for (const cell of cells) {
    let cellBest = 0;
    for (const field of CANONICAL_FIELDS) {
      cellBest = Math.max(cellBest, scoreHeaderAgainstField(cell, field));
    }
    score += cellBest;
    if (cell.trim() !== "" && Number.isNaN(Number(cell.replace(/[$,]/g, "")))) score += 0.1;
  }
  return score;
}
var CONFIDENCE_THRESHOLD = 0.9;
function proposeMapping(headers) {
  const candidates = [];
  for (const field of CANONICAL_FIELDS) {
    for (const header of headers) {
      const score = scoreHeaderAgainstField(header, field);
      if (score > 0) candidates.push({ field, header, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const mapping = {};
  const fieldConfidence = {};
  const usedHeaders = /* @__PURE__ */ new Set();
  for (const { field, header, score } of candidates) {
    if (mapping[field] !== void 0 || usedHeaders.has(header)) continue;
    mapping[field] = header;
    fieldConfidence[field] = score;
    usedHeaders.add(header);
  }
  const confidence2 = Math.min(...REQUIRED_FIELDS.map((f) => fieldConfidence[f] ?? 0));
  return {
    mapping,
    fieldConfidence,
    confidence: confidence2,
    needsConfirmation: confidence2 < CONFIDENCE_THRESHOLD,
    source: "auto"
  };
}
function applySavedMapping(headers, saved) {
  const normalized = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const mapping = {};
  const fieldConfidence = {};
  for (const [field, savedHeader] of Object.entries(saved)) {
    const match = normalized.get(normalizeHeader(savedHeader));
    if (match === void 0) return null;
    mapping[field] = match;
    fieldConfidence[field] = 1;
  }
  for (const f of REQUIRED_FIELDS) {
    if (mapping[f] === void 0) return null;
  }
  return { mapping, fieldConfidence, confidence: 1, needsConfirmation: false, source: "saved-seller-mapping" };
}

// src/ingest/headers.ts
var SCAN_ROWS = 15;
function detectTable(grid) {
  if (grid.length === 0) return { headers: [], rows: [], headerRowIndex: -1 };
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < Math.min(grid.length, SCAN_ROWS); i++) {
    const score = headerLikeScore(grid[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  const headerRow = grid[bestIndex];
  let lastNonEmpty = headerRow.length - 1;
  while (lastNonEmpty >= 0 && headerRow[lastNonEmpty].trim() === "") lastNonEmpty--;
  const headers = headerRow.slice(0, lastNonEmpty + 1).map((h) => h.trim());
  const headerKey = headers.join("\0").toLowerCase();
  const rows = grid.slice(bestIndex + 1).filter((r) => r.some((c) => c.trim() !== "")).filter((r) => r.slice(0, headers.length).join("\0").toLowerCase() !== headerKey).map((r) => {
    const out = r.slice(0, headers.length);
    while (out.length < headers.length) out.push("");
    return out;
  });
  return { headers, rows, headerRowIndex: bestIndex };
}

// src/ingest/ingest.ts
var ZIP_MAGIC = Buffer.from("PK", "latin1");
var OLE_MAGIC = Buffer.from([208, 207, 17, 224]);
async function parseManifest(filename, buf) {
  const isZip = buf.subarray(0, 4).equals(ZIP_MAGIC);
  if (buf.subarray(0, 4).equals(OLE_MAGIC)) {
    throw new Error("Legacy .xls format is not supported \u2014 re-save the manifest as .xlsx or .csv");
  }
  if (isZip || /\.xlsx$/i.test(filename)) {
    return detectTable(await parseXlsx(buf));
  }
  return detectTable(parseCsv(buf.toString("utf8")));
}

// src/ingest/normalize.ts
function parseMoney(raw2) {
  const cleaned = raw2.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function parseQuantity(raw2) {
  const cleaned = raw2.replace(/[,\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(n);
}
function normalizeCondition(raw2) {
  const c = raw2.toLowerCase();
  if (c === "") return "unknown";
  if (/salvage|as[\s-]?is|for parts|damag|scratch|dent/.test(c)) return "salvage";
  if (/like[\s-]?new|open[\s-]?box|refurb|renewed|shelf[\s-]?pull/.test(c)) return "like-new";
  if (/return|used|acceptable|good|fair|pre[\s-]?owned/.test(c)) return "customer-returns";
  if (/new|overstock|sealed/.test(c)) return "new";
  return "unknown";
}
var ASIN_RE = /^B0[A-Z0-9]{8}$/i;
function isValidGtin(digits) {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = 4 - w) {
    sum += Number(digits[i]) * w;
  }
  return (10 - sum % 10) % 10 === Number(digits[digits.length - 1]);
}
function pickIdentifier(values) {
  let upc = (values.upc ?? "").replace(/[\s-]/g, "");
  if (upc.length === 11 && isValidGtin(`0${upc}`)) upc = `0${upc}`;
  if (isValidGtin(upc)) return { type: "UPC", value: upc };
  const asin = (values.asin ?? "").trim();
  if (ASIN_RE.test(asin) || /^[A-Z0-9]{10}$/i.test(asin)) return { type: "ASIN", value: asin.toUpperCase() };
  const model = (values.model ?? "").trim();
  if (model !== "") return { type: "model", value: model };
  if (upc !== "") return { type: "model", value: upc };
  if (asin !== "") return { type: "model", value: asin };
  return { type: "none", value: null };
}
var TOTAL_ROW_RE = /^(grand\s+)?(sub)?total\b/i;
function normalizeRows(headers, rows, mapping) {
  const colIndex = /* @__PURE__ */ new Map();
  for (const [field, header] of Object.entries(mapping)) {
    const idx = headers.indexOf(header);
    if (idx >= 0) colIndex.set(field, idx);
  }
  const cell = (row, field) => {
    const idx = colIndex.get(field);
    return idx === void 0 ? "" : (row[idx] ?? "").trim();
  };
  const items = [];
  for (const row of rows) {
    const description = cell(row, "description");
    const unitMsrp = parseMoney(cell(row, "unit_msrp"));
    const id = pickIdentifier({
      upc: cell(row, "upc"),
      asin: cell(row, "asin"),
      model: cell(row, "model")
    });
    if (description === "" && id.type === "none" && unitMsrp === null) continue;
    if (TOTAL_ROW_RE.test(description) && id.type === "none") continue;
    const conditionRaw = cell(row, "condition");
    items.push({
      description: description !== "" ? description : "(no description)",
      identifierType: id.type,
      identifier: id.value,
      quantity: parseQuantity(cell(row, "quantity")),
      unitMsrp,
      conditionRaw,
      conditionGrade: normalizeCondition(conditionRaw),
      category: cell(row, "category") !== "" ? cell(row, "category") : null,
      unverifiable: id.type === "none"
    });
  }
  return items;
}

// src/valuation/comps.ts
function median(values) {
  if (values.length === 0) throw new Error("median of empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function topValueItems(items, n) {
  return [...items].sort(
    (a, b) => b.quantity * (b.unitMsrp ?? 0) - a.quantity * (a.unitMsrp ?? 0)
  ).slice(0, n);
}

// src/valuation/calibration.ts
var CALIBRATION_MIN_OUTCOMES = 3;
var CLOSING_RANGE_MIN_OUTCOMES = 5;
var segmentKey = (seller, category) => `${seller.trim().toLowerCase()}\0${category.trim().toLowerCase()}`;
function suggestCalibrations(outcomes, currentMultiplier) {
  const groups = /* @__PURE__ */ new Map();
  for (const o of outcomes) {
    if (!o.won || o.grossRecovered === null || o.predictedRevenue === null || o.predictedRevenue <= 0) {
      continue;
    }
    const key = segmentKey(o.seller, o.category);
    groups.set(key, [...groups.get(key) ?? [], o]);
  }
  const suggestions = [];
  for (const group of groups.values()) {
    if (group.length < CALIBRATION_MIN_OUTCOMES) continue;
    const ratios = group.map((o) => o.grossRecovered / o.predictedRevenue);
    const medianRatio = median(ratios);
    const current = currentMultiplier(group[0].seller, group[0].category);
    const suggested = Math.min(3, Math.max(0.01, current * medianRatio));
    if (Math.abs(suggested - current) / current < 0.05) continue;
    suggestions.push({
      seller: group[0].seller,
      category: group[0].category,
      sampleSize: group.length,
      medianRatio: Math.round(medianRatio * 100) / 100,
      currentMultiplier: current,
      suggestedMultiplier: Math.round(suggested * 100) / 100
    });
  }
  return suggestions;
}
function percentile(sortedAsc, p) {
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}
function predictClosingRange(outcomes, seller, category) {
  const key = segmentKey(seller, category);
  const pcts = outcomes.filter(
    (o) => segmentKey(o.seller, o.category) === key && o.finalPrice !== null && o.extendedRetail > 0
  ).map((o) => o.finalPrice / o.extendedRetail);
  if (pcts.length < CLOSING_RANGE_MIN_OUTCOMES) return null;
  const sorted = [...pcts].sort((a, b) => a - b);
  return {
    lowPctOfRetail: Math.round(percentile(sorted, 0.25) * 1e3) / 1e3,
    highPctOfRetail: Math.round(percentile(sorted, 0.75) * 1e3) / 1e3,
    sampleSize: sorted.length
  };
}

// src/calc/pricing.ts
function round2(n) {
  return Math.round(n * 100) / 100;
}
function floorPrice(cost, feeRate) {
  if (!Number.isFinite(cost) || cost < 0 || feeRate < 0 || feeRate >= 1) return null;
  return round2(cost / (1 - feeRate));
}
function targetPrice(cost, feeRate, marginRate) {
  if (!Number.isFinite(cost) || cost < 0 || marginRate < 0) return null;
  const denom = 1 - feeRate - marginRate;
  if (denom <= 0) return null;
  return round2(cost / denom);
}

// src/calc/tax.ts
var SE_TAX_RATE = 0.153;
var SE_EARNINGS_FACTOR = 0.9235;
var SE_MINIMUM = 400;
var MA_INCOME_RATE = 0.05;
var MA_SALES_TAX_RATE = 0.0625;
function round22(n) {
  return Math.round(n * 100) / 100;
}
function estimateSetAside(netProfit, federalRate) {
  const profit = Number.isFinite(netProfit) ? Math.max(0, netProfit) : 0;
  const seBase = profit * SE_EARNINGS_FACTOR;
  const seTax = seBase >= SE_MINIMUM ? seBase * SE_TAX_RATE : 0;
  const seDeduction = seTax / 2;
  const taxableIncome = Math.max(0, profit - seDeduction);
  const federalIncomeEst = taxableIncome * federalRate;
  const maIncomeEst = taxableIncome * MA_INCOME_RATE;
  const total = seTax + federalIncomeEst + maIncomeEst;
  return {
    netProfit: round22(profit),
    seTax: round22(seTax),
    seDeduction: round22(seDeduction),
    taxableIncome: round22(taxableIncome),
    federalIncomeEst: round22(federalIncomeEst),
    maIncomeEst: round22(maIncomeEst),
    totalSetAside: round22(total),
    setAsideRate: profit > 0 ? Math.round(total / profit * 1e3) / 1e3 : 0
  };
}
function maSalesTax(directSales) {
  if (!Number.isFinite(directSales) || directSales <= 0) return 0;
  return round22(directSales * MA_SALES_TAX_RATE);
}

// src/ingest/freight.ts
var PER_PALLET_BY_ZONE = [80, 105, 130, 155, 180, 210, 240, 270, 300, 330];
var WEIGHT_MULTIPLIER = {
  light: 0.85,
  standard: 1,
  heavy: 1.3
};
var ADDITIONAL_PALLET_FACTOR = 0.85;
var FREIGHT_ESTIMATE_REASON = "freight-estimate";
var ZIP_RE = /^\d{5}(-\d{4})?$/;
function estimateFreight(input) {
  if (!ZIP_RE.test(input.originZip)) throw new Error(`Invalid origin zip: ${input.originZip}`);
  if (!ZIP_RE.test(input.destZip)) throw new Error(`Invalid destination zip: ${input.destZip}`);
  if (!Number.isFinite(input.palletCount) || input.palletCount < 1) {
    throw new Error(`palletCount must be >= 1, got ${input.palletCount}`);
  }
  const zone = Math.min(
    Math.abs(Number(input.originZip[0]) - Number(input.destZip[0])),
    PER_PALLET_BY_ZONE.length - 1
  );
  const perPallet = PER_PALLET_BY_ZONE[zone] * WEIGHT_MULTIPLIER[input.weightClass];
  const pallets = Math.round(input.palletCount);
  const raw2 = perPallet + perPallet * ADDITIONAL_PALLET_FACTOR * (pallets - 1);
  const rounded = Math.round(raw2 / 5) * 5;
  return estimatedAmount(rounded, FREIGHT_ESTIMATE_REASON);
}
function resolveFreight(context, homeZip) {
  if (context.shippingType === "free" || context.shippingType === "pickup") return hardAmount(0);
  if (context.freightQuote !== null && Number.isFinite(context.freightQuote)) {
    return hardAmount(context.freightQuote);
  }
  if (context.sellerZip !== null && homeZip !== null && ZIP_RE.test(context.sellerZip) && ZIP_RE.test(homeZip) && context.palletCount !== null && context.palletCount >= 1) {
    return estimateFreight({
      originZip: context.sellerZip,
      destZip: homeZip,
      palletCount: context.palletCount,
      weightClass: context.weightClass ?? "standard"
    });
  }
  return null;
}

// src/valuation/recovery.ts
function effectiveRate(grade, rates, segmentMultiplier = 1) {
  return Math.min(1, Math.max(0, rates[grade] * segmentMultiplier));
}

// src/valuation/valuation.ts
var FLOOR_VALUATION_REASON = "floor-valuations";
var UNVERIFIED_ROWS_REASON = "unverified-rows";
var GRAIL_SHARE_THRESHOLD = 0.4;
var GRAIL_MIN_ITEMS = 4;
function round23(n) {
  return Math.round(n * 100) / 100;
}
function valueLot(inputs) {
  const {
    items,
    soldPricesByItemId,
    rates,
    segmentMultiplier = 1,
    conservativeFloorRate,
    sellThroughProbability
  } = inputs;
  const valuations = items.map((item) => {
    const comps = soldPricesByItemId.get(item.id) ?? [];
    let unitResale;
    let confidence2;
    let flooredValuation;
    if (comps.length > 0) {
      const compPrice = median(comps);
      unitResale = compPrice * effectiveRate(item.conditionGrade, rates, segmentMultiplier) * sellThroughProbability;
      confidence2 = comps.length >= 3 ? "high" : "medium";
      flooredValuation = false;
    } else {
      unitResale = (item.unitMsrp ?? 0) * conservativeFloorRate;
      confidence2 = "low";
      flooredValuation = item.unitMsrp !== null;
    }
    return {
      itemId: item.id,
      description: item.description,
      quantity: item.quantity,
      unitMsrp: item.unitMsrp,
      conditionGrade: item.conditionGrade,
      unitResale: round23(unitResale),
      extendedResale: round23(unitResale * item.quantity),
      confidence: confidence2,
      flooredValuation,
      unverifiable: item.unverifiable,
      grailRisk: false,
      compCount: comps.length
    };
  });
  const total = valuations.reduce((s, v) => s + v.extendedResale, 0);
  let grailItemIds = [];
  if (items.length >= GRAIL_MIN_ITEMS && total > 0) {
    const sorted = [...valuations].sort((a, b) => b.extendedResale - a.extendedResale);
    let prefix = 0;
    for (let k = 0; k < 3; k++) {
      prefix += sorted[k].extendedResale;
      if (prefix > GRAIL_SHARE_THRESHOLD * total) {
        grailItemIds = sorted.slice(0, k + 1).map((v) => v.itemId);
        break;
      }
    }
  }
  const grailSet = new Set(grailItemIds);
  for (const v of valuations) v.grailRisk = grailSet.has(v.itemId);
  const sumWhere = (pred) => round23(valuations.filter(pred).reduce((s, v) => s + v.extendedResale, 0));
  const unverifiedValue = sumWhere((v) => v.unverifiable);
  const flooredCount = valuations.filter((v) => v.flooredValuation).length;
  const makeRevenue = (amount) => {
    const reasons = [];
    if (flooredCount > 0) reasons.push(FLOOR_VALUATION_REASON);
    if (unverifiedValue > 0) reasons.push(UNVERIFIED_ROWS_REASON);
    return { amount: round23(amount), isEstimate: reasons.length > 0, estimateReasons: reasons };
  };
  const confidenceShares = { high: 0, medium: 0, low: 0 };
  if (total > 0) {
    for (const tier of ["high", "medium", "low"]) {
      confidenceShares[tier] = round23(sumWhere((v) => v.confidence === tier) / total);
    }
  }
  return {
    items: valuations,
    expectedRevenue: makeRevenue(total),
    breadAndButterRevenue: makeRevenue(total - sumWhere((v) => v.grailRisk)),
    hasGrailRisk: grailItemIds.length > 0,
    grailItemIds,
    unverifiedValueShare: total > 0 ? round23(unverifiedValue / total) : items.length === 0 ? 1 : 0,
    confidenceShares,
    extendedRetail: round23(items.reduce((s, i) => s + i.quantity * (i.unitMsrp ?? 0), 0)),
    totalUnits: items.reduce((s, i) => s + i.quantity, 0)
  };
}

// src/calc/bid.ts
function round24(n) {
  return Math.round(n * 100) / 100;
}
function requiredProfitAmount(profit, expectedRevenue) {
  return profit.kind === "absolute" ? profit.amount : profit.percent * expectedRevenue;
}
function computeBid(i) {
  const sellingCosts = i.expectedRevenue * i.sellingFeeRate;
  const profit = requiredProfitAmount(i.requiredProfit, i.expectedRevenue);
  const totalBudget = i.expectedRevenue - sellingCosts - profit;
  const auctionBudget = totalBudget - i.freight;
  const maxBid = Math.max(0, Math.floor(auctionBudget / (1 + i.buyersPremiumRate)));
  return {
    expectedRevenue: round24(i.expectedRevenue),
    sellingCosts: round24(sellingCosts),
    requiredProfitAmount: round24(profit),
    totalBudget: round24(totalBudget),
    freight: round24(i.freight),
    auctionBudget: round24(auctionBudget),
    maxBid,
    landedUnitPrice: i.totalUnits > 0 ? round24(totalBudget / i.totalUnits) : null
  };
}
function computeBidFlagged(input) {
  const n = computeBid({
    expectedRevenue: input.expectedRevenue.amount,
    sellingFeeRate: input.sellingFeeRate,
    requiredProfit: input.requiredProfit,
    freight: input.freight.amount,
    buyersPremiumRate: input.buyersPremiumRate,
    totalUnits: input.totalUnits
  });
  const from = (amount, ...sources) => {
    const reasons = [...new Set(sources.flatMap((s) => s.estimateReasons))];
    return { amount, isEstimate: reasons.length > 0, estimateReasons: reasons };
  };
  const rev = input.expectedRevenue;
  const fr = input.freight;
  return {
    expectedRevenue: from(n.expectedRevenue, rev),
    sellingCosts: from(n.sellingCosts, rev),
    requiredProfit: from(n.requiredProfitAmount, ...input.requiredProfit.kind === "percent" ? [rev] : []),
    totalBudget: from(n.totalBudget, rev),
    freight: from(n.freight, fr),
    auctionBudget: from(n.auctionBudget, rev, fr),
    maxBid: from(n.maxBid, rev, fr),
    landedUnitPrice: n.landedUnitPrice === null ? null : from(n.landedUnitPrice, rev),
    buyersPremiumRate: input.buyersPremiumRate,
    sellingFeeRate: input.sellingFeeRate,
    totalUnits: input.totalUnits
  };
}

// src/calc/verdict.ts
var PASS_CURRENT_BID = "current bid above your walk-away number";
var PASS_MAX_SPEND = "max spend per lot";
var PASS_CONDITION = "unacceptable condition";
var PASS_NO_PROFITABLE_BID = "no profitable bid at your required profit";
function estimateWarningsFor(amount, valuation) {
  const warnings = [];
  for (const reason of amount.estimateReasons) {
    if (reason === FREIGHT_ESTIMATE_REASON) {
      warnings.push("Freight is an estimate \u2014 get a real quote before bidding.");
    } else if (reason === "freight-missing") {
      warnings.push("No freight entered \u2014 these numbers assume $0 freight. Add a quote or seller zip.");
    } else if (reason === FLOOR_VALUATION_REASON) {
      warnings.push("Some items are valued at the conservative MSRP floor (no comps entered).");
    } else if (reason === UNVERIFIED_ROWS_REASON) {
      warnings.push(
        `${Math.round(valuation.unverifiedValueShare * 100)}% of the valuation is unverifiable (rows without identifiers).`
      );
    } else {
      warnings.push(`Estimated input: ${reason}.`);
    }
  }
  return warnings;
}
function decideVerdict(input) {
  const { bid, valuation, profile, currentBid } = input;
  const passReasons = [];
  let maxBid = { ...bid.maxBid };
  const acceptable = new Set(profile.acceptableConditions);
  const badGrades = [...new Set(
    valuation.items.filter((i) => !acceptable.has(i.conditionGrade)).map((i) => i.conditionGrade)
  )];
  for (const grade of badGrades) {
    passReasons.push(
      `${PASS_CONDITION}: lot contains "${grade}" items, which is outside your acceptable conditions`
    );
  }
  if (profile.maxSpendPerLot !== null) {
    const spendCappedBid = Math.floor(
      (profile.maxSpendPerLot - bid.freight.amount) / (1 + bid.buyersPremiumRate)
    );
    if (spendCappedBid <= 0) {
      passReasons.push(
        `${PASS_MAX_SPEND}: freight and premium alone exceed your $${profile.maxSpendPerLot} max spend`
      );
      maxBid = { ...maxBid, amount: 0 };
    } else if (spendCappedBid < maxBid.amount) {
      maxBid = { ...maxBid, amount: spendCappedBid };
    }
  }
  if (maxBid.amount <= 0 && passReasons.length === 0) {
    passReasons.push(PASS_NO_PROFITABLE_BID);
  }
  if (currentBid !== null && maxBid.amount > 0 && currentBid > maxBid.amount) {
    const gap = Math.round((currentBid - maxBid.amount) * 100) / 100;
    passReasons.push(
      `${PASS_CURRENT_BID}: current bid $${currentBid} is $${gap} above your walk-away $${maxBid.amount}`
    );
  }
  return {
    decision: passReasons.length > 0 ? "PASS" : "BID",
    maxBid,
    passReasons,
    estimateWarnings: estimateWarningsFor(maxBid, valuation)
  };
}

// src/reasoning/rationale.ts
var pct = (x) => `${Math.round(x * 100)}%`;
var usd = (x) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
var SEASONS = {
  outdoor: { peakMonths: [3, 4, 5, 6, 7], label: "spring/summer outdoor season" },
  garden: { peakMonths: [3, 4, 5, 6, 7], label: "spring/summer garden season" },
  patio: { peakMonths: [3, 4, 5, 6, 7], label: "spring/summer patio season" },
  sports: { peakMonths: [3, 4, 5, 6, 7], label: "spring/summer sports season" },
  toys: { peakMonths: [9, 10, 11], label: "holiday toy season" },
  games: { peakMonths: [9, 10, 11], label: "holiday season" },
  electronics: { peakMonths: [10, 11], label: "holiday electronics season" },
  holiday: { peakMonths: [9, 10, 11], label: "holiday season" }
};
function buildRationale(input) {
  return [
    valueComposition(input),
    location(input),
    seasonality(input),
    competition(input),
    confidence(input)
  ];
}
function valueComposition({ valuation }) {
  const total = valuation.expectedRevenue.amount;
  if (total <= 0) {
    return {
      topic: "value-composition",
      title: "Where the money is",
      text: "No resale value could be estimated for this lot yet \u2014 add comps or check the manifest."
    };
  }
  const top = [...valuation.items].sort((a, b) => b.extendedResale - a.extendedResale).slice(0, 3);
  const parts = top.filter((t) => t.extendedResale > 0).map((t) => `${t.description} (${usd(t.extendedResale)}, ${pct(t.extendedResale / total)})`);
  let text = `Top value drivers: ${parts.join("; ")}.`;
  if (valuation.hasGrailRisk) {
    text += ` Grail risk: ${valuation.grailItemIds.length} item(s) hold over 40% of the estimated value. If they are missing or misgraded the lot math collapses, so the recommended max bid uses the grails-excluded valuation of ${usd(valuation.breadAndButterRevenue.amount)} (full valuation ${usd(total)}).`;
  }
  return { topic: "value-composition", title: "Where the money is", text };
}
function location({ bid, context }) {
  const freight = bid.freight.amount;
  if (freight <= 0 && !bid.freight.isEstimate) {
    return {
      topic: "location",
      title: "Location & freight",
      text: context.shippingType === "pickup" ? "Local pickup \u2014 no freight drag on this lot." : "Freight is $0 for this lot."
    };
  }
  const budget = bid.totalBudget.amount;
  const share = budget > 0 ? ` \u2014 ${pct(freight / budget)} of your total budget` : "";
  let text = `Freight is ${usd(freight)}${share}. Every freight dollar comes straight out of your auction budget (${usd(freight)} of freight lowers your max bid by about ${usd(Math.round(freight / (1 + bid.buyersPremiumRate)))}).`;
  if (bid.freight.isEstimate) {
    text += " This freight number is an estimate \u2014 get a real quote before bidding.";
  }
  return { topic: "location", title: "Location & freight", text };
}
function seasonality({ category, now }) {
  const key = category === null ? null : Object.keys(SEASONS).find((k) => category.toLowerCase().includes(k));
  if (key === void 0 || key === null) {
    return {
      topic: "seasonality",
      title: "Seasonality",
      text: "No strong seasonal pattern for this category \u2014 demand should be steady year-round."
    };
  }
  const season = SEASONS[key];
  const month = now.getMonth();
  const inSeason = season.peakMonths.includes(month);
  const text = inSeason ? `This category is in its ${season.label} right now \u2014 expect faster sell-through, but also more bidders who know it.` : `This category is off-season (peak is the ${season.label}). Off-season lots often close cheaper \u2014 a discount opportunity \u2014 but plan for longer holding time and storage until demand returns.`;
  return { topic: "seasonality", title: "Seasonality", text };
}
var LOW_BID_COUNT = 2;
var NEAR_CLOSE_HOURS = 24;
function competition({ context, now }) {
  const { bidCount, endTime } = context;
  if (bidCount === null && endTime === null) {
    return {
      topic: "competition",
      title: "Competition",
      text: "No bid count or end time entered \u2014 add them from the listing page to read demand."
    };
  }
  const hoursLeft = endTime !== null ? (new Date(endTime).getTime() - now.getTime()) / 36e5 : null;
  const timePhrase = hoursLeft === null ? "" : hoursLeft <= 0 ? " The auction has ended." : hoursLeft < NEAR_CLOSE_HOURS ? ` About ${Math.max(1, Math.round(hoursLeft))}h remain.` : ` About ${Math.round(hoursLeft / 24)} day(s) remain.`;
  let text;
  if (bidCount !== null && bidCount <= LOW_BID_COUNT && hoursLeft !== null && hoursLeft > 0 && hoursLeft < NEAR_CLOSE_HOURS) {
    text = `Only ${bidCount} bid(s) with under ${NEAR_CLOSE_HOURS}h remaining \u2014 low competition is a favorable signal for closing near your number. But quiet auctions can also mean other buyers spotted a problem you missed: re-check the manifest (conditions, grail items, freight) before bidding.` + timePhrase;
  } else if (bidCount !== null && bidCount <= LOW_BID_COUNT) {
    text = `Only ${bidCount} bid(s) so far, but there is plenty of time left \u2014 most action on B-Stock arrives near close, so this is weak evidence either way.${timePhrase}`;
  } else if (bidCount !== null && bidCount >= 8) {
    text = `${bidCount} bids is strong demand \u2014 expect the close to run up. Your walk-away number does not move because others are excited.${timePhrase}`;
  } else if (bidCount !== null) {
    text = `${bidCount} bids \u2014 moderate interest.${timePhrase}`;
  } else {
    text = `No bid count entered.${timePhrase}`;
  }
  return { topic: "competition", title: "Competition", text };
}
function confidence({ valuation }) {
  const s = valuation.confidenceShares;
  const withComps = valuation.items.filter((i) => i.compCount > 0).length;
  let text = `${pct(s.high)} of the valuation is high-confidence (\u22653 sold comps), ${pct(s.medium)} medium (1\u20132 comps), ${pct(s.low)} low (MSRP-floor guesses). ${withComps} of ${valuation.items.length} line items have comps.`;
  if (valuation.unverifiedValueShare > 0) {
    text += ` ${pct(valuation.unverifiedValueShare)} of the value sits in rows with no identifier at all \u2014 unverifiable until you inspect.`;
  }
  return { topic: "confidence", title: "Valuation confidence", text };
}

// src/analyze.ts
var FREIGHT_MISSING_REASON = "freight-missing";
function dominantCategory(items) {
  const byCat = /* @__PURE__ */ new Map();
  for (const i of items) {
    if (i.category === null) continue;
    byCat.set(i.category, (byCat.get(i.category) ?? 0) + i.quantity * (i.unitMsrp ?? 0));
  }
  if (byCat.size === 0) return "uncategorized";
  return [...byCat.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
async function analyzeLot(db, lotId, now = /* @__PURE__ */ new Date()) {
  const [lot, items, profile, rates, compsForLot] = await Promise.all([
    getLot(db, lotId),
    getLineItems(db, lotId),
    getProfile(db),
    getRecoveryRates(db),
    getCompsForLot(db, lotId)
  ]);
  if (!lot) throw new Error(`No lot with id ${lotId}`);
  const category = dominantCategory(items);
  const override = await getSegmentOverride(db, lot.seller.trim().toLowerCase(), category);
  const soldPricesByItemId = /* @__PURE__ */ new Map();
  for (const [itemId, comps] of compsForLot) {
    soldPricesByItemId.set(itemId, comps.map((c) => c.soldPrice));
  }
  const valuation = valueLot({
    items,
    soldPricesByItemId,
    rates,
    segmentMultiplier: override?.multiplier ?? 1,
    conservativeFloorRate: profile.conservativeFloorRate,
    sellThroughProbability: profile.sellThroughProbability
  });
  const freight = resolveFreight(lot.context, profile.homeZip) ?? estimatedAmount(0, FREIGHT_MISSING_REASON);
  const revenueForBid = valuation.hasGrailRisk ? valuation.breadAndButterRevenue : valuation.expectedRevenue;
  const bid = computeBidFlagged({
    expectedRevenue: revenueForBid,
    sellingFeeRate: profile.sellingFeeRate,
    requiredProfit: profile.requiredProfit,
    freight,
    buyersPremiumRate: lot.context.buyersPremiumRate,
    totalUnits: valuation.totalUnits
  });
  const verdict = decideVerdict({
    bid,
    valuation,
    profile,
    currentBid: lot.context.currentBid
  });
  let marketEstimate = null;
  if (valuation.extendedRetail > 0) {
    const range = predictClosingRange(await listSegmentOutcomes(db), lot.seller, category);
    if (range) {
      marketEstimate = {
        low: Math.round(range.lowPctOfRetail * valuation.extendedRetail),
        high: Math.round(range.highPctOfRetail * valuation.extendedRetail),
        lowPctOfRetail: range.lowPctOfRetail,
        highPctOfRetail: range.highPctOfRetail,
        sampleSize: range.sampleSize,
        label: "market estimate"
      };
    }
  }
  return {
    lotId,
    valuation,
    bid,
    verdict,
    rationale: buildRationale({
      valuation,
      bid,
      context: lot.context,
      category: category === "uncategorized" ? null : category,
      now
    }),
    marketEstimate
  };
}

// src/ui/api.ts
var HttpError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function lotOr404(db, id) {
  const lot = await getLot(db, Number(id));
  if (!lot) throw new HttpError(404, `No lot ${id}`);
  return lot;
}
function badRequest(err, fallback) {
  throw new HttpError(400, err instanceof Error ? err.message : fallback);
}
function createApi(db) {
  const api = Router();
  api.use(json({ limit: "5mb" }));
  api.get("/profile", async (_req, res) => res.json(await getProfile(db)));
  api.put("/profile", async (req, res) => res.json(await updateProfile(db, req.body)));
  api.get("/rates", async (_req, res) => res.json(await getRecoveryRates(db)));
  api.put("/rates", async (req, res) => res.json(await saveRecoveryRates(db, req.body)));
  api.post(
    "/lots",
    raw({ type: "application/octet-stream", limit: "30mb" }),
    async (req, res) => {
      const name = String(req.query.name ?? "").trim();
      const seller = String(req.query.seller ?? "").trim();
      const unmanifested = req.query.unmanifested === "true";
      if (!name || !seller) throw new HttpError(400, "name and seller are required");
      const lot = await createLot(db, { name, seller, unmanifested });
      if (unmanifested || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.json({ lot, mapping: null, headers: [], sampleRows: [], itemCount: 0 });
      }
      const filename = String(req.headers["x-filename"] ?? "manifest");
      let table;
      try {
        table = await parseManifest(filename, req.body);
      } catch (err) {
        await deleteLot(db, lot.id);
        throw new HttpError(422, err instanceof Error ? err.message : "Could not parse manifest");
      }
      if (table.headers.length === 0 || table.rows.length === 0) {
        await deleteLot(db, lot.id);
        throw new HttpError(422, "No tabular data found in that file");
      }
      await saveRawFile(db, lot.id, filename, table.headers, table.rows);
      const saved = await getSellerMapping(db, seller);
      const proposal = (saved && applySavedMapping(table.headers, saved)) ?? proposeMapping(table.headers);
      let itemCount = 0;
      if (!proposal.needsConfirmation) {
        const items = normalizeRows(table.headers, table.rows, proposal.mapping);
        await replaceLineItems(db, lot.id, items);
        await setMappingStatus(db, lot.id, "confirmed");
        await saveSellerMapping(db, seller, proposal.mapping);
        itemCount = items.length;
      }
      res.json({
        lot: await getLot(db, lot.id),
        mapping: proposal,
        headers: table.headers,
        sampleRows: table.rows.slice(0, 5),
        itemCount
      });
    }
  );
  api.get("/lots", async (_req, res) => {
    const lots = await listLots(db);
    res.json(
      await Promise.all(
        lots.map(async (lot) => ({ ...lot, itemCount: (await getLineItems(db, lot.id)).length }))
      )
    );
  });
  api.get("/lots/:id", async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const rawFile = await getRawFile(db, lot.id);
    const pendingMapping = lot.mappingStatus === "pending" && rawFile ? {
      proposal: proposeMapping(rawFile.headers),
      headers: rawFile.headers,
      sampleRows: rawFile.rows.slice(0, 5)
    } : null;
    res.json({ lot, items: await getLineItems(db, lot.id), pendingMapping });
  });
  api.delete("/lots/:id", async (req, res) => {
    await lotOr404(db, req.params.id);
    await deleteLot(db, Number(req.params.id));
    res.json({ ok: true });
  });
  api.post(
    "/lots/:id/manifest",
    raw({ type: "application/octet-stream", limit: "30mb" }),
    async (req, res) => {
      const lot = await lotOr404(db, req.params.id);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(400, "No manifest file received");
      }
      const filename = String(req.headers["x-filename"] ?? "manifest");
      let table;
      try {
        table = await parseManifest(filename, req.body);
      } catch (err) {
        throw new HttpError(422, err instanceof Error ? err.message : "Could not parse manifest");
      }
      if (table.headers.length === 0 || table.rows.length === 0) {
        throw new HttpError(422, "No tabular data found in that file");
      }
      await saveRawFile(db, lot.id, filename, table.headers, table.rows);
      await setUnmanifested(db, lot.id, false);
      const saved = await getSellerMapping(db, lot.seller);
      const proposal = (saved && applySavedMapping(table.headers, saved)) ?? proposeMapping(table.headers);
      let itemCount = 0;
      if (!proposal.needsConfirmation) {
        const items = normalizeRows(table.headers, table.rows, proposal.mapping);
        await replaceLineItems(db, lot.id, items);
        await setMappingStatus(db, lot.id, "confirmed");
        await saveSellerMapping(db, lot.seller, proposal.mapping);
        itemCount = items.length;
      } else {
        await setMappingStatus(db, lot.id, "pending");
      }
      res.json({
        lot: await getLot(db, lot.id),
        mapping: proposal,
        headers: table.headers,
        sampleRows: table.rows.slice(0, 5),
        itemCount
      });
    }
  );
  api.post("/lots/:id/mapping", async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const mapping = req.body;
    const rawFile = await getRawFile(db, lot.id);
    if (!rawFile) throw new HttpError(409, "This lot has no uploaded manifest to map");
    for (const field of REQUIRED_FIELDS) {
      if (!mapping[field] || !rawFile.headers.includes(mapping[field])) {
        throw new HttpError(400, `Mapping for required field "${field}" is missing or not a file column`);
      }
    }
    for (const [field, header] of Object.entries(mapping)) {
      if (header && !rawFile.headers.includes(header)) {
        throw new HttpError(400, `"${header}" (${field}) is not a column of the uploaded file`);
      }
    }
    const items = normalizeRows(rawFile.headers, rawFile.rows, mapping);
    await replaceLineItems(db, lot.id, items);
    await setMappingStatus(db, lot.id, "confirmed");
    await saveSellerMapping(db, lot.seller, mapping);
    res.json({ lot: await getLot(db, lot.id), itemCount: items.length });
  });
  api.put("/lots/:id/context", async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const patch = req.body;
    const context = { ...emptyListingContext(), ...lot.context, ...patch };
    if (!Number.isFinite(context.buyersPremiumRate) || context.buyersPremiumRate < 0 || context.buyersPremiumRate > 1) {
      throw new HttpError(400, "buyersPremiumRate must be between 0 and 1");
    }
    await saveContext(db, lot.id, context);
    res.json(await getLot(db, lot.id));
  });
  api.post("/lots/:id/items", async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const b = req.body;
    if (!b.description?.trim()) throw new HttpError(400, "description is required");
    const conditionRaw = b.condition ?? "";
    const item = await addLineItem(db, lot.id, {
      description: b.description.trim(),
      identifierType: "none",
      identifier: null,
      quantity: Number.isFinite(b.quantity) && b.quantity > 0 ? Math.round(b.quantity) : 1,
      unitMsrp: Number.isFinite(b.unitMsrp) && b.unitMsrp >= 0 ? b.unitMsrp : null,
      conditionRaw,
      conditionGrade: normalizeCondition(conditionRaw),
      category: b.category?.trim() || null,
      unverifiable: true
    });
    res.json(item);
  });
  api.get("/lots/:id/top-items", async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const n = Number(req.query.n ?? 10);
    const top = topValueItems(await getLineItems(db, lot.id), Number.isFinite(n) && n > 0 ? n : 10);
    res.json(
      await Promise.all(
        top.map(async (item) => ({ item, comps: (await getComps(db, item.id)).map((c) => c.soldPrice) }))
      )
    );
  });
  api.put("/items/:itemId/comps", async (req, res) => {
    const item = await getLineItem(db, Number(req.params.itemId));
    if (!item) throw new HttpError(404, `No line item ${req.params.itemId}`);
    const body = req.body;
    const prices = body.prices;
    if (!Array.isArray(prices) || prices.some((p) => typeof p !== "number" || !Number.isFinite(p) || p < 0)) {
      throw new HttpError(400, "prices must be an array of non-negative numbers");
    }
    await setComps(db, item.id, prices.map((p) => ({ price: p })));
    if (body.currentRetail !== void 0) {
      if (body.currentRetail !== null && typeof body.currentRetail !== "number") {
        throw new HttpError(400, "currentRetail must be a number or null");
      }
      await setCurrentRetail(db, item.id, body.currentRetail);
    }
    res.json({
      itemId: item.id,
      comps: prices,
      currentRetail: (await getLineItem(db, item.id))?.currentRetail ?? null
    });
  });
  api.get("/lots/:id/analysis", async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    res.json(await analyzeLot(db, lot.id));
  });
  api.post("/lots/:id/outcome", async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const b = req.body;
    if (typeof b.won !== "boolean") throw new HttpError(400, "won (boolean) is required");
    const analysis = await analyzeLot(db, lot.id);
    const outcome = await recordOutcome(db, {
      lotId: lot.id,
      won: b.won,
      finalPrice: Number.isFinite(b.finalPrice) ? b.finalPrice : null,
      grossRecovered: Number.isFinite(b.grossRecovered) ? b.grossRecovered : null,
      predictedRevenue: analysis.valuation.expectedRevenue.amount,
      predictedMaxBid: analysis.verdict.maxBid?.amount ?? null
    });
    await deleteAutoExpenses(db, lot.id);
    if (outcome.won && outcome.finalPrice !== null && outcome.finalPrice > 0) {
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const premium = lot.context.buyersPremiumRate;
      await addExpense(db, {
        lotId: lot.id,
        amount: Math.round(outcome.finalPrice * (1 + premium) * 100) / 100,
        category: "lot-purchase",
        note: `auto: winning bid $${outcome.finalPrice} + ${Math.round(premium * 100)}% premium`,
        auto: true,
        spentAt: today
      });
      if (lot.context.freightQuote !== null && lot.context.freightQuote > 0) {
        await addExpense(db, {
          lotId: lot.id,
          amount: lot.context.freightQuote,
          category: "freight",
          note: "auto: freight quote",
          auto: true,
          spentAt: today
        });
      }
    }
    res.json(outcome);
  });
  api.get("/ledger", async (_req, res) => {
    const [sales, expenses, summary] = await Promise.all([
      listSales(db),
      listExpenses(db),
      ledgerSummary(db)
    ]);
    res.json({ sales, expenses, summary, categories: EXPENSE_CATEGORIES });
  });
  api.post("/sales", async (req, res) => {
    const b = req.body;
    if (typeof b.amount !== "number" || typeof b.soldAt !== "string") {
      throw new HttpError(400, "amount (number) and soldAt (YYYY-MM-DD) are required");
    }
    try {
      res.json(await addSale(db, { lotId: b.lotId ?? null, amount: b.amount, note: b.note ?? null, soldAt: b.soldAt }));
    } catch (err) {
      badRequest(err, "Invalid sale");
    }
  });
  api.delete("/sales/:id", async (req, res) => {
    await deleteSale(db, Number(req.params.id));
    res.json({ ok: true });
  });
  api.post("/expenses", async (req, res) => {
    const b = req.body;
    if (typeof b.amount !== "number" || typeof b.spentAt !== "string" || typeof b.category !== "string") {
      throw new HttpError(400, "amount, category, and spentAt (YYYY-MM-DD) are required");
    }
    try {
      res.json(
        await addExpense(db, {
          lotId: b.lotId ?? null,
          amount: b.amount,
          category: b.category,
          note: b.note ?? null,
          spentAt: b.spentAt
        })
      );
    } catch (err) {
      badRequest(err, "Invalid expense");
    }
  });
  api.delete("/expenses/:id", async (req, res) => {
    await deleteExpense(db, Number(req.params.id));
    res.json({ ok: true });
  });
  api.get("/leaderboard", async (req, res) => {
    const n = Number(req.query.n ?? 10);
    res.json(await lotPerformance(db, Number.isFinite(n) && n > 0 ? n : 10));
  });
  api.get("/history", async (_req, res) => {
    res.json({ outcomes: await listSegmentOutcomes(db) });
  });
  api.get("/calibration", async (_req, res) => {
    const outcomes = await listSegmentOutcomes(db);
    const multipliers = /* @__PURE__ */ new Map();
    for (const o of outcomes) {
      const key = `${o.seller.trim().toLowerCase()}\0${o.category}`;
      if (!multipliers.has(key)) {
        const override = await getSegmentOverride(db, o.seller.trim().toLowerCase(), o.category);
        multipliers.set(key, override?.multiplier ?? 1);
      }
    }
    res.json(
      suggestCalibrations(
        outcomes,
        (seller, category) => multipliers.get(`${seller.trim().toLowerCase()}\0${category}`) ?? 1
      )
    );
  });
  api.post("/calibration/apply", async (req, res) => {
    const b = req.body;
    if (!b.seller || !b.category || !Number.isFinite(b.multiplier)) {
      throw new HttpError(400, "seller, category, multiplier are required");
    }
    await saveSegmentOverride(db, b.seller.trim().toLowerCase(), b.category, b.multiplier);
    res.json({ ok: true });
  });
  const CONDITION_FACTORS = {
    "like-new": 0.65,
    good: 0.55,
    fair: 0.45,
    poor: 0.3
  };
  function enrich(item, profile) {
    const margin = profile.requiredProfit.kind === "percent" ? profile.requiredProfit.percent : 0.3;
    const floor = item.cost !== null ? floorPrice(item.cost, profile.sellingFeeRate) : null;
    const target = item.cost !== null ? targetPrice(item.cost, profile.sellingFeeRate, margin) : null;
    const factor = item.condition ? CONDITION_FACTORS[item.condition] : null;
    const ask = item.currentRetail !== null && factor !== null ? Math.round(item.currentRetail * factor / 5) * 5 : null;
    return {
      ...item,
      pricing: item.cost === null && ask === null ? null : {
        floor,
        target,
        ask,
        askBelowFloor: ask !== null && floor !== null && ask < floor,
        conditionFactor: factor,
        ceiling: item.currentRetail,
        feeRate: profile.sellingFeeRate,
        marginRate: margin
      }
    };
  }
  api.get("/inventory", async (_req, res) => {
    const [items, profile] = await Promise.all([listInventory(db), getProfile(db)]);
    res.json({ items: items.map((i) => enrich(i, profile)), statuses: INVENTORY_STATUSES });
  });
  api.post("/inventory", async (req, res) => {
    const b = req.body;
    if (typeof b.name !== "string" || !b.name.trim()) throw new HttpError(400, "name is required");
    try {
      const item = await addInventoryItem(db, b);
      res.json(enrich(item, await getProfile(db)));
    } catch (err) {
      badRequest(err, "Invalid item");
    }
  });
  api.put("/inventory/:id", async (req, res) => {
    if (!await getInventoryItem(db, Number(req.params.id))) {
      throw new HttpError(404, `No inventory item ${req.params.id}`);
    }
    try {
      const item = await updateInventoryItem(db, Number(req.params.id), req.body);
      res.json(enrich(item, await getProfile(db)));
    } catch (err) {
      badRequest(err, "Invalid update");
    }
  });
  api.delete("/inventory/:id", async (req, res) => {
    await deleteInventoryItem(db, Number(req.params.id));
    res.json({ ok: true });
  });
  api.get("/events", async (req, res) => {
    const { from, to } = req.query;
    res.json({
      events: from && to ? await listEvents(db, from, to) : await listEvents(db),
      kinds: EVENT_KINDS
    });
  });
  api.post("/events", async (req, res) => {
    const b = req.body;
    if (!b.title || !b.kind || !b.date) throw new HttpError(400, "title, kind, and date are required");
    try {
      res.json(
        await addEvent(db, {
          title: b.title,
          kind: b.kind,
          date: b.date,
          time: b.time ?? null,
          contact: b.contact ?? null,
          note: b.note ?? null,
          inventoryId: b.inventoryId ?? null
        })
      );
    } catch (err) {
      badRequest(err, "Invalid event");
    }
  });
  api.delete("/events/:id", async (req, res) => {
    await deleteEvent(db, Number(req.params.id));
    res.json({ ok: true });
  });
  api.get("/calendar.ics", async (_req, res) => {
    res.type("text/calendar; charset=utf-8").setHeader("Content-Disposition", 'inline; filename="manifest-analyzer.ics"').send(buildIcs(await listEvents(db)));
  });
  api.get("/workspace", async (_req, res) => {
    const [units, hours, hoursTotal, summary, timer] = await Promise.all([
      listStorageUnits(db),
      listWorkEntries(db),
      totalHours(db),
      ledgerSummary(db),
      getTimer(db)
    ]);
    res.json({
      units,
      hours,
      totalHours: hoursTotal,
      netProfit: summary.netProfit,
      profitPerHour: hoursTotal > 0 ? Math.round(summary.netProfit / hoursTotal * 100) / 100 : null,
      timer
    });
  });
  api.post("/timer/start", async (req, res) => {
    const b = req.body;
    try {
      res.json(await startTimer(db, { note: b.note ?? null, lotId: b.lotId ?? null }));
    } catch (err) {
      throw new HttpError(409, err instanceof Error ? err.message : "Timer already running");
    }
  });
  api.post("/timer/commit", async (req, res) => {
    const b = req.body;
    if (typeof b.hours !== "number" || typeof b.date !== "string") {
      throw new HttpError(400, "hours (number) and date (YYYY-MM-DD) are required");
    }
    try {
      const entry = await addWorkEntry(db, {
        date: b.date,
        hours: b.hours,
        note: b.note ?? null,
        lotId: b.lotId ?? null
      });
      await clearTimer(db);
      res.json(entry);
    } catch (err) {
      badRequest(err, "Invalid hours entry");
    }
  });
  api.post("/timer/discard", async (_req, res) => {
    await clearTimer(db);
    res.json({ ok: true });
  });
  api.post("/storage-units", async (req, res) => {
    const b = req.body;
    if (typeof b.name !== "string" || typeof b.monthlyCost !== "number" || typeof b.dueDay !== "number") {
      throw new HttpError(400, "name, monthlyCost, and dueDay are required");
    }
    try {
      res.json(await addStorageUnit(db, { name: b.name, monthlyCost: b.monthlyCost, dueDay: b.dueDay, note: b.note ?? null }));
    } catch (err) {
      badRequest(err, "Invalid storage unit");
    }
  });
  api.delete("/storage-units/:id", async (req, res) => {
    await deleteStorageUnit(db, Number(req.params.id));
    res.json({ ok: true });
  });
  api.post("/storage-units/:id/pay", async (req, res) => {
    const unit = await getStorageUnit(db, Number(req.params.id));
    if (!unit) throw new HttpError(404, `No storage unit ${req.params.id}`);
    const expense = await addExpense(db, {
      amount: unit.monthlyCost,
      category: "storage",
      note: `${unit.name} rent`,
      spentAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
    });
    res.json(expense);
  });
  api.post("/hours", async (req, res) => {
    const b = req.body;
    if (typeof b.date !== "string" || typeof b.hours !== "number") {
      throw new HttpError(400, "date (YYYY-MM-DD) and hours are required");
    }
    try {
      res.json(await addWorkEntry(db, { date: b.date, hours: b.hours, note: b.note ?? null, lotId: b.lotId ?? null }));
    } catch (err) {
      badRequest(err, "Invalid hours entry");
    }
  });
  api.delete("/hours/:id", async (req, res) => {
    await deleteWorkEntry(db, Number(req.params.id));
    res.json({ ok: true });
  });
  api.get("/library", async (_req, res) => {
    res.json({ entries: await listLibraryEntries(db) });
  });
  api.post("/library", async (req, res) => {
    const b = req.body;
    if (typeof b.title !== "string" || typeof b.text !== "string") {
      throw new HttpError(400, "title and text are required");
    }
    try {
      res.json(await addLibraryEntry(db, b.title, b.text));
    } catch (err) {
      badRequest(err, "Invalid library entry");
    }
  });
  api.delete("/library/:id", async (req, res) => {
    await deleteLibraryEntry(db, Number(req.params.id));
    res.json({ ok: true });
  });
  const AI_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-fable-5";
  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  const LISTING_SYSTEM = `You write Facebook Marketplace listings for a small local furniture reseller in Massachusetts who flips Costco liquidation furniture. Given item data as JSON, write one listing that sells.

Include, in a natural order: an attention-grabbing first line naming the item; price anchoring against the current retail price when provided ("$X at Costco \u2014 yours for $Y"); two to four short lines on the features buyers care about, drawn from the item description; an honest condition note (these are customer returns / liquidation stock in good shape \u2014 never claim brand new unless the data says so); logistics (local pickup, delivery available for a small fee, cash / Venmo / Zelle); and a closing call to action.

Voice: warm, direct, trustworthy local seller \u2014 not corporate, not spammy, no ALL CAPS. At most three emoji. 80\u2013160 words. Output only the listing text itself: no preamble, no markdown headers, no commentary.`;
  api.get("/ai-status", (_req, res) => {
    res.json({ enabled: anthropic !== null, model: AI_MODEL });
  });
  api.post("/listings/:itemId/ai", async (req, res) => {
    if (!anthropic) {
      throw new HttpError(
        409,
        "AI drafting is not set up yet \u2014 add an ANTHROPIC_API_KEY to enable it (the template draft still works)"
      );
    }
    const item = await getInventoryItem(db, Number(req.params.itemId));
    if (!item) throw new HttpError(404, `No inventory item ${req.params.itemId}`);
    const profile = await getProfile(db);
    const margin = profile.requiredProfit.kind === "percent" ? profile.requiredProfit.percent : 0.3;
    const asking = item.cost !== null ? targetPrice(item.cost, profile.sellingFeeRate, margin) : null;
    const extra = req.body?.instructions;
    const response = await anthropic.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16e3,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      output_config: { effort: "low" },
      system: LISTING_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            item: {
              name: item.name,
              quantityAvailable: item.qty,
              description: item.description,
              currentRetailPrice: item.currentRetail,
              askingPrice: asking
            },
            sellerNotes: extra ?? null
          })
        }
      ]
    });
    if (response.stop_reason === "refusal") {
      throw new HttpError(502, "The model declined this request \u2014 use the template draft instead");
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) throw new HttpError(502, "The model returned no text \u2014 try again");
    res.json({ text, model: response.model });
  });
  api.get("/tax-estimate", async (req, res) => {
    const year = String(req.query.year ?? (/* @__PURE__ */ new Date()).getFullYear());
    const [sales, expensesList, profile] = await Promise.all([
      listSales(db),
      listExpenses(db),
      getProfile(db)
    ]);
    const revenue = sales.filter((s) => s.soldAt.startsWith(year)).reduce((sum, s) => sum + s.amount, 0);
    const expenses = expensesList.filter((e) => e.spentAt.startsWith(year)).reduce((sum, e) => sum + e.amount, 0);
    const round25 = (n) => Math.round(n * 100) / 100;
    res.json({
      year: Number(year),
      revenue: round25(revenue),
      expenses: round25(expenses),
      netProfit: round25(revenue - expenses),
      federalRate: profile.estimatedFederalRate,
      estimate: estimateSetAside(revenue - expenses, profile.estimatedFederalRate),
      maIncomeRate: MA_INCOME_RATE,
      maSalesTaxRate: MA_SALES_TAX_RATE
    });
  });
  api.get("/sales-tax", (req, res) => {
    const amount = Number(req.query.amount ?? 0);
    res.json({ amount, owed: maSalesTax(amount), rate: MA_SALES_TAX_RATE });
  });
  api.use((err, _req, res, _next) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Internal error" });
  });
  return api;
}

// src/ui/auth.ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router as Router2, json as json2 } from "express";
var COOKIE = "ma_session";
var SESSION_MS = 14 * 24 * 36e5;
function cookieKey(password) {
  return createHash("sha256").update(`manifest-analyzer-cookie-v1:${password}`).digest();
}
function sign(payload, password) {
  return createHmac("sha256", cookieKey(password)).update(payload).digest("hex");
}
function makeToken(password, now = Date.now()) {
  const exp = now + SESSION_MS;
  return `${exp}.${sign(String(exp), password)}`;
}
function verifyToken(token, password, now = Date.now()) {
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = sign(expStr, password);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function feedKey(password) {
  return sign("ics-feed", password).slice(0, 24);
}
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
function passwordsMatch(supplied, actual) {
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(actual).digest();
  return timingSafeEqual(a, b);
}
var LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sign in \u2014 Manifest Analyzer</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:linear-gradient(180deg,#0d1322 0%,#141c33 100%); }
  .box { background:#fff; border-radius:16px; padding:34px 38px; width:min(360px,90vw); box-shadow:0 18px 48px rgba(0,0,0,.4); }
  h1 { font-size:18px; margin:0 0 4px; color:#12161f; letter-spacing:-.01em; }
  p { margin:0 0 18px; font-size:13px; color:#8a93a3; }
  input { font:inherit; width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #d7dce6; border-radius:10px; }
  input:focus { outline:none; border-color:#4f46e5; box-shadow:0 0 0 3px rgba(79,70,229,.16); }
  button { font:inherit; font-weight:650; width:100%; margin-top:12px; padding:10px; border:0; border-radius:10px;
           background:#4f46e5; color:#fff; cursor:pointer; }
  button:hover { background:#4338ca; }
  .err { color:#c62f2f; font-size:13px; font-weight:600; margin:10px 0 0; min-height:18px; }
</style></head><body>
<form class="box" id="f">
  <h1>Manifest Analyzer</h1>
  <p>Enter your password to continue.</p>
  <input id="pw" type="password" autocomplete="current-password" autofocus placeholder="Password" />
  <button type="submit">Sign in</button>
  <div class="err" id="err"></div>
</form>
<script>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ password: document.getElementById('pw').value }),
    });
    if (res.ok) location.href = '/';
    else document.getElementById('err').textContent = (await res.json()).error || 'Wrong password';
  });
</script></body></html>`;
var attempts = /* @__PURE__ */ new Map();
function throttled(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 5 * 6e4 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}
function createAuth(password) {
  const router = Router2();
  router.use(json2());
  router.get("/login", (_req, res) => {
    res.type("html").send(LOGIN_PAGE);
  });
  router.post("/api/login", (req, res) => {
    if (throttled(req.ip ?? "unknown")) {
      return res.status(429).json({ error: "Too many attempts \u2014 wait five minutes" });
    }
    const supplied = req.body.password ?? "";
    if (!passwordsMatch(supplied, password)) {
      return res.status(401).json({ error: "Wrong password" });
    }
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${makeToken(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1e3}${secure ? "; Secure" : ""}`
    );
    res.json({ ok: true });
  });
  router.post("/api/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });
  const middleware = (req, res, next) => {
    if (req.path === "/login" || req.path === "/api/login") return next();
    if (req.path === "/api/calendar.ics" && req.query.key === feedKey(password)) return next();
    const token = getCookie(req, COOKIE);
    if (token && verifyToken(token, password)) return next();
    if (req.path.startsWith("/api")) {
      res.status(401).json({ error: "Not signed in" });
    } else {
      res.redirect("/login");
    }
  };
  return { router, middleware };
}

// src/ui/server.ts
function createApp(db, options = {}) {
  const app = express();
  const password = options.password ?? null;
  if (password) {
    const auth = createAuth(password);
    app.use(auth.router);
    app.use(auth.middleware);
    app.get("/api/feed-info", (req, res) => {
      const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
      res.json({ feedUrl: `${proto}://${req.headers.host}/api/calendar.ics?key=${feedKey(password)}` });
    });
  } else {
    app.get("/api/feed-info", (req, res) => {
      res.json({ feedUrl: `${req.protocol}://${req.headers.host}/api/calendar.ics` });
    });
  }
  app.use("/api", createApi(db));
  app.use(express.static(options.publicDir ?? join(import.meta.dirname, "public")));
  return app;
}
function resolveDbConfig() {
  if (process.env.TURSO_DATABASE_URL) {
    return { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN };
  }
  if (process.env.MA_DB_URL) {
    return { url: process.env.MA_DB_URL, authToken: process.env.MA_DB_AUTH_TOKEN };
  }
  if (process.env.MA_DB_PATH) return { url: `file:${process.env.MA_DB_PATH}` };
  return { url: `file:${join(process.cwd(), "data", "analyzer.db")}` };
}
if (import.meta.main) {
  const PORT = Number(process.env.MA_PORT ?? 4317);
  const HOST = process.env.MA_HOST ?? "127.0.0.1";
  const password = process.env.MA_PASSWORD ?? null;
  const dbConfig = resolveDbConfig();
  const db = await openDb(dbConfig.url, dbConfig.authToken);
  const app = createApp(db, { password });
  app.listen(PORT, HOST, () => {
    console.log(`Manifest Analyzer running at http://${HOST}:${PORT}`);
    console.log(`Database: ${dbConfig.url}`);
    console.log(password ? "Password login: ENABLED" : "Password login: disabled (set MA_PASSWORD to enable)");
  });
}

// src/vercel-entry.ts
var appPromise = (async () => {
  const { url, authToken } = resolveDbConfig();
  const db = await openDb(url, authToken);
  return createApp(db, {
    password: process.env.MA_PASSWORD ?? null,
    publicDir: join2(process.cwd(), "src", "ui", "public")
  });
})();
async function handler(req, res) {
  const app = await appPromise;
  app(req, res);
}
export {
  handler as default
};
