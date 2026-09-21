import { test, expect } from '@playwright/test';

/**
 * SC-003 / quickstart.md step 2: after the app has been loaded once (so the
 * service worker and app-shell are cached), it must keep working with the
 * network fully disabled.
 */
test('the app keeps working after the network is turned off', async ({ page, context }) => {
  // First load: registers the service worker and caches the app shell.
  await page.goto('/profiles');
  await expect(page.getByRole('heading', { name: 'Chọn hồ sơ của bạn' })).toBeVisible();

  // Give the service worker a moment to finish its initial registration.
  await page.waitForTimeout(1000);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Chọn hồ sơ của bạn' })).toBeVisible();

  // Core offline interaction: log in and reach the home screen, all with no network.
  await page.getByText('Bé Một').click();
  await page.locator('input[type="password"]').fill('1234');
  await page.getByRole('button', { name: 'Nộp bài' }).click();
  await expect(page).toHaveURL(/child-home/);

  await context.setOffline(false);
});
