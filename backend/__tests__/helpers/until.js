/**
 * Wait for a condition instead of guessing how long it takes.
 *
 * The socket handlers here fire and return; the database work behind them finishes later.
 * Tests were sleeping a fixed number of milliseconds and then asserting - `flush(60)` and
 * its cousins - which is a bet that 60ms is enough. On an idle machine it is. Under load
 * it is not, and the assertion then runs against state that has not arrived yet, so the
 * suite fails somewhere unrelated to whatever was actually being changed.
 *
 * Polling for the answer is both faster in the ordinary case (it returns as soon as the
 * work lands, rather than always paying the full sleep) and correct in the slow one.
 *
 * `label` is what the failure says when the deadline passes, so a timeout names the thing
 * that never happened rather than pointing at a line number.
 */
const until = async (predicate, { timeout = 5000, interval = 5, label = 'condition' } = {}) => {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (err) {
      // A predicate that reads a row before it exists can throw rather than return false.
      // That is still "not yet", until the deadline says otherwise.
      last = err;
    }
    if (Date.now() >= deadline) {
      const detail = last instanceof Error ? ` (last error: ${last.message})` : '';
      throw new Error(`until: ${label} did not come true within ${timeout}ms${detail}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
};

/**
 * Wait for a value to satisfy a test, and return it.
 *
 * The common shape: read something out of the database, check a field, assert on the rest.
 * Separated from `until` only because returning the value is what the caller then wants.
 */
const untilValue = async (read, check, opts = {}) =>
  until(async () => {
    const value = await read();
    return check(value) ? value : null;
  }, opts);

/**
 * Wait for the work a socket handler queued, without guessing how long it takes.
 *
 * The handlers fire and return; their database work finishes later. Tests were sleeping a
 * fixed number of milliseconds and asserting - a bet that the machine is idle, which the
 * suite lost whenever anything else was running.
 *
 * This waits for the actual thing instead. sqlite serializes statements on a connection,
 * so a query queued after the handler's queries resolves after them. One round drains one
 * layer; a handler whose callback queues more work needs another, so several rounds run in
 * sequence and each one is a real barrier rather than a delay.
 *
 * Eight is chosen to cover the deepest nesting in these handlers - read settings, read the
 * sheet, read the token, write, re-read - with room to spare. Extra rounds on an already
 * quiet database cost microseconds, so the ceiling is generous on purpose.
 *
 * This does NOT wait for work scheduled off the database - a setTimeout inside a handler,
 * say. Nothing here does that, and `until` is the tool where something does.
 */
const drain = (db, rounds = 8) => new Promise((resolve, reject) => {
  let left = rounds;
  const round = () => {
    if (left-- <= 0) return resolve();
    db.get('SELECT 1', (err) => (err ? reject(err) : round()));
  };
  round();
});

module.exports = { until, untilValue, drain };
