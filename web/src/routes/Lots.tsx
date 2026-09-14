import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type BoardCard, type BoardColumn, type Analysis } from '../api/client.ts';
import { useApi, useAction } from '../lib/useApi.ts';
import { money, est, relTime, shortDate } from '../lib/fmt.ts';
import { Card, Pill, Segmented, Loading, ErrorBox, Empty, Field, Progress } from '../components/ui.tsx';

type View = 'board' | 'table';

export function Lots() {
  const [params, setParams] = useSearchParams();
  const board = useApi(() => api.board());
  const [view, setView] = useState<View>((localStorage.getItem('lots.view') as View) || 'board');
  const [seller, setSeller] = useState('all');
  const nav = useNavigate();
  const creating = params.get('new') === '1';

  const sellers = useMemo(() => {
    const s = new Set<string>();
    board.data?.columns.forEach((c) => c.lots.forEach((l) => s.add(l.seller)));
    return [...s].sort();
  }, [board.data]);

  const filtered: BoardColumn[] = useMemo(
    () => (board.data?.columns ?? []).map((c) => ({ ...c, lots: seller === 'all' ? c.lots : c.lots.filter((l) => l.seller === seller) })),
    [board.data, seller],
  );
  const count = filtered.reduce((s, c) => s + c.lots.length, 0);

  return (
    <main className="page">
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <h1>Lots</h1>
          <Segmented value={view} options={[{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }]} onChange={(v) => { setView(v); localStorage.setItem('lots.view', v); }} />
        </div>
        <div className="actions">
          {board.data ? <span className="muted small">{count} lot{count === 1 ? '' : 's'} · {money(board.data.committed)} committed</span> : null}
          <select className="input sm" style={{ width: 150 }} value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="all">All sellers</option>
            {sellers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn primary" onClick={() => setParams({ new: '1' })}>+ New lot</button>
        </div>
      </div>
      <ErrorBox error={board.error} />

      {creating ? <NewLot onDone={(id) => { setParams({}); if (id) nav(`/lots/${id}`); else void board.reload(); }} /> : null}

      {!board.data ? <Loading /> : view === 'board' ? <Board columns={filtered} /> : <LotsTable columns={filtered} />}
    </main>
  );
}

function Board({ columns }: { columns: BoardColumn[] }) {
  const nav = useNavigate();
  return (
    <div className="board">
      {columns.map((c) => (
        <div key={c.stage} className="col">
          <div className="colhead">
            <b>{c.label}</b>
            <div className="muted tiny">
              {c.count} lot{c.count === 1 ? '' : 's'}
              {c.total && c.total.value > 0 ? ` · ${money(c.total.value)} ${c.total.label}` : ''}
            </div>
          </div>
          {c.lots.map((l) => <LotCard key={l.id} lot={l} onOpen={() => nav(`/lots/${l.id}`)} />)}
        </div>
      ))}
    </div>
  );
}

const STAGE_COLOR: Record<string, string> = { analyzing: '#8b95a5', bid_placed: '#d99a2b', won: '#1b6a99', received: '#1b6a99', selling: '#1f7a44', closed: '#1f7a44' };

function LotCard({ lot, onOpen }: { lot: BoardCard; onOpen: () => void }) {
  const nav = useNavigate();
  return (
    <div className={`lot-card ${lot.overdueCheckin ? 'rot' : ''}`} onClick={onOpen} style={lot.stage === 'closed' ? { opacity: 0.8 } : undefined}>
      <div className="bar" style={{ background: STAGE_COLOR[lot.stage] }} />
      <div className="name">{lot.name}</div>
      <div className="muted tiny">{lot.seller} · {lot.units} units{lot.mappingStatus === 'pending' ? ' · needs mapping' : ''}</div>

      {(lot.stage === 'analyzing' || lot.stage === 'bid_placed') && (
        <>
          <div className="row2">
            {lot.analysis ? (
              lot.analysis.decision === 'BID'
                ? <Pill tone="good">BID {est(lot.analysis.maxBid, lot.analysis.isEstimate)}</Pill>
                : <Pill tone="bad">PASS</Pill>
            ) : <Pill tone="warn">{lot.mappingStatus === 'pending' ? 'map columns' : 'needs comps'}</Pill>}
            {lot.endsSoon ? <Pill tone={Date.parse(lot.endsSoon) - Date.now() < 12 * 3600_000 ? 'warn' : 'gray'}>{Date.parse(lot.endsSoon) < Date.now() ? 'ended' : `ends ${relTime(lot.endsSoon)}`}</Pill> : null}
          </div>
          <div className="row2 muted"><span>{lot.context.currentBid !== null ? `current ${money(lot.context.currentBid)}${lot.context.bidCount ? ` · ${lot.context.bidCount} bids` : ''}` : 'no bid entered'}</span><span>{money(lot.extRetail)} retail</span></div>
        </>
      )}

      {lot.stage === 'won' && (
        <>
          <div className="row2"><span>won {money(lot.outcome?.finalPrice ?? null)}</span>{lot.overdueCheckin ? <Pill tone="bad">{lot.daysInStage}d</Pill> : <span className="faint tiny">{lot.daysInStage}d</span>}</div>
          <div className="row2 muted"><span>landed / unit</span><span>{money(lot.landedUnitCost, { cents: true })}</span></div>
          {lot.checkin && lot.checkin.checked > 0 ? <Progress value={lot.checkin.checked} max={lot.checkin.manifestUnits} /> : null}
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={(e) => { e.stopPropagation(); nav(`/receive/${lot.id}`); }}>
            {lot.checkin && lot.checkin.checked > 0 ? 'Continue check-in →' : 'Check in →'}
          </button>
        </>
      )}

      {lot.stage === 'received' && (
        <>
          <div className="row2"><span>{lot.checkin?.works ?? 0} working</span><span className="muted">{lot.checkin?.dead ?? 0} dead</span></div>
          <div className="row2 muted"><span>landed / unit</span><span>{money(lot.landedUnitCost, { cents: true })}</span></div>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={(e) => { e.stopPropagation(); nav('/inventory'); }}>List units →</button>
        </>
      )}

      {(lot.stage === 'selling' || lot.stage === 'closed') && lot.selling && (
        <>
          <div className="row2"><span>recovered {money(lot.selling.recovered)}</span><span className="muted">of {money(lot.selling.cost)} cost</span></div>
          {lot.selling.units > 0 ? <Progress value={lot.selling.sold} max={lot.selling.units} /> : null}
          <div className="row2 muted">
            <span>{lot.selling.units - lot.selling.sold} left · {lot.selling.listed} listed</span>
            <span className={lot.selling.net >= 0 ? 'up' : 'down'}>{money(lot.selling.net, { sign: true })} net</span>
          </div>
          {lot.stage === 'selling' && lot.selling.canClose ? <Pill tone="good">all sold — close it</Pill> : null}
        </>
      )}
    </div>
  );
}

/** The old Compare view: confirmed lots sorted by landed unit price. */
function LotsTable({ columns }: { columns: BoardColumn[] }) {
  const lots = columns.flatMap((c) => c.lots);
  const analyses = useApi(async () => {
    const out = new Map<number, Analysis>();
    await Promise.all(lots.filter((l) => l.mappingStatus === 'confirmed' && l.units > 0).map(async (l) => { try { out.set(l.id, await api.analysis(l.id)); } catch { /* skip */ } }));
    return out;
  }, [lots.map((l) => l.id).join(',')]);
  if (!analyses.data) return <Loading />;
  const rows = lots
    .map((l) => ({ lot: l, a: analyses.data!.get(l.id) ?? null }))
    .sort((x, y) => (x.a?.bid.landedUnitPrice?.amount ?? Infinity) - (y.a?.bid.landedUnitPrice?.amount ?? Infinity));
  if (rows.length === 0) return <Empty>No lots yet.</Empty>;
  return (
    <Card flush>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Lot</th><th>Seller</th><th>Stage</th><th>Verdict</th><th className="num">Landed / unit</th><th className="num">Max bid</th><th className="num">Expected revenue</th><th className="num">High-conf.</th><th className="num">Units</th></tr></thead>
          <tbody>
            {rows.map(({ lot, a }) => (
              <tr key={lot.id}>
                <td><Link to={`/lots/${lot.id}`}><b>{lot.name}</b></Link><div className="faint tiny">{shortDate(lot.createdAt)}</div></td>
                <td>{lot.seller}</td>
                <td><Pill tone={lot.stage === 'closed' ? 'gray' : lot.stage === 'won' ? 'acc' : 'gray'}>{lot.stageLabel}</Pill></td>
                <td>{a ? <Pill tone={a.verdict.decision === 'BID' ? 'good' : 'bad'}>{a.verdict.decision}</Pill> : <span className="faint">—</span>}</td>
                <td className="num">{lot.landedUnitCost !== null ? money(lot.landedUnitCost, { cents: true }) : a?.bid.landedUnitPrice ? est(a.bid.landedUnitPrice.amount, a.bid.landedUnitPrice.isEstimate, true) : '—'}</td>
                <td className="num">{a?.verdict.maxBid ? est(a.verdict.maxBid.amount, a.verdict.maxBid.isEstimate) : '—'}</td>
                <td className="num">{a ? est(a.valuation.expectedRevenue.amount, a.valuation.expectedRevenue.isEstimate) : '—'}</td>
                <td className="num">{a ? `${Math.round(a.valuation.confidenceShares.high * 100)}%` : '—'}</td>
                <td className="num">{lot.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function NewLot({ onDone }: { onDone: (id: number | null) => void }) {
  const [name, setName] = useState('');
  const [seller, setSeller] = useState('');
  const [unmanifested, setUnmanifested] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const act = useAction();
  const submit = async () => {
    const result = await act.run(async () => {
      const payload = file ? { data: await file.arrayBuffer(), filename: file.name } : undefined;
      return api.createLot(name.trim(), seller.trim(), unmanifested, payload);
    });
    if (result) onDone(result.lot.id);
  };
  return (
    <Card>
      <div className="between" style={{ marginBottom: 10 }}><h3>New lot</h3><button className="btn sm ghost" onClick={() => onDone(null)}>Cancel</button></div>
      <ErrorBox error={act.error} />
      <div className="form-grid">
        <Field label="Lot name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="3 Pallets of Vacuums (MON-6995946)" /></Field>
        <Field label="Seller"><input className="input" value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="MON" /></Field>
        <Field label="Manifest file" hint="The .csv or .xlsx you downloaded from the listing">
          <input className="input" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={unmanifested} />
        </Field>
        <Field label="No manifest?">
          <label className={`check ${unmanifested ? 'on' : ''}`}><input type="checkbox" checked={unmanifested} onChange={(e) => setUnmanifested(e.target.checked)} /> Enter items by hand</label>
        </Field>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!name.trim() || !seller.trim() || (!file && !unmanifested) || act.busy} onClick={submit}>Create lot</button>
      </div>
    </Card>
  );
}
