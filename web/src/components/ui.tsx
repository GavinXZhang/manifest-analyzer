import { useEffect, type ReactNode } from 'react';

/** Small building blocks — every screen composes these so the look stays consistent. */

export function Card({ children, className = '', flush = false, tone }: { children: ReactNode; className?: string; flush?: boolean; tone?: 'good' | 'bad' }) {
  return <div className={`card ${flush ? 'flush' : ''} ${tone ?? ''} ${className}`}>{children}</div>;
}

export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {sub ? <div className="muted small">{sub}</div> : null}
      </div>
      {right ? <div className="row">{right}</div> : null}
    </div>
  );
}

export function Pill({ tone = 'gray', children }: { tone?: 'good' | 'warn' | 'bad' | 'gray' | 'acc'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Chip({ live, draft, onClick, children, title }: { live?: boolean; draft?: boolean; onClick?: () => void; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${live ? 'live' : ''} ${draft ? 'draft' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick} title={title}>
      {live ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

export function Kpi({ label, value, unit, sub, delta }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; delta?: { text: string; tone: 'up' | 'down' | 'flat' } }) {
  return (
    <div className="kpi">
      <div className="micro">{label}</div>
      <div className="v">
        {value}
        {unit ? <span className="unit"> {unit}</span> : null}
      </div>
      {delta ? <div className={`delta ${delta.tone === 'flat' ? 'muted' : delta.tone}`}>{delta.text}</div> : sub ? <div className="muted tiny">{sub}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, bare = false }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; bare?: boolean }) {
  return (
    <span className={`seg ${bare ? 'bare' : ''}`}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="faint tiny">{hint}</div> : null}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? <div className="error-box">{error}</div> : null;
}

export function Progress({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div style={{ width: `${w}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}

export function Drawer({ open, onClose, title, sub, children, actions }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {sub ? <div className="muted small">{sub}</div> : null}
          </div>
          <div className="row">
            {actions}
            <button className="btn sm ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        {children}
      </aside>
    </>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" className={`toggle ${on ? '' : 'off'}`} onClick={() => onChange(!on)} aria-label={label ?? (on ? 'On' : 'Off')} aria-pressed={on} />;
}

export function Toast({ text, action, onAction, onClose }: { text: string; action?: string; onAction?: () => void; onClose?: () => void }) {
  return (
    <div className="toast">
      <span>{text}</span>
      {action ? <button onClick={onAction}>{action}</button> : null}
      {onClose ? <button onClick={onClose} aria-label="Dismiss">✕</button> : null}
    </div>
  );
}

/** Stepper input for check-in counts. */
export function Counter({ value, onChange, tone, large = false, max }: { value: number; onChange: (v: number) => void; tone?: 'weak' | 'dead'; large?: boolean; max?: number }) {
  const clamp = (n: number) => Math.max(0, max !== undefined ? Math.min(max, n) : n);
  return (
    <span className={`cnt ${tone ?? ''} ${large ? 'lg' : ''}`}>
      <button type="button" onClick={() => onChange(clamp(value - 1))} aria-label="minus">−</button>
      <input type="number" inputMode="numeric" min={0} value={value} onChange={(e) => onChange(clamp(Number(e.target.value) || 0))} />
      <button type="button" onClick={() => onChange(clamp(value + 1))} aria-label="plus">+</button>
    </span>
  );
}

export function Icon({ name, size = 17 }: { name: 'today' | 'lots' | 'receive' | 'inventory' | 'money' | 'settings' | 'box'; size?: number }) {
  const common = { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'today': return <svg {...common}><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>;
    case 'lots': return <svg {...common}><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>;
    case 'receive': return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 13h5l1.5 2h5L16 13h5" /></svg>;
    case 'inventory': return <svg {...common}><path d="M3 7h18v13H3z" /><path d="M3 7l2-4h14l2 4" /><path d="M10 11h4" /></svg>;
    case 'money': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2 0 2.5 5 1.5 5 4 0 1.2-1 2-2.5 2-1.2 0-2.2-.6-2.7-1.5M12 6v2m0 8v2" /></svg>;
    case 'settings': return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="8" cy="18" r="2" fill="currentColor" /></svg>;
    case 'box': return <svg {...common} strokeWidth={2}><path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z" /><path d="M3 8.5 12 14l9-5.5" /><path d="M12 14v7" /></svg>;
  }
}
