import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Analysis, type ColumnMapping, type LineItem, type ListingContext, type LotDetail as LotDetailData, type MappingProposal, type Outcome, type TopItem } from '../api/client.ts';
import { CANONICAL_FIELDS, REQUIRED_FIELDS, CONDITION_GRADES, type CanonicalField, type FlaggedAmount } from '@server/types.ts';
import { useApi, useAction } from '../lib/useApi.ts';
import { money, est, pct, parseNumbers, numOrNull } from '../lib/fmt.ts';
import { Card, CardHead, Pill, Field, ErrorBox, Loading, Kpi, Progress } from '../components/ui.tsx';

const STAGE_TONE: Record<string, 'gray' | 'warn' | 'acc' | 'good'> = {
  analyzing: 'gray', bid_placed: 'warn', won: 'acc', received: 'acc', selling: 'good', closed: 'gray',
};
const STAGE_LABEL: Record<string, string> = {
  analyzing: 'Analyzing', bid_placed: 'Bid placed', won: 'Won', received: 'Received', selling: 'Selling', closed: 'Closed',
};

/** "~$X *" with the estimate reasons as a tooltip — nothing estimated may look hard. */
function Flag({ fa, cents = false }: { fa: FlaggedAmount | null | undefined; cents?: boolean }) {
  if (!fa) return <>—</>;
  return <span title={fa.isEstimate ? `Estimate: ${fa.estimateReasons.join(', ')}` : undefined}>{est(fa.amount, fa.isEstimate, cents)}</span>;
}

export function LotDetail() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const nav = useNavigate();
  const lot = useApi(() => api.lot(id), [id]);
  const hasItems = (lot.data?.items.length ?? 0) > 0 && !lot.data?.pendingMapping;
  const analysis = useApi(async () => (hasItems ? api.analysis(id) : null), [id, hasItems, lot.data?.items.length]);
  const topItems = useApi(async () => (hasItems ? api.topItems(id, 10) : []), [id, hasItems, lot.data?.items.length]);
  const reloadAll = async () => {
    await lot.reload();
    await Promise.all([analysis.reload(), topItems.reload()]);
  };
  const act = useAction(reloadAll);

  if (lot.error) return <main className="page"><ErrorBox error={lot.error} /></main>;
  if (!lot.data) return <main className="page"><Loading /></main>;
  const d = lot.data;
  const stage = d.lot.stage;

  const deleteLot = async () => {
    if (!window.confirm(`Delete "${d.lot.name}"? Its manifest, comps and outcome go with it.`)) return;
    const ok = await act.run(() => api.deleteLot(id));
    if (ok) nav('/lots');
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="micro"><Link to="/lots">Lots</Link> › {d.lot.name}</div>
          <div className="row" style={{ gap: 10 }}>
            <h1>{d.lot.name}</h1>
            <Pill tone={STAGE_TONE[stage] ?? 'gray'}>{STAGE_LABEL[stage] ?? stage}</Pill>
          </div>
          <div className="muted small">{d.lot.seller}{d.lot.unmanifested ? ' · unmanifested' : ''} · {d.items.length} line item{d.items.length === 1 ? '' : 's'}</div>
        </div>
        <div className="actions">
          {stage === 'analyzing' ? <button className="btn" disabled={act.busy} onClick={() => act.run(() => api.setStage(id, 'bid_placed'))}>Mark bid placed</button> : null}
          {stage === 'bid_placed' ? <button className="btn" disabled={act.busy} onClick={() => act.run(() => api.setStage(id, 'analyzing'))}>Back to analyzing</button> : null}
          {stage === 'won' ? <Link to={`/receive/${id}`} className="btn primary">Check in →</Link> : null}
          {stage === 'received' ? <Link to="/inventory" className="btn">Inventory →</Link> : null}
          {stage === 'selling' ? <button className="btn" disabled={act.busy} onClick={() => { if (window.confirm('Close this lot? Use this once everything is sold or disposed.')) void act.run(() => api.setStage(id, 'closed')); }}>Close lot</button> : null}
          <button className="btn danger" disabled={act.busy} onClick={deleteLot}>Delete</button>
        </div>
      </div>
      <ErrorBox error={act.error} />

      {d.pendingMapping ? (
        <MappingSection lotId={id} pending={d.pendingMapping} onDone={reloadAll} />
      ) : (
        <>
          <ContextSection lotId={id} context={d.lot.context} onDone={reloadAll} />
          {d.lot.unmanifested ? <ManualItemSection lotId={id} onDone={reloadAll} /> : null}
          {hasItems ? (
            <>
              {topItems.data ? <CompsSection items={topItems.data} onDone={reloadAll} /> : <Loading />}
              {analysis.error ? <ErrorBox error={analysis.error} /> : analysis.data ? <AnalysisSection a={analysis.data} /> : <Loading />}
            </>
          ) : (
            <UploadSection lotId={id} onDone={reloadAll} />
          )}
          <OutcomeSection lotId={id} outcome={d.outcome} stage={stage} onDone={reloadAll} />
        </>
      )}
    </main>
  );
}

// ---- column mapping ----

function MappingSection({ lotId, pending, onDone }: { lotId: number; pending: { proposal: MappingProposal; headers: string[]; sampleRows: string[][] }; onDone: () => Promise<void> }) {
  const [mapping, setMapping] = useState<ColumnMapping>({ ...pending.proposal.mapping });
  const act = useAction(onDone);
  const missing = REQUIRED_FIELDS.filter((f) => !mapping[f]);
  return (
    <Card>
      <CardHead title="Confirm column mapping" sub={`Auto-mapping confidence was ${pct(pending.proposal.confidence)} — below the auto-accept threshold, so please confirm. Best guesses are pre-filled and the confirmed mapping will be remembered for this seller.`} />
      <ErrorBox error={act.error} />
      <div className="form-grid">
        {CANONICAL_FIELDS.map((f: CanonicalField) => (
          <Field key={f} label={`${f}${REQUIRED_FIELDS.includes(f) ? ' *' : ''}`}>
            <select className="input" value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })}>
              <option value="">— not present —</option>
              {pending.headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </Field>
        ))}
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="t">
          <thead><tr>{pending.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{pending.sampleRows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="nowrap">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={missing.length > 0 || act.busy} onClick={() => act.run(() => api.confirmMapping(lotId, mapping))}>Confirm mapping</button>
        {missing.length > 0 ? <span className="muted small">Required: {missing.join(', ')}</span> : null}
      </div>
    </Card>
  );
}

// ---- listing context ----

function ContextSection({ lotId, context, onDone }: { lotId: number; context: ListingContext; onDone: () => Promise<void> }) {
  const toForm = (c: ListingContext) => ({
    currentBid: c.currentBid?.toString() ?? '',
    bidCount: c.bidCount?.toString() ?? '',
    endTime: c.endTime ? new Date(c.endTime).toISOString().slice(0, 16) : '',
    premium: String(Math.round(c.buyersPremiumRate * 100)),
    shippingType: c.shippingType ?? '',
    freightQuote: c.freightQuote?.toString() ?? '',
    sellerZip: c.sellerZip ?? '',
    palletCount: c.palletCount?.toString() ?? '',
    weightClass: c.weightClass ?? 'standard',
    marketplace: c.marketplace ?? '',
  });
  const [f, setF] = useState(toForm(context));
  useEffect(() => setF(toForm(context)), [context]);
  const act = useAction(onDone);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = () =>
    act.run(() =>
      api.saveContext(lotId, {
        currentBid: numOrNull(f.currentBid),
        bidCount: numOrNull(f.bidCount),
        endTime: f.endTime ? new Date(`${f.endTime}Z`).toISOString() : null,
        buyersPremiumRate: (numOrNull(f.premium) ?? 10) / 100,
        shippingType: (f.shippingType || null) as ListingContext['shippingType'],
        freightQuote: numOrNull(f.freightQuote),
        sellerZip: f.sellerZip.trim() || null,
        palletCount: numOrNull(f.palletCount),
        weightClass: (f.weightClass || null) as ListingContext['weightClass'],
        marketplace: f.marketplace.trim() || null,
      }),
    );
  return (
    <Card>
      <CardHead title="Listing context" sub="From the listing page — entered by you. Never scraped." />
      <ErrorBox error={act.error} />
      <div className="form-grid">
        <Field label="Current bid ($)"><input className="input" type="number" min={0} value={f.currentBid} onChange={set('currentBid')} /></Field>
        <Field label="Number of bids"><input className="input" type="number" min={0} value={f.bidCount} onChange={set('bidCount')} /></Field>
        <Field label="Auction end (UTC)"><input className="input" type="datetime-local" value={f.endTime} onChange={set('endTime')} /></Field>
        <Field label="Buyer's premium (%)"><input className="input" type="number" min={0} max={100} value={f.premium} onChange={set('premium')} /></Field>
        <Field label="Shipping type">
          <select className="input" value={f.shippingType} onChange={set('shippingType')}>
            <option value="">—</option>
            <option value="buyer-freight">Buyer arranges freight</option>
            <option value="seller-flat-rate">Seller flat rate</option>
            <option value="free">Free shipping</option>
            <option value="pickup">Local pickup</option>
          </select>
        </Field>
        <Field label="Freight quote ($, if you have one)"><input className="input" type="number" min={0} value={f.freightQuote} onChange={set('freightQuote')} /></Field>
        <Field label="Seller zip (for freight estimate)"><input className="input" value={f.sellerZip} onChange={set('sellerZip')} /></Field>
        <Field label="Pallet count"><input className="input" type="number" min={1} value={f.palletCount} onChange={set('palletCount')} /></Field>
        <Field label="Weight class">
          <select className="input" value={f.weightClass} onChange={set('weightClass')}>
            <option value="light">Light</option>
            <option value="standard">Standard</option>
            <option value="heavy">Heavy</option>
          </select>
        </Field>
        <Field label="Marketplace"><input className="input" value={f.marketplace} onChange={set('marketplace')} /></Field>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={act.busy} onClick={save}>Save context</button>
      </div>
    </Card>
  );
}

// ---- manifest upload / manual items ----

function UploadSection({ lotId, onDone }: { lotId: number; onDone: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const act = useAction(onDone);
  return (
    <Card>
      <CardHead title="Upload manifest" sub="This lot has no line items yet. Attach the manifest file (.xlsx or .csv) you downloaded from the listing — columns will auto-map, or you'll get the confirmation screen." />
      <ErrorBox error={act.error} />
      <div className="row">
        <input className="input" style={{ maxWidth: 360 }} type="file" accept=".csv,.xlsx,.xls,.tsv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn primary" disabled={!file || act.busy} onClick={() => act.run(async () => api.uploadManifest(lotId, { data: await file!.arrayBuffer(), filename: file!.name }))}>Upload &amp; map columns</button>
      </div>
    </Card>
  );
}

function ManualItemSection({ lotId, onDone }: { lotId: number; onDone: () => Promise<void> }) {
  const empty = { description: '', quantity: '1', unitMsrp: '', condition: CONDITION_GRADES[0] as string, category: '' };
  const [f, setF] = useState(empty);
  const act = useAction(async () => { await onDone(); setF(empty); });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <CardHead title="Add line item manually" sub="Unmanifested lot — enter what the listing describes." />
      <ErrorBox error={act.error} />
      <div className="form-grid">
        <Field label="Description"><input className="input" value={f.description} onChange={set('description')} /></Field>
        <Field label="Quantity"><input className="input" type="number" min={1} value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Unit MSRP ($)"><input className="input" type="number" min={0} value={f.unitMsrp} onChange={set('unitMsrp')} /></Field>
        <Field label="Condition">
          <select className="input" value={f.condition} onChange={set('condition')}>
            {CONDITION_GRADES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Category"><input className="input" value={f.category} onChange={set('category')} /></Field>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!f.description.trim() || act.busy} onClick={() => act.run(() => api.addItem(lotId, { description: f.description.trim(), quantity: Number(f.quantity) || 1, unitMsrp: numOrNull(f.unitMsrp), condition: f.condition, category: f.category.trim() || null }))}>Add item</button>
      </div>
    </Card>
  );
}

// ---- comps ----

function researchLinks(item: LineItem): { label: string; url: string }[] {
  const byId = !!item.identifier && (item.identifierType === 'UPC' || item.identifierType === 'model');
  const q = encodeURIComponent(byId ? item.identifier! : item.description);
  const qDesc = encodeURIComponent(item.description);
  return [
    { label: 'Costco', url: `https://www.costco.com/CatalogSearch?dept=All&keyword=${byId && item.identifierType === 'model' ? q : qDesc}` },
    { label: 'eBay sold', url: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1` },
    { label: 'FB Mktpl', url: `https://www.facebook.com/marketplace/search/?query=${qDesc}` },
    { label: 'Google', url: `https://www.google.com/search?q=${q}&udm=28` },
    item.identifierType === 'ASIN' && item.identifier
      ? { label: 'Amazon', url: `https://www.amazon.com/dp/${encodeURIComponent(item.identifier)}` }
      : { label: 'Amazon', url: `https://www.amazon.com/s?k=${qDesc}` },
  ];
}

function CompsSection({ items, onDone }: { items: TopItem[]; onDone: () => Promise<void> }) {
  const toForm = (list: TopItem[]) => Object.fromEntries(list.map(({ item, comps }) => [item.id, { prices: comps.join(', '), retail: item.currentRetail?.toString() ?? '' }]));
  const [f, setF] = useState<Record<number, { prices: string; retail: string }>>(toForm(items));
  useEffect(() => setF(toForm(items)), [items]);
  const act = useAction(onDone);
  const save = () =>
    act.run(async () => {
      for (const { item } of items) {
        const row = f[item.id] ?? { prices: '', retail: '' };
        await api.setComps(item.id, row.prices.trim() === '' ? [] : parseNumbers(row.prices), numOrNull(row.retail));
      }
    });
  return (
    <Card flush>
      <CardHead title="Comps for top-value items" sub={<>Enter recent <b>sold</b> prices (e.g. eBay sold listings), comma-separated. ≥3 prices per item = high confidence; items without comps fall back to a conservative MSRP floor. "Current retail" is today's listed price on the retailer's site — it becomes the compare-at price on your own listings and does not change the valuation.</>} />
      <div style={{ padding: '0 16px' }}><ErrorBox error={act.error} /></div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Manifest MSRP</th><th className="num">Ext. retail</th><th>Sold prices ($)</th><th>Current retail ($)</th></tr></thead>
          <tbody>
            {items.map(({ item, comps }) => (
              <tr key={item.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{item.description}</div>
                  <div className="muted tiny">{item.identifierType} {item.identifier ?? ''} · {item.conditionGrade}{comps.length ? ` · ${comps.length} comp${comps.length === 1 ? '' : 's'}` : ''}</div>
                  <div className="row" style={{ gap: 4, marginTop: 4 }}>
                    {researchLinks(item).map((l) => <a key={l.label} className="chip clickable" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
                  </div>
                </td>
                <td className="num">{item.quantity}</td>
                <td className="num">{money(item.unitMsrp, { cents: true })}</td>
                <td className="num">{money(item.quantity * (item.unitMsrp ?? 0))}</td>
                <td><input className="input sm" style={{ minWidth: 150 }} placeholder="e.g. 42, 38.50, 45" value={f[item.id]?.prices ?? ''} onChange={(e) => setF({ ...f, [item.id]: { ...(f[item.id] ?? { retail: '' }), prices: e.target.value } })} /></td>
                <td><input className="input sm num" style={{ maxWidth: 110 }} type="number" min={0} step="0.01" placeholder="today's price" value={f[item.id]?.retail ?? ''} onChange={(e) => setF({ ...f, [item.id]: { ...(f[item.id] ?? { prices: '' }), retail: e.target.value } })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ padding: '12px 16px' }}>
        <button className="btn primary" disabled={act.busy} onClick={save}>Save comps &amp; re-analyze</button>
      </div>
    </Card>
  );
}

// ---- analysis ----

function AnalysisSection({ a }: { a: Analysis }) {
  const v = a.verdict;
  const isBid = v.decision === 'BID';
  const conf = a.valuation.confidenceShares;
  return (
    <>
      <div className={`verdict ${isBid ? 'bid' : 'pass'}`}>
        <h2>{isBid ? <>BID ≤ <Flag fa={v.maxBid} /></> : 'PASS'}</h2>
        {isBid ? (
          <p className="small" style={{ marginTop: 6 }}><b>This is your walk-away number.</b> Place one proxy bid at this amount and stop. B-Stock uses proxy bidding with popcorn extensions — sniping doesn't work, and bidding "a little more to win" only means overpaying. If the price passes your number, the lot was never yours.</p>
        ) : (
          <>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{v.passReasons.map((r) => <li key={r}>{r}</li>)}</ul>
            {v.maxBid && v.maxBid.amount > 0 ? <p className="small" style={{ marginTop: 6 }}>For reference, your walk-away number would be <b><Flag fa={v.maxBid} /></b>.</p> : null}
          </>
        )}
      </div>

      {v.estimateWarnings.length > 0 ? (
        <div className="warn-box">
          <b>Estimates in play (numbers marked ~*):</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{v.estimateWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      ) : null}

      {a.valuation.hasGrailRisk ? (
        <div className="info-box">
          <div className="micro" style={{ color: 'inherit' }}>Grail risk</div>
          Over 40% of this lot's value sits in {a.valuation.grailItemIds.length} item{a.valuation.grailItemIds.length === 1 ? '' : 's'}. Full valuation: <b><Flag fa={a.valuation.expectedRevenue} /></b> · grails-excluded ("bread &amp; butter"): <b><Flag fa={a.valuation.breadAndButterRevenue} /></b>. The recommended max bid is computed from the grails-excluded number.
        </div>
      ) : null}

      {a.marketEstimate ? (
        <div className="info-box">
          <div className="micro" style={{ color: 'inherit' }}>Market estimate — not your number</div>
          Based on {a.marketEstimate.sampleSize} logged finals for this seller/category, similar lots close between <b>{money(a.marketEstimate.low)}</b> and <b>{money(a.marketEstimate.high)}</b> ({pct(a.marketEstimate.lowPctOfRetail)}–{pct(a.marketEstimate.highPctOfRetail)} of extended retail). Your walk-away number above is a budget fact; this range is only a prediction of what others may pay.
        </div>
      ) : null}

      <div className="grid-4">
        <Kpi label="Walk-away max bid" value={<Flag fa={v.maxBid} />} sub="one proxy bid, then stop" />
        <Kpi label="Landed unit price" value={<Flag fa={a.bid.landedUnitPrice} cents />} sub="all-in cost per unit at max bid" />
        <Kpi label="Expected revenue" value={<Flag fa={a.bid.expectedRevenue} />} sub={a.valuation.hasGrailRisk ? 'grails excluded' : 'all line items'} />
        <Kpi label="Total units" value={a.bid.totalUnits} sub={`across ${a.valuation.items.length} line items`} />
      </div>

      <div className="split">
        <Card>
          <CardHead title="The numbers" />
          <table className="t">
            <tbody>
              <tr><td>Expected revenue{a.valuation.hasGrailRisk ? ' (grails excluded)' : ''}</td><td className="num"><Flag fa={a.bid.expectedRevenue} /></td></tr>
              <tr><td>− Selling costs ({pct(a.bid.sellingFeeRate)})</td><td className="num"><Flag fa={a.bid.sellingCosts} /></td></tr>
              <tr><td>− Required profit</td><td className="num"><Flag fa={a.bid.requiredProfit} /></td></tr>
              <tr><td><b>= Total budget</b></td><td className="num"><b><Flag fa={a.bid.totalBudget} /></b></td></tr>
              <tr><td>− Freight</td><td className="num"><Flag fa={a.bid.freight} /></td></tr>
              <tr><td>= Auction budget</td><td className="num"><Flag fa={a.bid.auctionBudget} /></td></tr>
              <tr><td><b>Max bid</b> (÷ 1 + {pct(a.bid.buyersPremiumRate)} premium, floored)</td><td className="num"><b><Flag fa={a.bid.maxBid} /></b></td></tr>
              <tr><td>Landed unit price ({a.bid.totalUnits} units)</td><td className="num"><Flag fa={a.bid.landedUnitPrice} cents /></td></tr>
              <tr><td className="muted">Extended retail (for reference only — not value)</td><td className="num muted">{money(a.valuation.extendedRetail)}</td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 16 }}>Valuation confidence</h3>
          <div className="conf" style={{ marginTop: 8 }}>
            <div className="h" style={{ width: `${conf.high * 100}%` }} />
            <div className="m" style={{ width: `${conf.medium * 100}%` }} />
            <div className="l" style={{ width: `${conf.low * 100}%` }} />
          </div>
          <div className="legend" style={{ marginTop: 6 }}>
            <span><span className="sw" style={{ background: 'var(--good)' }} />{pct(conf.high)} high (≥3 comps)</span>
            <span><span className="sw" style={{ background: '#d99a2b' }} />{pct(conf.medium)} medium (1–2)</span>
            <span><span className="sw" style={{ background: '#c5ccd6' }} />{pct(conf.low)} low (MSRP floor)</span>
            {a.valuation.unverifiedValueShare > 0 ? <span><b>{pct(a.valuation.unverifiedValueShare)} unverifiable</b> (no identifiers)</span> : null}
          </div>
        </Card>
        <Card>
          <CardHead title={`Why ${isBid ? 'this could be a deal' : 'this is a pass'}`} />
          <div className="stack">
            {a.rationale.map((s) => (
              <div key={s.topic}>
                <div className="micro">{s.title}</div>
                <p className="small">{s.text}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

// ---- outcome ----

function OutcomeSection({ lotId, outcome, stage, onDone }: { lotId: number; outcome: Outcome | null; stage: string; onDone: () => Promise<void> }) {
  const toForm = (o: Outcome | null) => ({ won: o ? String(o.won) : '', finalPrice: o?.finalPrice?.toString() ?? '', grossRecovered: o?.grossRecovered?.toString() ?? '' });
  const [f, setF] = useState(toForm(outcome));
  useEffect(() => setF(toForm(outcome)), [outcome]);
  const act = useAction(onDone);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <CardHead
        title="Log outcome"
        sub="Recording what actually happened calibrates future recovery rates and closing-range predictions. A won lot moves to Won and waits for check-in; a lost one closes."
        right={outcome ? <Pill tone={outcome.won ? 'good' : 'gray'}>{outcome.won ? `Won${outcome.finalPrice !== null ? ` · ${money(outcome.finalPrice, { cents: true })}` : ''}` : 'Lost'}</Pill> : null}
      />
      <ErrorBox error={act.error} />
      <div className="form-grid">
        <Field label="Result">
          <select className="input" value={f.won} onChange={set('won')}>
            <option value="">—</option>
            <option value="true">Won</option>
            <option value="false">Lost</option>
          </select>
        </Field>
        <Field label="Final price ($)" hint="Winning bid before premium and freight"><input className="input" type="number" min={0} step="0.01" value={f.finalPrice} onChange={set('finalPrice')} /></Field>
        <Field label="Actual gross recovered ($, later)"><input className="input" type="number" min={0} step="0.01" value={f.grossRecovered} onChange={set('grossRecovered')} /></Field>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={f.won === '' || act.busy} onClick={() => act.run(() => api.outcome(lotId, { won: f.won === 'true', finalPrice: numOrNull(f.finalPrice), grossRecovered: numOrNull(f.grossRecovered) }))}>Save outcome</button>
        {outcome?.won && (stage === 'won') ? <Link to={`/receive/${lotId}`} className="btn">Check in →</Link> : null}
      </div>
      {outcome ? <ProgressNote outcome={outcome} /> : null}
    </Card>
  );
}

function ProgressNote({ outcome }: { outcome: Outcome }) {
  if (outcome.predictedRevenue === null && outcome.predictedMaxBid === null) return null;
  return (
    <div className="muted tiny" style={{ marginTop: 10 }}>
      Snapshot at record time: predicted revenue {money(outcome.predictedRevenue)} · predicted max bid {money(outcome.predictedMaxBid)}.
      {outcome.won && outcome.finalPrice !== null && outcome.predictedMaxBid !== null ? (
        <span> You paid {outcome.finalPrice <= outcome.predictedMaxBid ? 'at or under' : 'over'} your walk-away number.</span>
      ) : null}
      {outcome.grossRecovered !== null && outcome.predictedRevenue ? (
        <div style={{ marginTop: 6, maxWidth: 320 }}>
          <div className="between tiny"><span>Recovered vs predicted</span><span>{pct(outcome.grossRecovered / outcome.predictedRevenue)}</span></div>
          <Progress value={outcome.grossRecovered} max={outcome.predictedRevenue} />
        </div>
      ) : null}
    </div>
  );
}
