import type { ReactNode } from 'react';

export interface ChartTableColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  num?: boolean;
}

/** The same series as a table — every chart offers this view. */
export function ChartTable<T>({ rows, columns }: { rows: T[]; columns: ChartTableColumn<T>[] }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead>
          <tr>{columns.map((c) => <th key={c.header} className={c.num ? 'num' : ''}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="faint" style={{ textAlign: 'center' }}>No data in this period.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.header} className={c.num ? 'num' : ''}>{c.cell(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
