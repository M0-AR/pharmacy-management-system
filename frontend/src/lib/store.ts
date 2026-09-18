import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const STORE_DEFAULTS: Record<string, string> = {
  'store.name': 'PharmaSuite Pharmacy',
  'store.tagline': 'Eastern USA · Rx + OTC',
  'store.address': 'Philadelphia, PA',
  'store.phone': '+1 (555) 010-2000',
  'store.receiptFooter': 'Thank you for your trust. Check expiry before use · Ask your pharmacist about interactions.',
};

export function useStoreSettings() {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/api/settings')).data as { settings: Record<string, string> },
    staleTime: 60_000,
  });
  return { ...(STORE_DEFAULTS as Record<string, string>), ...(data?.settings ?? {}) };
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
