// Uniform float in [0, 1) backed by 32 bits of OS entropy.
// Drop-in replacement for Math.random() in dice-roll contexts.
export const cryptoRng = (): number => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
};
