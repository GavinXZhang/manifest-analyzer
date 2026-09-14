import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { CONDITION_GRADES, type ConditionGrade } from '@server/types.ts';
import { api, type Profile, type RecoveryRates, type Channel, type Family } from '../api/client.ts';
import { useApi, useAction } from '../lib/useApi.ts';
import { numOrNull } from '../lib/fmt.ts';
import { Card, CardHead, Pill, Field, Toggle, ErrorBox, Loading } from '../components/ui.tsx';

const SECTIONS = [
  { key: 'buyer-rules', label: 'Buyer rules' },
  { key: 'fees', label: 'Fees & recovery rates' },
  { key: 'channels', label: 'Selling channels' },
  { key: 'parts-book', label: 'Salvage parts book' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'data', label: 'Data & backup' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

const DRAFT_STYLES = ['ebay', 'casual', 'short', 'furniture', 'plain'] as const;

/** Percent inputs: the profile stores fractions (0.15), the user types 15. */
const toPct = (f: number | null | undefined): string => (f === null || f === undefined ? '' : String(Math.round(f * 10000) / 100));
const fromPct = (s: string): number | null => {
  const n = numOrNull(s);
  return n === null ? null : n / 100;
};
const csv = (list: string[]): string => list.join(', ');
const fromCsv = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean);

export function Settings() {
  const { section } = useParams();
  const active: SectionKey = SECTIONS.some((s) => s.key === section) ? (section as SectionKey) : 'buyer-rules';
  return (
    <main className="page">
      <h1>Settings</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 20, alignItems: 'start' }} className="split">
        <nav className="sub-nav">
          {SECTIONS.map((s) => (
            <NavLink key={s.key} to={`/settings/${s.key}`} className={() => (active === s.key ? 'active' : '')}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="stack" style={{ gap: 16 }}>
          {active === 'buyer-rules' && <BuyerRules />}
          {active === 'fees' && <Fees />}
          {active === 'channels' && <Channels />}
          {active === 'parts-book' && <PartsBook />}
          {active === 'integrations' && <Integrations />}
          {active === 'data' && <DataBackup />}
        </div>
      </div>
    </main>
  );
}

// ---------- Buyer rules ----------

interface RulesForm {
  homeZip: string; maxSpendPerLot: string; profitKind: 'percent' | 'absolute'; profitValue: string;
  acceptableConditions: ConditionGrade[]; categoriesOfInterest: string; preferredSellers: string;
  monthlyRevenueGoal: string; agingWarnDays: string; agingCutDays: string; priceCutPct: string; checkinOverdueDays: string;
  hourlyValue: string; timeZone: string;
}

function rulesForm(p: Profile): RulesForm {
  return {
    homeZip: p.homeZip ?? '',
    maxSpendPerLot: p.maxSpendPerLot === null ? '' : String(p.maxSpendPerLot),
    profitKind: p.requiredProfit.kind,
    profitValue: p.requiredProfit.kind === 'percent' ? toPct(p.requiredProfit.percent) : String(p.requiredProfit.amount),
    acceptableConditions: p.acceptableConditions,
    categoriesOfInterest: csv(p.categoriesOfInterest),
    preferredSellers: csv(p.preferredSellers),
    monthlyRevenueGoal: p.monthlyRevenueGoal === null ? '' : String(p.monthlyRevenueGoal),
    agingWarnDays: String(p.agingWarnDays),
    agingCutDays: String(p.agingCutDays),
    priceCutPct: toPct(p.priceCutFraction),
    checkinOverdueDays: String(p.checkinOverdueDays),
    hourlyValue: p.hourlyValue === null ? '' : String(p.hourlyValue),
    timeZone: p.timeZone,
  };
}

function rulesPatch(f: RulesForm): Partial<Profile> {
  return {
    homeZip: f.homeZip.trim() || null,
    maxSpendPerLot: numOrNull(f.maxSpendPerLot),
    requiredProfit:
      f.profitKind === 'percent'
        ? { kind: 'percent', percent: fromPct(f.profitValue) ?? 0 }
        : { kind: 'absolute', amount: numOrNull(f.profitValue) ?? 0 },
    acceptableConditions: f.acceptableConditions,
    categoriesOfInterest: fromCsv(f.categoriesOfInterest),
    preferredSellers: fromCsv(f.preferredSellers),
    monthlyRevenueGoal: numOrNull(f.monthlyRevenueGoal),
    agingWarnDays: Math.round(numOrNull(f.agingWarnDays) ?? 21),
    agingCutDays: Math.round(numOrNull(f.agingCutDays) ?? 30),
    priceCutFraction: fromPct(f.priceCutPct) ?? 0.1,
    checkinOverdueDays: Math.round(numOrNull(f.checkinOverdueDays) ?? 7),
    hourlyValue: numOrNull(f.hourlyValue),
    timeZone: f.timeZone.trim() || 'America/New_York',
  };
}

function useSaved() {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(id);
  }, [saved]);
  return { saved, flash: () => setSaved(true) };
}

function BuyerRules() {
  const profile = useApi(() => api.profile());
  const [form, setForm] = useState<RulesForm | null>(null);
  useEffect(() => { if (profile.data) setForm(rulesForm(profile.data)); }, [profile.data]);
  const { saved, flash } = useSaved();
  const act = useAction(async () => { await profile.reload(); flash(); });
  if (profile.error) return <ErrorBox error={profile.error} />;
  if (!form) return <Loading />;
  const set = <K extends keyof RulesForm>(k: K, v: RulesForm[K]) => setForm({ ...form, [k]: v });
  const toggleCond = (c: ConditionGrade) =>
    set('acceptableConditions', form.acceptableConditions.includes(c) ? form.acceptableConditions.filter((x) => x !== c) : [...form.acceptableConditions, c]);

  return (
    <>
      <Card>
        <CardHead title="Buyer rules" sub="Applied to every analysis automatically." />
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Home zip"><input className="input" value={form.homeZip} onChange={(e) => set('homeZip', e.target.value)} placeholder="02135" /></Field>
          <Field label="Max spend / lot" hint="Blank = no cap"><input className="input num" inputMode="decimal" value={form.maxSpendPerLot} onChange={(e) => set('maxSpendPerLot', e.target.value)} placeholder="no cap" /></Field>
          <Field label="Required profit">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select className="input" style={{ width: 130 }} value={form.profitKind} onChange={(e) => set('profitKind', e.target.value as RulesForm['profitKind'])}>
                <option value="percent">% of revenue</option>
                <option value="absolute">$ per lot</option>
              </select>
              <input className="input num" inputMode="decimal" value={form.profitValue} onChange={(e) => set('profitValue', e.target.value)} />
            </div>
          </Field>
          <Field label="Monthly revenue goal" hint="Drives the goal bar on the Money chart"><input className="input num" inputMode="decimal" value={form.monthlyRevenueGoal} onChange={(e) => set('monthlyRevenueGoal', e.target.value)} placeholder="3000" /></Field>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Acceptable conditions</label>
          <div className="checks">
            {CONDITION_GRADES.map((c) => (
              <button type="button" key={c} className={`check ${form.acceptableConditions.includes(c) ? 'on' : ''}`} onClick={() => toggleCond(c)}>{c}</button>
            ))}
          </div>
          <div className="faint tiny">Any grade outside this set marks a lot PASS with the constraint named.</div>
        </div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="Categories of interest" hint="Comma-separated"><input className="input" value={form.categoriesOfInterest} onChange={(e) => set('categoriesOfInterest', e.target.value)} placeholder="vacuums, small appliances" /></Field>
          <Field label="Preferred sellers" hint="Comma-separated"><input className="input" value={form.preferredSellers} onChange={(e) => set('preferredSellers', e.target.value)} placeholder="MON, TechLiquidators" /></Field>
        </div>
      </Card>

      <Card>
        <CardHead title="Aging, check-in and labor" sub="What the app nags you about, and when." />
        <div className="form-grid">
          <Field label="Flag inventory after (days)"><input className="input num" inputMode="numeric" value={form.agingWarnDays} onChange={(e) => set('agingWarnDays', e.target.value)} /></Field>
          <Field label="Suggest a price cut after (days)"><input className="input num" inputMode="numeric" value={form.agingCutDays} onChange={(e) => set('agingCutDays', e.target.value)} /></Field>
          <Field label="Price cut (%)"><input className="input num" inputMode="decimal" value={form.priceCutPct} onChange={(e) => set('priceCutPct', e.target.value)} /></Field>
          <Field label="Won lot unchecked after (days)"><input className="input num" inputMode="numeric" value={form.checkinOverdueDays} onChange={(e) => set('checkinOverdueDays', e.target.value)} /></Field>
          <Field label="Hourly value ($/hr)" hint="Blank = use trailing profit per hour"><input className="input num" inputMode="decimal" value={form.hourlyValue} onChange={(e) => set('hourlyValue', e.target.value)} placeholder="trailing profit/hour" /></Field>
          <Field label="Time zone" hint="For the time card and due dates"><input className="input" value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)} placeholder="America/New_York" /></Field>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={act.busy} onClick={() => act.run(() => api.updateProfile(rulesPatch(form)))}>Save buyer rules</button>
          {saved ? <span className="up small">Saved</span> : null}
        </div>
      </Card>
    </>
  );
}

// ---------- Fees & recovery rates ----------

const FEE_FIELDS: { key: keyof Pick<Profile, 'sellingFeeRate' | 'defaultBuyersPremiumRate' | 'conservativeFloorRate' | 'sellThroughProbability' | 'estimatedFederalRate'>; label: string; hint: string }[] = [
  { key: 'sellingFeeRate', label: 'Selling fee rate (%)', hint: 'Blended marketplace fee used in the bid math' },
  { key: 'defaultBuyersPremiumRate', label: "Default buyer's premium (%)", hint: 'Prefilled on every new lot' },
  { key: 'conservativeFloorRate', label: 'Conservative floor rate (%)', hint: 'Share of MSRP for items with no comps' },
  { key: 'sellThroughProbability', label: 'Sell-through probability (%)', hint: 'Share of units expected to sell at all' },
  { key: 'estimatedFederalRate', label: 'Estimated federal tax rate (%)', hint: 'For the quarterly set-aside' },
];

function Fees() {
  const profile = useApi(() => api.profile());
  const rates = useApi(() => api.rates());
  const [fees, setFees] = useState<Record<string, string> | null>(null);
  const [rateForm, setRateForm] = useState<Record<string, string> | null>(null);
  useEffect(() => { if (profile.data) setFees(Object.fromEntries(FEE_FIELDS.map((f) => [f.key, toPct(profile.data![f.key])]))); }, [profile.data]);
  useEffect(() => { if (rates.data) setRateForm(Object.fromEntries(Object.entries(rates.data).map(([k, v]) => [k, toPct(v)]))); }, [rates.data]);
  const feeSaved = useSaved();
  const rateSaved = useSaved();
  const saveFees = useAction(async () => { await profile.reload(); feeSaved.flash(); });
  const saveRates = useAction(async () => { await rates.reload(); rateSaved.flash(); });
  if (profile.error || rates.error) return <ErrorBox error={profile.error ?? rates.error} />;
  if (!fees || !rateForm) return <Loading />;

  return (
    <>
      <Card>
        <CardHead title="Fees & rates" sub="Every figure is a percentage." />
        <ErrorBox error={saveFees.error} />
        <div className="form-grid">
          {FEE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input className="input num" inputMode="decimal" value={fees[f.key]} onChange={(e) => setFees({ ...fees, [f.key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={saveFees.busy} onClick={() => saveFees.run(() => api.updateProfile(Object.fromEntries(FEE_FIELDS.map((f) => [f.key, fromPct(fees[f.key]) ?? 0])) as Partial<Profile>))}>Save fees</button>
          {feeSaved.saved ? <span className="up small">Saved</span> : null}
        </div>
      </Card>
      <Card>
        <CardHead title="Recovery rates by condition" sub="Share of MSRP a unit of each grade typically resells for. Calibration suggestions on Money adjust these per seller/category." />
        <ErrorBox error={saveRates.error} />
        <div className="form-grid">
          {CONDITION_GRADES.map((g) => (
            <Field key={g} label={`${g} (%)`}>
              <input className="input num" inputMode="decimal" value={rateForm[g] ?? ''} onChange={(e) => setRateForm({ ...rateForm, [g]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={saveRates.busy} onClick={() => saveRates.run(() => api.saveRates(Object.fromEntries(CONDITION_GRADES.map((g) => [g, fromPct(rateForm[g] ?? '') ?? 0])) as Partial<RecoveryRates>))}>Save rates</button>
          {rateSaved.saved ? <span className="up small">Saved</span> : null}
        </div>
      </Card>
    </>
  );
}

// ---------- Selling channels ----------

interface ChannelForm {
  name: string; feePct: string; feeFixed: string; shippedPct: string; shippedFixed: string; categories: string; draftStyle: Channel['draftStyle']; enabled: boolean;
}
const channelForm = (c: Channel): ChannelForm => ({
  name: c.name, feePct: toPct(c.feePercent), feeFixed: String(c.feeFixed), shippedPct: toPct(c.shippedFeePercent), shippedFixed: c.shippedFeeFixed === null ? '' : String(c.shippedFeeFixed),
  categories: csv(c.categories), draftStyle: c.draftStyle, enabled: c.enabled,
});
const channelPatch = (f: ChannelForm): Partial<Channel> => ({
  name: f.name.trim(), feePercent: fromPct(f.feePct) ?? 0, feeFixed: numOrNull(f.feeFixed) ?? 0,
  shippedFeePercent: fromPct(f.shippedPct), shippedFeeFixed: numOrNull(f.shippedFixed),
  categories: fromCsv(f.categories), draftStyle: f.draftStyle, enabled: f.enabled,
});
const EMPTY_CHANNEL: ChannelForm = { name: '', feePct: '', feeFixed: '', shippedPct: '', shippedFixed: '', categories: '', draftStyle: 'casual', enabled: true };

function Channels() {
  const channels = useApi(() => api.channels());
  const [forms, setForms] = useState<Record<number, ChannelForm>>({});
  const [adding, setAdding] = useState<ChannelForm | null>(null);
  useEffect(() => { if (channels.data) setForms(Object.fromEntries(channels.data.channels.map((c) => [c.id, channelForm(c)]))); }, [channels.data]);
  const act = useAction(async () => { await channels.reload(); setAdding(null); });
  if (channels.error) return <ErrorBox error={channels.error} />;
  if (!channels.data) return <Loading />;
  const setRow = (id: number, patch: Partial<ChannelForm>) => setForms({ ...forms, [id]: { ...forms[id], ...patch } });
  const dirty = (c: Channel) => forms[c.id] && JSON.stringify(channelPatch(forms[c.id])) !== JSON.stringify(channelPatch(channelForm(c)));

  const rowInputs = (f: ChannelForm, set: (p: Partial<ChannelForm>) => void) => (
    <>
      <td><input className="input sm" value={f.name} onChange={(e) => set({ name: e.target.value })} style={{ minWidth: 130 }} /></td>
      <td><input className="input sm num" inputMode="decimal" value={f.feePct} onChange={(e) => set({ feePct: e.target.value })} style={{ width: 70 }} /></td>
      <td><input className="input sm num" inputMode="decimal" value={f.feeFixed} onChange={(e) => set({ feeFixed: e.target.value })} style={{ width: 70 }} /></td>
      <td><input className="input sm num" inputMode="decimal" value={f.shippedPct} onChange={(e) => set({ shippedPct: e.target.value })} placeholder="same" style={{ width: 70 }} /></td>
      <td><input className="input sm num" inputMode="decimal" value={f.shippedFixed} onChange={(e) => set({ shippedFixed: e.target.value })} placeholder="same" style={{ width: 70 }} /></td>
      <td><input className="input sm" value={f.categories} onChange={(e) => set({ categories: e.target.value })} placeholder="all" style={{ minWidth: 110 }} /></td>
      <td>
        <select className="input sm" value={f.draftStyle} onChange={(e) => set({ draftStyle: e.target.value as Channel['draftStyle'] })}>
          {DRAFT_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td><Toggle on={f.enabled} onChange={(v) => set({ enabled: v })} label="Enabled" /></td>
    </>
  );

  return (
    <Card flush>
      <CardHead
        title="Selling channels"
        sub="Fees here drive the net-after-fees number on every inventory item. Percentages; shipped columns blank = same as local."
        right={!adding ? <button className="btn sm" onClick={() => setAdding({ ...EMPTY_CHANNEL })}>+ Add channel</button> : null}
      />
      <div style={{ padding: '0 16px' }}><ErrorBox error={act.error} /></div>
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr><th>Channel</th><th>Fee %</th><th>Fixed $</th><th>Shipped %</th><th>Shipped $</th><th>Categories</th><th>Draft style</th><th>On</th><th /></tr>
          </thead>
          <tbody>
            {channels.data.channels.map((c) => forms[c.id] ? (
              <tr key={c.id}>
                {rowInputs(forms[c.id], (p) => setRow(c.id, p))}
                <td className="num nowrap">
                  <button className="btn sm primary" disabled={!dirty(c) || act.busy} onClick={() => act.run(() => api.updateChannel(c.id, channelPatch(forms[c.id])))}>Save</button>{' '}
                  <button className="btn sm ghost" title="Delete (disable instead if it has listings)" onClick={() => { if (confirm(`Delete ${c.name}?`)) void act.run(() => api.deleteChannel(c.id)); }}>✕</button>
                </td>
              </tr>
            ) : null)}
            {adding ? (
              <tr>
                {rowInputs(adding, (p) => setAdding({ ...adding, ...p }))}
                <td className="num nowrap">
                  <button className="btn sm primary" disabled={!adding.name.trim() || act.busy} onClick={() => act.run(() => api.addChannel({ ...channelPatch(adding), name: adding.name.trim() }))}>Add</button>{' '}
                  <button className="btn sm ghost" onClick={() => setAdding(null)}>Cancel</button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------- Salvage parts book ----------

interface PartForm { name: string; low: string; high: string }
interface FamilyForm { family: string; keywords: string; parts: PartForm[]; estimated: boolean }
const familyForm = (f: Family): FamilyForm => ({ family: f.family, keywords: csv(f.keywords), parts: f.parts.map((p) => ({ name: p.name, low: String(p.low), high: String(p.high) })), estimated: f.estimated });
const familyPatch = (f: FamilyForm) => ({
  family: f.family.trim(),
  keywords: fromCsv(f.keywords),
  parts: f.parts.map((p) => ({ name: p.name.trim(), low: numOrNull(p.low) ?? 0, high: numOrNull(p.high) ?? 0 })),
  estimated: f.estimated,
});
const EMPTY_FAMILY: FamilyForm = { family: '', keywords: '', parts: [{ name: '', low: '', high: '' }], estimated: true };

function PartsBook() {
  const families = useApi(() => api.families());
  const [forms, setForms] = useState<Record<number, FamilyForm>>({});
  const [adding, setAdding] = useState<FamilyForm | null>(null);
  useEffect(() => { if (families.data) setForms(Object.fromEntries(families.data.families.map((f) => [f.id, familyForm(f)]))); }, [families.data]);
  const act = useAction(async () => { await families.reload(); setAdding(null); });
  if (families.error) return <ErrorBox error={families.error} />;
  if (!families.data) return <Loading />;
  const dirty = (f: Family) => forms[f.id] && JSON.stringify(familyPatch(forms[f.id])) !== JSON.stringify(familyPatch(familyForm(f)));

  return (
    <>
      <Card>
        <CardHead
          title="Salvage parts book"
          sub="Product family → the parts worth pulling from a dead unit and what they fetch. Every keyword must appear in the manifest line; the family with the most matching keywords wins."
          right={!adding ? <button className="btn sm" onClick={() => setAdding({ ...EMPTY_FAMILY, parts: [{ name: '', low: '', high: '' }] })}>+ Add family</button> : null}
        />
        <ErrorBox error={act.error} />
        <div className="muted small">Seeded values are estimates until you tick "confirmed from real sales" — the salvage plan labels them accordingly.</div>
      </Card>
      {adding ? (
        <FamilyEditor form={adding} onChange={setAdding} estimatedPill>
          <button className="btn sm primary" disabled={!adding.family.trim() || act.busy} onClick={() => act.run(() => api.addFamily(familyPatch(adding)))}>Add family</button>
          <button className="btn sm ghost" onClick={() => setAdding(null)}>Cancel</button>
        </FamilyEditor>
      ) : null}
      {families.data.families.map((f) => forms[f.id] ? (
        <FamilyEditor key={f.id} form={forms[f.id]} onChange={(next) => setForms({ ...forms, [f.id]: next })} estimatedPill>
          <button className="btn sm primary" disabled={!dirty(f) || act.busy} onClick={() => act.run(() => api.updateFamily(f.id, familyPatch(forms[f.id])))}>Save</button>
          <button className="btn sm ghost" onClick={() => { if (confirm(`Delete ${f.family}?`)) void act.run(() => api.deleteFamily(f.id)); }}>Delete</button>
        </FamilyEditor>
      ) : null)}
    </>
  );
}

function FamilyEditor({ form, onChange, children, estimatedPill }: { form: FamilyForm; onChange: (f: FamilyForm) => void; children: React.ReactNode; estimatedPill?: boolean }) {
  const setPart = (i: number, patch: Partial<PartForm>) => onChange({ ...form, parts: form.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="row">
          <input className="input" style={{ width: 200, fontWeight: 600 }} value={form.family} onChange={(e) => onChange({ ...form, family: e.target.value })} placeholder="Family name" />
          {estimatedPill ? (form.estimated ? <Pill tone="warn">estimate</Pill> : <Pill tone="good">confirmed</Pill>) : null}
        </div>
        <div className="row">{children}</div>
      </div>
      <div className="form-grid">
        <Field label="Keywords (all must match)" hint="Comma-separated, matched as whole words">
          <input className="input" value={form.keywords} onChange={(e) => onChange({ ...form, keywords: e.target.value })} placeholder="DYSON, V11" />
        </Field>
        <Field label="Values">
          <label className={`check ${form.estimated ? '' : 'on'}`} style={{ alignSelf: 'flex-start' }}>
            <input type="checkbox" checked={!form.estimated} onChange={(e) => onChange({ ...form, estimated: !e.target.checked })} /> confirmed from real sales
          </label>
        </Field>
      </div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="t">
          <thead><tr><th>Part</th><th className="num">Low $</th><th className="num">High $</th><th /></tr></thead>
          <tbody>
            {form.parts.map((p, i) => (
              <tr key={i}>
                <td><input className="input sm" value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} placeholder="Battery" /></td>
                <td className="num"><input className="input sm num" inputMode="decimal" style={{ width: 80 }} value={p.low} onChange={(e) => setPart(i, { low: e.target.value })} /></td>
                <td className="num"><input className="input sm num" inputMode="decimal" style={{ width: 80 }} value={p.high} onChange={(e) => setPart(i, { high: e.target.value })} /></td>
                <td className="num"><button className="btn sm ghost" onClick={() => onChange({ ...form, parts: form.parts.filter((_, j) => j !== i) })} aria-label="Remove part">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => onChange({ ...form, parts: [...form.parts, { name: '', low: '', high: '' }] })}>+ Part</button>
    </Card>
  );
}

// ---------- Integrations ----------

function Integrations() {
  const feed = useApi(() => api.feedInfo());
  const ai = useApi(() => api.aiStatus());
  const [copied, setCopied] = useState(false);
  const signOut = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  };
  return (
    <>
      <Card>
        <CardHead title="Google Calendar" sub="Subscribe once; deliveries, viewings and pickups show up in Google Calendar automatically (Google refreshes feeds every few hours)." />
        <ErrorBox error={feed.error} />
        {feed.data ? (
          <div className="stack">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <code className="input" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>{feed.data.feedUrl}</code>
              <button className="btn" onClick={() => { void navigator.clipboard.writeText(feed.data!.feedUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <ol className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>In Google Calendar, next to <b>Other calendars</b> click <b>+</b></li>
              <li>Choose <b>From URL</b></li>
              <li>Paste the address above and add the calendar</li>
            </ol>
          </div>
        ) : <Loading />}
      </Card>
      <Card>
        <CardHead title="Claude listing drafts" sub="Drafts per-channel listings from the item, its condition and comps." right={ai.data ? (ai.data.enabled ? <Pill tone="good">connected</Pill> : <Pill tone="gray">off</Pill>) : null} />
        {ai.data ? (
          ai.data.enabled
            ? <div className="muted small">Model: {ai.data.model}. Every item drawer has a "Draft with Claude" option; the template draft always works too.</div>
            : <div className="muted small">Add an <code>ANTHROPIC_API_KEY</code> environment variable on Vercel (or locally) to enable it. Template drafts work without it.</div>
        ) : <Loading />}
      </Card>
      <Card>
        <CardHead title="Password" right={feed.data ? (feed.data.passwordEnabled ? <Pill tone="good">enabled</Pill> : <Pill tone="warn">disabled</Pill>) : null} />
        <div className="muted small">
          The login gate is set with the <code>MA_PASSWORD</code> environment variable on Vercel — change it there and redeploy. Never run the hosted app without one.
        </div>
        {feed.data?.passwordEnabled ? <button className="btn" style={{ marginTop: 10 }} onClick={() => void signOut()}>Sign out</button> : null}
      </Card>
    </>
  );
}

// ---------- Data & backup ----------

const EXPORTS = ['lots', 'inventory', 'listings', 'sales', 'expenses', 'punches'] as const;

function DataBackup() {
  return (
    <Card>
      <CardHead title="Data & backup" sub="Download any table as CSV. Open in Numbers, Sheets or Excel." />
      <div className="row">
        {EXPORTS.map((t) => (
          <a key={t} className="btn" href={`/api/export/${t}.csv`} download>{t}.csv</a>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 12 }}>
        The database itself lives in Turso when hosted on Vercel, or in <code>data/analyzer.db</code> when running locally. Exports are read-only copies — nothing here deletes data.
      </div>
    </Card>
  );
}
