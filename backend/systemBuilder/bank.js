// A system's bank settings (3c2b1): whether the bank window's celebrations run.
//
//   bank: { celebrations: true, whale: 50000 }
//
// The celebrations are the bank's easter eggs: first payday, overdraft, debt cleared and whale
// status. Every built-in system keeps them as they are today. A custom system has them only if
// its GM turns them on (decided with the user, 2026-10-02). Turned on, they watch the main
// currency: the first in `currencies`, or the app's own money for a system that defines none.
//
// Whale status needs a threshold of the GM's own as well, because the built-ins' 10,000 means
// nothing in another system's money: 100 gp counted in copper, or ¥10,000. `whale` is a whole
// amount of the main currency's smallest unit (50000 is 500 gp counted in copper), as every
// amount is (currencies.js). Without one, whale status never fires.
//
// Pure: the definition checks and the render copy the browser reads both use it.

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const BANK_KEYS = new Set(['celebrations', 'whale']);

/** Problems with a definition's `bank` section, pushed onto `problems`. */
const checkBank = (bank, problems) => {
  if (bank === undefined) return;
  if (!isPlainObject(bank)) { problems.push({ where: 'bank', message: 'Must be the bank\'s settings' }); return; }
  for (const key of Object.keys(bank)) if (!BANK_KEYS.has(key)) problems.push({ where: `bank, ${key}`, message: 'Not a bank setting' });
  if (bank.celebrations !== undefined && typeof bank.celebrations !== 'boolean') {
    problems.push({ where: 'bank, celebrations', message: 'Must be true or false' });
  }
  if (bank.whale !== undefined) {
    if (!Number.isSafeInteger(bank.whale) || bank.whale < 1) {
      problems.push({ where: 'bank, whale', message: 'Must be a whole amount of the main currency\'s smallest unit, 1 or more' });
    } else if (bank.celebrations !== true) {
      problems.push({ where: 'bank, whale', message: 'Only with celebrations on' });
    }
  }
};

/**
 * A checked definition's bank settings, as the browser uses them: celebrations off unless on,
 * and a whale threshold only while they are on.
 */
const bankOf = (definition) => {
  const bank = definition && isPlainObject(definition.bank) ? definition.bank : {};
  const celebrations = bank.celebrations === true;
  return { celebrations, whale: celebrations && Number.isSafeInteger(bank.whale) && bank.whale >= 1 ? bank.whale : null };
};

module.exports = { checkBank, bankOf };
