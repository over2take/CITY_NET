// Fetching a Cyberpunk RED Companion character by its six-digit code.
//
// Kept apart from `companionImport.js` on purpose: that module is pure and holds the whole
// of the parsing risk, so it can be tested exhaustively without a network. This one does
// only the network, and takes its `fetch` as an argument so its failure modes — a timeout,
// a 404, a body that is not JSON — are testable too.
//
// **This is the app's first outbound call to a third party.** Two consequences shaped it:
//
//   - It runs server-side, never from the player's browser. That avoids CORS and keeps the
//     player's address out of a request they did not choose to make.
//   - The endpoint is a public Firestore path that a Foundry module found, not a published
//     API. It can change or close without warning, so every failure resolves to a short
//     reason the dialog can show rather than a hang or a stack trace.

const { flattenCompanion } = require('./companionImport');

const BASE = 'https://firestore.googleapis.com/v1/projects/cyberpunk-red-companion-dae35/databases/(default)/documents';

/** Codes are six characters. Checked before it goes anywhere near a URL. */
const CODE_PATTERN = /^[A-Z0-9]{6}$/;

const normaliseCode = (code) => String(code ?? '').trim().toUpperCase();

/** Whether a code is even worth a request. */
const isValidCode = (code) => CODE_PATTERN.test(normaliseCode(code));

/**
 * One GET, JSON out, with a deadline.
 *
 * Every outcome that is not a document becomes a reason string. The distinction that
 * matters to a player is "your code is wrong" versus "their service is down", and those
 * are the two they can act on differently.
 */
async function getJson(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (res.status === 404) return { error: 'NOT_FOUND' };
    if (!res.ok) return { error: 'SERVICE_ERROR' };
    try {
      return { doc: await res.json() };
    } catch (e) {
      return { error: 'BAD_RESPONSE' };
    }
  } catch (e) {
    // An abort and a refused connection are the same thing to a player: it did not answer.
    return { error: e?.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a code to a character, flattened into importer candidates.
 *
 * Two hops: the code names a character uuid, the uuid names the document. Returns
 * `{ candidates, version, missing }` on success, or `{ error }` with one of the reasons
 * above — never a partial result, since a half-read character is worse than none.
 */
async function fetchCharacter(code, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const clean = normaliseCode(code);
  if (!isValidCode(clean)) return { error: 'BAD_CODE' };
  if (typeof fetchImpl !== 'function') return { error: 'UNREACHABLE' };

  const lookup = await getJson(`${BASE}/code_to_character/${encodeURIComponent(clean)}`, { fetchImpl, timeoutMs });
  if (lookup.error) return { error: lookup.error };

  const uuid = String(lookup.doc?.fields?.character_uuid?.stringValue ?? '').trim();
  // A code that resolves to a document with no uuid in it is their format changing under
  // us, not a player mistyping — worth its own reason so it is not read as a bad code.
  if (!uuid) return { error: 'BAD_RESPONSE' };

  const character = await getJson(`${BASE}/character_export/${encodeURIComponent(uuid)}`, { fetchImpl, timeoutMs });
  if (character.error) return { error: character.error };

  const flat = flattenCompanion(character.doc);
  // A document that parses to nothing is not a character. Better to say the export could
  // not be read than to hand back an empty preview that looks like an empty character.
  if (!Object.keys(flat.candidates).length) return { error: 'EMPTY_EXPORT' };
  return flat;
}

/** What the dialog shows. Short, and about what the player can do next. */
const REASONS = {
  BAD_CODE: 'That is not a six-character code.',
  NOT_FOUND: 'No character for that code. Check it and try exporting again.',
  TIMEOUT: 'The character service did not answer in time.',
  UNREACHABLE: 'Could not reach the character service.',
  SERVICE_ERROR: 'The character service refused the request.',
  BAD_RESPONSE: 'The character service answered with something unexpected.',
  EMPTY_EXPORT: 'That export had nothing in it we could read.',
};

module.exports = { BASE, CODE_PATTERN, isValidCode, normaliseCode, fetchCharacter, REASONS };
