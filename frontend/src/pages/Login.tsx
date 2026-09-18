import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { apiError } from '../lib/api';
import { Button, Card, Field, Input } from '../components/ui';

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('admin@pharmacy.local');
  const [password, setPassword] = useState('Admin123!');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid min-h-screen place-items-center px-4" style={{ background: 'radial-gradient(1000px 500px at 20% 0%, rgba(13,148,136,.18), transparent), radial-gradient(900px 500px at 90% 20%, rgba(37,99,235,.16), transparent)' }}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: 'linear-gradient(135deg,#0d9488,#2563eb)' }}>
            <Activity />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold">PharmaSuite</h1>
            <p className="text-sm opacity-60">Pharmacy Management · Eastern USA edition</p>
          </div>
        </div>
        <Card>
          <h2 className="text-lg font-bold">Sign in</h2>
          <p className="mb-4 text-sm opacity-60">Role-based access for Admin, Pharmacist, Technician, Cashier.</p>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(''); setBusy(true);
              try { await login(email, password); nav('/'); }
              catch (e2) { setErr(apiError(e2)); }
              finally { setBusy(false); }
            }}
          >
            <Field label="Work email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password">
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {err && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300" role="alert">{err}</p>}
            <Button className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</Button>
          </form>
          <p className="mt-4 text-xs leading-relaxed opacity-60">
            Demo: <code>admin@pharmacy.local</code> / <code>Admin123!</code>. Change these before selling or going live.
            Prices in USD. For real PHI, deploy behind HTTPS with a signed BAA.
          </p>
        </Card>
      </div>
    </div>
  );
}
