const { isMainAdmin } = require('../middleware/auth');

// A person's own settings (6c4b3a), kept on their account so they follow them to any computer:
// a player's on their player account, the GM's on theirs. Only the settings named here, each with
// the choices it may take and the one it starts on; nothing anybody writes becomes a setting.
// The first is the dice tray's: ROLL, every throw played (6c4b2b), or LANDED, the dice shown as
// they came to rest. Then the tray's bell (6c4g): whether someone else's roll, made while the tray
// is shut, makes its buttons flash.

const SETTINGS = {
  trayMotion: { choices: ['roll', 'landed'], start: 'roll' },
  trayNotify: { choices: ['on', 'off'], start: 'on' },
};

/**
 * Whose settings a signed-in caller's token is: the GM's own login, or a player (their own login,
 * or the editing token the GM granted them, which is still them). Null for anything else, such as a
 * password-reset token.
 */
const accountOf = (user) => {
  if (!user || typeof user.username !== 'string' || !user.username) return null;
  if (isMainAdmin(user)) return { kind: 'gm', username: user.username };
  if (user.role === 'player' || user.isTemporary) return { kind: 'player', username: user.username };
  return null;
};

/** Every setting, as the account has it or as it starts. */
const settingsOf = (db, account) => new Promise((resolve, reject) => {
  db.all('SELECT key, value FROM account_settings WHERE kind = ? AND username = ?', [account.kind, account.username], (err, rows) => {
    if (err) return reject(err);
    const saved = new Map((rows || []).map((r) => [r.key, r.value]));
    resolve(Object.fromEntries(Object.entries(SETTINGS).map(([key, s]) => [key, s.choices.includes(saved.get(key)) ? saved.get(key) : s.start])));
  });
});

/** What is wrong with `changes` as settings, or null: only known settings, each one of its choices. */
const problemWith = (changes) => {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) return 'Send the settings to change, as { name: choice }';
  for (const [key, value] of Object.entries(changes)) {
    const s = Object.prototype.hasOwnProperty.call(SETTINGS, key) ? SETTINGS[key] : null;
    if (!s) return `No setting called ${key}`;
    if (!s.choices.includes(value)) return `${key} is one of ${s.choices.join(', ')}`;
  }
  return null;
};

/** Save `changes` (already checked) to the account, all of them or none. */
const saveSettings = (db, account, changes) => new Promise((resolve, reject) => {
  db.serialize(() => {
    db.run('BEGIN');
    for (const [key, value] of Object.entries(changes)) {
      db.run(`INSERT INTO account_settings (kind, username, key, value) VALUES (?, ?, ?, ?)
        ON CONFLICT(kind, username, key) DO UPDATE SET value = excluded.value`, [account.kind, account.username, key, value]);
    }
    db.run('COMMIT', (err) => (err ? reject(err) : resolve()));
  });
});

module.exports = { SETTINGS, accountOf, settingsOf, problemWith, saveSettings };
