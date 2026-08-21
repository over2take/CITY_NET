// Every request this app makes to a host it does not own goes through here.
//
// There are only two such callers — the Docker Hub version check and the Cyberpunk RED
// Companion import — and before this module they had independently grown two different
// sets of holes. That is the argument for one door rather than two: the constraints below
// are easy to get right once and easy to forget twice, and the next outbound feature
// inherits them instead of re-deriving them.
//
// What a caller cannot opt out of:
//
//   - **A named destination.** `allowHosts` is required. A URL whose hostname is not on
//     the caller's own list is refused before a socket opens, which is what stops a
//     response body talking us into a request somewhere else.
//   - **HTTPS.** These are third parties on the open internet.
//   - **A deadline covering the whole exchange**, not just the connection. The failure we
//     actually hit is a host that accepts the connection and then says nothing, and a
//     timeout that stops at the headers does not cover it.
//   - **A byte cap.** A response with no end to it should fail, not grow until the process
//     does.
//
// `fetchImpl` is injected so all of that is testable without a network. Nothing here
// should ever contact a real service from a test.

/** Generous for a JSON API, small enough that a hostile body fails rather than lands. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Long enough for a slow registry, short enough that a person is still waiting. */
const TIMEOUT_MS = 8000;

/**
 * Why a request produced no document.
 *
 * Deliberately coarse. The distinctions that survive are the ones a caller acts on
 * differently — "your input is wrong" (`NOT_FOUND`) against "their service failed us"
 * (everything else) — because that is the difference an eventual reader can do something
 * about. Anything finer would be detail we invent rather than detail we know.
 */
const REASONS = {
  BAD_URL: 'BAD_URL',
  BLOCKED_HOST: 'BLOCKED_HOST',
  NOT_FOUND: 'NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  UNREACHABLE: 'UNREACHABLE',
  SERVICE_ERROR: 'SERVICE_ERROR',
  TOO_LARGE: 'TOO_LARGE',
  BAD_RESPONSE: 'BAD_RESPONSE',
};

/**
 * Whether a URL is one the caller said it was willing to reach.
 *
 * An exact hostname match, never a suffix test: `endsWith('docker.com')` is also true of
 * `evil-docker.com`, and that class of check is how allowlists usually fail.
 */
function checkUrl(url, allowHosts) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return REASONS.BAD_URL;
  }
  if (parsed.protocol !== 'https:') return REASONS.BAD_URL;
  if (!allowHosts.includes(parsed.hostname)) return REASONS.BLOCKED_HOST;
  return null;
}

/**
 * Read a body with a ceiling on it.
 *
 * Streams where the response supports it, so an oversized body is abandoned partway
 * rather than fully received and then measured. A response object without a stream — a
 * test stub, in practice, since a real one always has one — is still checked, just after
 * the fact.
 */
async function readCapped(res, maxBytes, controller) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    return Buffer.byteLength(text) > maxBytes ? { error: REASONS.TOO_LARGE } : { text };
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Stop it at the source. Cancelling the reader alone leaves the request running.
      controller.abort();
      return { error: REASONS.TOO_LARGE };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

/**
 * One GET, JSON out, under every constraint above.
 *
 * Resolves to `{ doc }` or `{ error }` — never both, and never a partial document, since
 * half of a parsed response is worse to act on than none of it. Throwing is left to
 * callers that want it, because the two we have want opposite things.
 */
async function getJson(url, { allowHosts, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  if (!Array.isArray(allowHosts) || allowHosts.length === 0) {
    throw new Error('outbound.getJson requires allowHosts');
  }
  // Not a network failure — a bug or an attempted redirect. Checked before anything opens.
  const blocked = checkUrl(url, allowHosts);
  if (blocked) return { error: blocked };

  if (typeof fetchImpl !== 'function') return { error: REASONS.UNREACHABLE };

  const controller = new AbortController();
  // Armed across the body read as well as the request, and cleared only once the whole
  // exchange is done. A deadline that stops at the headers does not cover the case we
  // are actually defending against.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      // Their payload does not get to choose our next hop. `fetch` follows redirects by
      // default, and following one leaves the allowlist behind entirely.
      redirect: 'manual',
    });

    if (res.status === 404) return { error: REASONS.NOT_FOUND };
    if (!res.ok) return { error: REASONS.SERVICE_ERROR };

    const body = await readCapped(res, maxBytes, controller);
    if (body.error) return { error: body.error };

    try {
      return { doc: JSON.parse(body.text) };
    } catch {
      return { error: REASONS.BAD_RESPONSE };
    }
  } catch (e) {
    // An abort and a refused connection are the same thing to whoever is waiting: it did
    // not answer. Only the reason differs, and only the reason is reported.
    return { error: e?.name === 'AbortError' ? REASONS.TIMEOUT : REASONS.UNREACHABLE };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getJson, REASONS, MAX_BYTES, TIMEOUT_MS, checkUrl };
