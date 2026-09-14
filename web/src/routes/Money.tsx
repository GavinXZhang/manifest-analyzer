import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Period, type ReportKind, type RecurringExpense, type ExpenseCategory, type MoneyResponse } from '../api/client.ts';
import { useApi, useAction } from '../lib/useApi.ts';
import { money, pct, hours, shortDate, todayIso } from '../lib/fmt.ts';
import { Card, CardHead, Kpi, Segmented, Loading, ErrorBox, Field, Toggle, Pill } from '../components/ui.tsx';
import { ReportChart } from '../charts/ReportChart.tsx';
import { TimeCard } from './TimeCard.tsx';

const PERIODS: { value: Period; label: string }[] = [
  { value: '30d', label: '30d' }, { value: '90d', label: '90d' }, { value: 'ytd', label: 'YTD' }, { value: 'all', label: 'All' },
];
const KINDS: { value: ReportKind; label: string }[] = [
  { value: 'revenue-goal', label: 'Revenue vs goal' }, { value: 'net', label: 'Net profit' }, { value: 'funnel', label: 'Funnel' },
  { value: 'cycle', label: 'Cycle time' }, { value: 'hours', label: 'Hours' }, { value: 'storage', label: 'Storage' },
];
const PERIOD_WORD: Record<Period, string> = { '30d': '30d', '90d': '90d', ytd: 'YTD', all: 'all time' };
const EXPORTS = ['sales', 'expenses', 'inventory', 'listings', 'lots', 'punches'];

function delta(card: { delta: number | null }, period: Period, badWhenUp = false): { text: string; tone: 'up' | 'down' | 'flat' } | undefined {
  if (period === 'all' || card.delta === null) return undefined;
  const up = card.delta >= 0;
  const good = badWhenUp ? !up : up;
  return { text: `${up ? '▲' : '▼'} ${Math.abs(Math.round(card.delta * 100))}% vs prior ${PERIOD_WORD[period]}`, tone: card.delta === 0 ? 'flat' : good ? 'up' : 'down' };
}

export function Money() {
  const [period, setPeriod] = useState<Period>((localStorage.getItem('money.period') as Period) || '90d');
  const [lot, setLot] = useState<string>('');
  const [kind, setKind] = useState<ReportKind>('revenue-goal');
  const [table, setTable] = useState(false);
  const [form, setForm] = useState<'sale' | 'expense' | null>(null);
  const [exportsOpen, setExportsOpen] = useState(false);
  const lotId = lot === '' ? null : Number(lot);

  const lots = useApi(() => api.lots());
  const summary = useApi(() => api.money(period, lotId), [period, lotId]);
  const report = useApi(() => api.report(kind, period, lotId), [kind, period, lotId]);
  const ledger = useApi(() => api.ledger());
  const reloadAll = async () => { await Promise.all([summary.reload(), report.reload(), ledger.reload()]); };
  const act = useAction(reloadAll);

  const choosePeriod = (p: Period) => { setPeriod(p); localStorage.setItem('money.period', p); };
  const s = summary.data;

  return (
    <main className="page">
      <div className="page-head">
        <h1>Money</h1>
        <div className="actions">
          <Segmented value={period} options={PERIODS} onChange={choosePeriod} />
          <select className="input sm" style={{ width: 170 }} value={lot} onChange={(e) => setLot(e.target.value)}>
            <option value="">Lot: all</option>
            {(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className={`btn ${form === 'sale' ? 'primary' : ''}`} onClick={() => setForm(form === 'sale' ? null : 'sale')}>Log sale</button>
          <button className={`btn ${form === 'expense' ? 'primary' : ''}`} onClick={() => setForm(form === 'expense' ? null : 'expense')}>Log expense</button>
          <span style={{ position: 'relative' }}>
            <button className="btn" onClick={() => setExportsOpen((v) => !v)}>Export CSV ▾</button>
            {exportsOpen ? (
              <div className="card stack" style={{ position: 'absolute', right: 0, top: 36, zIndex: 10, gap: 4, padding: 8, minWidth: 150 }}>
                {EXPORTS.map((t) => <a key={t} className="btn sm ghost" style={{ justifyContent: 'flex-start' }} href={`/api/export/${t}.csv`} onClick={() => setExportsOpen(false)}>{t}.csv</a>)}
              </div>
            ) : null}
          </span>
        </div>
      </div>
      <ErrorBox error={summary.error ?? act.error} />

      {form ? (
        <LedgerForm kind={form} lots={lots.data ?? []} categories={ledger.data?.categories ?? []} busy={act.busy}
          onCancel={() => setForm(null)}
          onSave={async (body) => {
            const r = await act.run<unknown>(() =>
              form === 'sale' ? api.addSale(body as Parameters<typeof api.addSale>[0]) : api.addExpense(body as Parameters<typeof api.addExpense>[0]),
            );
            if (r) setForm(null);
          }} />
      ) : null}

      {!s ? <Loading /> : (
        <div className="grid-5">
          <Kpi label="Revenue" value={money(s.revenue.value)} delta={delta(s.revenue, period)} sub={s.fees.value > 0 ? `${money(s.fees.value)} in fees` : undefined} />
          <Kpi label="Expenses" value={money(s.expenses.value)} delta={delta(s.expenses, period, true)} />
          <Kpi label="Net profit" value={<span className={s.netProfit.value < 0 ? 'down' : ''}>{money(s.netProfit.value)}</span>} delta={delta(s.netProfit, period)} sub="after fees" />
          <Kpi label="Profit / hour" value={money(s.profitPerHour.value)} delta={delta(s.profitPerHour, period)} sub={`${hours(s.hours.value)} logged`} />
          <Kpi label="Sell-through" value={s.sellThrough.rate === null ? '—' : pct(s.sellThrough.rate)}
            sub={s.sellThrough.total > 0 ? `${s.sellThrough.sold} of ${s.sellThrough.total} units${s.sellThrough.avgDaysToSell !== null ? ` · avg ${s.sellThrough.avgDaysToSell} days to sell` : ''}` : 'no units received in period'} />
        </div>
      )}

      <Card flush>
        <div className="between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
          <Segmented bare value={kind} options={KINDS} onChange={setKind} />
          <button className={`btn sm ${table ? 'primary' : ''}`} onClick={() => setTable((v) => !v)}>Table</button>
        </div>
        <div style={{ padding: '12px 16px 12px' }}>
          {report.error ? <ErrorBox error={report.error} /> : !report.data ? <Loading /> : (
            <>
              <div className="row" style={{ marginBottom: 8, alignItems: 'baseline' }}>
                <b>{report.data.headline}</b>
                {kind === 'revenue-goal' && report.data.meta.goal === null ? <Link to="/settings" className="small">Set a goal →</Link> : null}
              </div>
              <ReportChart report={report.data} table={table} />
            </>
          )}
        </div>
      </Card>

      <div className="split">
        <TimeCard lots={lots.data ?? []} onChange={() => void summary.reload()} />
        <div className="stack" style={{ gap: 16 }}>
          <Recurring onChange={reloadAll} />
          {s ? <Scoreboard s={s} onChange={reloadAll} /> : null}
          {ledger.data ? <RecentLedger sales={ledger.data.sales} expenses={ledger.data.expenses} busy={act.busy}
            onDeleteSale={(id) => act.run(() => api.deleteSale(id))} onDeleteExpense={(id) => act.run(() => api.deleteExpense(id))} /> : null}
        </div>
      </div>
    </main>
  );
}

function LedgerForm({ kind, lots, categories, busy, onSave, onCancel }: {
  kind: 'sale' | 'expense'; lots: { id: number; name: string }[]; categories: readonly ExpenseCategory[]; busy: boolean;
  onSave: (body: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [lotId, setLotId] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('supplies');
  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && date;
  return (
    <Card>
      <CardHead title={kind === 'sale' ? 'Log a sale' : 'Log an expense'} sub={kind === 'sale' ? 'For sales from inventory, use "Mark sold" on the item so fees and quantity are tracked.' : undefined} />
      <div className="form-grid">
        <Field label="Amount"><input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === 'expense' ? (
          <Field label="Category">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Lot">
          <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">No lot</option>
            {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'sale' ? 'What sold, where' : 'Boxes, tape…'} /></Field>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!valid || busy} onClick={() => onSave(kind === 'sale'
          ? { amount: n, soldAt: date, lotId: lotId === '' ? null : Number(lotId), note: note || null }
          : { amount: n, spentAt: date, category, lotId: lotId === '' ? null : Number(lotId), note: note || null })}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  );
}

const nextDue = (dueDay: number, today: string): string => {
  const [y, m, d] = today.split('-').map(Number);
  const due = d <= dueDay ? new Date(Date.UTC(y, m - 1, dueDay)) : new Date(Date.UTC(y, m, dueDay));
  return due.toISOString().slice(0, 10);
};

function Recurring({ onChange }: { onChange: () => Promise<void> }) {
  const rec = useApi(() => api.recurring());
  const inv = useApi(() => api.inventory());
  const act = useAction(async () => { await rec.reload(); await onChange(); });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [form, setForm] = useState({ name: '', amount: '', dueDay: '1', category: 'storage' as ExpenseCategory });
  const categories: ExpenseCategory[] = ['storage', 'supplies', 'selling-fees', 'mileage', 'other'];
  const rate = inv.data?.summary.carryingRatePerItemDay ?? 0;

  const startEdit = (r: RecurringExpense) => { setEditing(r); setForm({ name: r.name, amount: String(r.amount), dueDay: String(r.dueDay), category: r.category }); setAdding(true); };
  const save = async () => {
    const body = { name: form.name.trim(), amount: Number(form.amount), dueDay: Number(form.dueDay), category: form.category };
    const r = await act.run(() => (editing ? api.updateRecurring(editing.id, body) : api.addRecurring(body)));
    if (r) { setAdding(false); setEditing(null); setForm({ name: '', amount: '', dueDay: '1', category: 'storage' }); }
  };
  const valid = form.name.trim() && Number(form.amount) > 0 && Number(form.dueDay) >= 1 && Number(form.dueDay) <= 28;

  return (
    <Card>
      <CardHead title="Storage & recurring" right={<button className="btn sm" onClick={() => { setEditing(null); setAdding((v) => !v); }}>+ Add</button>} />
      <ErrorBox error={rec.error ?? act.error} />
      {adding ? (
        <div className="stack" style={{ marginBottom: 10 }}>
          <div className="form-grid">
            <Field label="Name"><input className="input sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Extra Space 5×10" /></Field>
            <Field label="$ / month"><input className="input sm num" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Due day (1–28)"><input className="input sm num" inputMode="numeric" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} /></Field>
            <Field label="Category">
              <select className="input sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <button className="btn sm primary" disabled={!valid || act.busy} onClick={save}>{editing ? 'Save' : 'Add'}</button>
            <button className="btn sm ghost" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</button>
          </div>
        </div>
      ) : null}
      <div className="stack">
        {!rec.data ? <Loading /> : rec.data.recurring.length === 0 ? (
          <div className="muted small">No recurring costs yet. Add storage rent and it posts itself to the ledger every month.</div>
        ) : rec.data.recurring.map((r) => {
          const due = nextDue(r.dueDay, rec.data!.today);
          const soon = r.active && (Date.parse(due) - Date.parse(rec.data!.today)) / 86_400_000 <= 3;
          return (
            <div key={r.id} className="between" style={{ opacity: r.active ? 1 : 0.6 }}>
              <span style={{ minWidth: 0 }}>
                <b>{r.name}</b>
                <div className="muted tiny">{money(r.amount)} / mo · {r.category} · posts on the {r.dueDay}{ordinal(r.dueDay)} · auto{r.lastPeriod ? ` · last ${r.lastPeriod}` : ''}</div>
              </span>
              <span className="row nowrap">
                {r.active ? <Pill tone={soon ? 'warn' : 'gray'}>{due === rec.data!.today ? 'due today' : `due ${shortDate(due)}`}</Pill> : <Pill tone="gray">paused</Pill>}
                <Toggle on={r.active} label="Active" onChange={(v) => act.run(() => api.updateRecurring(r.id, { active: v }))} />
                <button className="btn sm ghost" onClick={() => startEdit(r)}>Edit</button>
                <button className="btn sm ghost" aria-label="Delete" onClick={() => { if (confirm(`Delete ${r.name}? Past postings stay in the ledger.`)) void act.run(() => api.deleteRecurring(r.id)); }}>✕</button>
              </span>
            </div>
          );
        })}
        {rec.data ? (
          <div className="between small" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
            <span className="muted">Burn</span>
            <b>{money(rec.data.burn.monthly)} / mo{rec.data.burn.storageMonthly > 0 ? ` · ${money(rate, { cents: true })} per item-day` : ''}</b>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

const ordinal = (n: number): string => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

function Scoreboard({ s, onChange }: { s: MoneyResponse; onChange: () => Promise<void> }) {
  const cal = useApi(() => api.calibration());
  const act = useAction(async () => { await cal.reload(); await onChange(); });
  return (
    <Card>
      <CardHead title="Predicted vs actual" sub={`Labor at ${money(s.hourlyValue)} / hr`} right={<Link to="/settings" className="small">Calibration →</Link>} />
      <ErrorBox error={act.error} />
      {s.scoreboard.length === 0 ? <div className="muted small">No won lots yet.</div> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Lot</th><th className="num">Predicted</th><th className="num">Actual</th><th className="num">Labor</th><th className="num">Cycle</th><th className="num">Δ</th></tr></thead>
            <tbody>
              {s.scoreboard.map((r) => {
                const d = r.predictedRevenue && r.predictedRevenue > 0 ? (r.actualRevenue - r.predictedRevenue) / r.predictedRevenue : null;
                return (
                  <tr key={r.lotId}>
                    <td><Link to={`/lots/${r.lotId}`}>{r.name}</Link><div className="faint tiny">{r.stageLabel}</div></td>
                    <td className="num">{money(r.predictedRevenue)}</td>
                    <td className="num">{money(r.actualRevenue)}{r.stage !== 'closed' ? <span className="faint tiny"> so far</span> : null}</td>
                    <td className="num">{r.laborHours > 0 ? <>{money(r.laborCost)}<div className="faint tiny">{hours(r.laborHours)}</div></> : '—'}</td>
                    <td className="num">{r.cycleDays !== null ? `${r.cycleDays}d` : '—'}</td>
                    <td className={`num ${d === null ? 'faint' : d >= 0 ? 'up' : 'down'}`}>{d === null ? '—' : `${d >= 0 ? '+' : ''}${Math.round(d * 100)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cal.data && cal.data.length > 0 ? (
        <div className="stack" style={{ marginTop: 10, gap: 6 }}>
          <div className="micro">Calibration suggestions</div>
          {cal.data.map((c) => (
            <div key={`${c.seller}-${c.category}`} className="between small">
              <span>{c.seller} · {c.category}: multiplier {c.currentMultiplier} → <b>{c.suggestedMultiplier}</b> <span className="muted">({c.sampleSize} outcomes)</span></span>
              <button className="btn sm" disabled={act.busy} onClick={() => act.run(() => api.applyCalibration({ seller: c.seller, category: c.category, multiplier: c.suggestedMultiplier }))}>Apply</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="muted tiny" style={{ marginTop: 10, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
        Tax set-aside {s.tax.year}: <b>{money(s.tax.totalSetAside)}</b> · rate {pct(s.tax.setAsideRate)} on {money(s.tax.netProfit)} net
      </div>
    </Card>
  );
}

function RecentLedger({ sales, expenses, busy, onDeleteSale, onDeleteExpense }: {
  sales: { id: number; amount: number; fees: number; note: string | null; soldAt: string }[];
  expenses: { id: number; amount: number; category: string; note: string | null; spentAt: string; auto: boolean }[];
  busy: boolean; onDeleteSale: (id: number) => void; onDeleteExpense: (id: number) => void;
}) {
  const recentSales = [...sales].sort((a, b) => b.soldAt.localeCompare(a.soldAt) || b.id - a.id).slice(0, 8);
  const recentExpenses = [...expenses].sort((a, b) => b.spentAt.localeCompare(a.spentAt) || b.id - a.id).slice(0, 8);
  return (
    <Card>
      <CardHead title="Recent activity" />
      <div className="grid-2">
        <div className="stack" style={{ gap: 4 }}>
          <div className="micro">Sales</div>
          {recentSales.length === 0 ? <div className="muted small">None yet.</div> : recentSales.map((x) => (
            <div key={x.id} className="between small">
              <span className="ellipsis"><span className="faint">{shortDate(x.soldAt)}</span> {x.note ?? 'Sale'}</span>
              <span className="row nowrap"><b>{money(x.amount)}</b>{x.fees > 0 ? <span className="faint tiny">−{money(x.fees)} fees</span> : null}<button className="btn sm ghost" disabled={busy} aria-label="Delete" onClick={() => { if (confirm('Delete this sale?')) onDeleteSale(x.id); }}>✕</button></span>
            </div>
          ))}
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <div className="micro">Expenses</div>
          {recentExpenses.length === 0 ? <div className="muted small">None yet.</div> : recentExpenses.map((x) => (
            <div key={x.id} className="between small">
              <span className="ellipsis"><span className="faint">{shortDate(x.spentAt)}</span> {x.note ?? x.category}{x.auto ? <span className="faint tiny"> · auto</span> : null}</span>
              <span className="row nowrap"><b>{money(x.amount)}</b><button className="btn sm ghost" disabled={busy} aria-label="Delete" onClick={() => { if (confirm('Delete this expense?')) onDeleteExpense(x.id); }}>✕</button></span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
