import { useTooltip } from './tooltip.ts';
import { FRAME, SERIES, niceMax, ticks } from './scale.ts';

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  /** % of the previous stage that reached this one (null for the first). */
  fromPrevious: number | null;
}

/** Stage columns with the stage-to-stage conversion shown between them. */
export function Funnel({ data }: { data: FunnelStage[] }) {
  const { show, hide } = useTooltip();
  const f = FRAME;
  const n = Math.max(1, data.length);
  const plotW = f.w - f.padL - f.padR;
  const plotH = f.h - f.padT - f.padB;
  const maxV = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const y = (v: number) => f.padT + ((maxV - v) / maxV) * plotH;
  const slot = plotW / n;
  const barW = Math.min(110, slot * 0.5);
  const x = (i: number) => f.padL + slot * i + slot / 2;
  const base = f.h - f.padB;

  return (
    <svg className="chart" viewBox={`0 0 ${f.w} ${f.h}`} role="img">
      {ticks(maxV, 4).map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'baseline' : 'grid'} x1={f.padL} x2={f.w - f.padR} y1={y(t)} y2={y(t)} />
          <text className="axis" x={f.padL - 8} y={y(t) + 4} textAnchor="end">{Math.round(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = x(i);
        const h = base - y(d.value);
        const prev = i > 0 ? data[i - 1] : null;
        return (
          <g key={d.key} onMouseMove={(e) => show(e, `${d.label}: ${d.value} lot${d.value === 1 ? '' : 's'}${prev ? ` · ${d.fromPrevious ?? 0}% of ${prev.label.toLowerCase()}` : ''}`)} onMouseLeave={hide}>
            <rect x={cx - slot / 2} y={f.padT} width={slot} height={plotH} fill="transparent" />
            {h > 0 ? <rect x={cx - barW / 2} y={y(d.value)} width={barW} height={h} rx={4} fill={SERIES} /> : <rect x={cx - barW / 2} y={base - 2} width={barW} height={2} fill={SERIES} />}
            <text className="label" x={cx} y={y(d.value) - 6} textAnchor="middle">{d.value}</text>
            <text className="axis" x={cx} y={f.h - f.padB + 16} textAnchor="middle">{d.label}</text>
            {prev ? (
              <g>
                <rect x={cx - slot / 2 - 22} y={f.padT + 2} width={44} height={18} rx={9} fill="#eceef2" />
                <text x={cx - slot / 2} y={f.padT + 15} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: 'var(--ink-2)' }}>
                  {d.fromPrevious === null ? '—' : `${d.fromPrevious}% ›`}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
