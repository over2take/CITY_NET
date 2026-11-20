// One pool of hit points changed by an amount: damage takes TEMP first and never goes below 0, healing never past MAX,
// and CURRENT is never over MAX. What the HEALTH route (routes/locations.js) and a condition's EACH TURN (8a9a,
// tokens/turnEffects.js) both do to a token. Pure.

/** `{ current, max, temp }` after `action` ('damage' or 'heal') of `amount`; anything else, or no amount, changes nothing but the clamp. */
const poolAfter = ({ current, max, temp }, action, amount) => {
  let cur = current === null || current === undefined ? 0 : current;
  const mx = max === null || max === undefined ? 0 : max;
  let tmp = temp === null || temp === undefined ? 0 : temp;
  if (mx > 0 && cur > mx) cur = mx;
  if (action === 'damage' && amount > 0) {
    let left = amount;
    if (tmp > 0) {
      if (tmp >= left) { tmp -= left; left = 0; } else { left -= tmp; tmp = 0; }
    }
    if (left > 0) cur = Math.max(0, cur - left);
  } else if (action === 'heal' && amount > 0) {
    cur = Math.min(mx, cur + amount);
  }
  return { current: cur, max: mx, temp: tmp };
};

module.exports = { poolAfter };
