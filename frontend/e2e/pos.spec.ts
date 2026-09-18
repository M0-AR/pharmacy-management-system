import { test, expect, apiAuthed, uid } from './fixtures';
import type { Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8095';

async function addByScan(page: Page, code: string) {
  await page.getByRole('textbox', { name: 'Search products' }).fill(code);
  // Wait for the search round-trip: the card must exist before Enter,
  // exactly like a scanner that types after results render.
  await expect(page.getByRole('button', { name: new RegExp(code) }).first()).toBeVisible();
  await page.keyboard.press('Enter');
}

test.describe('point of sale, DUR & invoices', () => {
  test('walk-in OTC sale charges exact totals and lands on an invoice', async ({ adminPage: page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await addByScan(page, 'MED-2044'); // Cough Drops $3.99
    await expect(page.getByRole('heading', { name: /Current sale \(1 lines\)/ })).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Sales tax %' }).fill('6');
    await expect(page.getByText('$4.23', { exact: true }).first()).toBeVisible(); // 3.99 + 6%
    await page.getByRole('button', { name: /Charge \$/ }).click();
    await expect(page).toHaveURL(/\/sales\//);
    await expect(page.getByText('COMPLETED')).toBeVisible();
    await expect(page.getByText('$4.23', { exact: true }).first()).toBeVisible();
  });

  test('cashier is blocked from Rx carts but can sell OTC', async ({ cashierPage: page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await addByScan(page, 'MED-2003'); // Atorvastatin Rx
    await expect(page.getByText(/pharmacist must sign in/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Charge \$/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Remove' }).click();
    await addByScan(page, 'MED-1001'); // Acetaminophen OTC
    await expect(page.getByRole('button', { name: /Charge \$/ })).toBeEnabled();
  });

  test('allergy flag → documented ack → charge → return → refill', async ({ adminPage: page, adminToken }) => {
    // Own allergic patient + own ibuprofen line item: fully isolated data.
    const allergy = `spec-allergy-${uid()}`;
    const cust = await apiAuthed(BASE, adminToken, 'POST', '/api/customers', {
      firstName: 'Spec', lastName: `Patient ${uid()}`, allergies: allergy,
    });
    const customerId = (cust.data.customer as { id: string }).id;
    const med = await apiAuthed(BASE, adminToken, 'POST', '/api/medicines', {
      name: `Specfen ${uid()}`, genericName: `Specfen-${allergy}`, category: 'Tablets',
      unitPrice: 6.5, quantity: 10,
    });
    const medicineId = (med.data.medicine as { id: string; code: string }).id;
    const code = (med.data.medicine as { code: string }).code;

    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await addByScan(page, code);
    // Customer <option> values are customer ids — select ours directly.
    await page.getByLabel('Customer (enables clinical screen)').selectOption(customerId);
    await page.getByRole('button', { name: 'Run check' }).click();
    await expect(page.getByText('[HIGH]', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Charge \$/ })).toBeDisabled();
    await page.getByRole('textbox', { name: /Clinical rationale/ }).fill('Spec rationale — prescriber consulted.');
    await page.getByRole('button', { name: 'Document review & proceed' }).click();
    await expect(page.getByText("Review documented — attached to this sale's audit trail.")).toBeVisible();
    await page.getByRole('button', { name: /Charge \$/ }).click();
    await expect(page).toHaveURL(/\/sales\//);

    // Return the line, then refill it back into a new cart.
    await page.getByLabel('Item').selectOption({ index: 1 });
    await page.getByRole('textbox', { name: 'Reason *' }).fill('Spec return — unopened');
    await page.getByRole('button', { name: 'Record return' }).click();
    await expect(page.getByText('Return recorded')).toBeVisible();
    await expect(page.getByText('Refunded')).toBeVisible();
    await page.getByRole('button', { name: 'Refill from this invoice' }).click();
    await expect(page).toHaveURL(/\/pos/);
    await expect(page.getByText('Refill loaded')).toBeVisible();

    // Cleanup: remove our fixtures (sale+return stay as ledger history by design).
    await apiAuthed(BASE, adminToken, 'DELETE', `/api/medicines/${medicineId}`).catch(() => {});
    await apiAuthed(BASE, adminToken, 'DELETE', `/api/customers/${customerId}`).catch(() => {});
  });
});
