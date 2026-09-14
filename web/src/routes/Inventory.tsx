import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Channel, type InventoryView, type InventoryViewResponse, type ListingView } from '../api/client.ts';
import { useApi, useAction } from '../lib/useApi.ts';
import { money, pct, todayIso, numOrNull } from '../lib/fmt.ts';
import { Card, CardHead, Pill, Chip, Kpi, Segmented, Drawer, Field, ErrorBox, Loading, Empty, Toggle } from '../components/ui.tsx';

type Tab = 'onhand' | 'listed' | 'sold' | 'parts';
type Condition = 'like-new' | 'good' | 'fair' | 'poor';

const CONDITIONS: Condition[] = ['like-new', 'good', 'fair', 'poor'];
const CONDITION_LABEL: Record<string, string> = { 'like-new': 'Like new', good: 'Good', fair: 'Fair', poor: 'Poor' };
const SHORT: Record<string, string> = { 'Facebook Marketplace': 'FB', Craigslist: 'CL' };
const short = (name: string): string => SHORT[name] ?? name;

function feeNote(c: Channel, shipped: boolean): string {
  const p = shipped && c.shippedFeePercent !== null ? c.shippedFeePercent : c.feePercent;
  const f = shipped && c.shippedFeeFixed !== null ? c.shippedFeeFixed : c.feeFixed;
  const parts: string[] = [];
  if (p > 0) parts.push(pct(p, 2).replace(/\.?0+%$/, '%'));
  if (f > 0) parts.push(money(f, { cents: true }));
  return parts.length ? parts.join(' + ') : '0%';
}

function matchesTab(i: InventoryView, tab: Tab): boolean {
  switch (tab) {
    case 'onhand': return i.remaining > 0 && i.kind === 'unit';
    case 'listed': return i.state === 'listed';
    case 'sold': return i.state === 'sold';
    case 'parts': return i.kind === 'parts';
  }
}

export function Inventory() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const data = useApi(() => api.inventory());
  const ai = useApi(() => api.aiStatus());
  const [tab, setTab] = useState<Tab>('onhand');
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('all');
  const [lot, setLot] = useState('all');
  const [adding, setAdding] = useState(false);
  const [presetChannel, setPresetChannel] = useState<number | null>(null);

  const selectedId = id ? Number(id) : null;
  const selected = selectedId !== null ? data.data?.items.find((i) => i.id === selectedId) ?? null : null;

  const lots = useMemo(() => {
    const s = new Set<number>();
    data.data?.items.forEach((i) => { if (i.lotId !== null) s.add(i.lotId); });
    return [...s].sort((a, b) => b - a);
  }, [data.data]);

  const filtered = useMemo(() => {
    const items = data.data?.items ?? [];
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (!matchesTab(i, tab)) return false;
      if (q && !`${i.name} ${i.family ?? ''} ${i.description ?? ''}`.toLowerCase().includes(q)) return false;
      if (channel !== 'all' && !i.listings.some((l) => l.status === 'active' && l.channelId === Number(channel))) return false;
      if (lot !== 'all' && i.lotId !== Number(lot)) return false;
      return true;
    });
  }, [data.data, tab, search, channel, lot]);

  const avgChannels = useMemo(() => {
    const listed = (data.data?.items ?? []).filter((i) => i.state === 'listed');
    if (listed.length === 0) return 0;
    return Math.round((listed.reduce((s, i) => s + i.listings.filter((l) => l.status === 'active').length, 0) / listed.length) * 10) / 10;
  }, [data.data]);

  const open = (itemId: number, chan: number | null = null) => {
    setPresetChannel(chan);
    nav(`/inventory/${itemId}`);
  };
  const close = () => {
    setPresetChannel(null);
    nav('/inventory');
  };

  if (data.error) return <main className="page"><ErrorBox error={data.error} /></main>;
  if (!data.data) return <main className="page"><Loading /></main>;
  const d: InventoryViewResponse = data.data;
  const enabled = d.channels.filter((c) => c.enabled);

  return (
    <main className="page">
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <h1>Inventory</h1>
          <Segmented value={tab} options={[{ value: 'onhand', label: 'On hand' }, { value: 'listed', label: 'Listed' }, { value: 'sold', label: 'Sold' }, { value: 'parts', label: 'Parts' }]} onChange={setTab} />
        </div>
        <div className="actions">
          <input className="input" style={{ width: 200 }} placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input" style={{ width: 150 }} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All channels</option>
            {d.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input" style={{ width: 120 }} value={lot} onChange={(e) => setLot(e.target.value)}>
            <option value="all">All lots</option>
            {lots.map((l) => <option key={l} value={l}>Lot #{l}</option>)}
          </select>
          <button className="btn primary" onClick={() => setAdding(true)}>+ Add item</button>
        </div>
      </div>

      {adding ? <AddItem onDone={async (created) => { setAdding(false); await data.reload(); if (created) open(created); }} onCancel={() => setAdding(false)} /> : null}

      <div className="grid-4">
        <Kpi label="On hand" value={d.summary.onHandUnits} unit="units" />
        <Kpi label="Cost tied up" value={money(d.summary.costTiedUp)} />
        <Kpi label="Listed" value={d.summary.listedItems} unit={d.summary.listedItems > 0 ? `on ${avgChannels} channels avg` : undefined} />
        <Kpi label="Avg days on shelf" value={d.summary.avgDaysOnShelf} sub={d.summary.carryingRatePerItemDay > 0 ? `${money(d.summary.carryingRatePerItemDay, { cents: true })} storage per item-day` : 'no storage costs set'} />
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <Empty>{d.items.length === 0 ? 'Nothing in inventory yet — check in a won lot or add an item.' : 'No items match these filters.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Item</th><th>Condition</th><th className="num">Cost</th><th className="num">Days</th><th>Channels</th><th className="num">Best net</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const active = i.listings.filter((l) => l.status === 'active');
                  const listedOn = new Set(i.listings.filter((l) => l.status === 'active' || l.status === 'draft').map((l) => l.channelId));
                  const rowClass = i.remaining > 0 ? (i.aging === 'cut' ? 'cut' : i.aging === 'warn' ? 'warn' : '') : '';
                  return (
                    <tr key={i.id} className={`clickable ${rowClass} ${selectedId === i.id ? 'open' : ''}`} onClick={() => open(i.id)}>
                      <td>
                        <b>{i.name}</b>
                        <div className="muted tiny">
                          {[i.lotId !== null ? `Lot #${i.lotId}` : 'no lot', i.family, i.kind === 'parts' ? 'parts' : null, i.remaining > 0 ? `×${i.remaining}` : `×${i.qty} sold`].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td>{i.condition ? <Pill tone={i.kind === 'parts' ? 'warn' : 'gray'}>{i.kind === 'parts' ? 'Parts' : CONDITION_LABEL[i.condition]}</Pill> : <span className="faint">—</span>}</td>
                      <td className="num">{money(i.cost, { cents: true })}</td>
                      <td className="num">{i.remaining === 0 ? <span className="faint">—</span> : i.aging === 'ok' ? i.daysOnShelf : <Pill tone={i.aging === 'cut' ? 'bad' : 'warn'}>{i.daysOnShelf}</Pill>}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {active.map((l) => <Chip key={l.id} live title={`net ${money(l.net, { cents: true })}`}>{short(l.channelName)} {money(l.ask)}</Chip>)}
                          {i.remaining > 0 ? enabled.filter((c) => !listedOn.has(c.id)).map((c) => (
                            <Chip key={c.id} draft onClick={() => open(i.id, c.id)} title={`List on ${c.name}`}>+ {short(c.name)}</Chip>
                          )) : null}
                        </div>
                      </td>
                      <td className="num">{i.bestNet ? <><b>{money(i.bestNet.net)}</b> <span className="muted tiny">{short(i.bestNet.channelName)}</span></> : <span className="faint">—</span>}</td>
                      <td><Pill tone={i.state === 'listed' ? 'good' : 'gray'}>{i.state === 'unlisted' ? 'Unlisted' : i.state === 'listed' ? 'Listed' : 'Sold'}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="between muted small" style={{ padding: '10px 16px' }}>
          <span>Showing {filtered.length} of {d.items.length} items</span>
        </div>
      </Card>

      {selected ? (
        <ItemDrawer
          key={selected.id}
          item={selected}
          channels={d.channels}
          settings={d.settings}
          aiEnabled={ai.data?.enabled ?? false}
          reload={data.reload}
          onClose={close}
          initialSell={params.get('sell') === '1'}
          presetChannelId={presetChannel}
        />
      ) : null}
    </main>
  );
}

function AddItem({ onDone, onCancel }: { onDone: (id: number | null) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: '', qty: '1', cost: '', currentRetail: '', condition: 'good' as Condition, description: '', lotId: '' });
  const act = useAction();
  const submit = async () => {
    const r = await act.run(() => api.addInventory({
      name: f.name.trim(),
      qty: Math.max(1, Math.round(Number(f.qty) || 1)),
      cost: numOrNull(f.cost),
      currentRetail: numOrNull(f.currentRetail),
      condition: f.condition,
      description: f.description.trim() || null,
      lotId: f.lotId.trim() ? Number(f.lotId) : null,
    }));
    if (r) onDone(r.id);
  };
  return (
    <Card>
      <div className="between" style={{ marginBottom: 10 }}><h3>Add item</h3><button className="btn sm ghost" onClick={onCancel}>Cancel</button></div>
      <ErrorBox error={act.error} />
      <div className="form-grid">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dyson V10 Animal+" /></Field>
        <Field label="Qty"><input className="input num" type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="My cost (each)"><input className="input num" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="52.30" /></Field>
        <Field label="Current retail"><input className="input num" value={f.currentRetail} onChange={(e) => setF({ ...f, currentRetail: e.target.value })} placeholder="449.99" /></Field>
        <Field label="Condition">
          <select className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value as Condition })}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="From lot (id)" hint="Optional"><input className="input num" value={f.lotId} onChange={(e) => setF({ ...f, lotId: e.target.value })} /></Field>
      </div>
      <Field label="Description">
        <textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What buyers care about — copied from the retailer's page is fine." />
      </Field>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!f.name.trim() || act.busy} onClick={submit}>Add item</button>
      </div>
    </Card>
  );
}

function ItemDrawer({ item, channels, settings, aiEnabled, reload, onClose, initialSell, presetChannelId }: {
  item: InventoryView;
  channels: Channel[];
  settings: InventoryViewResponse['settings'];
  aiEnabled: boolean;
  reload: () => Promise<void>;
  onClose: () => void;
  initialSell: boolean;
  presetChannelId: number | null;
}) {
  const act = useAction(reload);
  const enabled = channels.filter((c) => c.enabled);
  const byId = new Map(channels.map((c) => [c.id, c]));
  const active = item.listings.filter((l) => l.status === 'active');
  const drafts = item.listings.filter((l) => l.status === 'draft');
  const closed = item.listings.filter((l) => l.status === 'ended' || l.status === 'sold');
  const listedOn = new Set([...active, ...drafts].map((l) => l.channelId));
  const cutPct = Math.round(settings.priceCutFraction * 100);

  // ---- add listing ----
  const [showAdd, setShowAdd] = useState(presetChannelId !== null);
  const firstFree = enabled.find((c) => !listedOn.has(c.id));
  const [addForm, setAddForm] = useState({
    channelId: String(presetChannelId ?? firstFree?.id ?? enabled[0]?.id ?? ''),
    ask: item.pricing?.target !== null && item.pricing?.target !== undefined ? String(item.pricing.target) : active[0] ? String(active[0].ask) : '',
    shipped: false,
    url: '',
  });
  const addListing = () => act.run(async () => {
    await api.addListing(item.id, { channelId: Number(addForm.channelId), ask: Number(addForm.ask), shipped: addForm.shipped, url: addForm.url.trim() || null });
    setShowAdd(false);
  });

  // ---- mark sold ----
  const [showSell, setShowSell] = useState(initialSell);
  const best = item.bestNet ? active.find((l) => l.id === item.bestNet!.listingId) ?? null : active[0] ?? null;
  const [sell, setSell] = useState({
    amount: best ? String(best.ask) : item.pricing?.target ? String(item.pricing.target) : '',
    qty: '1',
    via: best ? `listing:${best.id}` : 'none',
    soldAt: todayIso(),
    shipped: best?.shipped ?? false,
  });
  const prefillSell = (l: ListingView) => {
    setSell({ amount: String(l.ask), qty: '1', via: `listing:${l.id}`, soldAt: todayIso(), shipped: l.shipped });
    setShowSell(true);
  };
  const markSold = () => act.run(async () => {
    const [kind, idStr] = sell.via.split(':');
    await api.markSold(item.id, {
      amount: Number(sell.amount),
      qty: Math.max(1, Math.round(Number(sell.qty) || 1)),
      soldAt: sell.soldAt,
      listingId: kind === 'listing' ? Number(idStr) : null,
      channelId: kind === 'channel' ? Number(idStr) : null,
      shipped: sell.shipped,
    });
    setShowSell(false);
  });

  // ---- draft ----
  const [showDraft, setShowDraft] = useState(false);
  const [draftChannel, setDraftChannel] = useState(String(active[0]?.channelId ?? enabled[0]?.id ?? ''));
  const [draft, setDraft] = useState<{ text: string; source: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const draftAct = useAction();
  const makeDraft = async (useAi: boolean) => {
    const r = await draftAct.run(() => api.draft(item.id, { channelId: Number(draftChannel), useAi }));
    if (r) setDraft(r);
  };
  const copyDraft = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ---- edit ----
  const [showEdit, setShowEdit] = useState(false);
  const [edit, setEdit] = useState({
    name: item.name,
    condition: (item.condition ?? 'good') as Condition,
    cost: item.cost !== null ? String(item.cost) : '',
    currentRetail: item.currentRetail !== null ? String(item.currentRetail) : '',
    qty: String(item.qty),
    description: item.description ?? '',
  });
  useEffect(() => {
    setEdit({
      name: item.name,
      condition: (item.condition ?? 'good') as Condition,
      cost: item.cost !== null ? String(item.cost) : '',
      currentRetail: item.currentRetail !== null ? String(item.currentRetail) : '',
      qty: String(item.qty),
      description: item.description ?? '',
    });
  }, [item.name, item.condition, item.cost, item.currentRetail, item.qty, item.description]);
  const saveEdit = () => act.run(async () => {
    await api.updateInventory(item.id, {
      name: edit.name.trim(),
      condition: edit.condition,
      cost: numOrNull(edit.cost),
      currentRetail: numOrNull(edit.currentRetail),
      qty: Math.max(item.qtySold, Math.round(Number(edit.qty) || 1), 1),
      description: edit.description.trim() || null,
    });
    setShowEdit(false);
  });
  const remove = async () => {
    if (!window.confirm(`Delete "${item.name}" and its listings? Sales stay in the ledger.`)) return;
    const ok = await act.run(() => api.deleteInventory(item.id));
    if (ok) onClose();
  };

  const sub = [item.lotId !== null ? `Lot #${item.lotId}` : null, item.family, item.kind === 'parts' ? 'parts' : null, item.condition ? CONDITION_LABEL[item.condition] : null, `${item.remaining} of ${item.qty} left`].filter(Boolean).join(' · ');

  return (
    <Drawer open onClose={onClose} title={item.name} sub={sub} actions={<Pill tone={item.state === 'listed' ? 'good' : 'gray'}>{item.state === 'unlisted' ? 'Unlisted' : item.state === 'listed' ? 'Listed' : 'Sold'}</Pill>}>
      <ErrorBox error={act.error} />

      <section className="stack">
        <div className="between"><span className="micro">Channels · net after fees</span>{item.remaining > 0 && !showAdd ? <button className="btn sm" onClick={() => setShowAdd(true)}>+ Add listing</button> : null}</div>
        {active.length === 0 && drafts.length === 0 ? <div className="muted small">Not listed anywhere yet.</div> : null}
        {[...active, ...drafts].map((l) => {
          const c = byId.get(l.channelId);
          return (
            <div key={l.id} className="between" style={{ border: `1px ${l.status === 'draft' ? 'dashed' : 'solid'} ${l.status === 'draft' ? '#d5d9df' : 'var(--good-line)'}`, background: l.status === 'draft' ? 'transparent' : 'var(--good-plane)', borderRadius: 'var(--r)', padding: '8px 12px', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <b>{l.channelName}</b>{l.status === 'draft' ? <Pill tone="gray">draft</Pill> : null}
                <div className="muted tiny">ask {money(l.ask)}{l.shipped ? ' · shipped' : ' · local'} · fee {c ? feeNote(c, l.shipped) : '—'}{l.lastCutAt ? ` · cut ${new Date(l.lastCutAt).toLocaleDateString()}` : ''}</div>
              </div>
              <div className="row nowrap" style={{ flexWrap: 'nowrap' }}>
                <b>{money(l.net)}</b>
                {l.url ? <a className="btn sm" href={l.url} target="_blank" rel="noreferrer">Open ↗</a> : null}
                {l.status === 'draft' ? <button className="btn sm" onClick={() => act.run(() => api.updateListing(l.id, { status: 'active' }))}>Activate</button> : <button className="btn sm" onClick={() => prefillSell(l)}>Sold…</button>}
                <button className="btn sm ghost" title="End listing" onClick={() => act.run(() => api.updateListing(l.id, { status: 'ended' }))}>End</button>
              </div>
            </div>
          );
        })}
        {closed.length > 0 ? <div className="faint tiny">{closed.length} ended or sold listing{closed.length === 1 ? '' : 's'}</div> : null}

        {showAdd ? (
          <div className="stack" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 12 }}>
            <div className="form-grid">
              <Field label="Channel">
                <select className="input" value={addForm.channelId} onChange={(e) => setAddForm({ ...addForm, channelId: e.target.value })}>
                  {enabled.map((c) => <option key={c.id} value={c.id}>{c.name}{listedOn.has(c.id) ? ' (already listed)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Ask" hint={addForm.channelId && byId.get(Number(addForm.channelId)) ? `fee ${feeNote(byId.get(Number(addForm.channelId))!, addForm.shipped)}` : undefined}>
                <input className="input num" value={addForm.ask} onChange={(e) => setAddForm({ ...addForm, ask: e.target.value })} />
              </Field>
              <Field label="Shipped?"><div className="row" style={{ height: 32 }}><Toggle on={addForm.shipped} onChange={(v) => setAddForm({ ...addForm, shipped: v })} /><span className="muted small">{addForm.shipped ? 'shipped' : 'local pickup'}</span></div></Field>
              <Field label="Listing URL" hint="Optional"><input className="input" value={addForm.url} onChange={(e) => setAddForm({ ...addForm, url: e.target.value })} placeholder="https://…" /></Field>
            </div>
            <div className="row">
              <button className="btn sm primary" disabled={!addForm.channelId || numOrNull(addForm.ask) === null || act.busy} onClick={addListing}>Save listing</button>
              <button className="btn sm ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        ) : null}

        {item.remaining > 0 ? (
          <div className="row">
            <button className="btn sm primary" onClick={() => setShowSell((v) => !v)}>Mark sold…</button>
            {active.length > 0 ? <button className="btn sm" onClick={() => act.run(() => api.cutPrice(item.id))}>Cut price {cutPct}%</button> : null}
            <button className="btn sm" onClick={() => setShowDraft((v) => !v)}>Draft listing</button>
            <button className="btn sm" onClick={() => setShowEdit((v) => !v)}>Edit</button>
          </div>
        ) : (
          <div className="row"><button className="btn sm" onClick={() => setShowEdit((v) => !v)}>Edit</button></div>
        )}
      </section>

      {showSell && item.remaining > 0 ? (
        <section className="stack" style={{ border: '1px solid var(--good-line)', background: 'var(--good-plane)', borderRadius: 'var(--r)', padding: 12 }}>
          <span className="micro">Mark sold</span>
          <div className="form-grid">
            <Field label="Sold for (total)"><input className="input num" autoFocus value={sell.amount} onChange={(e) => setSell({ ...sell, amount: e.target.value })} /></Field>
            <Field label="Qty" hint={`${item.remaining} left`}><input className="input num" type="number" min={1} max={item.remaining} value={sell.qty} onChange={(e) => setSell({ ...sell, qty: e.target.value })} /></Field>
            <Field label="Via">
              <select className="input" value={sell.via} onChange={(e) => setSell({ ...sell, via: e.target.value })}>
                {active.map((l) => <option key={l.id} value={`listing:${l.id}`}>{l.channelName} listing ({money(l.ask)})</option>)}
                {enabled.filter((c) => !active.some((l) => l.channelId === c.id)).map((c) => <option key={c.id} value={`channel:${c.id}`}>{c.name}</option>)}
                <option value="none">Cash / no channel</option>
              </select>
            </Field>
            <Field label="Date"><input className="input" type="date" value={sell.soldAt} onChange={(e) => setSell({ ...sell, soldAt: e.target.value })} /></Field>
            <Field label="Shipped?"><div className="row" style={{ height: 32 }}><Toggle on={sell.shipped} onChange={(v) => setSell({ ...sell, shipped: v })} /><span className="muted small">{sell.shipped ? 'shipped' : 'local'}</span></div></Field>
          </div>
          <div className="row">
            <button className="btn sm primary" disabled={!(Number(sell.amount) > 0) || act.busy} onClick={markSold}>Record sale</button>
            <button className="btn sm ghost" onClick={() => setShowSell(false)}>Cancel</button>
          </div>
        </section>
      ) : null}

      {showDraft ? (
        <section className="stack">
          <span className="micro">Listing draft</span>
          <ErrorBox error={draftAct.error} />
          <div className="row">
            <select className="input sm" style={{ width: 190 }} value={draftChannel} onChange={(e) => setDraftChannel(e.target.value)}>
              {enabled.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn sm" disabled={draftAct.busy} onClick={() => makeDraft(false)}>Template draft</button>
            {aiEnabled ? <button className="btn sm" disabled={draftAct.busy} onClick={() => makeDraft(true)}>Ask Claude</button> : null}
            {draft ? <button className="btn sm" onClick={copyDraft}>{copied ? 'Copied ✓' : 'Copy'}</button> : null}
          </div>
          {draftAct.busy ? <div className="muted small">Drafting…</div> : null}
          {draft ? <pre className="draft">{draft.text}</pre> : null}
          {draft ? <div className="faint tiny">{draft.source === 'claude' ? 'Written by Claude — read it before posting.' : 'Template draft — edit before posting.'}</div> : null}
        </section>
      ) : null}

      <section className="stack">
        <span className="micro">Pricing</span>
        {item.pricing ? (
          <div className="grid-3" style={{ gap: 8 }}>
            <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '8px 10px' }}><div className="micro">Floor</div><div style={{ fontWeight: 600 }}>{money(item.pricing.floor)}</div><div className="muted tiny">breakeven after fees</div></div>
            <div style={{ border: '1px solid var(--accent)', borderRadius: 'var(--r)', padding: '8px 10px', background: 'var(--accent-tint)' }}><div className="micro" style={{ color: 'var(--accent)' }}>Target</div><div style={{ fontWeight: 600 }}>{money(item.pricing.target)}</div><div className="muted tiny">cost + your required profit</div></div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '8px 10px' }}><div className="micro">Ceiling</div><div style={{ fontWeight: 600 }}>{money(item.pricing.ceiling)}</div><div className="muted tiny">{item.condition && item.currentRetail !== null ? `${CONDITION_LABEL[item.condition].toLowerCase()} share of ${money(item.currentRetail)} retail` : 'set retail + condition'}</div></div>
          </div>
        ) : <div className="muted small">Add a cost or current retail to get floor / target / ceiling.</div>}
        <div className="micro" style={{ marginTop: 4 }}>Carrying cost</div>
        <div className="muted small">
          {item.remaining > 0
            ? `${item.daysOnShelf} day${item.daysOnShelf === 1 ? '' : 's'} on shelf · ${money(item.carryingCost, { cents: true })} storage so far · price auto-suggests a ${cutPct}% cut at ${settings.agingCutDays} days`
            : 'Sold out — nothing on the shelf.'}
        </div>
      </section>

      {showEdit ? (
        <section className="stack" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 12 }}>
          <span className="micro">Edit item</span>
          <div className="form-grid">
            <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Condition">
              <select className="input" value={edit.condition} onChange={(e) => setEdit({ ...edit, condition: e.target.value as Condition })}>
                {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
              </select>
            </Field>
            <Field label="My cost (each)"><input className="input num" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} /></Field>
            <Field label="Current retail"><input className="input num" value={edit.currentRetail} onChange={(e) => setEdit({ ...edit, currentRetail: e.target.value })} /></Field>
            <Field label="Qty" hint={item.qtySold > 0 ? `${item.qtySold} already sold` : undefined}><input className="input num" type="number" min={Math.max(1, item.qtySold)} value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: e.target.value })} /></Field>
          </div>
          <Field label="Description"><textarea className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <div className="between">
            <div className="row">
              <button className="btn sm primary" disabled={!edit.name.trim() || act.busy} onClick={saveEdit}>Save</button>
              <button className="btn sm ghost" onClick={() => setShowEdit(false)}>Cancel</button>
            </div>
            <button className="btn sm danger" onClick={remove}>Delete item</button>
          </div>
        </section>
      ) : null}

      {item.description && !showEdit ? (
        <details className="desc">
          <summary>Description</summary>
          <div className="muted small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{item.description}</div>
        </details>
      ) : null}
    </Drawer>
  );
}
