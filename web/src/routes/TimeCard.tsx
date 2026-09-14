import { useEffect, useState } from 'react';
import { api, type Punch, type PunchCategory, type TimeCard as TimeCardData, type LotListRow } from '../api/client.ts';
import { useApi, useAction } from '../lib/useApi.ts';
import { money, hours, dayName, shortDate, timeOf, todayIso } from '../lib/fmt.ts';
import { Card, CardHead, Pill, ErrorBox, Loading, Field } from '../components/ui.tsx';

export const CATEGORY_LABEL: Record<PunchCategory, string> = {
  receiving: 'Receiving', testing: 'Testing', listing: 'Listing', photos: 'Photos', shipping: 'Shipping', driving: 'Driving', admin: 'Admin', other: 'Other',
};

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Local "YYYY-MM-DDTHH:MM" → ISO instant. */
const localToIso = (local: string): string => new Date(local).toISOString();
/** ISO instant → local "YYYY-MM-DDTHH:MM" for datetime-local inputs. */
const isoToLocal = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** The week time card: punch clock, Mon–Sun grid, hours by task, punch log. */
export function TimeCard({ lots, onChange }: { lots: LotListRow[]; onChange?: () => void }) {
  const [anchor, setAnchor] = useState(todayIso());
  const tc = useApi(() => api.timecard(anchor), [anchor]);
  const act = useAction(async () => { await tc.reload(); onChange?.(); });
  const [category, setCategory] = useState<PunchCategory>('receiving');
  const [lotId, setLotId] = useState<string>('');
  const [switching, setSwitching] = useState(false);
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (tc.error) return <Card><ErrorBox error={tc.error} /></Card>;
  if (!tc.data) return <Card><Loading /></Card>;
  const d: TimeCardData = tc.data;
  const running = d.running;
  const elapsed = running ? (Date.now() - Date.parse(running.startedAt)) / 3600_000 : 0;
  const lotOf = (id: number | null) => (id === null ? null : lots.find((l) => l.id === id)?.name ?? null);
  const parsedLot = lotId === '' ? null : Number(lotId);

  return (
    <Card tone={running ? 'good' : undefined}>
      <CardHead title="Time card" right={
        <>
          <button className="btn sm" onClick={() => setAnchor(addDays(d.weekStart, -7))}>‹</button>
          <span className="small nowrap">{shortDate(d.weekStart)} – {shortDate(d.weekEnd)}</span>
          <button className="btn sm" onClick={() => setAnchor(addDays(d.weekStart, 7))} disabled={addDays(d.weekStart, 7) > d.today}>›</button>
          <button className="btn sm" onClick={() => { setLogging((v) => !v); setEditing(null); }}>Log hours</button>
        </>
      } />
      <ErrorBox error={act.error} />

      {/* clock */}
      <div className="stack" style={{ marginBottom: 12 }}>
        {running ? (
          <>
            <div className="between">
              <div>
                <div className="big">{hours(elapsed)}</div>
                <div className="muted small">{CATEGORY_LABEL[running.category]}{lotOf(running.lotId) ? ` · ${lotOf(running.lotId)}` : ''}{running.note ? ` · ${running.note}` : ''}</div>
              </div>
              <Pill tone="good">● Clocked in {timeOf(running.startedAt)}</Pill>
            </div>
            {switching ? (
              <div className="row">
                <select className="input sm" style={{ width: 140 }} value={category} onChange={(e) => setCategory(e.target.value as PunchCategory)}>
                  {d.categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
                <select className="input sm" style={{ width: 200 }} value={lotId} onChange={(e) => setLotId(e.target.value)}>
                  <option value="">No lot</option>
                  {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button className="btn sm primary" disabled={act.busy} onClick={() => { void act.run(() => api.switchTask({ category, lotId: parsedLot })); setSwitching(false); }}>Switch</button>
                <button className="btn sm ghost" onClick={() => setSwitching(false)}>Cancel</button>
              </div>
            ) : (
              <div className="row">
                <button className="btn danger" disabled={act.busy} onClick={() => act.run(() => api.clockOut())}>■ Clock out</button>
                <button className="btn" onClick={() => { setCategory(running.category); setLotId(running.lotId === null ? '' : String(running.lotId)); setSwitching(true); }}>Switch task</button>
              </div>
            )}
          </>
        ) : (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Task">
              <select className="input" style={{ width: 150 }} value={category} onChange={(e) => setCategory(e.target.value as PunchCategory)}>
                {d.categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field label="Lot">
              <select className="input" style={{ width: 220 }} value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">No lot</option>
                {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <button className="btn primary" disabled={act.busy} onClick={() => act.run(() => api.clockIn({ category, lotId: parsedLot }))}>▶ Clock in</button>
          </div>
        )}
      </div>

      {logging ? (
        <ManualPunchForm lots={lots} categories={d.categories} busy={act.busy} onCancel={() => setLogging(false)}
          onSave={async (body) => { const r = await act.run(() => api.addPunch(body)); if (r) setLogging(false); }} />
      ) : null}

      {/* week grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, marginBottom: 10 }}>
        {d.days.map((day) => (
          <div key={day.date} className={`day ${day.isToday ? 'today' : ''}`} title={day.date}>
            <div className="micro" style={day.isToday ? { color: 'var(--accent)' } : undefined}>{dayName(day.date)} {Number(day.date.slice(8))}</div>
            <div style={{ fontWeight: 600, color: day.hours === 0 ? 'var(--ink-3)' : undefined }}>
              {day.hours === 0 ? '—' : day.hours.toFixed(1)}
              {day.isToday && running ? <span style={{ fontSize: 10, color: 'var(--good)' }}> ●</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="between" style={{ marginBottom: 10 }}>
        <span><b>{hours(d.total)}</b> <span className="muted">this week</span></span>
        <span><b>{money(d.profitPerHour)} / hr</b> <span className="muted">net ÷ hours, 90d</span></span>
      </div>

      {/* hours by category */}
      {d.byCategory.length > 0 ? (
        <table className="t" style={{ marginBottom: 10 }}>
          <thead><tr><th>Where the hours went</th><th className="num">Hours</th><th className="num">Share</th></tr></thead>
          <tbody>
            {d.byCategory.map((c) => (
              <tr key={c.category}><td>{CATEGORY_LABEL[c.category]}</td><td className="num">{c.hours.toFixed(1)}</td><td className="num">{Math.round(c.share * 100)}%</td></tr>
            ))}
          </tbody>
        </table>
      ) : <div className="muted small" style={{ marginBottom: 10 }}>No hours logged this week yet.</div>}

      {/* punch log */}
      {d.punches.length > 0 ? (
        <div className="stack" style={{ gap: 4 }}>
          <div className="micro">Punch log</div>
          {d.punches.map((p) => editing === p.id ? (
            <PunchEditor key={p.id} punch={p} lots={lots} categories={d.categories} busy={act.busy} onCancel={() => setEditing(null)}
              onSave={async (patch) => { const r = await act.run(() => api.updatePunch(p.id, patch)); if (r) setEditing(null); }} />
          ) : (
            <div key={p.id} className="between small" style={{ padding: '4px 0', borderTop: '1px solid var(--line-soft)' }}>
              <span className="ellipsis">
                <b>{dayName(p.startedAt.slice(0, 10))} {timeOf(p.startedAt)}</b> → {p.endedAt ? timeOf(p.endedAt) : <Pill tone="good">running</Pill>}
                <span className="muted"> · {CATEGORY_LABEL[p.category]}{p.lotName ? ` · ${p.lotName}` : ''}{p.note ? ` · ${p.note}` : ''}{p.source === 'manual' ? ' · manual' : ''}</span>
              </span>
              <span className="row nowrap">
                <b>{hours(p.hours)}</b>
                <button className="btn sm ghost" onClick={() => { setEditing(p.id); setLogging(false); }}>Edit</button>
                <button className="btn sm ghost" aria-label="Delete" onClick={() => { if (confirm('Delete this punch?')) void act.run(() => api.deletePunch(p.id)); }}>✕</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function ManualPunchForm({ lots, categories, busy, onSave, onCancel }: {
  lots: LotListRow[]; categories: readonly PunchCategory[]; busy: boolean;
  onSave: (body: { startedAt: string; endedAt: string; category: PunchCategory; lotId: number | null; note: string | null }) => void; onCancel: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('12:00');
  const [category, setCategory] = useState<PunchCategory>('receiving');
  const [lotId, setLotId] = useState('');
  const [note, setNote] = useState('');
  const valid = date && start && end && end > start;
  return (
    <div className="stack" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 12, marginBottom: 12, background: 'var(--surface)' }}>
      <div className="micro">Log hours</div>
      <div className="row">
        <input className="input sm" type="date" style={{ width: 140 }} value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="input sm" type="time" style={{ width: 100 }} value={start} onChange={(e) => setStart(e.target.value)} />
        <span className="muted">→</span>
        <input className="input sm" type="time" style={{ width: 100 }} value={end} onChange={(e) => setEnd(e.target.value)} />
        <select className="input sm" style={{ width: 130 }} value={category} onChange={(e) => setCategory(e.target.value as PunchCategory)}>
          {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <select className="input sm" style={{ width: 180 }} value={lotId} onChange={(e) => setLotId(e.target.value)}>
          <option value="">No lot</option>
          {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input className="input sm" placeholder="Note" style={{ width: 160 }} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn sm primary" disabled={!valid || busy} onClick={() => onSave({ startedAt: localToIso(`${date}T${start}`), endedAt: localToIso(`${date}T${end}`), category, lotId: lotId === '' ? null : Number(lotId), note: note || null })}>Save</button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
        {!valid && start && end ? <span className="faint tiny">End must be after start.</span> : null}
      </div>
    </div>
  );
}

function PunchEditor({ punch, lots, categories, busy, onSave, onCancel }: {
  punch: Punch; lots: LotListRow[]; categories: readonly PunchCategory[]; busy: boolean;
  onSave: (patch: { startedAt: string; endedAt: string | null; category: PunchCategory; lotId: number | null; note: string | null }) => void; onCancel: () => void;
}) {
  const [start, setStart] = useState(isoToLocal(punch.startedAt));
  const [end, setEnd] = useState(punch.endedAt ? isoToLocal(punch.endedAt) : '');
  const [category, setCategory] = useState<PunchCategory>(punch.category);
  const [lotId, setLotId] = useState(punch.lotId === null ? '' : String(punch.lotId));
  const [note, setNote] = useState(punch.note ?? '');
  return (
    <div className="stack" style={{ padding: '6px 0', borderTop: '1px solid var(--line-soft)' }}>
      <div className="row">
        <input className="input sm" type="datetime-local" style={{ width: 190 }} value={start} onChange={(e) => setStart(e.target.value)} />
        <span className="muted">→</span>
        <input className="input sm" type="datetime-local" style={{ width: 190 }} value={end} onChange={(e) => setEnd(e.target.value)} placeholder="still running" />
        <select className="input sm" style={{ width: 120 }} value={category} onChange={(e) => setCategory(e.target.value as PunchCategory)}>
          {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <select className="input sm" style={{ width: 170 }} value={lotId} onChange={(e) => setLotId(e.target.value)}>
          <option value="">No lot</option>
          {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <input className="input sm" placeholder="Note" style={{ width: 140 }} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn sm primary" disabled={busy || !start} onClick={() => onSave({ startedAt: localToIso(start), endedAt: end ? localToIso(end) : null, category, lotId: lotId === '' ? null : Number(lotId), note: note || null })}>Save</button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
