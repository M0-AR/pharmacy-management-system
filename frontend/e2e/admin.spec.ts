import { test, expect, apiAuthed, uid } from './fixtures';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8095';

test.describe('administration & inventory', () => {
  test('user lifecycle: create → disable → enable', async ({ adminPage: page, adminToken }) => {
    const email = `spec-${uid()}@example.com`;
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByRole('textbox', { name: 'Full name *' }).fill('Spec Tech');
    await page.getByRole('textbox', { name: 'Work email *' }).fill(email);
    await page.getByRole('textbox', { name: /Temporary password/ }).fill('SpecTech123!');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('User created.')).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // Match by run-unique email: prior suite runs may have left same-named rows.
    const row = page.getByRole('row', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button').click();
    await expect(row.getByText('Disabled')).toBeVisible();

    const login = await apiAuthed(BASE, '', 'POST', '/api/auth/login', { email, password: 'SpecTech123!' });
    expect(login.status).toBe(401);

    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button').click();
    await expect(row.getByText('Active')).toBeVisible();
    void adminToken;
  });

  test('white-label settings propagate and revert', async ({ adminPage: page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Tagline' }).fill('Spec Tagline');
    await page.getByRole('button', { name: 'Save store profile' }).click();
    await expect(page.getByText('Spec Tagline').first()).toBeVisible();
    await page.getByRole('textbox', { name: 'Tagline' }).fill('Eastern USA · Rx + OTC');
    await page.getByRole('button', { name: 'Save store profile' }).click();
    await expect(page.getByText('Eastern USA · Rx + OTC').first()).toBeVisible();
  });

  test('inventory adjustment moves the low-stock needle', async ({ adminPage: page, adminToken }) => {
    const med = await apiAuthed(BASE, adminToken, 'POST', '/api/medicines', {
      name: `SpecLow ${uid()}`, category: 'Tablets', unitPrice: 2, quantity: 2, lowStockThreshold: 5,
    });
    const id = (med.data.medicine as { id: string }).id;
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Low stock (≤ threshold)')).toBeVisible();
    await page.getByLabel('Medicine').selectOption(
      await page.getByLabel('Medicine').evaluate((sel: HTMLSelectElement) => {
        const opt = [...sel.options].find((o) => o.text.includes('SpecLow'));
        return opt ? opt.value : '';
      }),
    );
    await page.getByRole('spinbutton', { name: /Change/ }).fill('20');
    await page.getByRole('textbox', { name: 'Note' }).fill('Spec PO-1');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Stock adjusted and ledgered.')).toBeVisible();
    await apiAuthed(BASE, adminToken, 'DELETE', `/api/medicines/${id}`);
  });

  test('audit trail records the session', async ({ adminPage: page }) => {
    await page.goto('/audit', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('append-only')).toBeVisible();
    // Wait for data, not chrome: rows only exist after the API round-trip.
    await expect(page.getByText('auth.login').first()).toBeVisible();
    expect(await page.getByRole('row').count()).toBeGreaterThan(3);
  });
});
