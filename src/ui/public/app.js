/* Manifest Analyzer SPA — vanilla JS, no build step. */

const main = document.getElementById('main');

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}
const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const usd = (n, dec = 0) => {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  const hasCents = Math.round(v * 100) % 100 !== 0;
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : dec,
    maximumFractionDigits: 2,
  })}`;
};

/* Every estimated number renders with ~ and an asterisk — nothing estimated may look hard. */
const flagged = (fa, dec = 0) => {
  if (fa === null || fa === undefined) return '—';
  const money = usd(fa.amount, dec);
  return fa.isEstimate
    ? `<span class="est" title="Estimate: ${esc(fa.estimateReasons.join(', '))}">~${money}</span>`
    : money;
};

const pct = (x) => `${Math.round(x * 100)}%`;

/*
 * One-click research links: open the retailer/marketplace search for an item
 * in YOUR browser. You do the looking and type the number in — nothing here
 * fetches or scrapes anything on your behalf.
 */
function researchLinks({ description, identifierType, identifier }) {
  const byId = identifier && (identifierType === 'UPC' || identifierType === 'model');
  const q = encodeURIComponent(byId ? identifier : description);
  const qDesc = encodeURIComponent(description);
  const links = [
    ['Costco', `https://www.costco.com/CatalogSearch?dept=All&keyword=${byId && identifierType === 'model' ? q : qDesc}`],
    ['eBay sold', `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`],
    ['FB Mktpl', `https://www.facebook.com/marketplace/search/?query=${qDesc}`],
    ['Google', `https://www.google.com/search?q=${q}&udm=28`],
    identifierType === 'ASIN' && identifier
      ? ['Amazon', `https://www.amazon.com/dp/${encodeURIComponent(identifier)}`]
      : ['Amazon', `https://www.amazon.com/s?k=${qDesc}`],
  ];
  return `<span class="research-links">${links
    .map(([label, url]) => `<a href="${url}" target="_blank" rel="noopener">${label}</a>`)
    .join('')}</span>`;
}

function showError(err) {
  const div = document.createElement('div');
  div.className = 'error-box';
  div.textContent = err.message || String(err);
  main.prepend(div);
  setTimeout(() => div.remove(), 6000);
}

const on = (sel, event, handler) => {
  document.querySelectorAll(sel).forEach((el) =>
    el.addEventListener(event, (e) => Promise.resolve(handler(e, el)).catch(showError)),
  );
};

/* ---------- charts (inline SVG, no libraries) ---------- */

const CHART = { w: 720, h: 210, padL: 52, padR: 16, padT: 14, padB: 26 };
const day = (s) => new Date(`${s}T00:00:00Z`).getTime();
const DAY_MS = 86_400_000;
const todayIso = () => new Date().toISOString().slice(0, 10);

function niceMax(v) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function dayRange(fromIso, toIso) {
  const days = [];
  for (let t = day(fromIso); t <= day(toIso); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

const shortDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/* Shared frame: gridlines, y labels, x date labels. Returns {open, close, x, y}. */
function chartFrame(days, yMax, yFmt) {
  const { w, h, padL, padR, padT, padB } = CHART;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const x = (iso) => padL + ((day(iso) - day(days[0])) / Math.max(day(days.at(-1)) - day(days[0]), DAY_MS)) * plotW;
  const y = (v) => padT + plotH - (v / yMax) * plotH;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    grid += `<line x1="${padL}" y1="${y(v)}" x2="${w - padR}" y2="${y(v)}" stroke="#e9edf3" stroke-width="1"/>
      <text x="${padL - 8}" y="${y(v) + 3.5}" text-anchor="end" class="axis-label">${yFmt(v)}</text>`;
  }
  const tickCount = Math.min(5, days.length);
  for (let i = 0; i < tickCount; i++) {
    const iso = days[Math.round((i * (days.length - 1)) / Math.max(tickCount - 1, 1))];
    grid += `<text x="${x(iso)}" y="${h - 7}" text-anchor="middle" class="axis-label">${shortDate(iso)}</text>`;
  }
  return {
    open: `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img">${grid}`,
    close: `</svg>`,
    x,
    y,
  };
}

const kUsd = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(v)}`);

/* Cumulative revenue as a step line: flat on no-sale days, up on sale days. */
function revenueChart(sales, fromIso) {
  const days = dayRange(fromIso, todayIso());
  const byDay = new Map();
  for (const s of sales) byDay.set(s.soldAt, (byDay.get(s.soldAt) ?? 0) + s.amount);
  let cum = 0;
  const points = days.map((d) => {
    cum += byDay.get(d) ?? 0;
    return { d, cum, sold: byDay.get(d) ?? 0 };
  });
  const yMax = niceMax(cum);
  const f = chartFrame(days, yMax, kUsd);

  let path = '';
  points.forEach((p, i) => {
    const px = f.x(p.d).toFixed(1);
    const py = f.y(p.cum).toFixed(1);
    path += i === 0 ? `M ${px} ${py}` : ` H ${px} V ${py}`;
  });

  const hitW = Math.max((CHART.w - CHART.padL - CHART.padR) / days.length, 8);
  const hits = points
    .map(
      (p) => `<rect x="${(f.x(p.d) - hitW / 2).toFixed(1)}" y="${CHART.padT}" width="${hitW.toFixed(1)}" height="${CHART.h - CHART.padT - CHART.padB}"
        fill="transparent" data-tip="${esc(`${shortDate(p.d)} — total ${usd(p.cum, 2)}${p.sold > 0 ? ` (+${usd(p.sold, 2)} that day)` : ' (no sales)'}`)}"/>`,
    )
    .join('');
  const last = points.at(-1);
  const endLabel = `<circle cx="${f.x(last.d)}" cy="${f.y(last.cum)}" r="4" fill="#2a78d6"/>
    <text x="${f.x(last.d) - 8}" y="${f.y(last.cum) - 9}" text-anchor="end" class="end-label">${usd(last.cum)}</text>`;
  return `${f.open}<path d="${path}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round"/>${endLabel}${hits}${f.close}`;
}

/* One dot per expense entry. */
function expenseChart(expenses, fromIso) {
  const days = dayRange(fromIso, todayIso());
  const yMax = niceMax(Math.max(...expenses.map((e) => e.amount)));
  const f = chartFrame(days, yMax, kUsd);
  const dots = expenses
    .map(
      (e) => `<g data-tip="${esc(`${shortDate(e.spentAt)} — ${usd(e.amount, 2)} · ${e.category}${e.note ? ` · ${e.note}` : ''}`)}">
        <circle cx="${f.x(e.spentAt).toFixed(1)}" cy="${f.y(e.amount).toFixed(1)}" r="10" fill="transparent"/>
        <circle cx="${f.x(e.spentAt).toFixed(1)}" cy="${f.y(e.amount).toFixed(1)}" r="4.5" fill="#eb6834" stroke="#fff" stroke-width="1.5"/>
      </g>`,
    )
    .join('');
  return `${f.open}${dots}${f.close}`;
}

/* One shared tooltip div, driven by [data-tip] elements. */
function wireTooltips() {
  let tip = document.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    document.body.appendChild(tip);
  }
  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      tip.textContent = el.dataset.tip;
      tip.style.display = 'block';
      tip.style.left = `${e.clientX + 14}px`;
      tip.style.top = `${e.clientY + 14}px`;
    });
    el.addEventListener('mouseleave', () => (tip.style.display = 'none'));
  });
}

/* ---------- router ---------- */

const CONDITIONS = ['new', 'like-new', 'customer-returns', 'salvage', 'unknown'];

let tickInterval = null;

async function route() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  const hash = location.hash.replace(/^#\/?/, '') || 'lots';
  const [view, arg] = hash.split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === (view === 'lot' ? 'lots' : view));
  });
  try {
    if (view === 'lots') await renderLots();
    else if (view === 'lot') await renderLot(Number(arg));
    else if (view === 'compare') await renderCompare();
    else if (view === 'history') await renderHistory();
    else if (view === 'inventory') await renderInventory();
    else if (view === 'listings') await renderListings();
    else if (view === 'storage') await renderStorage();
    else if (view === 'calendar') await renderCalendar();
    else if (view === 'taxes') await renderTaxes();
    else if (view === 'profile') await renderProfile();
    else location.hash = '#/lots';
  } catch (err) {
    main.innerHTML = '';
    showError(err);
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

/* ---------- lots list + upload ---------- */

async function renderLots() {
  const lots = await api('/lots');
  main.innerHTML = `
    <h2>New lot</h2>
    <div class="card">
      <div class="form-grid">
        <div><label>Lot name</label><input id="nl-name" placeholder="e.g. TL pallet #4471" /></div>
        <div><label>Seller / storefront</label><input id="nl-seller" placeholder="e.g. Amazon Liquidation Auctions" /></div>
        <div><label>Manifest file (.xlsx or .csv)</label><input id="nl-file" type="file" accept=".csv,.xlsx,.tsv,.txt" /></div>
        <div><label>Unmanifested lot</label><input id="nl-unman" type="checkbox" style="width:auto" /></div>
      </div>
      <p class="muted">Download the manifest from the listing page yourself, then upload it here.</p>
      <button id="nl-create">Create lot</button>
    </div>
    <h2>Analyzed lots</h2>
    ${lots.length === 0 ? '<p class="muted">No lots yet.</p>' : ''}
    ${lots
      .map(
        (l) => `
      <div class="card lot-card" data-id="${l.id}">
        <div>
          <strong>${esc(l.name)}</strong>
          <div class="muted">${esc(l.seller)} · ${l.itemCount} line items · ${new Date(l.createdAt).toLocaleDateString()}</div>
        </div>
        <div>
          ${l.mappingStatus === 'pending' ? '<span class="badge pending">needs column mapping</span>' : ''}
          ${l.unmanifested ? '<span class="badge pending">unmanifested</span>' : ''}
          <button class="small danger del-lot" data-id="${l.id}">Delete</button>
        </div>
      </div>`,
      )
      .join('')}
  `;

  on('#nl-create', 'click', async () => {
    const name = document.getElementById('nl-name').value.trim();
    const seller = document.getElementById('nl-seller').value.trim();
    const unmanifested = document.getElementById('nl-unman').checked;
    const file = document.getElementById('nl-file').files[0];
    if (!name || !seller) throw new Error('Name and seller are required');
    if (!unmanifested && !file) throw new Error('Upload a manifest, or mark the lot unmanifested');
    const q = `name=${encodeURIComponent(name)}&seller=${encodeURIComponent(seller)}&unmanifested=${unmanifested}`;
    const result = await api(`/lots?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file ? file.name : '' },
      body: file ? await file.arrayBuffer() : undefined,
    });
    location.hash = `#/lot/${result.lot.id}`;
  });

  on('.del-lot', 'click', async (e, el) => {
    e.stopPropagation();
    if (!confirm('Delete this lot and its history?')) return;
    await api(`/lots/${el.dataset.id}`, { method: 'DELETE' });
    route();
  });

  on('.lot-card', 'click', (_e, el) => {
    location.hash = `#/lot/${el.dataset.id}`;
  });
}

/* ---------- lot detail ---------- */

async function renderLot(id) {
  const { lot, items, pendingMapping } = await api(`/lots/${id}`);
  const parts = [
    `<h2>${esc(lot.name)} <span class="muted">· ${esc(lot.seller)}</span></h2>`,
  ];

  if (pendingMapping) {
    parts.push(mappingSection(pendingMapping));
  } else {
    parts.push(contextSection(lot));
    if (lot.unmanifested) parts.push(manualItemSection());
    if (items.length > 0) {
      const [topItems, analysis] = await Promise.all([
        api(`/lots/${id}/top-items?n=10`),
        api(`/lots/${id}/analysis`),
      ]);
      parts.push(compsSection(topItems));
      parts.push(analysisSection(analysis, lot));
      parts.push(outcomeSection());
    } else {
      parts.push(uploadManifestSection());
      parts.push(outcomeSection());
    }
  }
  main.innerHTML = parts.join('');
  wireLotHandlers(lot);
}

function mappingSection({ proposal, headers, sampleRows }) {
  const FIELDS = ['description', 'upc', 'asin', 'model', 'quantity', 'unit_msrp', 'condition', 'category'];
  const REQUIRED = ['description', 'quantity', 'unit_msrp'];
  const options = (selected) =>
    `<option value="">— not present —</option>` +
    headers.map((h) => `<option value="${esc(h)}" ${h === selected ? 'selected' : ''}>${esc(h)}</option>`).join('');
  return `
    <div class="card">
      <h3>Confirm column mapping</h3>
      <p class="muted">Auto-mapping confidence was ${pct(proposal.confidence)} — below the auto-accept
      threshold, so please confirm. Best guesses are pre-filled and the confirmed mapping will be
      remembered for this seller.</p>
      <div class="form-grid">
        ${FIELDS.map(
          (f) => `
          <div><label>${f}${REQUIRED.includes(f) ? ' *' : ''}</label>
          <select class="map-field" data-field="${f}">${options(proposal.mapping[f])}</select></div>`,
        ).join('')}
      </div>
      <div class="map-sample">
        <table>
          <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${sampleRows
            .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody>
        </table>
      </div>
      <button id="map-confirm">Confirm mapping</button>
    </div>`;
}

function contextSection(lot) {
  const c = lot.context;
  const endLocal = c.endTime ? new Date(c.endTime).toISOString().slice(0, 16) : '';
  const opt = (v, sel, label) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${label}</option>`;
  return `
    <div class="card">
      <h3>Listing context <span class="muted">(from the listing page — entered by you)</span></h3>
      <div class="form-grid">
        <div><label>Current bid ($)</label><input id="cx-bid" type="number" min="0" value="${c.currentBid ?? ''}" /></div>
        <div><label>Number of bids</label><input id="cx-count" type="number" min="0" value="${c.bidCount ?? ''}" /></div>
        <div><label>Auction end (UTC)</label><input id="cx-end" type="datetime-local" value="${endLocal}" /></div>
        <div><label>Buyer's premium (%)</label><input id="cx-prem" type="number" min="0" max="100" value="${Math.round(c.buyersPremiumRate * 100)}" /></div>
        <div><label>Shipping type</label>
          <select id="cx-ship">
            <option value="">—</option>
            ${opt('buyer-freight', c.shippingType, 'Buyer arranges freight')}
            ${opt('seller-flat-rate', c.shippingType, 'Seller flat rate')}
            ${opt('free', c.shippingType, 'Free shipping')}
            ${opt('pickup', c.shippingType, 'Local pickup')}
          </select></div>
        <div><label>Freight quote ($, if you have one)</label><input id="cx-freight" type="number" min="0" value="${c.freightQuote ?? ''}" /></div>
        <div><label>Seller zip (for freight estimate)</label><input id="cx-zip" value="${esc(c.sellerZip ?? '')}" /></div>
        <div><label>Pallet count</label><input id="cx-pallets" type="number" min="1" value="${c.palletCount ?? ''}" /></div>
        <div><label>Weight class</label>
          <select id="cx-weight">
            ${opt('light', c.weightClass ?? 'standard', 'Light')}
            ${opt('standard', c.weightClass ?? 'standard', 'Standard')}
            ${opt('heavy', c.weightClass ?? 'standard', 'Heavy')}
          </select></div>
        <div><label>Marketplace</label><input id="cx-marketplace" value="${esc(c.marketplace ?? '')}" /></div>
      </div>
      <button id="cx-save">Save context</button>
    </div>`;
}

function uploadManifestSection() {
  return `
    <div class="card">
      <h3>Upload manifest</h3>
      <p class="muted">This lot has no line items yet. Attach the manifest file (.xlsx or .csv) you
      downloaded from the listing — columns will auto-map, or you'll get the confirmation screen.</p>
      <input id="mf-file" type="file" accept=".csv,.xlsx,.tsv,.txt" />
      <button id="mf-upload">Upload &amp; map columns</button>
    </div>`;
}

function manualItemSection() {
  return `
    <div class="card">
      <h3>Add line item manually <span class="muted">(unmanifested lot)</span></h3>
      <div class="form-grid">
        <div><label>Description</label><input id="mi-desc" /></div>
        <div><label>Quantity</label><input id="mi-qty" type="number" min="1" value="1" /></div>
        <div><label>Unit MSRP ($)</label><input id="mi-msrp" type="number" min="0" /></div>
        <div><label>Condition</label><select id="mi-cond">${CONDITIONS.map((c) => `<option>${c}</option>`).join('')}</select></div>
        <div><label>Category</label><input id="mi-cat" /></div>
      </div>
      <button id="mi-add">Add item</button>
    </div>`;
}

function compsSection(topItems) {
  return `
    <div class="card">
      <h3>Comps for top-value items</h3>
      <p class="muted">Enter recent <strong>sold</strong> prices (e.g. eBay sold listings), comma-separated.
      ≥3 prices per item = high confidence. Items without comps fall back to a conservative MSRP floor.
      "Current retail" is today's listed price on the retailer's site — manifest MSRP goes stale; use this
      as the compare-at price on your own listings (it does not change the valuation).</p>
      <table>
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Manifest MSRP</th><th class="num">Ext. retail</th><th>Sold prices ($)</th><th>Current retail ($)</th></tr></thead>
        <tbody>
          ${topItems
            .map(
              ({ item, comps }) => `
            <tr>
              <td>${esc(item.description)}<div class="muted">${esc(item.identifierType)} ${esc(item.identifier ?? '')} · ${esc(item.conditionGrade)}</div>${researchLinks(item)}</td>
              <td class="num">${item.quantity}</td>
              <td class="num">${usd(item.unitMsrp, 2)}</td>
              <td class="num">${usd(item.quantity * (item.unitMsrp ?? 0))}</td>
              <td><input class="comp-input" data-item="${item.id}" value="${comps.join(', ')}" placeholder="e.g. 42, 38.50, 45" /></td>
              <td><input class="retail-input" data-item="${item.id}" type="number" min="0" step="0.01" value="${item.currentRetail ?? ''}" placeholder="today's price" style="max-width:110px" /></td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <button id="comps-save">Save comps &amp; re-analyze</button>
    </div>`;
}

function analysisSection(a, lot) {
  const v = a.verdict;
  const isBid = v.decision === 'BID';
  const conf = a.valuation.confidenceShares;
  return `
    <div class="verdict-banner ${isBid ? 'bid' : 'pass'}">
      <div class="big">${
        isBid ? `BID ≤ ${flagged(v.maxBid)}` : 'PASS'
      }</div>
      ${
        isBid
          ? `<div class="walkaway-copy"><strong>This is your walk-away number.</strong> Place one proxy bid
             at this amount and stop. B-Stock uses proxy bidding with popcorn extensions — sniping doesn't
             work, and bidding "a little more to win" only means overpaying. If the price passes your
             number, the lot was never yours.</div>`
          : `<ul>${v.passReasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
             ${v.maxBid && v.maxBid.amount > 0 ? `<div class="walkaway-copy">For reference, your walk-away number would be ${flagged(v.maxBid)}.</div>` : ''}`
      }
    </div>
    ${
      v.estimateWarnings.length > 0
        ? `<div class="estimate-warnings"><strong>Estimates in play (numbers marked ~*):</strong>
           <ul>${v.estimateWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
        : ''
    }
    ${
      a.valuation.hasGrailRisk
        ? `<div class="grail-box"><span class="label">Grail risk</span><br/>
           Over 40% of this lot's value sits in ${a.valuation.grailItemIds.length} item(s).
           Full valuation: <strong>${flagged(a.valuation.expectedRevenue)}</strong> ·
           grails-excluded ("bread &amp; butter"): <strong>${flagged(a.valuation.breadAndButterRevenue)}</strong>.
           The recommended max bid is computed from the grails-excluded number.</div>`
        : ''
    }
    ${
      a.marketEstimate
        ? `<div class="market-box"><span class="label">Market estimate — not your number</span><br/>
           Based on ${a.marketEstimate.sampleSize} logged finals for this seller/category, similar lots
           close between <strong>${usd(a.marketEstimate.low)}</strong> and <strong>${usd(a.marketEstimate.high)}</strong>
           (${pct(a.marketEstimate.lowPctOfRetail)}–${pct(a.marketEstimate.highPctOfRetail)} of extended retail).
           Your walk-away number above is a budget fact; this range is only a prediction of what others may pay.</div>`
        : ''
    }
    <div class="kpis">
      <div class="kpi"><span class="microlabel">Walk-away max bid</span>
        <div class="value">${flagged(v.maxBid)}</div>
        <div class="sub">one proxy bid, then stop</div></div>
      <div class="kpi"><span class="microlabel">Landed unit price</span>
        <div class="value">${flagged(a.bid.landedUnitPrice, 2)}</div>
        <div class="sub">all-in cost per unit at max bid</div></div>
      <div class="kpi"><span class="microlabel">Expected revenue</span>
        <div class="value">${flagged(a.bid.expectedRevenue)}</div>
        <div class="sub">${a.valuation.hasGrailRisk ? 'grails excluded' : 'all line items'}</div></div>
      <div class="kpi"><span class="microlabel">Total units</span>
        <div class="value">${a.bid.totalUnits}</div>
        <div class="sub">across ${a.valuation.items.length} line items</div></div>
    </div>
    <div class="card">
      <h3>The numbers</h3>
      <table>
        <tr><td>Expected revenue${a.valuation.hasGrailRisk ? ' (grails excluded)' : ''}</td><td class="num">${flagged(a.bid.expectedRevenue)}</td></tr>
        <tr><td>− Selling costs (${pct(a.bid.sellingFeeRate)})</td><td class="num">${flagged(a.bid.sellingCosts)}</td></tr>
        <tr><td>− Required profit</td><td class="num">${flagged(a.bid.requiredProfit)}</td></tr>
        <tr><td><strong>= Total budget</strong></td><td class="num"><strong>${flagged(a.bid.totalBudget)}</strong></td></tr>
        <tr><td>− Freight</td><td class="num">${flagged(a.bid.freight)}</td></tr>
        <tr><td>= Auction budget</td><td class="num">${flagged(a.bid.auctionBudget)}</td></tr>
        <tr><td><strong>Max bid</strong> (÷ 1 + ${pct(a.bid.buyersPremiumRate)} premium, floored)</td><td class="num"><strong>${flagged(a.bid.maxBid)}</strong></td></tr>
        <tr><td>Landed unit price (${a.bid.totalUnits} units)</td><td class="num">${flagged(a.bid.landedUnitPrice, 2)}</td></tr>
        <tr><td class="muted">Extended retail (for reference only — not value)</td><td class="num muted">${usd(a.valuation.extendedRetail)}</td></tr>
      </table>
      <h3>Valuation confidence</h3>
      <div class="conf-bar">
        <div class="high" style="width:${conf.high * 100}%"></div>
        <div class="medium" style="width:${conf.medium * 100}%"></div>
        <div class="low" style="width:${conf.low * 100}%"></div>
      </div>
      <div class="conf-legend">
        <span class="dot" style="background:#2f9e56"></span>${pct(conf.high)} high (≥3 comps)
        <span class="dot" style="background:#e5b93c;margin-left:12px"></span>${pct(conf.medium)} medium (1–2)
        <span class="dot" style="background:#c4cdd9;margin-left:12px"></span>${pct(conf.low)} low (MSRP floor)
        ${a.valuation.unverifiedValueShare > 0 ? ` · <strong>${pct(a.valuation.unverifiedValueShare)} unverifiable</strong> (no identifiers)` : ''}
      </div>
    </div>
    <div class="card rationale">
      <h3>Why ${isBid ? 'this could be a deal' : 'this is a pass'}</h3>
      ${a.rationale.map((s) => `<h4>${esc(s.title)}</h4><p>${esc(s.text)}</p>`).join('')}
    </div>`;
}

function outcomeSection() {
  return `
    <div class="card">
      <h3>Log outcome</h3>
      <p class="muted">Recording what actually happened calibrates future recovery rates and closing-range predictions.</p>
      <div class="form-grid">
        <div><label>Result</label><select id="oc-won"><option value="">—</option><option value="true">Won</option><option value="false">Lost</option></select></div>
        <div><label>Final price ($)</label><input id="oc-final" type="number" min="0" /></div>
        <div><label>Actual gross recovered ($, later)</label><input id="oc-gross" type="number" min="0" /></div>
      </div>
      <button id="oc-save">Save outcome</button>
    </div>`;
}

function wireLotHandlers(lot) {
  on('#map-confirm', 'click', async () => {
    const mapping = {};
    document.querySelectorAll('.map-field').forEach((sel) => {
      if (sel.value) mapping[sel.dataset.field] = sel.value;
    });
    await api(`/lots/${lot.id}/mapping`, json('POST', mapping));
    route();
  });

  on('#mf-upload', 'click', async () => {
    const file = document.getElementById('mf-file').files[0];
    if (!file) throw new Error('Choose a manifest file first');
    await api(`/lots/${lot.id}/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
      body: await file.arrayBuffer(),
    });
    route();
  });

  on('#cx-save', 'click', async () => {
    const num = (id) => {
      const v = document.getElementById(id).value;
      return v === '' ? null : Number(v);
    };
    const str = (id) => document.getElementById(id).value.trim() || null;
    const end = document.getElementById('cx-end').value;
    await api(
      `/lots/${lot.id}/context`,
      json('PUT', {
        currentBid: num('cx-bid'),
        bidCount: num('cx-count'),
        endTime: end ? new Date(`${end}Z`).toISOString() : null,
        buyersPremiumRate: (num('cx-prem') ?? 10) / 100,
        shippingType: str('cx-ship'),
        freightQuote: num('cx-freight'),
        sellerZip: str('cx-zip'),
        palletCount: num('cx-pallets'),
        weightClass: str('cx-weight'),
        marketplace: str('cx-marketplace'),
      }),
    );
    route();
  });

  on('#mi-add', 'click', async () => {
    await api(
      `/lots/${lot.id}/items`,
      json('POST', {
        description: document.getElementById('mi-desc').value,
        quantity: Number(document.getElementById('mi-qty').value) || 1,
        unitMsrp: document.getElementById('mi-msrp').value === '' ? null : Number(document.getElementById('mi-msrp').value),
        condition: document.getElementById('mi-cond').value,
        category: document.getElementById('mi-cat').value,
      }),
    );
    route();
  });

  on('#comps-save', 'click', async () => {
    const inputs = [...document.querySelectorAll('.comp-input')];
    for (const input of inputs) {
      const prices = input.value
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0 && input.value.trim() !== '');
      const retailInput = document.querySelector(`.retail-input[data-item="${input.dataset.item}"]`);
      const currentRetail = retailInput && retailInput.value !== '' ? Number(retailInput.value) : null;
      await api(`/items/${input.dataset.item}/comps`, json('PUT', { prices, currentRetail }));
    }
    route();
  });

  on('#oc-save', 'click', async () => {
    const won = document.getElementById('oc-won').value;
    if (won === '') throw new Error('Pick won or lost');
    const num = (id) => {
      const v = document.getElementById(id).value;
      return v === '' ? null : Number(v);
    };
    await api(
      `/lots/${lot.id}/outcome`,
      json('POST', { won: won === 'true', finalPrice: num('oc-final'), grossRecovered: num('oc-gross') }),
    );
    route();
  });
}

/* ---------- compare ---------- */

async function renderCompare() {
  const lots = (await api('/lots')).filter((l) => l.itemCount > 0 && l.mappingStatus === 'confirmed');
  const analyses = await Promise.all(lots.map((l) => api(`/lots/${l.id}/analysis`).catch(() => null)));
  const rows = lots
    .map((lot, i) => ({ lot, a: analyses[i] }))
    .filter((r) => r.a)
    .sort((x, y) => (x.a.bid.landedUnitPrice?.amount ?? Infinity) - (y.a.bid.landedUnitPrice?.amount ?? Infinity));
  main.innerHTML = `
    <h2>Compare lots <span class="muted">— sorted by landed unit price</span></h2>
    ${rows.length === 0 ? '<p class="muted">No analyzed lots yet.</p>' : ''}
    <div class="card">
    <table>
      <thead><tr><th>Lot</th><th>Seller</th><th>Verdict</th><th class="num">Landed unit price</th>
      <th class="num">Max bid</th><th class="num">Expected revenue</th><th class="num">High-confidence</th></tr></thead>
      <tbody>
        ${rows
          .map(
            ({ lot, a }) => `
          <tr>
            <td><a href="#/lot/${lot.id}">${esc(lot.name)}</a></td>
            <td>${esc(lot.seller)}</td>
            <td><span class="badge ${a.verdict.decision === 'BID' ? 'bid' : 'pass'}">${a.verdict.decision}</span></td>
            <td class="num">${flagged(a.bid.landedUnitPrice, 2)}</td>
            <td class="num">${flagged(a.verdict.maxBid)}</td>
            <td class="num">${flagged(a.bid.expectedRevenue)}</td>
            <td class="num">${pct(a.valuation.confidenceShares.high)}</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    </div>`;
}

/* ---------- history: dashboard / ledger / scoreboard / calibration ---------- */

function ledgerTables(sales, expenses) {
  const recent = (list, n = 12) => [...list].reverse().slice(0, n);
  const saleRows = recent(sales)
    .map(
      (s) => `<tr><td>${shortDate(s.soldAt)}</td><td class="num">${usd(s.amount, 2)}</td>
        <td>${esc(s.note ?? '')}</td>
        <td class="num"><button class="small danger del-sale" data-id="${s.id}">✕</button></td></tr>`,
    )
    .join('');
  const expRows = recent(expenses)
    .map(
      (e) => `<tr><td>${shortDate(e.spentAt)}</td><td class="num">${usd(e.amount, 2)}</td>
        <td>${esc(e.category)}${e.auto ? ' <span class="muted">(auto)</span>' : ''}</td>
        <td>${esc(e.note ?? '')}</td>
        <td class="num"><button class="small danger del-expense" data-id="${e.id}">✕</button></td></tr>`,
    )
    .join('');
  return `
    <div class="two-col" style="gap:16px">
      <div class="card"><h3>Recent sales</h3>
        ${sales.length === 0 ? '<p class="muted">Nothing yet.</p>' : `<table><thead><tr><th>Date</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead><tbody>${saleRows}</tbody></table>`}
      </div>
      <div class="card"><h3>Recent expenses</h3>
        ${expenses.length === 0 ? '<p class="muted">Nothing yet.</p>' : `<table><thead><tr><th>Date</th><th class="num">Amount</th><th>Category</th><th>Note</th><th></th></tr></thead><tbody>${expRows}</tbody></table>`}
      </div>
    </div>`;
}

async function renderHistory() {
  const [{ outcomes }, suggestions, ledger, leaderboard, lots] = await Promise.all([
    api('/history'),
    api('/calibration'),
    api('/ledger'),
    api('/leaderboard?n=10'),
    api('/lots'),
  ]);
  const { sales, expenses, summary, categories } = ledger;
  const err = (o) =>
    o.grossRecovered !== null && o.predictedRevenue
      ? pct((o.grossRecovered - o.predictedRevenue) / o.predictedRevenue)
      : '—';
  const firstDate =
    [...sales.map((s) => s.soldAt), ...expenses.map((e) => e.spentAt)].sort()[0] ?? todayIso();
  const ranked = [...leaderboard].sort((a, b) => b.profit - a.profit);
  const lotOptions =
    `<option value="">— none —</option>` +
    lots.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  const profitCell = (v) =>
    `<td class="num" style="color:${v >= 0 ? 'var(--good-text)' : 'var(--bad-text)'};font-weight:700">${v >= 0 ? '' : '−'}${usd(Math.abs(v))}</td>`;

  main.innerHTML = `
    <h2>Business dashboard</h2>
    <div class="kpis">
      <div class="kpi"><span class="microlabel">Total revenue</span>
        <div class="value">${usd(summary.totalRevenue)}</div>
        <div class="sub">${sales.length} sale${sales.length === 1 ? '' : 's'} recorded</div></div>
      <div class="kpi"><span class="microlabel">Total expenses</span>
        <div class="value">${usd(summary.totalExpenses)}</div>
        <div class="sub">${expenses.length} entr${expenses.length === 1 ? 'y' : 'ies'}</div></div>
      <div class="kpi"><span class="microlabel">Net profit</span>
        <div class="value" style="color:${summary.netProfit >= 0 ? 'var(--good-text)' : 'var(--bad-text)'}">
          ${summary.netProfit >= 0 ? '' : '−'}${usd(Math.abs(summary.netProfit))}</div>
        <div class="sub">revenue − expenses</div></div>
      <div class="kpi"><span class="microlabel">Best recent lot</span>
        <div class="value" style="font-size:17px;line-height:1.3">${
          ranked[0] ? `<a href="#/lot/${ranked[0].lotId}">${esc(ranked[0].name)}</a>` : '—'
        }</div>
        <div class="sub">${ranked[0] ? `${ranked[0].profit < 0 ? '−' : ''}${usd(Math.abs(ranked[0].profit))} profit` : 'log a won auction to start'}</div></div>
    </div>

    <div class="card">
      <h3>Revenue over time</h3>
      <span class="muted">Cumulative sales — flat on days you didn't sell, up on days you did. Hover for the day's detail.</span>
      ${sales.length === 0 ? '<p class="muted" style="margin-top:12px">No sales recorded yet — log your first sale below.</p>' : revenueChart(sales, firstDate)}
    </div>

    <div class="card">
      <h3>Expenses</h3>
      <span class="muted">One dot per entry — hover for amount, category, and note. Winning bids and freight are added automatically when you log a won auction.</span>
      ${expenses.length === 0 ? '<p class="muted" style="margin-top:12px">No expenses recorded yet.</p>' : expenseChart(expenses, firstDate)}
    </div>

    <div class="card">
      <h3>Record activity</h3>
      <div class="two-col" style="gap:28px">
        <div>
          <span class="microlabel">Sale</span>
          <div class="form-grid">
            <div><label>Amount ($)</label><input id="sl-amount" type="number" min="0" step="0.01" /></div>
            <div><label>Date</label><input id="sl-date" type="date" value="${todayIso()}" /></div>
            <div><label>Lot (optional)</label><select id="sl-lot">${lotOptions}</select></div>
            <div><label>Note</label><input id="sl-note" placeholder="e.g. JBL speaker, ebay" /></div>
          </div>
          <button id="sl-add">Add sale</button>
        </div>
        <div>
          <span class="microlabel">Expense</span>
          <div class="form-grid">
            <div><label>Amount ($)</label><input id="ex-amount" type="number" min="0" step="0.01" /></div>
            <div><label>Date</label><input id="ex-date" type="date" value="${todayIso()}" /></div>
            <div><label>Category</label><select id="ex-cat">${categories.map((c) => `<option>${c}</option>`).join('')}</select></div>
            <div><label>Lot (optional)</label><select id="ex-lot">${lotOptions}</select></div>
            <div><label>Note</label><input id="ex-note" placeholder="e.g. poly bags" /></div>
          </div>
          <button id="ex-add">Add expense</button>
        </div>
      </div>
    </div>

    <h2>Last 10 auctions <span class="muted">— ranked by realized profit</span></h2>
    <div class="card">
      ${ranked.length === 0 ? '<p class="muted">Log a won auction outcome to populate the leaderboard.</p>' : ''}
      ${
        ranked.length > 0
          ? `<table>
        <thead><tr><th>#</th><th>Lot</th><th>Seller</th><th>Won</th>
        <th class="num">Cost</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">ROI</th></tr></thead>
        <tbody>${ranked
          .map(
            (p, i) => `<tr>
            <td>${i + 1}</td>
            <td><a href="#/lot/${p.lotId}">${esc(p.name)}</a></td>
            <td>${esc(p.seller)}</td>
            <td>${new Date(p.wonAt).toLocaleDateString()}</td>
            <td class="num">${usd(p.cost)}</td>
            <td class="num">${usd(p.revenue)}${p.revenueSource === 'outcome-gross' ? ' <span class="muted" title="from the lot outcome, not itemized sales">†</span>' : ''}</td>
            ${profitCell(p.profit)}
            <td class="num">${p.roi === null ? '—' : pct(p.roi)}</td>
          </tr>`,
          )
          .join('')}</tbody>
      </table>
      <p class="muted" style="margin:10px 0 0">† revenue from the lot's gross-recovered figure; itemized sales linked to a lot take precedence.</p>`
          : ''
      }
    </div>

    ${ledgerTables(sales, expenses)}

    <h2>Scoreboard <span class="muted">— predicted vs. actual</span></h2>
    <div class="card">
      ${outcomes.length === 0 ? '<p class="muted">No outcomes logged yet.</p>' : ''}
      <table>
        <thead><tr><th>Lot</th><th>Seller</th><th>Category</th><th>Result</th>
        <th class="num">Predicted revenue</th><th class="num">Actual gross</th><th class="num">Error</th>
        <th class="num">Predicted max bid</th><th class="num">Final price</th></tr></thead>
        <tbody>
          ${outcomes
            .map(
              (o) => `
            <tr>
              <td><a href="#/lot/${o.lotId}">${esc(o.lotName ?? o.lotId)}</a></td>
              <td>${esc(o.seller)}</td>
              <td>${esc(o.category)}</td>
              <td><span class="badge ${o.won ? 'bid' : 'pass'}">${o.won ? 'WON' : 'LOST'}</span></td>
              <td class="num">${usd(o.predictedRevenue)}</td>
              <td class="num">${usd(o.grossRecovered)}</td>
              <td class="num">${err(o)}</td>
              <td class="num">${usd(o.predictedMaxBid)}</td>
              <td class="num">${usd(o.finalPrice)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <h2>Recovery-rate calibration</h2>
    <div class="card">
      ${
        suggestions.length === 0
          ? '<p class="muted">No suggestions yet — they appear once a seller/category segment has ≥3 outcomes with actual gross recorded.</p>'
          : suggestions
              .map(
                (s, i) => `
        <p><strong>${esc(s.seller)} / ${esc(s.category)}</strong> — over ${s.sampleSize} lots you recovered
        a median of ${pct(s.medianRatio)} of predicted. Suggested recovery multiplier:
        <strong>×${s.suggestedMultiplier}</strong> (currently ×${s.currentMultiplier}).
        <button class="small cal-apply" data-i="${i}">Apply</button></p>`,
              )
              .join('')
      }
    </div>`;
  on('.cal-apply', 'click', async (_e, el) => {
    const s = suggestions[Number(el.dataset.i)];
    await api('/calibration/apply', json('POST', { seller: s.seller, category: s.category, multiplier: s.suggestedMultiplier }));
    route();
  });

  const numOrNull = (id) => {
    const v = document.getElementById(id).value;
    return v === '' ? null : Number(v);
  };
  on('#sl-add', 'click', async () => {
    const amount = numOrNull('sl-amount');
    if (amount === null) throw new Error('Enter a sale amount');
    await api(
      '/sales',
      json('POST', {
        amount,
        soldAt: document.getElementById('sl-date').value,
        lotId: numOrNull('sl-lot'),
        note: document.getElementById('sl-note').value.trim() || null,
      }),
    );
    route();
  });
  on('#ex-add', 'click', async () => {
    const amount = numOrNull('ex-amount');
    if (amount === null) throw new Error('Enter an expense amount');
    await api(
      '/expenses',
      json('POST', {
        amount,
        spentAt: document.getElementById('ex-date').value,
        category: document.getElementById('ex-cat').value,
        lotId: numOrNull('ex-lot'),
        note: document.getElementById('ex-note').value.trim() || null,
      }),
    );
    route();
  });
  on('.del-sale', 'click', async (_e, el) => {
    await api(`/sales/${el.dataset.id}`, { method: 'DELETE' });
    route();
  });
  on('.del-expense', 'click', async (_e, el) => {
    await api(`/expenses/${el.dataset.id}`, { method: 'DELETE' });
    route();
  });
  wireTooltips();
}

/* ---------- profile ---------- */

async function renderProfile() {
  const [profile, rates] = await Promise.all([api('/profile'), api('/rates')]);
  const rp = profile.requiredProfit;
  main.innerHTML = `
    <h2>Buyer profile</h2>
    <div class="card">
      <div class="form-grid">
        <div><label>Home zip</label><input id="pf-zip" value="${esc(profile.homeZip ?? '')}" /></div>
        <div><label>Max spend per lot ($, blank = none)</label><input id="pf-max" type="number" min="0" value="${profile.maxSpendPerLot ?? ''}" /></div>
        <div><label>Required profit type</label>
          <select id="pf-ptype">
            <option value="percent" ${rp.kind === 'percent' ? 'selected' : ''}>% of expected revenue</option>
            <option value="absolute" ${rp.kind === 'absolute' ? 'selected' : ''}>Absolute $</option>
          </select></div>
        <div><label>Required profit value</label><input id="pf-pval" type="number" min="0" step="0.01"
          value="${rp.kind === 'percent' ? Math.round(rp.percent * 100) : rp.amount}" />
          <span class="muted">percent → whole number (30 = 30%)</span></div>
        <div><label>Selling fee rate (%)</label><input id="pf-fee" type="number" min="0" max="100" value="${Math.round(profile.sellingFeeRate * 100)}" /></div>
        <div><label>Default buyer's premium (%)</label><input id="pf-prem" type="number" min="0" max="100" value="${Math.round(profile.defaultBuyersPremiumRate * 100)}" /></div>
        <div><label>Conservative floor rate (%)</label><input id="pf-floor" type="number" min="0" max="100" value="${Math.round(profile.conservativeFloorRate * 100)}" /></div>
        <div><label>Sell-through probability (%)</label><input id="pf-sell" type="number" min="0" max="100" value="${Math.round(profile.sellThroughProbability * 100)}" /></div>
        <div><label>Categories of interest (comma-sep)</label><input id="pf-cats" value="${esc(profile.categoriesOfInterest.join(', '))}" /></div>
        <div><label>Preferred sellers (comma-sep)</label><input id="pf-sellers" value="${esc(profile.preferredSellers.join(', '))}" /></div>
      </div>
      <label>Acceptable conditions</label>
      ${CONDITIONS.map(
        (c) => `<label style="display:inline-block;margin-right:14px"><input type="checkbox" class="pf-cond" value="${c}"
          style="width:auto" ${profile.acceptableConditions.includes(c) ? 'checked' : ''}/> ${c}</label>`,
      ).join('')}
      <br/><button id="pf-save">Save profile</button>
    </div>
    <h2>Recovery rates by condition</h2>
    <div class="card">
      <p class="muted">Share of comp price (or MSRP baseline) you realistically recover per condition grade.</p>
      <div class="form-grid">
        ${CONDITIONS.map(
          (c) => `<div><label>${c}</label><input class="rate-input" data-grade="${c}" type="number" min="0" max="1" step="0.01" value="${rates[c]}" /></div>`,
        ).join('')}
      </div>
      <button id="rates-save">Save rates</button>
    </div>`;

  on('#pf-save', 'click', async () => {
    const val = (id) => document.getElementById(id).value;
    const ptype = val('pf-ptype');
    const pval = Number(val('pf-pval')) || 0;
    await api(
      '/profile',
      json('PUT', {
        homeZip: val('pf-zip').trim() || null,
        maxSpendPerLot: val('pf-max') === '' ? null : Number(val('pf-max')),
        requiredProfit: ptype === 'percent' ? { kind: 'percent', percent: pval / 100 } : { kind: 'absolute', amount: pval },
        sellingFeeRate: Number(val('pf-fee')) / 100,
        defaultBuyersPremiumRate: Number(val('pf-prem')) / 100,
        conservativeFloorRate: Number(val('pf-floor')) / 100,
        sellThroughProbability: Number(val('pf-sell')) / 100,
        categoriesOfInterest: val('pf-cats').split(',').map((s) => s.trim()).filter(Boolean),
        preferredSellers: val('pf-sellers').split(',').map((s) => s.trim()).filter(Boolean),
        acceptableConditions: [...document.querySelectorAll('.pf-cond:checked')].map((el) => el.value),
      }),
    );
    route();
  });

  on('#rates-save', 'click', async () => {
    const rates = {};
    document.querySelectorAll('.rate-input').forEach((el) => (rates[el.dataset.grade] = Number(el.value)));
    await api('/rates', json('PUT', rates));
    route();
  });
}

/* ---------- inventory ---------- */

async function renderInventory() {
  const [{ items }, lots] = await Promise.all([api('/inventory'), api('/lots')]);
  const lotOptions =
    `<option value="">— none —</option>` +
    lots.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  const active = items.filter((i) => i.status !== 'sold');
  const stockValue = active.reduce((s, i) => s + (i.cost ?? 0) * i.qty, 0);
  const ceilingValue = active.reduce((s, i) => s + (i.currentRetail ?? 0) * i.qty, 0);

  const priceCell = (v, hint) =>
    v === null || v === undefined ? '<td class="num muted">—</td>' : `<td class="num" title="${esc(hint)}">${usd(v, 2)}</td>`;

  main.innerHTML = `
    <h2>Inventory</h2>
    <div class="kpis">
      <div class="kpi"><span class="microlabel">Items on hand</span>
        <div class="value">${active.reduce((s, i) => s + i.qty, 0)}</div>
        <div class="sub">${active.length} distinct item${active.length === 1 ? '' : 's'}</div></div>
      <div class="kpi"><span class="microlabel">Cost tied up</span>
        <div class="value">${usd(stockValue)}</div>
        <div class="sub">what unsold stock cost you</div></div>
      <div class="kpi"><span class="microlabel">Retail ceiling</span>
        <div class="value">${usd(ceilingValue)}</div>
        <div class="sub">sum of current retail prices</div></div>
    </div>

    <div class="card">
      <h3>Add item</h3>
      <div class="form-grid">
        <div><label>Name</label><input id="iv-name" placeholder="e.g. West Elm Harmony Sofa" /></div>
        <div><label>Qty</label><input id="iv-qty" type="number" min="1" value="1" /></div>
        <div><label>My cost ($, per unit)</label><input id="iv-cost" type="number" min="0" step="0.01" /></div>
        <div><label>Current retail ($, from the store's site)</label><input id="iv-retail" type="number" min="0" step="0.01" /></div>
        <div><label>Acquired</label><input id="iv-date" type="date" value="${todayIso()}" /></div>
        <div><label>From lot (optional)</label><select id="iv-lot">${lotOptions}</select></div>
      </div>
      <label>Description <span class="muted">(copy it from the product page yourself — specs, dimensions, materials)</span></label>
      <textarea id="iv-desc" rows="3" placeholder="e.g. 82&quot; performance-velvet sofa, down-blend cushions, kiln-dried frame..."></textarea>
      <button id="iv-add">Add to inventory</button>
    </div>

    <div id="fb-gen"></div>

    <div class="card">
      <h3>On hand</h3>
      <span class="muted">Floor = break-even after selling fees. Target = floor plus your required margin (from Profile). Ceiling = today's retail — nobody pays more than new.</span>
      ${items.length === 0 ? '<p class="muted" style="margin-top:10px">Nothing yet.</p>' : `
      <table>
        <thead><tr><th>Item</th><th>Status</th><th class="num">Qty</th><th class="num">My cost</th>
        <th class="num">Floor</th><th class="num">Target</th><th class="num">Ceiling</th><th></th></tr></thead>
        <tbody>
        ${items
          .map(
            (i) => `<tr${i.status === 'sold' ? ' style="opacity:.55"' : ''}>
            <td>${esc(i.name)}${
              i.description
                ? `<details class="iv-desc"><summary class="muted">description</summary><div>${esc(i.description)}</div></details>`
                : ''
            }${researchLinks({ description: i.name, identifierType: 'none', identifier: null })}</td>
            <td><select class="iv-status" data-id="${i.id}" style="min-width:118px">
              ${['in-stock', 'listed', 'sold'].map((s) => `<option ${s === i.status ? 'selected' : ''}>${s}</option>`).join('')}
            </select></td>
            <td class="num">${i.qty}</td>
            ${priceCell(i.cost, 'your per-unit cost')}
            ${priceCell(i.pricing?.floor, `break-even after ${pct(i.pricing?.feeRate ?? 0)} selling fees`)}
            ${priceCell(i.pricing?.target, `covers fees plus your ${pct(i.pricing?.marginRate ?? 0)} margin`)}
            ${priceCell(i.currentRetail, "today's listed retail price")}
            <td class="num" style="white-space:nowrap">
              ${i.status !== 'sold' ? `<button class="small iv-fb" data-id="${i.id}" title="generate a Facebook Marketplace post">FB post</button>
              <button class="small iv-sold" data-id="${i.id}">Sold…</button>` : ''}
              <button class="small danger iv-del" data-id="${i.id}">✕</button>
            </td>
          </tr>`,
          )
          .join('')}
        </tbody>
      </table>`}
    </div>`;

  on('#iv-add', 'click', async () => {
    const val = (id) => document.getElementById(id).value;
    if (!val('iv-name').trim()) throw new Error('Name is required');
    await api(
      '/inventory',
      json('POST', {
        name: val('iv-name'),
        qty: Number(val('iv-qty')) || 1,
        cost: val('iv-cost') === '' ? null : Number(val('iv-cost')),
        currentRetail: val('iv-retail') === '' ? null : Number(val('iv-retail')),
        acquiredAt: val('iv-date') || null,
        lotId: val('iv-lot') === '' ? null : Number(val('iv-lot')),
        description: val('iv-desc').trim() || null,
      }),
    );
    route();
  });

  on('.iv-status', 'change', async (_e, el) => {
    await api(`/inventory/${el.dataset.id}`, json('PUT', { status: el.value }));
    route();
  });

  on('.iv-fb', 'click', (_e, el) => {
    const item = items.find((i) => i.id === Number(el.dataset.id));
    const box = document.getElementById('fb-gen');
    box.innerHTML = `
      <div class="card">
        <h3>Facebook Marketplace post — ${esc(item.name)}</h3>
        <span class="muted">Edit freely, then copy and paste into your FB listing. Asking price defaults to your target.</span>
        <textarea id="fb-text" rows="12" style="max-width:740px;margin-top:10px">${esc(fbPostFor(item))}</textarea>
        <div><button id="fb-copy">Copy to clipboard</button>
        <button class="small" id="fb-close" style="margin-left:8px">Close</button></div>
      </div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('fb-copy').addEventListener('click', async () => {
      await navigator.clipboard.writeText(document.getElementById('fb-text').value);
      document.getElementById('fb-copy').textContent = 'Copied ✓';
      setTimeout(() => { const b = document.getElementById('fb-copy'); if (b) b.textContent = 'Copy to clipboard'; }, 2000);
    });
    document.getElementById('fb-close').addEventListener('click', () => (box.innerHTML = ''));
  });

  on('.iv-sold', 'click', async (_e, el) => {
    const item = items.find((i) => i.id === Number(el.dataset.id));
    const raw = window.prompt(`Sold "${item.name}" — for how much? (also logs the sale in your ledger)`, item.pricing?.target ?? '');
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid sale amount');
    await api('/sales', json('POST', { amount, soldAt: todayIso(), lotId: item.lotId, note: item.name }));
    await api(`/inventory/${item.id}`, json('PUT', { status: 'sold' }));
    route();
  });

  on('.iv-del', 'click', async (_e, el) => {
    if (!confirm('Remove this inventory item?')) return;
    await api(`/inventory/${el.dataset.id}`, { method: 'DELETE' });
    route();
  });
}

/* ---------- calendar ---------- */

/* "Add to Google Calendar" prefilled-event link — no API or OAuth involved. */
function gcalUrl(e) {
  const pad = (n) => String(n).padStart(2, '0');
  let dates;
  if (e.time) {
    const start = new Date(`${e.date}T${e.time}:00`);
    const end = new Date(start.getTime() + 3600_000);
    const fmt = (x) =>
      `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    dates = `${fmt(start)}/${fmt(end)}`;
  } else {
    const next = new Date(`${e.date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const fmtD = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
    dates = `${e.date.replace(/-/g, '')}/${fmtD(next)}`;
  }
  const details = [e.kind, e.contact, e.note].filter(Boolean).join(' — ');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${dates}&details=${encodeURIComponent(details)}`;
}

let calCursor = null; // {y, m} — persists across re-renders within the session

async function renderCalendar() {
  const now = new Date();
  if (!calCursor) calCursor = { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = calCursor;
  const monthName = new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstDow = new Date(y, m, 1).getDay();
  const iso = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const [{ events, kinds }, { items }, { feedUrl }] = await Promise.all([
    api('/events'),
    api('/inventory'),
    api('/feed-info'),
  ]);
  const byDate = new Map();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const invName = (id) => items.find((i) => i.id === id)?.name ?? null;

  const chip = (e) => {
    const bits = [e.time, e.contact, invName(e.inventoryId), e.note].filter(Boolean).join(' · ');
    return `<button class="event-chip ${e.kind}" data-id="${e.id}" title="${esc(`${e.title}${bits ? ` — ${bits}` : ''} (click to delete)`)}">${e.time ? `${esc(e.time)} ` : ''}${esc(e.title)}</button>`;
  };

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dayIso = iso(d);
    const isToday = dayIso === todayIso();
    cells += `<div class="cal-cell${isToday ? ' today' : ''}">
      <span class="cal-day">${d}</span>
      ${(byDate.get(dayIso) ?? []).map(chip).join('')}
    </div>`;
  }

  const upcoming = events
    .filter((e) => e.date >= todayIso())
    .slice(0, 8);

  main.innerHTML = `
    <h2>Calendar <span class="muted">— deliveries, viewings, pickups</span></h2>
    <div class="card">
      <div class="cal-head">
        <button class="small" id="cal-prev">‹</button>
        <h3 style="margin:0">${monthName}</h3>
        <button class="small" id="cal-next">›</button>
        <span class="cal-legend">
          <span class="event-chip delivery">delivery</span>
          <span class="event-chip viewing">viewing</span>
          <span class="event-chip pickup">pickup</span>
          <span class="event-chip other">other</span>
        </span>
      </div>
      <div class="cal-grid">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
        ${cells}
      </div>
    </div>

    <div class="two-col" style="gap:16px">
      <div class="card">
        <h3>Schedule something</h3>
        <div class="form-grid">
          <div><label>Title</label><input id="ev-title" placeholder="e.g. Deliver sofa to Cambridge" /></div>
          <div><label>Type</label><select id="ev-kind">${kinds.map((k) => `<option>${k}</option>`).join('')}</select></div>
          <div><label>Date</label><input id="ev-date" type="date" value="${todayIso()}" /></div>
          <div><label>Time</label><input id="ev-time" type="time" /></div>
          <div><label>Contact</label><input id="ev-contact" placeholder="name / phone" /></div>
          <div><label>Item (optional)</label><select id="ev-item">
            <option value="">— none —</option>
            ${items.filter((i) => i.status !== 'sold').map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}
          </select></div>
        </div>
        <label>Note</label><input id="ev-note" />
        <button id="ev-add">Add to calendar</button>
      </div>
      <div class="card">
        <h3>Coming up</h3>
        ${upcoming.length === 0 ? '<p class="muted">Nothing scheduled.</p>' : `
        <table><tbody>
          ${upcoming
            .map(
              (e) => `<tr>
              <td style="white-space:nowrap">${shortDate(e.date)}${e.time ? ` · ${esc(e.time)}` : ''}</td>
              <td><span class="event-chip ${e.kind}">${esc(e.kind)}</span></td>
              <td>${esc(e.title)}${e.contact ? `<div class="muted">${esc(e.contact)}</div>` : ''}</td>
              <td class="num" style="white-space:nowrap">
                <span class="research-links"><a href="${gcalUrl(e)}" target="_blank" rel="noopener">+ GCal</a></span>
                <button class="small danger ev-del" data-id="${e.id}">✕</button></td>
            </tr>`,
            )
            .join('')}
        </tbody></table>`}
      </div>
    </div>

    <div class="card">
      <h3>Sync with Google Calendar</h3>
      <p class="muted">Three ways, no Google API keys needed:</p>
      <p style="font-size:13.5px;max-width:760px"><strong>1. One event at a time</strong> — the
      <span class="research-links"><a>+ GCal</a></span> button next to any upcoming event opens Google Calendar
      with everything prefilled; just hit Save.</p>
      <p style="font-size:13.5px;max-width:760px"><strong>2. Import the whole calendar</strong> —
      <a href="/api/calendar.ics" download>download the .ics file</a> and in Google Calendar go to
      Settings → Import &amp; export → Import.</p>
      <p style="font-size:13.5px;max-width:760px"><strong>3. Live subscription</strong> — in Google Calendar:
      Settings → Add calendar → From URL, and paste:
      <br/><code style="font-size:12px;background:#f4f5f8;padding:3px 8px;border-radius:6px;word-break:break-all">${esc(feedUrl)}</code>
      <br/><span class="muted">Google refreshes subscribed calendars every few hours. This only works once the
      app is reachable from the internet — on localhost, use options 1 or 2.</span></p>
    </div>`;

  on('#cal-prev', 'click', () => {
    calCursor = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
    route();
  });
  on('#cal-next', 'click', () => {
    calCursor = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
    route();
  });
  on('#ev-add', 'click', async () => {
    const val = (id) => document.getElementById(id).value;
    if (!val('ev-title').trim()) throw new Error('Give the event a title');
    await api(
      '/events',
      json('POST', {
        title: val('ev-title'),
        kind: val('ev-kind'),
        date: val('ev-date'),
        time: val('ev-time') || null,
        contact: val('ev-contact').trim() || null,
        note: val('ev-note').trim() || null,
        inventoryId: val('ev-item') === '' ? null : Number(val('ev-item')),
      }),
    );
    route();
  });
  const removeEvent = async (id) => {
    if (!confirm('Delete this event?')) return;
    await api(`/events/${id}`, { method: 'DELETE' });
    route();
  };
  on('.cal-cell .event-chip', 'click', (_e, el) => removeEvent(el.dataset.id));
  on('.ev-del', 'click', (_e, el) => removeEvent(el.dataset.id));
}

/* ---------- taxes (Massachusetts) ---------- */

async function renderTaxes() {
  const year = new Date().getFullYear();
  const t = await api(`/tax-estimate?year=${year}`);
  const e = t.estimate;

  main.innerHTML = `
    <h2>Taxes <span class="muted">— Massachusetts set-aside estimator</span></h2>
    <div class="estimate-warnings"><strong>Planning estimate, not tax advice.</strong>
      Numbers below use ${year} figures from your ledger and flat assumed rates
      (SE 15.3%, MA income 5%, your estimated federal rate). Brackets, deductions, credits,
      and filing status are not modeled — confirm with a tax professional before filing.</div>

    <div class="kpis">
      <div class="kpi"><span class="microlabel">${year} net profit</span>
        <div class="value" style="color:${t.netProfit >= 0 ? 'inherit' : 'var(--bad-text)'}">${t.netProfit < 0 ? '−' : ''}${usd(Math.abs(t.netProfit))}</div>
        <div class="sub">${usd(t.revenue)} revenue − ${usd(t.expenses)} expenses</div></div>
      <div class="kpi"><span class="microlabel">Suggested set-aside</span>
        <div class="value" style="color:var(--accent-strong)">${usd(e.totalSetAside)}</div>
        <div class="sub">park this in a separate account</div></div>
      <div class="kpi"><span class="microlabel">Effective rate</span>
        <div class="value">${pct(e.setAsideRate)}</div>
        <div class="sub">of net profit</div></div>
    </div>

    <div class="card">
      <h3>Where that number comes from</h3>
      <table>
        <tr><td>Self-employment tax <span class="muted">(15.3% × 92.35% of profit${e.seTax === 0 ? ' — waived under $400' : ''})</span></td><td class="num">${usd(e.seTax, 2)}</td></tr>
        <tr><td class="muted">− half of SE tax is deductible before income tax</td><td class="num muted">−${usd(e.seDeduction, 2)}</td></tr>
        <tr><td>Taxable income after that deduction</td><td class="num">${usd(e.taxableIncome, 2)}</td></tr>
        <tr><td>Federal income tax at your estimated
          <input id="tx-fed" type="number" min="0" max="40" step="1" value="${Math.round(t.federalRate * 100)}"
            style="width:64px;display:inline-block;padding:3px 6px" />%
          <button class="small" id="tx-fed-save">update</button></td>
          <td class="num">${usd(e.federalIncomeEst, 2)}</td></tr>
        <tr><td>Massachusetts income tax (5% flat)</td><td class="num">${usd(e.maIncomeEst, 2)}</td></tr>
        <tr><td><strong>Total to set aside</strong></td><td class="num"><strong>${usd(e.totalSetAside, 2)}</strong></td></tr>
      </table>
    </div>

    <div class="two-col" style="gap:16px">
      <div class="card">
        <h3>MA sales tax (6.25%) on direct sales</h3>
        <p class="muted">Marketplaces (eBay, Facebook Marketplace, etc.) collect and remit MA sales tax for you.
        But cash/Venmo sales where someone picks up a couch from you directly — those are on you: register on
        MassTaxConnect, collect 6.25%, and remit.</p>
        <label>Direct (non-marketplace) sales this year ($)</label>
        <input id="tx-direct" type="number" min="0" step="0.01" />
        <p id="tx-direct-out" style="font-weight:700;margin:10px 0 0"></p>
      </div>
      <div class="card">
        <h3>Quarterly estimated payments</h3>
        <p class="muted">Once you owe meaningfully, the IRS and MA both expect quarterly prepayments
        (IRS Form 1040-ES, MA Form 1-ES via MassTaxConnect):</p>
        <table><tbody>
          <tr><td>Q1 (Jan–Mar)</td><td class="num">April 15</td></tr>
          <tr><td>Q2 (Apr–May)</td><td class="num">June 15</td></tr>
          <tr><td>Q3 (Jun–Aug)</td><td class="num">September 15</td></tr>
          <tr><td>Q4 (Sep–Dec)</td><td class="num">January 15</td></tr>
        </tbody></table>
        <p class="muted" style="margin-top:10px">Rough quarterly payment at current pace: <strong>${usd(e.totalSetAside / 4)}</strong></p>
      </div>
    </div>`;

  on('#tx-fed-save', 'click', async () => {
    const rate = Number(document.getElementById('tx-fed').value) / 100;
    await api('/profile', json('PUT', { estimatedFederalRate: rate }));
    route();
  });
  const directIn = document.getElementById('tx-direct');
  directIn.addEventListener('input', () => {
    const amt = Number(directIn.value) || 0;
    document.getElementById('tx-direct-out').textContent =
      amt > 0 ? `Sales tax owed: ${usd(amt * t.maSalesTaxRate, 2)}` : '';
  });
}

/* ---------- storage units & work hours ---------- */

function nextDueDate(dueDay) {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (now.getDate() > dueDay) due.setMonth(due.getMonth() + 1);
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function renderStorage() {
  const [w, lots] = await Promise.all([api('/workspace'), api('/lots')]);
  const lotOptions =
    `<option value="">— general —</option>` +
    lots.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  const monthlyBurn = w.units.reduce((s, u) => s + u.monthlyCost, 0);

  main.innerHTML = `
    <h2>Storage &amp; Hours</h2>
    <div id="timer-card"></div>
    <div class="kpis">
      <div class="kpi"><span class="microlabel">Monthly storage burn</span>
        <div class="value">${usd(monthlyBurn, 2)}</div>
        <div class="sub">${w.units.length} unit${w.units.length === 1 ? '' : 's'}</div></div>
      <div class="kpi"><span class="microlabel">Hours worked</span>
        <div class="value">${w.totalHours}</div>
        <div class="sub">all time</div></div>
      <div class="kpi"><span class="microlabel">This week</span>
        <div class="value">${weeklyTally(w.hours).thisWeekTotal}h</div>
        <div class="sub">week of ${shortDate(weekStartIso(todayIso()))}</div></div>
      <div class="kpi"><span class="microlabel">You're earning</span>
        <div class="value" style="color:${(w.profitPerHour ?? 0) >= 0 ? 'inherit' : 'var(--bad-text)'}">
          ${w.profitPerHour === null ? '—' : `${w.profitPerHour < 0 ? '−' : ''}${usd(Math.abs(w.profitPerHour), 2)}/hr`}</div>
        <div class="sub">net profit ÷ hours logged</div></div>
    </div>

    <div class="card">
      <h3>Hours per day</h3>
      <span class="muted">One bar per day you logged work — hover for detail. Weekly totals on the right.</span>
      <div class="two-col" style="gap:24px;align-items:start">
        <div style="grid-column:span 1;min-width:0">${w.hours.length === 0 ? '<p class="muted" style="margin-top:12px">No hours logged yet.</p>' : hoursChart(w.hours)}</div>
        <div>
          ${(() => {
            const t = weeklyTally(w.hours);
            return t.rows.length === 0 ? '' : `
            <table><thead><tr><th>Week</th><th class="num">Hours</th></tr></thead><tbody>
              ${t.rows.map((r) => `<tr><td>${r.label}${r.isCurrent ? ' <span class="badge bid">now</span>' : ''}</td><td class="num">${r.total}h</td></tr>`).join('')}
            </tbody></table>`;
          })()}
        </div>
      </div>
    </div>

    <div class="two-col" style="gap:16px">
      <div class="card">
        <h3>Storage units</h3>
        ${w.units.length === 0 ? '<p class="muted">No units yet.</p>' : `
        <table><thead><tr><th>Unit</th><th class="num">$/month</th><th>Next due</th><th></th></tr></thead><tbody>
          ${w.units
            .map(
              (u) => `<tr>
              <td>${esc(u.name)}${u.note ? `<div class="muted">${esc(u.note)}</div>` : ''}</td>
              <td class="num">${usd(u.monthlyCost, 2)}</td>
              <td>${nextDueDate(u.dueDay)} <span class="muted">(day ${u.dueDay})</span></td>
              <td class="num" style="white-space:nowrap">
                <button class="small su-pay" data-id="${u.id}" title="log this month's rent as a storage expense">Paid ✓</button>
                <button class="small danger su-del" data-id="${u.id}">✕</button></td>
            </tr>`,
            )
            .join('')}
        </tbody></table>
        <p class="muted" style="margin:10px 0 0">"Paid ✓" logs the rent into your expense ledger dated today.</p>`}
        <h3 style="margin-top:18px">Add unit</h3>
        <div class="form-grid">
          <div><label>Name</label><input id="su-name" placeholder="e.g. CubeSmart 10x15 #204" /></div>
          <div><label>Monthly cost ($)</label><input id="su-cost" type="number" min="0" step="0.01" /></div>
          <div><label>Due day of month (1–28)</label><input id="su-day" type="number" min="1" max="28" value="1" /></div>
          <div><label>Note</label><input id="su-note" placeholder="gate code, address…" /></div>
        </div>
        <button id="su-add">Add storage unit</button>
      </div>

      <div class="card">
        <h3>Log hours</h3>
        <div class="form-grid">
          <div><label>Date</label><input id="wh-date" type="date" value="${todayIso()}" /></div>
          <div><label>Hours</label><input id="wh-hours" type="number" min="0" max="24" step="0.25" placeholder="e.g. 2.5" /></div>
          <div><label>Lot (optional)</label><select id="wh-lot">${lotOptions}</select></div>
          <div><label>What did you do?</label><input id="wh-note" placeholder="pickup, listing photos, delivery…" /></div>
        </div>
        <button id="wh-add">Log hours</button>
        <h3 style="margin-top:18px">Recent</h3>
        ${w.hours.length === 0 ? '<p class="muted">Nothing logged yet.</p>' : `
        <table><thead><tr><th>Date</th><th class="num">Hours</th><th>What</th><th></th></tr></thead><tbody>
          ${w.hours
            .slice(0, 12)
            .map(
              (h) => `<tr><td>${shortDate(h.date)}</td><td class="num">${h.hours}</td>
              <td>${esc(h.note ?? '')}</td>
              <td class="num"><button class="small danger wh-del" data-id="${h.id}">✕</button></td></tr>`,
            )
            .join('')}
        </tbody></table>`}
      </div>
    </div>`;

  mountTimer(w.timer, lotOptions);
  wireTooltips();

  on('#su-add', 'click', async () => {
    const val = (id) => document.getElementById(id).value;
    if (!val('su-name').trim()) throw new Error('Give the unit a name');
    await api('/storage-units', json('POST', {
      name: val('su-name'),
      monthlyCost: Number(val('su-cost')) || 0,
      dueDay: Number(val('su-day')) || 1,
      note: val('su-note').trim() || null,
    }));
    route();
  });
  on('.su-pay', 'click', async (_e, el) => {
    await api(`/storage-units/${el.dataset.id}/pay`, { method: 'POST' });
    route();
  });
  on('.su-del', 'click', async (_e, el) => {
    if (!confirm('Remove this storage unit? (Past expenses stay in the ledger.)')) return;
    await api(`/storage-units/${el.dataset.id}`, { method: 'DELETE' });
    route();
  });
  on('#wh-add', 'click', async () => {
    const val = (id) => document.getElementById(id).value;
    const hours = Number(val('wh-hours'));
    if (!hours) throw new Error('Enter hours');
    await api('/hours', json('POST', {
      date: val('wh-date'),
      hours,
      note: val('wh-note').trim() || null,
      lotId: val('wh-lot') === '' ? null : Number(val('wh-lot')),
    }));
    route();
  });
  on('.wh-del', 'click', async (_e, el) => {
    await api(`/hours/${el.dataset.id}`, { method: 'DELETE' });
    route();
  });
}

/* ---------- Facebook Marketplace post generator ---------- */

function fbPostFor(item) {
  const retail = item.currentRetail;
  const ask = item.pricing?.target ?? null;
  const lines = [];
  lines.push(`${item.name}${item.qty > 1 ? ` (${item.qty} available)` : ''}`);
  lines.push('');
  if (retail && ask) {
    lines.push(`Sells for $${Math.round(retail).toLocaleString()} at Costco — yours for $${Math.round(ask).toLocaleString()}! 🔥`);
  } else if (ask) {
    lines.push(`Asking $${Math.round(ask).toLocaleString()}.`);
  }
  lines.push('');
  if (item.description) {
    const clean = item.description
      .replace(/Lot GLD-[^.]*\.\s*/g, '')
      .replace(/Verified [^.]*\.\s*/g, '')
      .replace(/Manifest MSRP[^.]*\.\s*/g, '')
      .replace(/My planned list range[^.]*\.?/g, '')
      .trim();
    if (clean) lines.push(clean);
    lines.push('');
  }
  lines.push('✅ Smoke-free storage, inspected and clean');
  lines.push('🚚 Local pickup — delivery available for a small fee');
  lines.push('💵 Cash, Venmo, or Zelle on pickup');
  lines.push('');
  lines.push('Serious buyers only please. First come, first served — message me!');
  return lines.join('\n');
}

/* ---------- work timer (start / stop-confirm) ---------- */

function mountTimer(timer, lotOptions) {
  const box = document.getElementById('timer-card');
  if (!box) return;

  const wire = (sel, fn) => document.querySelector(sel)?.addEventListener('click', (e) => Promise.resolve(fn(e)).catch(showError));

  if (!timer) {
    box.innerHTML = `
      <div class="card">
        <h3>Work timer</h3>
        <div class="form-grid">
          <div><label>What are you working on?</label><input id="tm-note" placeholder="e.g. listing photos, delivery run" /></div>
          <div><label>Lot (optional)</label><select id="tm-lot">${lotOptions}</select></div>
        </div>
        <button id="tm-start">▶ Start working</button>
      </div>`;
    wire('#tm-start', async () => {
      const lot = document.getElementById('tm-lot').value;
      await api('/timer/start', json('POST', {
        note: document.getElementById('tm-note').value.trim() || null,
        lotId: lot === '' ? null : Number(lot),
      }));
      route();
    });
    return;
  }

  const started = new Date(timer.startedAt);
  const elapsedText = () => {
    const h = (Date.now() - started.getTime()) / 3600000;
    return h < 1 ? `${Math.round(h * 60)} min` : `${(Math.round(h * 4) / 4).toFixed(2)} h`;
  };

  const showRunning = () => {
    box.innerHTML = `
      <div class="card" style="border-color:#9fd4ae;background:linear-gradient(135deg,#f0fbf2,#ffffff)">
        <h3>⏱ Timer running <span class="muted">— since ${started.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${timer.note ? ` · ${esc(timer.note)}` : ''}</span></h3>
        <div style="font-size:30px;font-weight:800;letter-spacing:-.02em;margin:6px 0" id="tm-elapsed">${elapsedText()}</div>
        <button id="tm-stop">■ Stop</button>
      </div>`;
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      const el = document.getElementById('tm-elapsed');
      if (el) el.textContent = elapsedText();
    }, 30000);
    wire('#tm-stop', showConfirm);
  };

  const showConfirm = () => {
    const rawHours = (Date.now() - started.getTime()) / 3600000;
    const suggested = Math.max(0.25, Math.round(rawHours * 4) / 4);
    box.innerHTML = `
      <div class="card" style="border-color:#eccf8e;background:#fffdf5">
        <h3>Confirm your hours</h3>
        <p class="muted">Timer says <strong>${suggested}h</strong> (started ${started.toLocaleString()}). Left it running by accident? Just correct the number before saving.</p>
        <div class="form-grid">
          <div><label>Hours</label><input id="tm-hours" type="number" min="0.25" max="24" step="0.25" value="${suggested}" /></div>
          <div><label>Date</label><input id="tm-date" type="date" value="${started.toISOString().slice(0, 10)}" /></div>
          <div><label>What did you do?</label><input id="tm-cnote" value="${esc(timer.note ?? '')}" /></div>
          <div><label>Lot (optional)</label><select id="tm-clot">${lotOptions}</select></div>
        </div>
        <button id="tm-save">✓ Confirm &amp; save</button>
        <button class="small" id="tm-back" style="margin-left:8px">Keep running</button>
        <button class="small danger" id="tm-discard" style="margin-left:8px">Discard timer</button>
      </div>`;
    if (timer.lotId) {
      const sel = document.getElementById('tm-clot');
      if (sel) sel.value = String(timer.lotId);
    }
    wire('#tm-save', async () => {
      await api('/timer/commit', json('POST', {
        hours: Number(document.getElementById('tm-hours').value),
        date: document.getElementById('tm-date').value,
        note: document.getElementById('tm-cnote').value.trim() || null,
        lotId: document.getElementById('tm-clot').value === '' ? null : Number(document.getElementById('tm-clot').value),
      }));
      route();
    });
    wire('#tm-back', showRunning);
    wire('#tm-discard', async () => {
      if (!confirm('Discard this timer without saving any hours?')) return;
      await api('/timer/discard', { method: 'POST' });
      route();
    });
  };

  showRunning();
}

/* ---------- hours chart + weekly tally ---------- */

function weekStartIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back to Sunday
  return d.toISOString().slice(0, 10);
}

function weeklyTally(hours) {
  const byWeek = new Map();
  for (const h of hours) {
    const w = weekStartIso(h.date);
    byWeek.set(w, (byWeek.get(w) ?? 0) + h.hours);
  }
  const current = weekStartIso(todayIso());
  const rows = [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 8)
    .map(([w, total]) => {
      const end = new Date(`${w}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 6);
      return {
        label: `${shortDate(w)} – ${shortDate(end.toISOString().slice(0, 10))}`,
        total: Math.round(total * 100) / 100,
        isCurrent: w === current,
      };
    });
  return { rows, thisWeekTotal: Math.round((byWeek.get(current) ?? 0) * 100) / 100 };
}

function hoursChart(hours) {
  const byDay = new Map();
  const notesByDay = new Map();
  for (const h of hours) {
    byDay.set(h.date, (byDay.get(h.date) ?? 0) + h.hours);
    if (h.note) notesByDay.set(h.date, [...(notesByDay.get(h.date) ?? []), h.note]);
  }
  const today = todayIso();
  const firstLogged = [...byDay.keys()].sort()[0] ?? today;
  const sixWeeksAgo = new Date(Date.now() - 41 * 86400000).toISOString().slice(0, 10);
  const from = firstLogged > sixWeeksAgo ? firstLogged : sixWeeksAgo;
  const days = dayRange(from, today);
  const yMax = niceMax(Math.max(...days.map((d) => byDay.get(d) ?? 0), 2));
  const f = chartFrame(days, yMax, (v) => `${v}h`);
  const plotBottom = CHART.h - CHART.padB;
  const slot = (CHART.w - CHART.padL - CHART.padR) / Math.max(days.length, 1);
  const barW = Math.max(3, Math.min(slot * 0.65, 26));
  const tip = (d) => {
    const v = byDay.get(d) ?? 0;
    const notes = notesByDay.get(d);
    return `${shortDate(d)} — ${Math.round(v * 100) / 100}h${notes ? ` · ${notes.join('; ')}` : ''}`;
  };
  const hits = days
    .map(
      (d) => `<rect x="${(f.x(d) - Math.max(slot, 8) / 2).toFixed(1)}" y="${CHART.padT}" width="${Math.max(slot, 8).toFixed(1)}" height="${plotBottom - CHART.padT}" fill="transparent" data-tip="${esc(tip(d))}"/>`,
    )
    .join('');
  const bars = days
    .map((d) => {
      const v = byDay.get(d) ?? 0;
      if (v <= 0) return '';
      const y = f.y(v);
      return `<rect x="${(f.x(d) - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${(plotBottom - y).toFixed(1)}" rx="2" fill="#2a78d6" data-tip="${esc(tip(d))}"/>`;
    })
    .join('');
  return `${f.open}${hits}${bars}${f.close}`;
}

/* ---------- listings: per-item editor + description library ---------- */

async function renderListings() {
  const [{ items }, { entries }] = await Promise.all([api('/inventory'), api('/library')]);

  main.innerHTML = `
    <h2>Listings <span class="muted">— Facebook Marketplace descriptions</span></h2>
    <div class="card">
      <div class="form-grid">
        <div><label>Item</label><select id="ls-item">
          <option value="">— pick an item —</option>
          ${items.map((i) => `<option value="${i.id}">${esc(i.name)}${i.listingText ? ' ✓' : ''}${i.status === 'sold' ? ' (sold)' : ''}</option>`).join('')}
        </select></div>
      </div>
      <p class="muted">✓ = has a saved description. Want a fresh one written? Ask Claude in your session —
      copy a couple of past descriptions from the library below as style examples, plus the item details —
      then paste the result here and save it.</p>
    </div>
    <div id="ls-editor"></div>

    <div class="card">
      <h3>Description library</h3>
      <span class="muted">Paste past listings here (even old ones from before this app) — they become your
      style references for writing future descriptions.</span>
      <div class="form-grid" style="margin-top:10px">
        <div><label>Title</label><input id="lb-title" placeholder="e.g. Thomasville Tisdale — sold Aug '26" /></div>
      </div>
      <label>Description text</label>
      <textarea id="lb-text" rows="6" placeholder="Paste the full listing text…"></textarea>
      <button id="lb-add">Add to library</button>

      ${entries.length === 0 && !items.some((i) => i.listingText) ? '<p class="muted" style="margin-top:14px">Library is empty.</p>' : ''}
      ${entries
        .map(
          (e) => `
        <div style="border-top:1px solid var(--line-soft);margin-top:16px;padding-top:12px">
          <strong>${esc(e.title)}</strong> <span class="muted">· pasted ${new Date(e.createdAt).toLocaleDateString()}</span>
          <button class="small lb-copy" data-id="${e.id}" style="margin-left:8px">Copy</button>
          <button class="small danger lb-del" data-id="${e.id}" style="margin-left:4px">✕</button>
          <pre style="white-space:pre-wrap;font:inherit;font-size:13px;color:var(--ink-2);margin:8px 0 0;max-width:740px">${esc(e.text)}</pre>
        </div>`,
        )
        .join('')}
      ${items
        .filter((i) => i.listingText)
        .map(
          (i) => `
        <div style="border-top:1px solid var(--line-soft);margin-top:16px;padding-top:12px">
          <strong>${esc(i.name)}</strong> <span class="badge ${i.status === 'sold' ? 'pass' : 'bid'}">${i.status === 'sold' ? 'sold item' : 'item listing'}</span>
          <button class="small it-copy" data-id="${i.id}" style="margin-left:8px">Copy</button>
          <pre style="white-space:pre-wrap;font:inherit;font-size:13px;color:var(--ink-2);margin:8px 0 0;max-width:740px">${esc(i.listingText)}</pre>
        </div>`,
        )
        .join('')}
    </div>`;

  const editor = document.getElementById('ls-editor');

  const renderEditor = (item) => {
    editor.innerHTML = `
      <div class="card">
        <h3>${esc(item.name)}${item.status === 'sold' ? ' <span class="badge pass">sold</span>' : ''}</h3>
        <span class="muted">Asking (your target): ${item.pricing?.target ? usd(item.pricing.target, 2) : '—'} ·
        Retail: ${item.currentRetail ? usd(item.currentRetail, 2) : '—'} · Floor: ${item.pricing?.floor ? usd(item.pricing.floor, 2) : '—'}</span>
        <textarea id="ls-text" rows="13" style="max-width:760px;margin-top:12px">${esc(item.listingText ?? fbPostFor(item))}</textarea>
        <div>
          <button id="ls-save">Save to item</button>
          <button class="small" id="ls-template" style="margin-left:8px">Template draft</button>
          <button class="small" id="ls-copy" style="margin-left:8px">Copy</button>
        </div>
        <p class="muted" id="ls-status" style="margin-top:8px"></p>
      </div>`;

    const status = (t) => (document.getElementById('ls-status').textContent = t);
    const wire = (sel, fn) =>
      document.querySelector(sel)?.addEventListener('click', (e) =>
        Promise.resolve(fn(e)).catch((err) => {
          status('');
          showError(err);
        }),
      );

    wire('#ls-template', () => {
      document.getElementById('ls-text').value = fbPostFor(item);
      status('Template draft loaded — edit freely, then Save.');
    });
    wire('#ls-save', async () => {
      await api(`/inventory/${item.id}`, json('PUT', { listingText: document.getElementById('ls-text').value }));
      status('Saved ✓ (refresh to see it in the library list)');
    });
    wire('#ls-copy', async () => {
      await navigator.clipboard.writeText(document.getElementById('ls-text').value);
      status('Copied to clipboard ✓');
    });
  };

  document.getElementById('ls-item').addEventListener('change', (e) => {
    const item = items.find((i) => i.id === Number(e.target.value));
    if (item) renderEditor(item);
    else editor.innerHTML = '';
  });

  on('#lb-add', 'click', async () => {
    const title = document.getElementById('lb-title').value.trim();
    const text = document.getElementById('lb-text').value.trim();
    if (!title || !text) throw new Error('Both a title and the description text are needed');
    await api('/library', json('POST', { title, text }));
    route();
  });
  on('.lb-copy', 'click', async (_e, el) => {
    const entry = entries.find((x) => x.id === Number(el.dataset.id));
    await navigator.clipboard.writeText(entry.text);
    el.textContent = 'Copied ✓';
    setTimeout(() => (el.textContent = 'Copy'), 1500);
  });
  on('.lb-del', 'click', async (_e, el) => {
    if (!confirm('Remove this description from the library?')) return;
    await api(`/library/${el.dataset.id}`, { method: 'DELETE' });
    route();
  });
  on('.it-copy', 'click', async (_e, el) => {
    const item = items.find((x) => x.id === Number(el.dataset.id));
    await navigator.clipboard.writeText(item.listingText);
    el.textContent = 'Copied ✓';
    setTimeout(() => (el.textContent = 'Copy'), 1500);
  });
}
