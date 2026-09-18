import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  Activity, Bell, Boxes, FileText, LayoutDashboard, LogOut, Menu, Moon, Pill,
  Receipt, Settings as SettingsIcon, ShieldCheck, ShoppingCart, Sun, Truck, Users, X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useStoreSettings } from '../lib/store';
import { cx } from '../lib/format';

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pos', label: 'New Sale (POS)', icon: ShoppingCart },
  { to: '/sales', label: 'Sales & Invoices', icon: Receipt },
  { to: '/medicines', label: 'Medicines', icon: Pill },
  { to: '/inventory', label: 'Inventory Alerts', icon: Boxes },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/audit', label: 'Audit Trail', icon: ShieldCheck },
  { to: '/users', label: 'Users & Roles', icon: Users, admin: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('pharma_theme', next ? 'dark' : 'light');
  };
  return { dark, toggle };
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const store = useStoreSettings();
  const nav = useNavigate();
  const { dark, toggle } = useDark();
  const [open, setOpen] = useState(false);
  const visibleLinks = links.filter((l) => !(l as { admin?: boolean }).admin || user?.role === 'ADMIN');

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link to="/" className="flex items-center gap-3 px-5 pb-5 pt-6" onClick={() => setOpen(false)}>
        <span className="grid h-11 w-11 place-items-center rounded-2xl text-white shadow-soft" style={{ background: 'linear-gradient(135deg,#0d9488,#2563eb)' }}>
          <Activity size={22} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-lg font-extrabold leading-tight">{store['store.name']}</span>
          <span className="block truncate text-xs opacity-60">{store['store.tagline']}</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-1 overflow-auto px-3" aria-label="Primary">
        {visibleLinks.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'text-white shadow-soft' : 'hover:opacity-100 opacity-80 hover:bg-[hsl(var(--muted))]',
              )
            }
            style={({ isActive }) => (isActive ? { background: 'linear-gradient(135deg,#0d9488,#2563eb)' } : undefined)}
          >
            <l.icon size={18} />
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4">
        <div className="card p-3 text-xs leading-relaxed opacity-90">
          <p className="font-bold">HIPAA-aware by design</p>
          <p className="opacity-70">RBAC · audit trail · minimum-necessary access. Sign a BAA with your host before storing real PHI.</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-full lg:flex">
      <aside className="no-print hidden w-72 shrink-0 border-r lg:block" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}>
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-80 max-w-[85vw] shadow-2xl" style={{ background: 'hsl(var(--card))' }}>
            <button className="absolute right-3 top-4 rounded-lg p-2" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 border-b backdrop-blur" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--background) / 0.85)' }}>
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button className="btn-ghost btn !px-3 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Good day, {user?.name?.split(' ')[0] ?? 'there'} — ready to dispense safely.</p>
              <p className="truncate text-xs opacity-60">USD pricing · NDC + Rx/OTC tracking · expiry & low-stock guardrails</p>
            </div>
            <button className="btn-ghost btn !px-3" onClick={toggle} aria-label="Toggle theme" title="Toggle light / dark">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <span className="hidden items-center gap-2 rounded-xl border px-3 py-2 text-xs sm:inline-flex" style={{ borderColor: 'hsl(var(--border))' }}>
              <Bell size={15} className="opacity-60" />
              {user?.role}
            </span>
            <button
              className="btn-ghost btn !px-3"
              onClick={() => { logout(); nav('/login'); }}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
