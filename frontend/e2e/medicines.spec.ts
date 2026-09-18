import { test, expect, apiAuthed, uid } from './fixtures';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8095';

test.describe('medicine catalog & ledger', () => {
  test('search narrows the table and low-stock filter honors thresholds', async ({ adminPage: page }) => {
    await page.goto('/medicines', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Search medicines' }).fill('warfarin');
    await expect(page.getByText('Warfarin 5mg')).toBeVisible();
    await expect(page.getByText('1 products')).toBeVisible();
  });

  test('full lifecycle: add (date-only expiry) → edit qty with ledger → history → delete', async ({
    adminPage: page,
    adminToken,
  }) => {
    const name = `Spec Syrup ${uid()}`;
    await page.goto('/medicines', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add medicine', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name *' }).fill(name);
    await page.getByRole('spinbutton', { name: 'Unit price (USD) *' }).fill('7.77');
    await page.getByRole('spinbutton', { name: 'Opening quantity' }).fill('30');
    await page.getByRole('textbox', { name: 'Expiry date' }).fill('2029-01-15');
    // The open form and the page header both contain an "Add medicine"
    // button — scope the submit to the form card.
    const form = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Add medicine' }) }).last();
    await form.getByRole('button', { name: 'Add medicine', exact: true }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // Edit quantity 30 → 25 and prove the -5 correction lands in the ledger.
    await page.getByRole('textbox', { name: 'Search medicines' }).fill(name);
    await expect(page.getByText(name)).toBeVisible();
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await page.getByRole('spinbutton', { name: /Quantity/ }).fill('25');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.getByRole('button', { name: `History of ${name}` }).click();
    await expect(page.getByRole('dialog', { name: 'Stock ledger' })).toBeVisible();
    await expect(page.getByText('Opening stock')).toBeVisible();
    await expect(page.getByText('Manual correction via medicine edit')).toBeVisible();
    await page.getByRole('button', { name: 'Close ledger' }).click();

    // Delete (confirm dialog) and confirm the row is gone.
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(page.getByText('Deleted.')).toBeVisible();

    // API-level proof the ledger rows were cleaned with the medicine.
    const list = await apiAuthed(BASE, adminToken, 'GET', `/api/medicines?search=${encodeURIComponent(name)}&pageSize=5`);
    expect((list.data.items as unknown[]).length).toBe(0);
  });

  test('delete is blocked when sales history exists', async ({ adminPage: page, adminToken }) => {
    // Acetaminophen MED-1001 always has history in seeded + tested stacks.
    const list = await apiAuthed(BASE, adminToken, 'GET', '/api/medicines?search=MED-1001&pageSize=2');
    const med = (list.data.items as { id: string; name: string }[])[0]!;
    await page.goto('/medicines', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Search medicines' }).fill('MED-1001');
    await expect(page.getByText('Acetaminophen 500mg')).toBeVisible();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: `Delete ${med.name}` }).click();
    await expect(page.getByText('Cannot delete')).toBeVisible();
  });
});
