// A ceiling on how often one caller may make us do something expensive.
//
// Written for the Companion import, which is the one route that is open to anyone *and*
// spends our outbound requests on their behalf. Two things follow from that pairing:
// somebody can point our address at a third party as fast as they can send requests, and
// a six-character code is a small enough keyspace that a script could walk it and read
// back whichever characters answer.
//
// Authentication would close both, and is the wrong tool here: an open install has no
// player tokens at all, so requiring one removes the feature from the people it is for.
// A limit costs a genuine user nothing — importing your own character is something you do
// once — and costs a script the whole attack.
//
// In-memory and per-process, like `elevatedUsers`. A restart forgets every counter, which
// is the right trade for something whose window is minutes.

/** Requests are counted against whoever sent them, as far as we can tell who that is. */
const clientKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * How many distinct callers to remember at once.
 *
 * The map is keyed by address, so without a bound it is a slow memory leak that anyone
 * can drive by varying their source. Past this, expired entries are swept and, if that
 * is not enough, the least recently seen are dropped — which forgives someone rather
 * than blocking them, the safer direction to fail.
 */
const MAX_KEYS = 10000;

/**
 * Express middleware allowing `limit` requests per `windowMs`, per caller.
 *
 * A sliding window rather than a fixed one: a fixed window lets someone spend the whole
 * allowance at the end of one and again at the start of the next, which is twice the
 * limit back to back at exactly the moment it matters.
 *
 * `now` is injectable so the tests can move time instead of waiting for it.
 */
function rateLimit({ limit, windowMs, now = Date.now, keyOf = clientKey, maxKeys = MAX_KEYS } = {}) {
  if (!limit || !windowMs) throw new Error('rateLimit requires limit and windowMs');

  /** caller -> timestamps of their requests inside the window */
  const hits = new Map();

  const sweep = (cutoff) => {
    for (const [key, times] of hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length) hits.set(key, live);
      else hits.delete(key);
    }
    // Still too many distinct callers to hold, all of them active. Drop the ones seen
    // longest ago; Map iterates in insertion order, and every live key was re-inserted
    // above, so this is oldest-first.
    if (hits.size > maxKeys) {
      const excess = hits.size - maxKeys;
      let dropped = 0;
      for (const key of hits.keys()) {
        hits.delete(key);
        if (++dropped >= excess) break;
      }
    }
  };

  const middleware = (req, res, next) => {
    const at = now();
    const cutoff = at - windowMs;
    const key = keyOf(req);

    if (hits.size > maxKeys) sweep(cutoff);

    const times = (hits.get(key) || []).filter((t) => t > cutoff);

    if (times.length >= limit) {
      // Told, not silently dropped. Someone hitting this by accident deserves to know
      // when to try again, and someone hitting it deliberately learns nothing useful.
      const retryAfter = Math.max(1, Math.ceil((times[0] + windowMs - at) / 1000));
      hits.set(key, times);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Wait a moment and try again.',
        retryAfter,
      });
    }

    times.push(at);
    hits.set(key, times);
    next();
  };

  /** For tests, and for anything that needs to forget a caller deliberately. */
  middleware.reset = () => hits.clear();
  middleware.size = () => hits.size;
  return middleware;
}

module.exports = { rateLimit, clientKey, MAX_KEYS };
