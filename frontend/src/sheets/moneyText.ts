import { formatAmount, parseAmount, type Currency, type ParsedAmount } from './currencies';
import { customTemplate, isCustomSystem } from './customTemplates';

// What the money windows say in a custom system's own currencies (3c2b2), and whether the bank
// celebrates. Pure, so every sentence is tested apart from the windows that show it: BANK.EXE,
// the shop cart, PAYROLL.EXE and BANK_ADMIN.EXE (3c2b3 to 3c2b5, mockup approved by the user
// 2026-10-02, docs/mockups/currency-windows.html).
//
// Every amount is written as the currency writes it (currencies.ts formatAmount): "20 gp 4 sp",
// "$4.34", "1.234,56 €". A built-in system has no currency here (null), and says what it says today.

/**
 * Why an amount typed into a box can't be used, or null when it can (or the box is empty, which
 * has nothing to say). With `positive`, zero and below are refused too: a withdrawal, a loan or a
 * payment is always of something.
 */
export const amountProblem = (currency: Currency, parsed: ParsedAmount, { positive = false } = {}): string | null => {
  if (parsed.ok) return positive && parsed.amount <= 0 ? 'Write an amount above zero.' : null;
  const coins = currency.denominations.map((d) => d.short || d.name);
  switch (parsed.reason) {
    case 'empty': return null;
    case 'which_coin': return `Which coin? Write it like "15 ${coins[0]}" (${coins.join(', ')}).`;
    case 'unknown_coin': return `${currency.name} has no coin by that name. Its coins: ${coins.join(', ')}.`;
    case 'too_precise': return currency.decimals
      ? `${currency.name} has only ${currency.decimals} decimal place${currency.decimals === 1 ? '' : 's'}.`
      : `${currency.name} has no decimal places.`;
    default: return `That isn't an amount of ${currency.name}.`;
  }
};

/**
 * An amount to show as the way to write this currency, under an empty box: "2 gp 5 sp" with
 * coins, "$4.34" or "4,34 €" with decimals, "¥4" or "4 Favor" without.
 */
export const amountExample = (currency: Currency): string => {
  const coins = currency.denominations;
  if (coins.length > 1) return formatAmount(currency, 2 * coins[0].value + 5 * coins[1].value);
  if (coins.length === 1) return formatAmount(currency, 15 * coins[0].value);
  return formatAmount(currency, Math.round(4.34 * 10 ** currency.decimals));
};

/** What the bank did, as the server names it (bankRefused: backend/bank/moneyRules.js). */
export type BankAction = 'withdraw' | 'borrow' | 'pay' | 'set';
export type BankReason = 'amount' | 'funds' | 'no_debt' | 'no_negative' | 'nothing';

/**
 * Why the bank did nothing, for a bankRefused message. `currency` is the one it was refused in, or
 * null under a built-in system, whose money is `moneyWord` ("credits", or the system's own word).
 * `account` is that currency's balance and debt as the window last heard them.
 */
export const bankRefusal = (
  currency: Currency | null, action: BankAction, reason: BankReason | string,
  account: { balance: number; debt: number }, moneyWord = 'credits',
): string => {
  const name = currency ? currency.name : moneyWord;
  switch (reason) {
    case 'amount': return 'Write an amount above zero.';
    case 'funds': return `Not enough ${name}.${currency ? ` You have ${formatAmount(currency, account.balance)}.` : ''}`;
    case 'no_debt': return action === 'set' ? `Nobody can owe ${name} in this game.` : `${name} can't be borrowed in this game.`;
    case 'no_negative': return `${name} can't go below zero in this game.`;
    case 'nothing': return account.debt > 0 ? `You have no ${name} to pay with.` : `You owe no ${name}.`;
    default: return 'The bank did nothing.';
  }
};

/** One currency's part of a cart (components/shopCart.ts cartTotalsIn). */
export interface CartCurrencyTotal {
  currency: Currency;
  net: number;
  balance: number;
  /** How much more than the balance the cart comes to; 0 when it is covered. */
  short: number;
}

/** The question the cart asks about one currency it is short in. */
export const shortQuestion = ({ currency, net, balance, short }: CartCurrencyTotal): string =>
  `The ${currency.name} total comes to ${formatAmount(currency, net)} and you have ${formatAmount(currency, balance)}. `
  + `How do you want to cover the ${formatAmount(currency, short)} short?`;

/**
 * Why a checkout in currencies was refused, for the reasons that name one (backend/shops/checkout.js
 * planCheckoutInCurrencies); null for the rest, which say what they always have (data/shopRules.ts
 * refusalText).
 */
export const cartRefusal = (reason: string, total: CartCurrencyTotal): string | null => {
  const { currency, net, balance } = total;
  const name = currency.name;
  if (reason === 'funds') {
    return `Not enough ${name}: it comes to ${formatAmount(currency, net)} and you have ${formatAmount(currency, balance)}. `
      + `${name} can't be owed or go below zero in this game. Nothing was charged.`;
  }
  if (reason === 'total_changed') {
    return `Prices changed while this sat in the cart: the ${name} total is now ${formatAmount(currency, net)}. Check it, then CHECK OUT again.`;
  }
  return null;
};

/**
 * A GM's edit to one account in BANK_ADMIN.EXE (3c2b5), read as the server will hold it
 * (backend/bank/moneyRules.js setAccount): a balance below zero only where the currency allows it,
 * debt never below zero and only where it can be owed. `debtText` is null where the window shows no
 * debt box, which is none owed.
 */
export const readAccountEdit = (
  currency: Currency, balanceText: string, debtText: string | null,
): { ok: true; balance: number; debt: number } | { ok: false; problem: string } => {
  /** An amount, or what is wrong with the text. */
  const read = (text: string): number | string => {
    if (!text.trim()) return `Write an amount of ${currency.name}.`;
    const parsed = parseAmount(currency, text);
    return parsed.ok ? parsed.amount : amountProblem(currency, parsed) ?? `That isn't an amount of ${currency.name}.`;
  };
  const balance = read(balanceText);
  if (typeof balance === 'string') return { ok: false, problem: balance };
  const debt = debtText === null ? 0 : read(debtText);
  if (typeof debt === 'string') return { ok: false, problem: debt };
  if (balance < 0 && !currency.negative) return { ok: false, problem: `${currency.name} can't go below zero in this game.` };
  if (debt < 0) return { ok: false, problem: 'Debt is never below zero.' };
  if (debt > 0 && !currency.debt) return { ok: false, problem: `Nobody can owe ${currency.name} in this game.` };
  return { ok: true, balance, debt };
};

/**
 * What each player gets from PAYROLL.EXE in a custom currency (3c2b5): the total split, rounded up
 * to a whole smallest unit so nobody is short, as the server pays it (adminPayPlayers).
 */
export const payShare = (currency: Currency, total: number, count: number): string => {
  const each = Math.ceil(total / count);
  return `${count} ${count === 1 ? 'player' : 'players'}: ${formatAmount(currency, each)} each`
    + `${each * count !== total ? ', rounded up so nobody is short' : ''}.`;
};

/**
 * What a currency allows when a player is short of it, for the house rules' note where the
 * overdraft rule is hidden (3c2b5): each currency decides for itself, set in the system.
 */
export const shortfallRule = (currency: Currency): string => {
  if (currency.debt && currency.negative) return 'can be owed or go below zero';
  if (currency.debt) return 'can be owed';
  if (currency.negative) return 'can go below zero';
  return 'refused';
};

/** Whale status's threshold in every built-in system, as it has always been. */
export const BUILT_IN_WHALE = 10000;

/**
 * Whether the bank window celebrates (first payday, overdraft, debt cleared), and the balance that
 * makes a whale, or null for none. Every built-in system as today. A custom system only as its own
 * bank section says (backend/systemBuilder/bank.js): off unless its GM turned them on, and whale
 * status only with a threshold of the GM's own (decided with the user, 2026-10-02). A custom system
 * not loaded yet celebrates nothing rather than guessing. They watch the main currency, the
 * balance a bank update has always carried.
 */
export const celebrationsFor = (system: string | null | undefined): { on: boolean; whale: number | null } => {
  if (!isCustomSystem(system)) return { on: true, whale: BUILT_IN_WHALE };
  const bank = customTemplate(system)?.bank;
  const on = bank?.celebrations === true;
  const whale = on && Number.isSafeInteger(bank?.whale) && (bank?.whale as number) >= 1 ? bank?.whale as number : null;
  return { on, whale };
};
