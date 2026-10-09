// TRY IT's health (4c1; approved mockup docs/mockups/builder-try-it.html, 2026-10-08): a made-up
// character's health under a draft's model, on a pretend token, through the same rules the game
// runs (health.js) and drawn as the HEALTH folder draws it (healthView.js), for the one who changes
// it and for everyone else. Pure: nothing is read or written, and the draft needn't be published.

const { applyHealthAction } = require('./health');
const { healthView } = require('./healthView');
const { partOn } = require('./parts');
const { ownWords } = require('./terms');

/**
 * A draft's health model as the game would run it: none with token health off (3b6d), its own
 * model from SETUP, or one pool when it never answered.
 */
const healthOfDraft = (definition) => {
  if (!partOn(definition, 'token_health')) return { model: 'none' };
  const core = definition && definition.core && typeof definition.core === 'object' ? definition.core : null;
  return core && core.health && typeof core.health === 'object' ? core.health : { model: 'pool' };
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Health tried: `action` (as the HEALTH folder sends it) applied to `token` ({ current, max, temp })
 * and `sheet`, or nothing applied when there is no action. Answers the token and sheet after it,
 * the action's own report (or its refusal), and both views.
 */
const tryHealth = (definition, { token, sheet, action } = {}) => {
  const health = healthOfDraft(definition);
  const hpWord = (ownWords(definition).hp || {}).short || 'HP';
  let t = { current: num(token && token.current), max: num(token && token.max), temp: Math.max(0, num(token && token.temp)) };
  let s = sheet && typeof sheet === 'object' && !Array.isArray(sheet) ? { ...sheet } : {};
  let result = null;
  if (action) {
    result = applyHealthAction(health, t, s, action);
    if (result.ok) {
      t = result.token;
      s = { ...s, ...result.sheetPatch };
    }
  }
  return {
    model: health.model,
    token: t,
    sheet: s,
    result,
    full: healthView(health, t, s, { full: true, hpWord }),
    others: healthView(health, t, s, { full: false, hpWord }),
  };
};

module.exports = { tryHealth, healthOfDraft };
