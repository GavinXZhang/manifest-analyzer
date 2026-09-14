import type { Report } from '../api/client.ts';
import { Columns } from './Columns.tsx';
import { HBars } from './HBars.tsx';
import { Funnel } from './Funnel.tsx';
import { ChartTable } from './ChartTable.tsx';
import { compact } from './scale.ts';
import { money, hours as fmtHours } from '../lib/fmt.ts';

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** Picks the right figure for a report kind; `table` renders the same data as rows. */
export function ReportChart({ report, table }: { report: Report; table: boolean }) {
  const s = report.series;
  switch (report.kind) {
    case 'revenue-goal': {
      const goal = typeof report.meta.goal === 'number' ? report.meta.goal : null;
      if (table) {
        return <ChartTable rows={s} columns={[
          { header: 'Month', cell: (r) => r.label + (num(r.extra?.toDate) ? ' · to date' : '') },
          { header: 'Revenue', num: true, cell: (r) => money(r.value, { cents: true }) },
          { header: 'Goal', num: true, cell: () => (goal !== null ? money(goal) : '—') },
          { header: 'Of goal', num: true, cell: (r) => (goal ? `${Math.round((r.value / goal) * 100)}%` : '—') },
        ]} />;
      }
      return <Columns
        data={s.map((r) => ({ key: r.key, label: r.label, value: r.value, ghost: goal, valueLabel: money(r.value), caption: num(r.extra?.toDate) ? 'to date' : undefined,
          tip: `${r.label}: ${money(r.value, { cents: true })}${goal ? ` · ${Math.round((r.value / goal) * 100)}% of ${money(goal)} goal` : ''}` }))}
        primaryLabel="Revenue" ghostLabel={goal ? `Goal ${money(goal)} / month` : undefined} />;
    }
    case 'net': {
      if (table) {
        return <ChartTable rows={s} columns={[
          { header: 'Month', cell: (r) => r.label },
          { header: 'Revenue', num: true, cell: (r) => money(num(r.extra?.revenue), { cents: true }) },
          { header: 'Fees', num: true, cell: (r) => money(num(r.extra?.fees), { cents: true }) },
          { header: 'Expenses', num: true, cell: (r) => money(num(r.extra?.expenses), { cents: true }) },
          { header: 'Net', num: true, cell: (r) => <span className={r.value < 0 ? 'down' : ''}>{money(r.value, { cents: true })}</span> },
        ]} />;
      }
      return <Columns primaryLabel="Net profit"
        data={s.map((r) => ({ key: r.key, label: r.label, value: r.value, valueLabel: money(r.value),
          tip: `${r.label}: net ${money(r.value, { cents: true })} · revenue ${money(num(r.extra?.revenue))} − fees ${money(num(r.extra?.fees))} − expenses ${money(num(r.extra?.expenses))}` }))} />;
    }
    case 'funnel': {
      if (table) {
        return <ChartTable rows={s} columns={[
          { header: 'Stage', cell: (r) => r.label },
          { header: 'Lots', num: true, cell: (r) => r.value },
          { header: 'From previous', num: true, cell: (r) => (r.extra?.fromPrevious === null || r.extra?.fromPrevious === undefined ? '—' : `${r.extra.fromPrevious}%`) },
        ]} />;
      }
      return <Funnel data={s.map((r) => ({ key: r.key, label: r.label, value: r.value, fromPrevious: typeof r.extra?.fromPrevious === 'number' ? r.extra.fromPrevious : null }))} />;
    }
    case 'cycle': {
      if (table) {
        return <ChartTable rows={s} columns={[
          { header: 'Stage', cell: (r) => r.label },
          { header: 'Avg days', num: true, cell: (r) => r.value },
          { header: 'Lots', num: true, cell: (r) => num(r.extra?.lots) },
        ]} />;
      }
      return <HBars format={(v) => `${Math.round(v)} d`} data={s.map((r) => ({ key: r.key, label: r.label, value: r.value, valueLabel: `${r.value} d`,
        tip: `${r.label}: average ${r.value} day${r.value === 1 ? '' : 's'} (based on ${num(r.extra?.lots)} lot${num(r.extra?.lots) === 1 ? '' : 's'})` }))} />;
    }
    case 'hours': {
      if (table) {
        return <ChartTable rows={s.filter((r) => r.value > 0)} columns={[
          { header: 'Day', cell: (r) => r.key },
          { header: 'Hours', num: true, cell: (r) => fmtHours(r.value) },
        ]} />;
      }
      return <Columns primaryLabel="Hours" labels={false} yFormat={(v) => `${Math.round(v * 10) / 10}h`}
        data={s.map((r) => ({ key: r.key, label: r.label, value: r.value, tip: `${r.key}: ${fmtHours(r.value)}` }))} />;
    }
    case 'storage': {
      if (table) {
        return <ChartTable rows={s} columns={[
          { header: 'Month', cell: (r) => r.label },
          { header: 'Storage', num: true, cell: (r) => money(r.value, { cents: true }) },
          { header: 'Revenue', num: true, cell: (r) => money(num(r.extra?.revenue), { cents: true }) },
          { header: 'Storage ÷ revenue', num: true, cell: (r) => (num(r.extra?.revenue) > 0 ? `${Math.round((r.value / num(r.extra?.revenue)) * 100)}%` : '—') },
        ]} />;
      }
      return <Columns primaryLabel="Storage cost" secondaryLabel="Revenue" yFormat={compact}
        data={s.map((r) => ({ key: r.key, label: r.label, value: r.value, valueLabel: money(r.value), secondary: num(r.extra?.revenue),
          tip: `${r.label}: storage ${money(r.value, { cents: true })} · revenue ${money(num(r.extra?.revenue))}` }))} />;
    }
  }
}
