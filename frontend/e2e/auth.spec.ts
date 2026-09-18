import { test, expect, ADMIN, CASHIER } from './fixtures';

test.describe('authentication & access control', () => {
  test('rejects wrong credentials with a clear message', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Work email' }).fill(ADMIN.email);
    await page.getByRole('textbox', { name: 'Password' }).fill('WrongPass123!');
    await page.getByRole('button', { name: 'Sign in securely' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page).toHaveURL(/\/login/);
  });

  test('admin signs in through the UI and lands on a live dashboard', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Work email' }).fill(ADMIN.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in securely' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Command center' })).toBeVisible();
    await expect(page.getByText('Revenue (all time)')).toBeVisible();
  });

  test('anonymous visits are bounced to login', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });

  test('cashier session hides admin navigation', async ({ page }) => {
    const { apiLogin } = await import('./fixtures');
    const base = process.env.E2E_BASE_URL ?? 'http://localhost:8095';
    const { token, user } = await apiLogin(base, CASHIER.email, CASHIER.password);
    await page.addInitScript(
      ({ t, u }) => {
        localStorage.setItem('pharma_token', t);
        localStorage.setItem('pharma_user', JSON.stringify(u));
      },
      { t: token, u: user },
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('CASHIER', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Users & Roles/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /New Sale/ })).toBeVisible();
  });
});
