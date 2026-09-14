import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type ReceivingView, type ReceiptSummary, type BoardCard } from '../api/client.ts';
import { useApi, useAction } from '../lib/useApi.ts';
import { money } from '../lib/fmt.ts';
import { Card, CardHead, Pill, Counter, Progress, ErrorBox, Loading, Empty, Toast, Field } from '../components/ui.tsx';

type Tally = { received: number; works: number; incomplete: number; weakBattery: number; dead: number; note: string };
type Line = ReceivingView['lines'][number];

const emptyTally = (): Tally => ({ received: 0, works: 0, incomplete: 0, weakBattery: 0, dead: 0, note: '' });
const tallyOf = (l: Line): Tally =>
  l.receipt
    ? { received: l.receipt.received, works: l.receipt.works, incomplete: l.receipt.incomplete, weakBattery: l.receipt.weakBattery, dead: l.receipt.dead, note: l.receipt.note ?? '' }
    : emptyTally();
const sorted = (t: Tally) => t.works + t.incomplete + t.weakBattery + t.dead;
const range = (r: { low: number; high: number }) => `${money(r.low)}–${money(r.high)}`;

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.innerWidth <= 800);
  useEffect(() => {
    const on = () => setPhone(window.innerWidth <= 800);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return phone;
}

export function Receive() {
  const { id } = useParams();
  return id ? <CheckIn lotId={Number(id)} /> : <ReceiveList />;
}

// ---------- /receive : lots waiting ----------

function ReceiveList() {
  const board = useApi(() => api.board());
  if (board.error) return <main className="page"><ErrorBox error={board.error} /></main>;
  if (!board.data) return <main className="page"><Loading /></main>;
  const lots: BoardCard[] = board.data.columns.filter((c) => c.stage === 'won' || c.stage === 'received').flatMap((c) => c.lots);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="micro">Won lots waiting to be checked in</div>
          <h1>Receive</h1>
        </div>
      </div>
      {lots.length === 0 ? (
        <Card><Empty>No won lots are waiting. Once you log a win on the <Link to="/lots">Lots</Link> board, it shows up here for check-in.</Empty></Card>
      ) : (
        <Card flush>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Lot</th><th>Stage</th><th className="num">Units</th><th className="num">Landed / unit</th><th style={{ width: '26%' }}>Check-in</th><th className="num">Since won</th><th /></tr></thead>
              <tbody>
                {lots.map((l) => {
                  const c = l.checkin;
                  return (
                    <tr key={l.id} className={l.overdueCheckin ? 'cut' : undefined}>
                      <td><Link to={`/receive/${l.id}`}><b>{l.name}</b></Link><div className="muted tiny">{l.seller}</div></td>
                      <td><Pill tone={l.stage === 'received' ? 'good' : 'acc'}>{l.stageLabel}</Pill></td>
                      <td className="num">{l.units}</td>
                      <td className="num">{money(l.landedUnitCost, { cents: true })}</td>
                      <td>
                        {c ? (
                          <>
                            <div className="between tiny" style={{ marginBottom: 4 }}><span>{c.checked} of {c.manifestUnits} checked</span><span className="muted">{c.works} work · {c.dead} dead</span></div>
                            <Progress value={c.checked} max={c.manifestUnits} />
                          </>
                        ) : <span className="faint">—</span>}
                      </td>
                      <td className="num">{l.overdueCheckin ? <Pill tone="bad">{l.daysInStage}d</Pill> : <span className="muted">{l.daysInStage}d</span>}</td>
                      <td className="num"><Link to={`/receive/${l.id}`} className="btn sm">{c && c.checked > 0 ? 'Continue →' : 'Check in →'}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}

// ---------- /receive/:id : check-in ----------

function CheckIn({ lotId }: { lotId: number }) {
  const view = useApi(() => api.receiving(lotId), [lotId]);
  const running = useApi(() => api.running(), [lotId]);
  const nav = useNavigate();
  const phone = useIsPhone();
  const [tallies, setTallies] = useState<Map<number, Tally>>(new Map());
  const [summary, setSummary] = useState<ReceiptSummary | null>(null);
  const [lineErrors, setLineErrors] = useState<Map<number, string>>(new Map());
  const [uncheckedOnly, setUncheckedOnly] = useState(false);
  const [byValue, setByValue] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const act = useAction();

  // Seed local tallies from the server once (and whenever the lot changes).
  useEffect(() => {
    if (!view.data) return;
    setTallies(new Map(view.data.lines.map((l) => [l.item.id, tallyOf(l)])));
    setSummary(view.data.summary);
  }, [view.data]);

  const save = useCallback(
    async (lineItemId: number, t: Tally) => {
      try {
        const r = await api.saveReceipt(lotId, lineItemId, { ...t, note: t.note.trim() || null });
        setSummary(r.summary);
        setLineErrors((m) => { const n = new Map(m); n.delete(lineItemId); return n; });
        return true;
      } catch (err) {
        setLineErrors((m) => new Map(m).set(lineItemId, err instanceof Error ? err.message : 'Could not save'));
        return false;
      }
    },
    [lotId],
  );

  /** Update a line locally and autosave ~500ms after the last change. */
  const update = useCallback(
    (lineItemId: number, patch: Partial<Tally>) => {
      setTallies((prev) => {
        const next = new Map(prev);
        const t = { ...(prev.get(lineItemId) ?? emptyTally()), ...patch };
        next.set(lineItemId, t);
        const existing = timers.current.get(lineItemId);
        if (existing) clearTimeout(existing);
        timers.current.set(lineItemId, setTimeout(() => { timers.current.delete(lineItemId); void save(lineItemId, t); }, 500));
        return next;
      });
    },
    [save],
  );
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  /** Flush pending autosaves before a server-side action reads the tallies. */
  const flush = useCallback(async () => {
    const pending = [...timers.current.entries()];
    timers.current.clear();
    for (const [, t] of pending) clearTimeout(t);
    await Promise.all(pending.map(([id]) => { const t = tallies.get(id); return t ? save(id, t) : Promise.resolve(true); }));
  }, [tallies, save]);

  const refreshSalvage = useCallback(async () => { await view.reload(); }, [view]);

  const lines = useMemo(() => {
    if (!view.data) return [];
    let ls = view.data.lines;
    if (uncheckedOnly) ls = ls.filter((l) => (tallies.get(l.item.id)?.received ?? 0) === 0);
    if (byValue) ls = [...ls].sort((a, b) => b.item.quantity * (b.item.unitMsrp ?? 0) - a.item.quantity * (a.item.unitMsrp ?? 0));
    return ls;
  }, [view.data, uncheckedOnly, byValue, tallies]);

  if (view.error) return <main className="page"><ErrorBox error={view.error} /></main>;
  if (!view.data || !summary) return <main className="page"><Loading /></main>;
  const d = view.data;
  const punch = running.data?.running ?? null;

  const transfer = () => act.run(async () => {
    await flush();
    const r = await api.transfer(lotId);
    setToast(`${r.unitsInInventory} working unit${r.unitsInInventory === 1 ? '' : 's'} in inventory (${r.created} new, ${r.updated} updated${r.removed ? `, ${r.removed} removed` : ''})`);
    await refreshSalvage();
  });
  const finish = () => {
    const left = summary.manifestUnits - summary.checked;
    const msg = left > 0 ? `${left} unit${left === 1 ? '' : 's'} still unchecked. Finish anyway? Working units move to inventory and the lot is marked Received.` : 'Move working units to inventory and mark the lot Received?';
    if (!window.confirm(msg)) return;
    void act.run(async () => { await flush(); await api.finishCheckin(lotId); nav('/inventory'); });
  };
  const createParts = () => act.run(async () => {
    await flush();
    const r = await api.createParts(lotId);
    setToast(r.created === 0 ? 'No new parts to create — dead units already have parts items' : `Created ${r.created} parts item${r.created === 1 ? '' : 's'} in inventory`);
  });
  const clockIn = () => act.run(async () => { await api.clockIn({ category: 'receiving', lotId }); await running.reload(); });

  const head = (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        <div className="micro"><Link to="/lots">Lots</Link> › {d.lot.stage === 'received' ? 'Received' : 'Won'}</div>
        <h1 className="ellipsis">Check in · {d.lot.name}</h1>
        <div className="muted small" style={{ marginTop: 2 }}>
          {summary.manifestUnits} units on manifest
          {d.landedUnitCost !== null
            ? <> · landed {money(d.landedUnitCost, { cents: true })} / unit · every working unit gets that as its cost basis</>
            : <> · <span className="down">no landed cost yet</span> — <Link to={`/lots/${lotId}`}>log the winning price on the lot</Link></>}
        </div>
      </div>
      <div className="actions">
        {punch ? <Pill tone="good">● Timer running · {punch.category}</Pill> : <button className="btn sm" onClick={clockIn} disabled={act.busy}>Clock in (receiving)</button>}
        <button className="btn" onClick={transfer} disabled={act.busy || summary.works === 0}>Send {summary.works} working → Inventory</button>
        <button className="btn primary" onClick={finish} disabled={act.busy}>Finish check-in</button>
      </div>
    </div>
  );

  const kpis = (
    <div className="grid-4">
      <div className="kpi">
        <div className="micro">Checked</div>
        <div className="v">{summary.checked} <span className="unit">/ {summary.manifestUnits}</span></div>
        <div style={{ marginTop: 6 }}><Progress value={summary.checked} max={summary.manifestUnits} /></div>
      </div>
      <div className="kpi"><div className="micro">Works</div><div className="v up">{summary.works}</div><div className="muted tiny">sell whole</div></div>
      <div className="kpi"><div className="micro">Incomplete / weak battery</div><div className="v" style={{ color: 'var(--warn)' }}>{summary.incomplete + summary.weakBattery}</div><div className="muted tiny">fix from donors or sell as-is</div></div>
      <div className="kpi"><div className="micro">Dead</div><div className="v down">{summary.dead}</div><div className="muted tiny">{summary.dead > 0 ? `salvage floor ≈ ${range(d.salvage.floor)}` : 'nothing to salvage yet'}</div></div>
    </div>
  );

  const salvage = (
    <Card>
      <CardHead title="Salvage plan" sub="Dead and weak units pooled by compatible family. Parts values are your own — edit them in Settings as you sell." right={<span className="muted tiny">grouped by family</span>} />
      <div className="stack">
        {d.salvage.families.length === 0 && d.salvage.unmatched.length === 0 ? (
          <div className="muted small">No dead or weak units recorded yet. Tallies you enter show up here grouped by product family.</div>
        ) : null}
        {d.salvage.families.map((f) => (
          <div key={f.family} className={`fam ${f.dead > 0 ? 'hot' : ''}`}>
            <div className="between">
              <b>{f.family}{f.estimated ? <span className="faint tiny" style={{ fontWeight: 400 }}> · estimate</span> : null}</b>
              <span className="row" style={{ gap: 4 }}>
                {f.dead > 0 ? <Pill tone="bad">{f.dead} dead</Pill> : null}
                {f.weakBattery > 0 ? <Pill tone="warn">{f.weakBattery} weak batt.</Pill> : null}
                {f.incomplete > 0 ? <Pill tone="gray">{f.incomplete} incomplete</Pill> : null}
              </span>
            </div>
            {f.cannibalize > 0 ? (
              <div className="info-box">Swap parts from the dead unit{f.dead === 1 ? '' : 's'} into the weak one{f.weakBattery === 1 ? '' : 's'} → <b>{f.cannibalize} more working {f.family}</b>. Keep the rest as spares.</div>
            ) : null}
            {f.parts.map((p) => <div key={p.name} className="part"><span>{p.name}</span><span>{range(p)}</span></div>)}
            <div className="part" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
              <span className="muted">Per dead unit {range(f.perUnitFloor)}</span>
              <b>{f.dead > 0 ? range(f.floor) : '—'}</b>
            </div>
          </div>
        ))}
        {d.salvage.unmatched.length > 0 ? (
          <div className="fam">
            <div className="between"><b>Unmatched</b><span className="faint tiny">no family in the parts book</span></div>
            {d.salvage.unmatched.map((u) => (
              <div key={u.lineItemId} className="part"><span className="ellipsis">{u.description}</span><span className="muted">{[u.dead ? `${u.dead} dead` : '', u.weakBattery ? `${u.weakBattery} weak` : '', u.incomplete ? `${u.incomplete} incomplete` : ''].filter(Boolean).join(' · ')}</span></div>
            ))}
            <div className="faint tiny">Add a family with matching keywords under Settings › Salvage parts book.</div>
          </div>
        ) : null}
        <div className="between" style={{ paddingTop: 4 }}>
          <span className="muted">Salvage floor so far</span>
          <b style={{ fontSize: 16 }}>{range(d.salvage.floor)}</b>
        </div>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={createParts} disabled={act.busy || d.salvage.totalDead === 0}>Create parts inventory items</button>
      </div>
    </Card>
  );

  return (
    <main className="page">
      {head}
      <ErrorBox error={act.error} />
      {phone ? (
        <PhoneCheckIn lines={d.lines} tallies={tallies} update={update} save={save} lineErrors={lineErrors} summary={summary} />
      ) : (
        <>
          {kpis}
          <div className="split wide">
            <Card flush>
              <CardHead title="Manifest lines" right={
                <>
                  <button className={`btn sm ${uncheckedOnly ? 'primary' : ''}`} onClick={() => setUncheckedOnly((v) => !v)}>Unchecked only</button>
                  <button className={`btn sm ${byValue ? 'primary' : ''}`} onClick={() => setByValue((v) => !v)}>Sort by value</button>
                </>
              } />
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Item</th><th className="num">Manifest</th><th className="num">Received</th><th className="num">Works</th><th className="num">Incomplete</th><th className="num">Weak batt.</th><th className="num">Dead</th><th>Note</th></tr></thead>
                  <tbody>
                    {lines.length === 0 ? <tr><td colSpan={8}><Empty>Every line has been checked.</Empty></td></tr> : null}
                    {lines.map((l) => {
                      const t = tallies.get(l.item.id) ?? emptyTally();
                      const err = lineErrors.get(l.item.id);
                      const over = sorted(t) > t.received;
                      return (
                        <tr key={l.item.id} className={t.received === 0 ? 'open' : undefined}>
                          <td style={{ minWidth: 220 }}>
                            <b>{l.item.description}</b>
                            <div className="muted tiny">{money(l.item.unitMsrp, { cents: true })}{l.family ? ` · ${l.family}` : ''}</div>
                            {err || over ? <div className="down tiny">{err ?? 'Sorted units exceed units received'}</div> : null}
                          </td>
                          <td className="num">{l.item.quantity}</td>
                          <td className="num"><Counter value={t.received} onChange={(v) => update(l.item.id, { received: v })} /></td>
                          <td className="num"><Counter value={t.works} onChange={(v) => update(l.item.id, { works: v })} /></td>
                          <td className="num"><Counter value={t.incomplete} onChange={(v) => update(l.item.id, { incomplete: v })} /></td>
                          <td className="num"><Counter value={t.weakBattery} tone="weak" onChange={(v) => update(l.item.id, { weakBattery: v })} /></td>
                          <td className="num"><Counter value={t.dead} tone="dead" onChange={(v) => update(l.item.id, { dead: v })} /></td>
                          <td style={{ minWidth: 160 }}><input className="input sm" placeholder="note" value={t.note} onChange={(e) => update(l.item.id, { note: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            {salvage}
          </div>
        </>
      )}
      {toast ? <Toast text={toast} onClose={() => setToast(null)} /> : null}
    </main>
  );
}

// ---------- phone: one line at a time ----------

function PhoneCheckIn({ lines, tallies, update, save, lineErrors, summary }: {
  lines: Line[];
  tallies: Map<number, Tally>;
  update: (id: number, patch: Partial<Tally>) => void;
  save: (id: number, t: Tally) => Promise<boolean>;
  lineErrors: Map<number, string>;
  summary: ReceiptSummary;
}) {
  const firstUnchecked = Math.max(0, lines.findIndex((l) => (tallies.get(l.item.id)?.received ?? 0) === 0));
  const [idx, setIdx] = useState(firstUnchecked);
  const [saving, setSaving] = useState(false);
  const line = lines[Math.min(idx, lines.length - 1)];
  if (!line) return <Card><Empty>No manifest lines.</Empty></Card>;
  const t = tallies.get(line.item.id) ?? emptyTally();
  const err = lineErrors.get(line.item.id);
  const advance = () => {
    const next = lines.findIndex((l, i) => i > idx && (tallies.get(l.item.id)?.received ?? 0) === 0);
    setIdx(next >= 0 ? next : Math.min(idx + 1, lines.length - 1));
  };
  const saveNext = async () => {
    setSaving(true);
    const ok = await save(line.item.id, t);
    setSaving(false);
    if (ok) advance();
  };
  return (
    <div className="stack">
      <div>
        <div className="between tiny" style={{ marginBottom: 4 }}><span>{summary.checked} of {summary.manifestUnits} units checked</span><span className="muted">{summary.works} work · {summary.dead} dead</span></div>
        <Progress value={summary.checked} max={summary.manifestUnits} />
      </div>
      <Card>
        <div className="between"><b>Line {idx + 1} of {lines.length}</b><span className="muted tiny">{(tallies.get(line.item.id)?.received ?? 0) > 0 ? 'checked' : 'unchecked'}</span></div>
        <div style={{ fontWeight: 600, fontSize: 16, marginTop: 8 }}>{line.item.description}</div>
        <div className="muted small">{line.item.quantity} on manifest · {money(line.item.unitMsrp, { cents: true })}{line.family ? ` · ${line.family}` : ''}</div>
        {err ? <div className="error-box" style={{ marginTop: 8 }}>{err}</div> : null}
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="between"><span className="micro">Received</span><Counter large value={t.received} onChange={(v) => update(line.item.id, { received: v })} /></div>
          <div className="between"><span className="micro">Works</span><Counter large value={t.works} onChange={(v) => update(line.item.id, { works: v })} /></div>
          <div className="between"><span className="micro">Incomplete</span><Counter large value={t.incomplete} onChange={(v) => update(line.item.id, { incomplete: v })} /></div>
          <div className="between"><span className="micro">Weak battery</span><Counter large tone="weak" value={t.weakBattery} onChange={(v) => update(line.item.id, { weakBattery: v })} /></div>
          <div className="between"><span className="micro">Dead</span><Counter large tone="dead" value={t.dead} onChange={(v) => update(line.item.id, { dead: v })} /></div>
          <Field label="Note"><input className="input" style={{ height: 44 }} placeholder="e.g. missing charger" value={t.note} onChange={(e) => update(line.item.id, { note: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: 'nowrap' }}>
          <button className="btn lg" disabled title="Photos are coming later">Photo</button>
          <button className="btn lg primary" style={{ flex: 1 }} onClick={saveNext} disabled={saving}>Save · next line →</button>
        </div>
        <div className="between" style={{ marginTop: 10 }}>
          <button className="btn sm ghost" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>‹ Previous</button>
          <button className="btn sm ghost" onClick={advance}>Skip ›</button>
        </div>
      </Card>
    </div>
  );
}
