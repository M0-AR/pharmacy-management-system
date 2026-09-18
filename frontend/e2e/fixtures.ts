import { test as base, expect, type Page } from '@playwright/test';

// Business-action fixtures (2026 consensus): authenticate once per role via
// the API, hand tests a ready page. Only auth.spec.ts logs in through the UI.
export const ADMIN = { email: 'admin@pharmacy.local', password: 'Admin123!' };
export const CASHIER = { email: 'cashier@pharmacy.local', password: 'Cashier123!' };
export const PHARMACIST = { email: 'pharmacist@pharmacy.local', password: 'Pharmacist123!' };

export async function apiLogin(baseURL: string, email: string, password: string) {
  const res = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`seed login failed for ${email}: ${res.status}`);
  return (await res.json()) as { token: string; user: { id: string; name: string; email: string; role: string } };
}

export async function apiAuthed(baseURL: string, token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseURL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data: data as Record<string, unknown> };
}

async function gotoAuthed(page: Page, baseURL: string, creds: { email: string; password: string }, url: string) {
  const { token, user } = await apiLogin(baseURL, creds.email, creds.password);
  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('pharma_token', t);
      localStorage.setItem('pharma_user', JSON.stringify(u));
    },
    { t: token, u: user },
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Landmark wait (hydration-proof): the primary nav only renders post-auth.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  return { token, user };
}

type Fixtures = {
  adminPage: Page;
  cashierPage: Page;
  pharmacistPage: Page;
  adminToken: string;
};

export const test = base.extend<Fixtures>({
  adminPage: async ({ page }, use) => {
    await gotoAuthed(page, baseURL(), ADMIN, '/');
    await use(page);
  },
  cashierPage: async ({ page }, use) => {
    await gotoAuthed(page, baseURL(), CASHIER, '/');
    await use(page);
  },
  pharmacistPage: async ({ page }, use) => {
    await gotoAuthed(page, baseURL(), PHARMACIST, '/');
    await use(page);
  },
  adminToken: async ({}, use) => {
    const { token } = await apiLogin(baseURL(), ADMIN.email, ADMIN.password);
    await use(token);
  },
});

function baseURL(): string {
  return process.env.E2E_BASE_URL ?? 'http://localhost:8095';
}

export { expect };
export const uid = (p = 'e2e') => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
