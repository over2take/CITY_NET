// TRY IT's rests (4f6a; approved mockup docs/mockups/builder-rests.html, 2026-10-09): one of a
// draft's rests on a made-up character, through the same rules the game runs (resting.js), so a GM
// can see what a rest does before publishing. The RESTS page's ON THE SAMPLE box previews it on the
// sample character (dice not rolled); TRY IT's CALL A REST rolls it, as the GAME tab would. Pure:
// nothing is read or written, and the draft needn't be published.

const crypto = require('crypto');
const { compileSystem } = require('./derived');
const { restOn, restLine } = require('./resting');
const { restsOf } = require('./rests');
const { conditionsOf } = require('./conditions');

const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The draft's formulas worked out on a sheet, as a published system's are on every save. A draft
 * whose formulas don't compile yet leaves the sheet as typed: TRY IT still runs.
 */
const workedOut = (definition, sheet) => {
  const data = { ...sheet };
  const compiled = compileSystem({ lookups: definition.lookups, derived: definition.derived ?? [] });
  if (compiled.ok) compiled.system.apply(data);
  return data;
};

/**
 * One rest tried. `sheet` is the made-up character's values, `token` its pretend token
 * ({ current, max, temp }; none for a character without one), `conditions` the ones on it
 * ([{ id, left? }]). With `roll` the dice are rolled (`rng`, the operating system's random source by
 * default); without, they wait, as the GAME tab's preview shows them.
 *
 * Answers { ok: true, rest, sheet, token, conditions, changes, gone, rolls, line } with the character
 * as it stands after the rest (formulas worked out again) and the dice-log line the game would write,
 * or { ok: false, error }.
 */
const tryRest = (definition, { rest: restId, sheet, token, conditions, roll = false } = {}, rng = cryptoRng) => {
  const rest = restsOf(definition).find((r) => r.id === restId);
  if (!rest) return { ok: false, error: 'Not one of this system\'s rests' };
  const before = workedOut(definition, isPlainObject(sheet) ? sheet : {});
  const t = isPlainObject(token) ? { current: num(token.current), max: num(token.max), temp: Math.max(0, num(token.temp)) } : null;
  const result = restOn({
    definition, restId, sheet: before, token: t, conditions: Array.isArray(conditions) ? conditions : [], rng: roll ? rng : null,
  });
  if (!result.ok) return result;
  const names = new Map(conditionsOf(definition).map((c) => [c.id, c.name]));
  return {
    ok: true,
    rest: { id: rest.id, name: rest.name },
    sheet: workedOut(definition, { ...before, ...result.sheetPatch }),
    token: result.token,
    conditions: result.conditions,
    changes: result.changes,
    gone: result.gone.map((id) => names.get(id) || id),
    rolls: result.rolls,
    line: restLine(definition, rest.name, 'Sample', result),
  };
};

module.exports = { tryRest };
