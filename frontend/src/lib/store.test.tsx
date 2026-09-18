import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, apiError } from './api';
import { STORE_DEFAULTS, downloadCsv, useStoreSettings } from './store';

vi.mock('./api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./api')>();
  return { ...mod, api: { get: vi.fn() } };
});
const apiGet = vi.mocked(api.get);

describe('apiError()', () => {
  it('prefers server messages, falls back gracefully', () => {
    expect(apiError({ response: { data: { error: 'Nope' } } })).toBe('Nope');
    expect(apiError({ message: 'boom' })).toBe('boom');
    expect(apiError(null)).toBe('Something went wrong');
    expect(apiError(undefined)).toBe('Something went wrong');
  });
});

describe('STORE_DEFAULTS', () => {
  it('covers every white-label key the UI reads', () => {
    for (const key of ['store.name', 'store.tagline', 'store.address', 'store.phone', 'store.receiptFooter']) {
      expect(STORE_DEFAULTS[key]).toBeTruthy();
    }
  });
});

describe('useStoreSettings()', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it('falls back to defaults when the API fails', async () => {
    apiGet.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useStoreSettings(), { wrapper });
    await waitFor(() => expect(result.current['store.name']).toBe(STORE_DEFAULTS['store.name']));
  });

  it('server values override defaults', async () => {
    apiGet.mockResolvedValueOnce({ data: { settings: { 'store.name': 'Acme Pharmacy' } } });
    const { result } = renderHook(() => useStoreSettings(), { wrapper });
    await waitFor(() => expect(result.current['store.name']).toBe('Acme Pharmacy'));
    expect(result.current['store.phone']).toBe(STORE_DEFAULTS['store.phone']);
  });
});

describe('downloadCsv()', () => {
  it('builds a quoted CSV and triggers a download', () => {
    const clicks: string[] = [];
    const create = vi.spyOn(document, 'createElement');
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => { clicks.push('x'); });
    create.mockReturnValueOnce(anchor as unknown as HTMLElement);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const objUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv');

    downloadCsv('t.csv', [
      { code: 'MED-1', name: 'A, "quoted"' },
      { code: 'MED-2', name: 'Plain', extra: 1 },
    ]);

    expect(anchor.download).toBe('t.csv');
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:csv');
    expect(objUrl).toHaveBeenCalled();
    create.mockRestore();
    revoke.mockRestore();
    objUrl.mockRestore();
  });
});
