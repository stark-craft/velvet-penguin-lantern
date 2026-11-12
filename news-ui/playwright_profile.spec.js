import { test, expect } from '@playwright/test';

test('profile save', async ({ page }) => {
  page.on('console', msg => console.log('CONSOLE', msg.type(), msg.text()));
  page.on('request', req => {
    if (req.url().includes('/viewer/profile')) console.log('REQ', req.method(), req.url(), req.postData());
  });
  page.on('response', async res => {
    if (res.url().includes('/viewer/profile')) {
      console.log('RES', res.status(), res.url(), await res.text().catch(()=> ''));
    }
  });
  await page.goto('/sampark/for-you');
  await page.waitForTimeout(1500);
  const headerBefore = await page.textContent('.techscout-greeting p');
  console.log('HEADER BEFORE', headerBefore);
  await page.click('button[aria-label="Open settings"]');
  await page.waitForSelector('.settings-modal');
  const nameInput = page.locator('.settings-modal input[autocomplete="nickname"]');
  const testName = `MuseProfileTest_${Date.now()}`;
  console.log('TYPING', testName);
  await nameInput.fill(testName);
  const saveBtn = page.locator('.settings-modal footer button.btn-primary');
  console.log('SAVE TEXT', await saveBtn.textContent());
  console.log('DISABLED', await saveBtn.isDisabled());
  await saveBtn.click();
  console.log('CLICKED');
  await page.waitForTimeout(3000);
  const stillVisible = await page.locator('.settings-modal').isVisible().catch(()=> false);
  console.log('MODAL STILL VISIBLE', stillVisible);
  const msg = await page.textContent('.settings-message').catch(()=> 'no message');
  console.log('MESSAGE', msg);
  const headerAfter = await page.textContent('.techscout-greeting p');
  console.log('HEADER AFTER', headerAfter);
  expect(headerAfter).toContain(testName);
});
