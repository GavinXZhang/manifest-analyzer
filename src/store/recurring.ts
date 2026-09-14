import type { Db } from './db.ts';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from './ledger.ts';

/** A cost that repeats monthly (storage rent, software, …) and posts itself to the ledger. */
export interface RecurringExpense {
  id: number;
  name: string;
  amount: number;
  category: ExpenseCategory;
  /** Day of month it is due (1–28 so every month has one). */
  dueDay: number;
  active: boolean;
  /** YYYY-MM of the last period posted; null → never posted. */
  lastPeriod: string | null;
  note: string | null;
  createdAt: string;
}

interface Row {
  id: number; name: string; amount: number; category: string; due_day: number; active: number;
  last_period: string | null; note: string | null; created_at: string;
}

const toRecurring = (r: Row): RecurringExpense => ({
  id: r.id,
  name: r.name,
  amount: r.amount,
  category: r.category as ExpenseCategory,
  dueDay: r.due_day,
  active: r.active === 1,
  lastPeriod: r.last_period,
  note: r.note,
  createdAt: r.created_at,
});

function validate(r: { name: string; amount: number; category: string; dueDay: number }): void {
  if (!r.name.trim()) throw new Error('name is required');
  if (!Number.isFinite(r.amount) || r.amount <= 0) throw new Error('amount must be positive');
  if (!EXPENSE_CATEGORIES.includes(r.category as ExpenseCategory)) throw new Error(`Unknown expense category "${r.category}"`);
  if (!Number.isInteger(r.dueDay) || r.dueDay < 1 || r.dueDay > 28) throw new Error('dueDay must be 1–28 (so every month has one)');
}

export async function addRecurring(
  db: Db,
  input: { name: string; amount: number; category?: ExpenseCategory; dueDay: number; note?: string | null; createdAt?: string },
): Promise<RecurringExpense> {
  const category = input.category ?? 'storage';
  validate({ ...input, category });
  const r = await db.run(
    `INSERT INTO recurring_expenses (name, amount, category, due_day, active, last_period, note, created_at)
     VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`,
    [input.name.trim(), input.amount, category, input.dueDay, input.note ?? null, input.createdAt ?? new Date().toISOString()],
  );
  return (await getRecurring(db, r.lastInsertRowid))!;
}

export async function updateRecurring(
  db: Db,
  id: number,
  patch: Partial<Pick<RecurringExpense, 'name' | 'amount' | 'category' | 'dueDay' | 'active' | 'note'>>,
): Promise<RecurringExpense> {
  const existing = await getRecurring(db, id);
  if (!existing) throw new Error(`No recurring expense ${id}`);
  const merged = { ...existing, ...patch };
  validate(merged);
  await db.run(
    'UPDATE recurring_expenses SET name = ?, amount = ?, category = ?, due_day = ?, active = ?, note = ? WHERE id = ?',
    [merged.name.trim(), merged.amount, merged.category, merged.dueDay, merged.active ? 1 : 0, merged.note, id],
  );
  return (await getRecurring(db, id))!;
}

export async function deleteRecurring(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM recurring_expenses WHERE id = ?', [id]);
}

export async function getRecurring(db: Db, id: number): Promise<RecurringExpense | null> {
  const r = await db.get<Row>('SELECT * FROM recurring_expenses WHERE id = ?', [id]);
  return r ? toRecurring(r) : null;
}

export async function listRecurring(db: Db): Promise<RecurringExpense[]> {
  const rows = await db.all<Row>('SELECT * FROM recurring_expenses ORDER BY due_day, id');
  return rows.map(toRecurring);
}

function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // month is 1-based here, so this is next month
  return d.toISOString().slice(0, 7);
}

/**
 * Post every period that is due and not yet posted, one expense per period,
 * dated to the due day. Idempotent: running it twice in a month posts nothing
 * the second time; skipping a month back-fills it on the next run.
 */
export async function postDueRecurring(db: Db, today: string = new Date().toISOString().slice(0, 10)): Promise<number> {
  const currentPeriod = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  let posted = 0;
  for (const r of await listRecurring(db)) {
    if (!r.active) continue;
    let period = r.lastPeriod ? nextPeriod(r.lastPeriod) : r.createdAt.slice(0, 7);
    while (period < currentPeriod || (period === currentPeriod && dayOfMonth >= r.dueDay)) {
      const spentAt = `${period}-${String(r.dueDay).padStart(2, '0')}`;
      await db.batch([
        {
          sql: 'INSERT INTO expenses (lot_id, amount, category, note, auto, spent_at, recurring_id) VALUES (NULL, ?, ?, ?, 1, ?, ?)',
          args: [r.amount, r.category, `${r.name} (auto)`, spentAt, r.id],
        },
        { sql: 'UPDATE recurring_expenses SET last_period = ? WHERE id = ?', args: [period, r.id] },
      ]);
      posted += 1;
      period = nextPeriod(period);
    }
  }
  return posted;
}

export interface Burn {
  monthly: number;
  storageMonthly: number;
}

/** Monthly total of active recurring costs, and the storage-only share used for carrying cost. */
export async function monthlyBurn(db: Db): Promise<Burn> {
  const active = (await listRecurring(db)).filter((r) => r.active);
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  return {
    monthly: round2(active.reduce((s, r) => s + r.amount, 0)),
    storageMonthly: round2(active.filter((r) => r.category === 'storage').reduce((s, r) => s + r.amount, 0)),
  };
}
