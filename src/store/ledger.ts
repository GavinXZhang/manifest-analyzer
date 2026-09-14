import type { Db } from './db.ts';

export const EXPENSE_CATEGORIES = [
  'lot-purchase',
  'freight',
  'selling-fees',
  'supplies',
  'storage',
  'mileage',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Sale {
  id: number;
  lotId: number | null;
  amount: number;
  note: string | null;
  /** YYYY-MM-DD */
  soldAt: string;
}

export interface Expense {
  id: number;
  lotId: number | null;
  amount: number;
  category: ExpenseCategory;
  note: string | null;
  auto: boolean;
  /** YYYY-MM-DD */
  spentAt: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertEntry(amount: number, date: string): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`amount must be positive, got ${amount}`);
  if (!DATE_RE.test(date)) throw new Error(`date must be YYYY-MM-DD, got "${date}"`);
}

interface SaleRow {
  id: number;
  lot_id: number | null;
  amount: number;
  note: string | null;
  sold_at: string;
}

const rowToSale = (r: SaleRow): Sale => ({ id: r.id, lotId: r.lot_id, amount: r.amount, note: r.note, soldAt: r.sold_at });

export async function addSale(
  db: Db,
  input: { lotId?: number | null; amount: number; note?: string | null; soldAt: string },
): Promise<Sale> {
  assertEntry(input.amount, input.soldAt);
  const r = await db.run('INSERT INTO sales (lot_id, amount, note, sold_at) VALUES (?, ?, ?, ?)', [
    input.lotId ?? null,
    input.amount,
    input.note ?? null,
    input.soldAt,
  ]);
  const row = await db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', [r.lastInsertRowid]);
  return rowToSale(row!);
}

export async function deleteSale(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM sales WHERE id = ?', [id]);
}

export async function listSales(db: Db): Promise<Sale[]> {
  const rows = await db.all<SaleRow>('SELECT * FROM sales ORDER BY sold_at, id');
  return rows.map(rowToSale);
}

interface ExpenseRow {
  id: number;
  lot_id: number | null;
  amount: number;
  category: string;
  note: string | null;
  auto: number;
  spent_at: string;
}

const rowToExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  lotId: r.lot_id,
  amount: r.amount,
  category: r.category as ExpenseCategory,
  note: r.note,
  auto: r.auto === 1,
  spentAt: r.spent_at,
});

export async function addExpense(
  db: Db,
  input: {
    lotId?: number | null;
    amount: number;
    category: ExpenseCategory;
    note?: string | null;
    auto?: boolean;
    spentAt: string;
  },
): Promise<Expense> {
  assertEntry(input.amount, input.spentAt);
  if (!EXPENSE_CATEGORIES.includes(input.category)) {
    throw new Error(`Unknown expense category "${input.category}"`);
  }
  const r = await db.run(
    'INSERT INTO expenses (lot_id, amount, category, note, auto, spent_at) VALUES (?, ?, ?, ?, ?, ?)',
    [input.lotId ?? null, input.amount, input.category, input.note ?? null, input.auto ? 1 : 0, input.spentAt],
  );
  const row = await db.get<ExpenseRow>('SELECT * FROM expenses WHERE id = ?', [r.lastInsertRowid]);
  return rowToExpense(row!);
}

export async function deleteExpense(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM expenses WHERE id = ?', [id]);
}

/** Auto rows for a lot are wiped and rebuilt whenever its outcome is (re)logged. */
export async function deleteAutoExpenses(db: Db, lotId: number): Promise<void> {
  await db.run('DELETE FROM expenses WHERE lot_id = ? AND auto = 1', [lotId]);
}

export async function listExpenses(db: Db): Promise<Expense[]> {
  const rows = await db.all<ExpenseRow>('SELECT * FROM expenses ORDER BY spent_at, id');
  return rows.map(rowToExpense);
}

export interface LedgerSummary {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

export async function ledgerSummary(db: Db): Promise<LedgerSummary> {
  const rev = (await db.get<{ s: number }>('SELECT COALESCE(SUM(amount), 0) AS s FROM sales'))!.s;
  const exp = (await db.get<{ s: number }>('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses'))!.s;
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  return { totalRevenue: round2(rev), totalExpenses: round2(exp), netProfit: round2(rev - exp) };
}

export interface LotPerformance {
  lotId: number;
  name: string;
  seller: string;
  wonAt: string;
  finalPrice: number | null;
  /** Sales linked to the lot; falls back to the outcome's gross-recovered figure. */
  revenue: number;
  revenueSource: 'sales-ledger' | 'outcome-gross' | 'none';
  /** All expenses linked to the lot (auto rows include bid + premium and freight). */
  cost: number;
  profit: number;
  /** profit / cost, null when cost is 0. */
  roi: number | null;
}

/** The most recent won lots, ready to rank — the "last N pallets" leaderboard. */
export async function lotPerformance(db: Db, limit = 10): Promise<LotPerformance[]> {
  const rows = await db.all<{
    id: number;
    name: string;
    seller: string;
    final_price: number | null;
    gross_recovered: number | null;
    recorded_at: string;
    sales_sum: number;
    expense_sum: number;
  }>(
    `SELECT l.id, l.name, l.seller, o.final_price, o.gross_recovered, o.recorded_at,
       COALESCE((SELECT SUM(s.amount) FROM sales s WHERE s.lot_id = l.id), 0) AS sales_sum,
       COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.lot_id = l.id), 0) AS expense_sum
     FROM outcomes o JOIN lots l ON l.id = o.lot_id
     WHERE o.won = 1
     ORDER BY o.recorded_at DESC
     LIMIT ?`,
    [limit],
  );
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  return rows.map((r) => {
    const revenue = r.sales_sum > 0 ? r.sales_sum : (r.gross_recovered ?? 0);
    const profit = round2(revenue - r.expense_sum);
    return {
      lotId: r.id,
      name: r.name,
      seller: r.seller,
      wonAt: r.recorded_at,
      finalPrice: r.final_price,
      revenue: round2(revenue),
      revenueSource: r.sales_sum > 0 ? 'sales-ledger' : r.gross_recovered !== null ? 'outcome-gross' : 'none',
      cost: round2(r.expense_sum),
      profit,
      roi: r.expense_sum > 0 ? Math.round((profit / r.expense_sum) * 1000) / 1000 : null,
    };
  });
}
