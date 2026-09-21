import { test, expect } from '@playwright/test';

/**
 * User Story 1 (P1) smoke test: a child logs in, plays the seeded daily
 * exercise end-to-end, and reaches a result screen (quickstart.md step 3).
 */
test('child completes the seeded daily exercise and sees a result', async ({ page }) => {
  await page.goto('/profiles');
  await expect(page.getByRole('heading', { name: 'Chọn hồ sơ của bạn' })).toBeVisible();

  await page.getByText('Bé Một').click();
  await page.locator('input[type="password"]').fill('1234');
  await page.getByRole('button', { name: 'Nộp bài' }).click();

  await expect(page).toHaveURL(/child-home/);
  await expect(page.getByText('Luyện tập buổi sáng')).toBeVisible();

  await page.getByRole('button', { name: 'Bắt đầu' }).click();
  await expect(page).toHaveURL(/exercise-intro/);
  await page.getByRole('button', { name: 'Bắt đầu' }).click();

  await expect(page).toHaveURL(/exercise\/question/);

  // Answer every seeded question (single-choice, number, short-text). After
  // the last one, the attempt completes and the app navigates straight to
  // the result screen without necessarily showing a "Next" to click.
  for (let i = 0; i < 5 && !page.url().includes('/exercise/result'); i++) {
    const choiceButtons = page.locator('button.choice');
    const numberInput = page.locator('input[name="numberAnswer"]');
    const textInput = page.locator('input[name="textAnswer"]');

    if (await choiceButtons.count() > 0) {
      await choiceButtons.first().click();
    } else if (await numberInput.count() > 0) {
      await numberInput.fill('9');
    } else if (await textInput.count() > 0) {
      await textInput.fill('meo');
    }

    await page.getByRole('button', { name: 'Nộp bài' }).click();

    // Whichever happens first: the attempt ends and the app navigates to
    // the result screen on its own, or the feedback screen's Next button
    // appears and needs a click (either manual or the auto-advance timer).
    await Promise.race([
      page.waitForURL(/exercise\/result/, { timeout: 10_000 }),
      page.getByRole('button', { name: 'Tiếp theo' }).waitFor({ state: 'visible', timeout: 10_000 }),
    ]);

    if (page.url().includes('/exercise/result')) break;

    await page
      .getByRole('button', { name: 'Tiếp theo' })
      .click({ timeout: 3_000 })
      .catch(() => {
        // Auto-advance (or a same-tick navigation to the result screen) may
        // have already handled this; either way the loop's next check covers it.
      });
  }

  await expect(page).toHaveURL(/exercise\/result/);
  await expect(page.getByRole('button', { name: 'Trang chủ' })).toBeVisible();
});
