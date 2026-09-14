import { useTooltip } from './tooltip.ts';
import { SERIES, niceMax, ticks } from './scale.ts';

export interface HBar {
  key: string;
  label: string;
  value: number;
  valueLabel?: string;
  tip?: string;
}

/** Horizontal bars — one row per category (cycle time per stage). */
export function HBars({ data, format = (v) => `${Math.round(v)}` }: { data: HBar[]; format?: (v: number) => string }) {
  const { show, hide } = useTooltip();
  const w = 1120;
  const padL = 170;
  const padR = 60;
  const rowH = 38;
  const padT = 14;
  const padB = 26;
  const h = padT + padB + rowH * Math.max(1, data.length);
  const plotW = w - padL - padR;
  const maxV = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const x = (v: number) => padL + (v / maxV) * plotW;

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img">
      {ticks(maxV, 4).map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'baseline' : 'grid'} x1={x(t)} x2={x(t)} y1={padT} y2={h - padB} />
          <text className="axis" x={x(t)} y={h - padB + 16} textAnchor="middle">{format(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cy = padT + rowH * i + rowH / 2;
        const bw = Math.max(0, x(d.value) - padL);
        return (
          <g key={d.key} onMouseMove={(e) => show(e, d.tip ?? `${d.label}: ${format(d.value)}`)} onMouseLeave={hide}>
            <rect x={0} y={cy - rowH / 2} width={w} height={rowH} fill="transparent" />
            <text className="axis" x={padL - 10} y={cy + 4} textAnchor="end" style={{ fontSize: 12.5, fill: 'var(--ink)' }}>{d.label}</text>
            {bw > 0 ? <rect x={padL} y={cy - 9} width={bw} height={18} rx={4} fill={SERIES} /> : <rect x={padL} y={cy - 1} width={2} height={2} fill={SERIES} />}
            <text className="label" x={padL + bw + 8} y={cy + 4}>{d.valueLabel ?? format(d.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}
