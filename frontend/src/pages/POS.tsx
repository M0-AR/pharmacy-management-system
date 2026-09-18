import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Minus, Plus, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { Badge, Button, Card, Field, Input, Select } from '../components/ui';
import { useAuth } from '../lib/auth';
import { isExpired, usd } from '../lib/format';

interface Med { id: string; code: string; name: string; genericName: string | null; unitPrice: number; quantity: number; expiryDate: string | null; rxType: string; ndc: string | null }
interface CartLine { med: Med; qty: number }
interface Warning { type: string; severity: string; message: string; medicineId?: string }

export function POS() {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [discountPct, setDiscountPct] = useState('0');
  const [taxPct, setTaxPct] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [msg, setMsg] = useState('');
  const [warnings, setWarnings] = useState<Warning[] | null>(null);
  const [durNote, setDurNote] = useState('');
  const [durAcked, setDurAcked] = useState(false);

  const { data: meds } = useQuery({
    queryKey: ['pos-search', q],
    queryFn: async () => (await api.get('/api/medicines', { params: { search: q, pageSize: 12 } })).data as { items: Med[] },
  });
  const { data: customers } = useQuery({
    queryKey: ['customers-mini'],
    queryFn: async () => (await api.get('/api/customers', { params: { pageSize: 100 } })).data as { items: { id: string; firstName: string; lastName: string }[] },
  });

  // Refill handoff from an invoice ("Refill from this invoice").
  useEffect(() => {
    const raw = sessionStorage.getItem('pharma_refill');
    if (!raw) return;
    sessionStorage.removeItem('pharma_refill');
    try {
      const refill = JSON.parse(raw) as { customerId?: string; items: { medicineId: string; qty: number }[] };
      if (refill.customerId) setCustomerId(refill.customerId);
      Promise.all(
        refill.items.map((l) => api.get(`/api/medicines/${l.medicineId}`).then((r) => ({ med: r.data.medicine as Med, qty: l.qty })).catch(() => null)),
      ).then((lines) => {
        const valid = lines.filter((l): l is CartLine => l !== null && !isExpired(l.med.expiryDate) && l.med.quantity > 0);
        if (valid.length) { setCart(valid.map((l) => ({ ...l, qty: Math.min(l.qty, l.med.quantity) }))); setMsg(`Refill loaded: ${valid.length} line(s). Review and charge.`); }
        else setMsg('Refill could not be loaded (items expired or out of stock).');
      });
    } catch { /* ignore malformed handoff */ }
  }, []);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.med.unitPrice * l.qty, 0), [cart]);
  const discountAmt = subtotal * (Number(discountPct || 0) / 100);
  const taxAmt = (subtotal - discountAmt) * (Number(taxPct || 0) / 100);
  const total = subtotal - discountAmt + taxAmt;
  const hasRx = cart.some((l) => l.med.rxType === 'RX');
  const canDispenseRx = user?.role === 'ADMIN' || user?.role === 'PHARMACIST';
  const highWarnings = (warnings ?? []).filter((w) => w.severity === 'high');
  const cartChanged = useMemo(() => cart.map((l) => `${l.med.id}:${l.qty}`).join(','), [cart]);
  // Any cart/customer change invalidates a previous clinical review.
  useEffect(() => { setWarnings(null); setDurAcked(false); }, [cartChanged, customerId]);

  const runCheck = useMutation({
    mutationFn: async () => (await api.post('/api/dur/check', { customerId, items: cart.map((l) => ({ medicineId: l.med.id })) })).data as { warnings: Warning[] },
    onSuccess: (d) => { setWarnings(d.warnings); setDurAcked(false); setDurNote(''); setMsg(d.warnings.length === 0 ? 'Clinical screen clear — no allergy or duplicate-therapy flags.' : `${d.warnings.length} clinical flag(s) need review.`); },
    onError: (e) => setMsg(apiError(e)),
  });

  const acknowledge = useMutation({
    mutationFn: async () => (await api.post('/api/dur/acknowledge', { customerId, items: cart.map((l) => ({ medicineId: l.med.id })), warnings: warnings ?? [], note: durNote })).data,
    onSuccess: () => { setDurAcked(true); setMsg('Clinical review documented and audit-logged.'); },
    onError: (e) => setMsg(apiError(e)),
  });

  const sell = useMutation({
    mutationFn: async () => (await api.post('/api/sales', {
      customerId: customerId || null,
      items: cart.map((l) => ({ medicineId: l.med.id, qty: l.qty })),
      discountPct: Number(discountPct || 0),
      taxPct: Number(taxPct || 0),
      paymentMethod,
      ...(durAcked && warnings ? { durAck: { warnings, note: durNote || null } } : {}),
    })).data as { sale: { id: string } },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['medicines'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      nav(`/sales/${d.sale.id}`);
    },
    onError: (e) => {
      const err = e as { response?: { data?: { warnings?: Warning[]; error?: string } } };
      if (err?.response?.data?.warnings) {
        setWarnings(err.response.data.warnings ?? []);
        setDurAcked(false);
        setMsg('Server clinical screen raised flags — review and acknowledge to proceed.');
      } else setMsg(apiError(e));
    },
  });

  const add = (med: Med) => {
    if (isExpired(med.expiryDate)) { setMsg(`Blocked: ${med.name} is expired.`); return; }
    if (med.quantity <= 0) { setMsg(`Out of stock: ${med.name}.`); return; }
    setMsg('');
    setCart((prev) => {
      const found = prev.find((l) => l.med.id === med.id);
      if (found) {
        if (found.qty + 1 > med.quantity) { setMsg(`Only ${med.quantity} in stock for ${med.name}.`); return prev; }
        return prev.map((l) => (l.med.id === med.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { med, qty: 1 }];
    });
  };

  // Barcode-scanner support: scanners type the code/NDC + Enter.
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const needle = q.trim().toLowerCase();
    const exact = (meds?.items ?? []).find((m) => m.code.toLowerCase() === needle || (m.ndc ?? '').toLowerCase() === needle);
    if (exact) { add(exact); setQ(''); }
  };

  const chargeDisabled =
    cart.length === 0 || sell.isPending ||
    (hasRx && !canDispenseRx) ||
    (highWarnings.length > 0 && !durAcked);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Point of sale</h1>
        <p className="text-sm opacity-60">Scanner-ready search (type or scan code/NDC + Enter) → clinical screen → charge → printable invoice.</p>
      </div>
      {msg && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm" role="alert">{msg}</p>}
      {hasRx && !canDispenseRx && (
        <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">
          <ShieldAlert size={14} className="mr-1 inline" /> This cart contains prescription (Rx) items — a pharmacist must sign in to complete the sale. You can still sell OTC items.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-3 opacity-50" />
            <Input className="pl-9" placeholder="Search or scan code / NDC, then Enter…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Search products" autoFocus />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(meds?.items ?? []).map((m) => {
              const blocked = isExpired(m.expiryDate) || m.quantity <= 0;
              return (
                <button
                  key={m.id}
                  onClick={() => add(m)}
                  disabled={blocked}
                  className="rounded-xl border p-3 text-left transition hover:shadow-soft disabled:opacity-50"
                  style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }}
                >
                  <p className="truncate text-sm font-bold">{m.name} {m.rxType === 'RX' && <Badge tone="blue">Rx</Badge>}</p>
                  <p className="font-mono text-xs opacity-60">{m.code}{m.ndc ? ` · NDC ${m.ndc}` : ''}</p>
                  <p className="mt-1 flex items-center justify-between text-sm">
                    <span className="font-extrabold">{usd(m.unitPrice)}</span>
                    {blocked ? <Badge tone="red">{isExpired(m.expiryDate) ? 'Expired' : 'Out'}</Badge> : <Badge tone={m.quantity <= 10 ? 'amber' : 'green'}>{m.quantity} left</Badge>}
                  </p>
                </button>
              );
            })}
          </div>
          {(meds?.items ?? []).length === 0 && <p className="mt-3 text-sm opacity-60">No matches. Search by name, code, or NDC.</p>}
        </Card>

        <Card className="xl:col-span-2">
          <h2 className="mb-3 font-bold">Current sale ({cart.length} lines)</h2>
          {cart.length === 0 ? <p className="text-sm opacity-60">Cart is empty — tap a product (or scan) to add it.</p> : (
            <div className="space-y-2">
              {cart.map((l) => (
                <div key={l.med.id} className="flex items-center gap-2 rounded-xl border p-2" style={{ borderColor: 'hsl(var(--border))' }}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{l.med.name} {l.med.rxType === 'RX' && <Badge tone="blue">Rx</Badge>}</p>
                    <p className="font-mono text-xs opacity-60">{l.med.code} · {usd(l.med.unitPrice)} each</p>
                  </div>
                  <button className="rounded-lg border p-1.5" style={{ borderColor: 'hsl(var(--border))' }} aria-label="Decrease" onClick={() => setCart((p) => p.map((x) => (x.med.id === l.med.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus size={14} /></button>
                  <span className="w-6 text-center text-sm font-bold">{l.qty}</span>
                  <button className="rounded-lg border p-1.5" style={{ borderColor: 'hsl(var(--border))' }} aria-label="Increase" onClick={() => setCart((p) => p.map((x) => (x.med.id === l.med.id ? { ...x, qty: Math.min(x.med.quantity, x.qty + 1) } : x)))}><Plus size={14} /></button>
                  <span className="w-20 text-right text-sm font-bold">{usd(l.med.unitPrice * l.qty)}</span>
                  <button className="rounded-lg border p-1.5 text-red-600" style={{ borderColor: 'hsl(var(--border))' }} aria-label="Remove" onClick={() => setCart((p) => p.filter((x) => x.med.id !== l.med.id))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Customer (enables clinical screen)">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in</option>
                {(customers?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </Select>
            </Field>
            <Field label="Payment">
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="CASH">Cash</option><option value="CARD">Card</option><option value="INSURANCE">Insurance</option>
              </Select>
            </Field>
            <Field label="Discount %"><Input type="number" min="0" max="100" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} /></Field>
            <Field label="Sales tax %"><Input type="number" min="0" max="30" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} /></Field>
          </div>

          {customerId && cart.length > 0 && (
            <div className="mt-4 rounded-xl border p-3" style={{ borderColor: 'hsl(var(--border))' }}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold"><ShieldAlert size={14} className="mr-1 inline" /> Clinical screen (DUR-lite)</p>
                <Button variant="ghost" disabled={runCheck.isPending} onClick={() => runCheck.mutate()}>Run check</Button>
              </div>
              {!warnings && <p className="text-xs opacity-60">Screens allergies + duplicate therapy (120-day history). High-severity flags need a documented rationale.</p>}
              {(warnings ?? []).map((w, i) => (
                <p key={i} className={`mt-1 rounded-lg px-2 py-1.5 text-xs ${w.severity === 'high' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-amber-500/10'}`}>
                  <strong>[{w.severity.toUpperCase()}]</strong> {w.message}
                </p>
              ))}
              {warnings && highWarnings.length > 0 && !durAcked && (
                <div className="mt-2 space-y-2">
                  <Field label="Clinical rationale (required for high-severity flags)">
                    <Input value={durNote} onChange={(e) => setDurNote(e.target.value)} placeholder="e.g. Spoke with prescriber; intentional overlap for titration" />
                  </Field>
                  <Button variant="ghost" disabled={acknowledge.isPending || !durNote.trim()} onClick={() => acknowledge.mutate()}>Document review & proceed</Button>
                </div>
              )}
              {durAcked && <p className="mt-2 text-xs font-semibold text-teal-700 dark:text-teal-300">Review documented — attached to this sale's audit trail.</p>}
            </div>
          )}

          <div className="mt-4 space-y-1 rounded-xl p-3 text-sm" style={{ background: 'hsl(var(--muted))' }}>
            <p className="flex justify-between"><span>Subtotal</span><span className="font-semibold">{usd(subtotal)}</span></p>
            <p className="flex justify-between"><span>Discount</span><span>−{usd(discountAmt)}</span></p>
            <p className="flex justify-between"><span>Tax</span><span>+{usd(taxAmt)}</span></p>
            <p className="flex justify-between border-t pt-2 text-base font-extrabold" style={{ borderColor: 'hsl(var(--border))' }}><span>Total</span><span>{usd(total)}</span></p>
          </div>

          <div className="mt-3 flex gap-2">
            <Button className="flex-1" disabled={chargeDisabled} onClick={() => sell.mutate()}>
              {sell.isPending ? 'Charging…' : `Charge ${usd(total)}`}
            </Button>
            <Button variant="ghost" onClick={() => { setCart([]); setWarnings(null); setDurAcked(false); }}>Clear</Button>
          </div>
          {highWarnings.length > 0 && !durAcked && <p className="mt-1 text-xs text-red-600">Resolve clinical flags above to charge.</p>}
          <p className="mt-2 text-xs opacity-60">Atomic sale: stock + ledger + audit commit together. Rx lines require a pharmacist session; expired lines are refused server-side.</p>
        </Card>
      </div>
    </div>
  );
}
