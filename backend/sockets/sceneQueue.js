/**
 * One scene's initiative changes, one after another (found by 8i2's journey on CI). Each roll, NEXT, removal or reorder
 * reads the scene's order and writes it back whole, so two at once lost one, and ROLL ENEMIES with a crowd lost rolls.
 *
 * `inTurn(key, work)` runs `work(done)` once the work queued before it for the same key has called `done`. Different keys
 * never wait on each other. Should a piece of work throw, or never call `done`, the next goes after `timeoutMs` anyway, so
 * one mistake can't freeze a fight.
 */
const sceneQueue = ({ timeoutMs = 5000, onError = (e) => console.error('[initiative]', e.message) } = {}) => {
  const queues = new Map();
  const inTurn = (key, work) => {
    const before = queues.get(key) || Promise.resolve();
    const mine = before.then(() => new Promise((resolve) => {
      // Said twice, nothing more: a promise settles once.
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      try { work(done); } catch (e) { onError(e); done(); }
    }));
    queues.set(key, mine);
    // Forgotten once the last in line is done, so a long night's scenes don't pile up.
    mine.then(() => { if (queues.get(key) === mine) queues.delete(key); });
  };
  return { inTurn, waiting: () => queues.size };
};

module.exports = { sceneQueue };
