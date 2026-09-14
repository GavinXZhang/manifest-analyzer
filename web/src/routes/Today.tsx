import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, gcalUrl, type PunchCategory } from '../api/client.ts';
import { useApi, useAction } from '../lib/useApi.ts';
import { money, hours, longDate, shortDate, dayName, todayIso, relTime } from '../lib/fmt.ts';
import { Card, CardHead, Pill, Chip, Progress, Loading, ErrorBox, Empty, Field } from '../components/ui.tsx';

const CATEGORY_LABEL: Record<PunchCategory, string> = {
  receiving: 'Receiving', testing: 'Testing', listing: 'Listing', photos: 'Photos', shipping: 'Shipping', driving: 'Driving', admin: 'Admin', other: 'Other',
};

export function Today() {
  const today = useApi(() => api.today());
  const act = useAction(today.reload);
  const nav = useNavigate();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  if (today.error) return <main className="page"><ErrorBox error={today.error} /></main>;
  if (!today.data) return <main className="page"><Loading /></main>;
  const d = today.data;
  const running = d.timeCard.running;
  const elapsed = running ? (Date.now() - Date.parse(running.startedAt)) / 3600_000 : 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="micro">{longDate(d.today)}</div>
          <h1>Today</h1>
        </div>
        <div className="actions">
          <Link to="/money" className="btn">Log a sale</Link>
          <Link to="/lots?new=1" className="btn primary">+ New lot</Link>
        </div>
      </div>
      <ErrorBox error={act.error} />

      <div className="grid-3">
        <TimeCardCard running={running} elapsed={elapsed} weekHours={d.timeCard.weekHours} lastWeekHours={d.timeCard.lastWeekHours} profitPerHour={d.timeCard.profitPerHour} onClockOut={() => act.run(() => api.clockOut())} onClockIn={(c) => act.run(() => api.clockIn({ category: c }))} onSwitch={(c) => act.run(() => api.switchTask({ category: c }))} />

        {d.checkin.length > 0 ? (
          <Card>
            <CardHead title="Needs check-in" right={<Pill tone={d.checkin[0].overdue ? 'bad' : 'gray'}>{d.checkin[0].daysSinceWon}d since won</Pill>} />
            <div className="stack">
              <div style={{ fontWeight: 600 }}>{d.checkin[0].lot.name}</div>
              <div className="muted small">
                {d.checkin[0].summary.manifestUnits} units{d.checkin[0].landedUnitCost !== null ? ` · landed ${money(d.checkin[0].landedUnitCost, { cents: true })} / unit` : ''}
              </div>
              <div>
                <div className="between tiny" style={{ marginBottom: 4 }}>
                  <span>{d.checkin[0].summary.checked} of {d.checkin[0].summary.manifestUnits} checked</span>
                  <span className="muted">{d.checkin[0].summary.manifestUnits > 0 ? Math.round((d.checkin[0].summary.checked / d.checkin[0].summary.manifestUnits) * 100) : 0}%</span>
                </div>
                <Progress value={d.checkin[0].summary.checked} max={d.checkin[0].summary.manifestUnits} />
              </div>
              <div className="row small">
                <span><b>{d.checkin[0].summary.works}</b> <span className="muted">work</span></span>
                <span><b>{d.checkin[0].summary.incomplete + d.checkin[0].summary.weakBattery}</b> <span className="muted">incomplete</span></span>
                <span><b>{d.checkin[0].summary.dead}</b> <span className="muted">dead</span></span>
              </div>
              <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => nav(`/receive/${d.checkin[0].lot.id}`)}>
                {d.checkin[0].summary.checked > 0 ? 'Continue check-in' : 'Start check-in'}
              </button>
              {d.checkin.length > 1 ? <div className="faint tiny">+ {d.checkin.length - 1} more lot{d.checkin.length > 2 ? 's' : ''} waiting</div> : null}
            </div>
          </Card>
        ) : d.bidding.length > 0 ? (
          <Card>
            <CardHead title="Ending soonest" right={<Pill tone="warn">{relTime(d.bidding[0].endTime)}</Pill>} />
            <div className="stack">
              <div style={{ fontWeight: 600 }}>{d.bidding[0].lot.name}</div>
              <div className="muted small">{d.bidding[0].lot.seller} · {d.bidding[0].stage === 'bid_placed' ? 'bid placed' : 'analyzing'} · current {money(d.bidding[0].lot.context.currentBid)}</div>
              <Link to={`/lots/${d.bidding[0].lot.id}`} className="btn" style={{ alignSelf: 'flex-start' }}>Open lot</Link>
            </div>
          </Card>
        ) : (
          <Card>
            <CardHead title="Nothing to check in" />
            <div className="muted small">No won lots are waiting. Analyze a new manifest to keep the pipeline moving.</div>
            <Link to="/lots?new=1" className="btn" style={{ marginTop: 10, display: 'inline-flex' }}>+ New lot</Link>
          </Card>
        )}

        <Card>
          <CardHead title={new Date().toLocaleString('en-US', { month: 'long' })} right={<Link to="/money" className="small">Money →</Link>} />
          <div className="grid-2">
            <div>
              <div className="micro">Revenue</div>
              <div className="big" style={{ fontSize: 22 }}>{money(d.money.monthRevenue)}</div>
              {d.money.revenueDelta !== null ? <div className={`tiny ${d.money.revenueDelta >= 0 ? 'up' : 'down'}`}>{d.money.revenueDelta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(d.money.revenueDelta * 100))}% vs prior 30d</div> : null}
            </div>
            <div>
              <div className="micro">Net profit</div>
              <div className="big" style={{ fontSize: 22 }}>{money(d.money.monthNet)}</div>
              <div className="muted tiny">last 30 days, after fees</div>
            </div>
            <div><div className="micro">Cost tied up in inventory</div><div style={{ fontWeight: 600, fontSize: 15 }}>{money(d.money.costTiedUp)}</div></div>
            <div><div className="micro">Set aside for tax</div><div style={{ fontWeight: 600, fontSize: 15 }}>{money(d.money.taxSetAside)}</div></div>
          </div>
        </Card>
      </div>

      <div className="split">
        <Card flush>
          <CardHead title="Aging inventory" sub={d.aging.length ? `On the shelf past your threshold — each day costs ~${money(d.carryingRatePerItemDay, { cents: true })} in storage` : 'Nothing is aging right now'} right={<Link to="/inventory" className="small">All inventory →</Link>} />
          {d.aging.length === 0 ? (
            <Empty>Everything on the shelf is under {d.aging.length === 0 ? 'your aging threshold' : ''}.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Item</th><th className="num">Days</th><th>Listed on</th><th className="num">Ask</th><th /></tr></thead>
                <tbody>
                  {d.aging.map((i) => (
                    <tr key={i.id} className={i.aging === 'cut' ? 'cut' : 'warn'}>
                      <td><b>{i.name}</b><div className="muted tiny">cost {money(i.cost, { cents: true })} · {money(i.carryingCost, { cents: true })} storage so far</div></td>
                      <td className="num"><Pill tone={i.aging === 'cut' ? 'bad' : 'warn'}>{i.daysOnShelf}d</Pill></td>
                      <td>{i.listings.length ? i.listings.map((l) => <Chip key={l.id} live>{l.channelName} {money(l.ask)}</Chip>) : <span className="faint">not listed</span>}</td>
                      <td className="num">{money(i.bestAsk)}</td>
                      <td className="num">
                        {i.listings.length ? <button className="btn sm" onClick={() => act.run(() => api.cutPrice(i.id))}>Cut price</button> : <Link to={`/inventory/${i.id}`} className="btn sm">List it</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack" style={{ gap: 16 }}>
          <ComingUp events={d.events} reload={today.reload} />
          <Card>
            <CardHead title="Sold this week" />
            {d.recentSales.length === 0 ? <div className="muted small">No sales in the last 7 days.</div> : (
              <div className="stack" style={{ gap: 6 }}>
                {d.recentSales.map((s) => (
                  <div key={s.id} className="between small">
                    <span className="ellipsis">{s.itemName ?? s.note ?? 'Sale'} <span className="faint">{shortDate(s.soldAt)}</span></span>
                    <b>{money(s.amount)}</b>
                  </div>
                ))}
                <div className="between small" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
                  <span className="muted">{d.recentSales.length} sale{d.recentSales.length === 1 ? '' : 's'}</span>
                  <b>{money(d.recentSales.reduce((s, x) => s + x.amount, 0))}</b>
                </div>
              </div>
            )}
          </Card>
          {d.quickSell.length > 0 ? (
            <Card className="only-mobile">
              <CardHead title="Quick sell" right={<Link to="/inventory" className="small">All listed →</Link>} />
              <div className="stack" style={{ gap: 6 }}>
                {d.quickSell.map((q) => (
                  <div key={q.id} className="between small">
                    <span className="ellipsis">{q.name} {q.bestNet ? <span className="muted">{q.bestNet.channelName} {money(q.bestNet.net)}</span> : null}</span>
                    <Link to={`/inventory/${q.id}?sell=1`} className="btn sm">Sold…</Link>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function TimeCardCard({ running, elapsed, weekHours, lastWeekHours, profitPerHour, onClockOut, onClockIn, onSwitch }: {
  running: { category: PunchCategory; lotId: number | null; note: string | null; startedAt: string } | null;
  elapsed: number; weekHours: number; lastWeekHours: number; profitPerHour: number;
  onClockOut: () => void; onClockIn: (c: PunchCategory) => void; onSwitch: (c: PunchCategory) => void;
}) {
  const [category, setCategory] = useState<PunchCategory>('receiving');
  const [switching, setSwitching] = useState(false);
  return (
    <Card tone={running ? 'good' : undefined}>
      <CardHead title="Time card" right={running ? <Pill tone="good">● Clocked in {new Date(running.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Pill> : <Link to="/money" className="small">Week →</Link>} />
      {running ? (
        <div className="stack">
          <div className="big">{hours(elapsed)}</div>
          <div className="muted small">{CATEGORY_LABEL[running.category]}{running.note ? ` · ${running.note}` : ''}</div>
          {switching ? (
            <div className="row">
              <select className="input sm" style={{ width: 150 }} value={category} onChange={(e) => setCategory(e.target.value as PunchCategory)}>
                {(Object.keys(CATEGORY_LABEL) as PunchCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
              <button className="btn sm primary" onClick={() => { onSwitch(category); setSwitching(false); }}>Switch</button>
              <button className="btn sm ghost" onClick={() => setSwitching(false)}>Cancel</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn danger" onClick={onClockOut}>■ Clock out</button>
              <button className="btn" onClick={() => setSwitching(true)}>Switch task</button>
            </div>
          )}
        </div>
      ) : (
        <div className="stack">
          <div className="muted small">Not clocked in.</div>
          <Field label="Task">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as PunchCategory)}>
              {(Object.keys(CATEGORY_LABEL) as PunchCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </Field>
          <button className="btn primary" onClick={() => onClockIn(category)}>▶ Clock in</button>
        </div>
      )}
      <div className="between" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10, marginTop: 12 }}>
        <div><div className="micro">This week</div><div style={{ fontWeight: 600 }}>{hours(weekHours)}</div></div>
        <div><div className="micro">Earning</div><div style={{ fontWeight: 600 }}>{money(profitPerHour)} / hr</div></div>
        <div><div className="micro">Last week</div><div style={{ fontWeight: 600 }}>{hours(lastWeekHours)}</div></div>
      </div>
    </Card>
  );
}

function ComingUp({ events, reload }: { events: (import('../api/client.ts').CalendarEvent & { itemName: string | null })[]; reload: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [feed, setFeed] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', kind: 'delivery' as import('../api/client.ts').EventKind, date: todayIso(), time: '', contact: '' });
  const act = useAction(async () => { await reload(); setAdding(false); });
  return (
    <Card>
      <CardHead title="Coming up" right={<button className="btn sm ghost" onClick={async () => setFeed(feed ? null : (await api.feedInfo()).feedUrl)}>Subscribe in Google Calendar</button>} />
      {feed ? (
        <div className="info-box" style={{ marginBottom: 10 }}>
          In Google Calendar: <b>Other calendars → + → From URL</b>, paste:
          <div className="row" style={{ marginTop: 4 }}><code style={{ fontSize: 11, wordBreak: 'break-all' }}>{feed}</code><button className="btn sm" onClick={() => void navigator.clipboard.writeText(feed)}>Copy</button></div>
        </div>
      ) : null}
      <ErrorBox error={act.error} />
      <div className="stack">
        {events.length === 0 ? <div className="muted small">Nothing scheduled in the next two weeks.</div> : events.map((e) => (
          <div key={e.id} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <Pill tone="acc"><span style={{ width: 34, textAlign: 'center' }}>{dayName(e.date)}</span></Pill>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{e.title}{e.time ? ` · ${e.time}` : ''}</div>
              <div className="muted tiny">{[shortDate(e.date), e.kind, e.contact, e.itemName].filter(Boolean).join(' · ')}</div>
            </div>
            <a className="btn sm ghost" href={gcalUrl(e)} target="_blank" rel="noreferrer" title="Add to Google Calendar">+ GCal</a>
            <button className="btn sm ghost" onClick={() => act.run(() => api.deleteEvent(e.id))} aria-label="Delete">✕</button>
          </div>
        ))}
        {adding ? (
          <div className="stack" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
            <input className="input" placeholder="What (e.g. Deliver sofa to Cambridge)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div className="row">
              <select className="input sm" style={{ width: 110 }} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}>
                {['delivery', 'viewing', 'pickup', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input className="input sm" type="date" style={{ width: 140 }} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              <input className="input sm" type="time" style={{ width: 110 }} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              <input className="input sm" placeholder="Contact" style={{ width: 130 }} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </div>
            <div className="row">
              <button className="btn sm primary" disabled={!form.title || act.busy} onClick={() => act.run(() => api.addEvent({ title: form.title, kind: form.kind, date: form.date, time: form.time || null, contact: form.contact || null }))}>Save</button>
              <button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>+ Schedule</button>
        )}
      </div>
    </Card>
  );
}
