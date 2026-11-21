import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, approvedPlayer } from './helpers';
import { playerToken, payPlayer } from './shops';

// The bank at the table, a safety net before 8a7 (8n2; the user, 2026-11-19: tests for the thin places, the bank among them).
// Cities Without Number's money: the GM pays a player 1,000 from PAYROLL.EXE, and their bank opens by itself; in BANK.EXE
// the player withdraws 200, borrows 100 (owed, the money in hand) and pays 50 of it back from the account, the balance and
// the debt as the bank says each time. By the names the windows give their boxes.

/** BANK.EXE's amount prompt: `action` pressed, `amount` typed, CONFIRM. */
const act = async (bank: ReturnType<Page['locator']>, action: string, amount: number) => {
  await bank.getByRole('button', { name: action, exact: true }).click();
  await bank.getByRole('spinbutton', { name: 'Amount' }).fill(String(amount));
  await bank.getByRole('button', { name: 'CONFIRM', exact: true }).click();
};

test('the bank: paid by the GM, it opens; a withdrawal, a loan and part of it paid back, each in BANK.EXE (8n2)', async ({ page, browser, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await asGm(request, gm, 'put', '/api/sheets/system', { system: 'cities_without_number' });
  const player = { username: `e2e_banker${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await payPlayer(page, player.username, 1000);

  // Being paid opens the player's bank by itself (App.tsx onBalancePaid): waited for, never clicked (a click shuts it).
  const bank = mine.locator('.win95-window', { has: mine.getByText('BANK.EXE', { exact: true }) });
  await expect(bank).toBeVisible({ timeout: 15_000 });
  const balance = bank.getByTestId('bank-balance');
  const debt = bank.getByTestId('bank-debt');
  await expect(balance).toHaveText('1000.00', { timeout: 15_000 });
  await expect(debt).toHaveText('0.00');

  await act(bank, 'WITHDRAW', 200);
  await expect(balance).toHaveText('800.00', { timeout: 15_000 });
  // A loan is owed, the money in hand rather than in the account (bank/moneyRules.js borrow); paid back from the account.
  await act(bank, 'BORROW', 100);
  await expect(debt).toHaveText('100.00', { timeout: 15_000 });
  await expect(balance).toHaveText('800.00');
  await act(bank, 'PAY', 50);
  await expect(debt).toHaveText('50.00', { timeout: 15_000 });
  await expect(balance).toHaveText('750.00');
  await context.close();
});
