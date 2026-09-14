import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Icon, Toast } from './components/ui.tsx';
import { Today } from './routes/Today.tsx';
import { Lots } from './routes/Lots.tsx';
import { LotDetail } from './routes/LotDetail.tsx';
import { Receive } from './routes/Receive.tsx';
import { Inventory } from './routes/Inventory.tsx';
import { Money } from './routes/Money.tsx';
import { Settings } from './routes/Settings.tsx';

const NAV = [
  { to: '/', icon: 'today', label: 'Today', end: true },
  { to: '/lots', icon: 'lots', label: 'Lots' },
  { to: '/receive', icon: 'receive', label: 'Receive' },
  { to: '/inventory', icon: 'inventory', label: 'Inventory' },
  { to: '/money', icon: 'money', label: 'Money' },
] as const;

export function App() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="brand">
          <span className="mark"><Icon name="box" size={16} /></span>
          Manifest Analyzer
        </NavLink>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={'end' in n} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>
            <Icon name={n.icon} />
            {n.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <NavLink to="/settings" className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>
          <Icon name="settings" />
          Settings
        </NavLink>
        <div className="foot">Local-first. Never connects to bstock.com — manifests and listing details are entered by you.</div>
      </aside>

      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/lots" element={<Lots />} />
        <Route path="/lots/:id" element={<LotDetail />} />
        <Route path="/receive" element={<Receive />} />
        <Route path="/receive/:id" element={<Receive />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory/:id" element={<Inventory />} />
        <Route path="/money" element={<Money />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:section" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <nav className="tabs">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={'end' in n} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={n.icon} size={22} />
            {n.label}
          </NavLink>
        ))}
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="settings" size={22} />
          Settings
        </NavLink>
      </nav>

      {needRefresh ? (
        <Toast text="A new version is ready." action="Reload" onAction={() => void updateServiceWorker(true)} onClose={() => setNeedRefresh(false)} />
      ) : null}
    </div>
  );
}
