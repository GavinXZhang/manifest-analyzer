import { useTooltip } from './tooltip.ts';
import { FRAME, GHOST, SECONDARY, SERIES, SERIES_SOFT, compact, labelIndexes, niceMax, ticks } from './scale.ts';

export interface Column {
  key: string;
  label: string;
  value: number;
  /** Ghost bar behind the column (a goal/target), in the same units. */
  ghost?: number | null;
  /** Value label drawn above the column (omit for none). */
  valueLabel?: string;
  /** Tooltip text. */
  tip?: string;
  /** Small caption under the x label ("to date"). */
  caption?: string;
  /** Second series point (drawn as a line with markers on the same axis). */
  secondary?: number;
}

export interface ColumnsProps {
  data: Column[];
  yFormat?: (v: number) => string;
  /** Dashed reference line, e.g. the monthly goal. */
  goal?: number | null;
  /** Legend entry for the secondary series (required when any column has one). */
  secondaryLabel?: string;
  primaryLabel?: string;
  ghostLabel?: string;
  /** Show a value label on every column (fine for ≤ 12 columns). */
  labels?: boolean;
  height?: number;
}

/**
 * Vertical columns on one y-axis. Handles negative values (zero baseline),
 * ghost/goal bars, and an optional secondary line series.
 */
export function Columns({ data, yFormat = compact, goal = null, secondaryLabel, primaryLabel = 'Value', ghostLabel, labels = true, height }: ColumnsProps) {
  const { show, hide } = useTooltip();
  const f = { ...FRAME, h: height ?? FRAME.h };
  const n = Math.max(1, data.length);
  const plotW = f.w - f.padL - f.padR;
  const plotH = f.h - f.padT - f.padB;

  const values = data.flatMap((d) => [d.value, d.ghost ?? 0, d.secondary ?? 0]);
  if (goal !== null) values.push(goal);
  const maxV = niceMax(Math.max(0, ...values));
  const minRaw = Math.min(0, ...data.map((d) => d.value));
  const minV = minRaw < 0 ? -niceMax(-minRaw) : 0;
  const span = maxV - minV || 1;
  const y = (v: number) => f.padT + ((maxV - v) / span) * plotH;
  const zeroY = y(0);

  const slot = plotW / n;
  const barW = Math.max(6, Math.min(120, slot * 0.6));
  const ghostW = Math.min(slot * 0.82, barW + 24);
  const x = (i: number) => f.padL + slot * i + slot / 2;
  const showLabels = labelIndexes(n, 5);
  const hasGhost = data.some((d) => d.ghost !== null && d.ghost !== undefined && d.ghost > 0);
  const hasSecondary = data.some((d) => d.secondary !== undefined);

  const tickVals = [...ticks(maxV, 4), ...(minV < 0 ? ticks(minV, 2).slice(1) : [])];

  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${f.w} ${f.h}`} role="img">
        {tickVals.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'baseline' : 'grid'} x1={f.padL} x2={f.w - f.padR} y1={y(t)} y2={y(t)} />
            <text className="axis" x={f.padL - 8} y={y(t) + 4} textAnchor="end">{yFormat(t)}</text>
          </g>
        ))}
        {goal !== null && goal > 0 ? (
          <line x1={f.padL} x2={f.w - f.padR} y1={y(goal)} y2={y(goal)} stroke={SECONDARY} strokeDasharray="4 3" />
        ) : null}
        {data.map((d, i) => {
          const cx = x(i);
          const top = Math.min(y(d.value), zeroY);
          const h = Math.abs(y(d.value) - zeroY);
          const neg = d.value < 0;
          const tipText = d.tip ?? `${d.label}: ${yFormat(d.value)}`;
          return (
            <g key={d.key} onMouseMove={(e) => show(e, tipText)} onMouseLeave={hide}>
              <rect x={cx - slot / 2} y={f.padT} width={slot} height={plotH} fill="transparent" />
              {d.ghost !== null && d.ghost !== undefined && d.ghost > 0 ? (
                <rect x={cx - ghostW / 2} y={y(d.ghost)} width={ghostW} height={zeroY - y(d.ghost)} rx={4} fill={GHOST} />
              ) : null}
              {h > 0 ? (
                <>
                  <rect x={cx - barW / 2} y={top} width={barW} height={Math.max(2, h)} rx={4} fill={neg ? SERIES_SOFT : SERIES} />
                  {/* square off the end that sits on the baseline so only the data end is rounded */}
                  <rect x={cx - barW / 2} y={neg ? zeroY : zeroY - Math.min(4, h)} width={barW} height={Math.min(4, h)} fill={neg ? SERIES_SOFT : SERIES} />
                </>
              ) : (
                <rect x={cx - barW / 2} y={zeroY - 1} width={barW} height={2} fill={SERIES_SOFT} />
              )}
              {labels && d.valueLabel ? (
                <text className="label" x={cx} y={neg ? y(d.value) + 14 : top - 6} textAnchor="middle">{d.valueLabel}</text>
              ) : null}
              {showLabels.has(i) ? (
                <text className="axis" x={cx} y={f.h - f.padB + 16} textAnchor="middle">{d.label}{d.caption ? ` · ${d.caption}` : ''}</text>
              ) : null}
            </g>
          );
        })}
        {hasSecondary ? (
          <>
            <polyline fill="none" stroke={SECONDARY} strokeWidth={2} points={data.map((d, i) => `${x(i)},${y(d.secondary ?? 0)}`).join(' ')} />
            {data.map((d, i) => (
              <circle key={`${d.key}-s`} cx={x(i)} cy={y(d.secondary ?? 0)} r={4} fill={SECONDARY} stroke="#fff" strokeWidth={2}
                onMouseMove={(e) => show(e, `${d.label} · ${secondaryLabel ?? 'secondary'}: ${yFormat(d.secondary ?? 0)}`)} onMouseLeave={hide} />
            ))}
          </>
        ) : null}
      </svg>
      {hasGhost || hasSecondary || goal !== null ? (
        <div className="legend" style={{ padding: '4px 0 0 56px' }}>
          <span><span className="sw" style={{ background: SERIES }} />{primaryLabel}</span>
          {hasGhost ? <span><span className="sw" style={{ background: GHOST }} />{ghostLabel ?? 'Goal'}</span> : null}
          {goal !== null && goal > 0 && !hasGhost ? <span><span className="sw" style={{ background: 'transparent', borderTop: `2px dashed ${SECONDARY}`, height: 0, verticalAlign: '3px' }} />Goal {yFormat(goal)}</span> : null}
          {hasSecondary ? <span><span className="sw" style={{ background: SECONDARY, borderRadius: 5 }} />{secondaryLabel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
