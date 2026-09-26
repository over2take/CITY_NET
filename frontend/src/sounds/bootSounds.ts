// The boot screen's sounds, built in code like the bank's: the PC speaker's POST beep, and
// the hard drive's heads clicking as it reads while each line of the self test appears.
//
// Browsers keep audio suspended until the page has been clicked or typed in, and the boot
// waits for neither. Nothing is queued while suspended - a suspended context's clock does not
// move, so anything scheduled would all go off at once on the first click. So each sound only
// plays while the context is running, and `wake()` (a click during the boot) beeps and lets
// the clicks follow from then.

export interface BootSounds {
  /** The page was clicked: sound is allowed now. Beeps, as the machine "powers on". */
  wake: () => void;
  /** The PC speaker's single POST beep - only ever once. */
  beep: () => void;
  /** The heads seeking, a short burst of clicks, for one line of text. */
  seek: () => void;
  close: () => void;
}

export function createBootSounds(vol = 1): BootSounds | null {
  let ctx: AudioContext;
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return null;
  }
  void ctx.resume().catch(() => {});
  const running = () => ctx.state === 'running';

  const master = ctx.createGain();
  master.gain.value = vol;
  master.connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  let beeped = false;
  const beep = () => {
    if (!running() || beeped) return;
    beeped = true;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.005);
    g.gain.setValueAtTime(0.12, t + 0.17);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  };

  /** One head movement: a dry tick with a little thud of the arm behind it. */
  const click = (t: number) => {
    const tick = ctx.createBufferSource();
    tick.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(0.25 + Math.random() * 0.15, t + 0.001);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.01);
    tick.connect(hp).connect(tg).connect(master);
    tick.start(t, Math.random() * 0.4, 0.015);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(180, t);
    thud.frequency.exponentialRampToValueAtTime(70, t + 0.03);
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.0001, t);
    dg.gain.exponentialRampToValueAtTime(0.08, t + 0.002);
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    thud.connect(dg).connect(master);
    thud.start(t);
    thud.stop(t + 0.04);
  };

  const seek = () => {
    if (!running()) return;
    let t = ctx.currentTime + 0.01;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i += 1) {
      click(t);
      t += 0.025 + Math.random() * 0.05;
    }
  };

  return {
    // The beep once, whichever comes first: the boot's first line with sound allowed, or
    // the click that allows it.
    wake: () => { void ctx.resume().then(beep).catch(() => {}); },
    beep,
    seek,
    close: () => { setTimeout(() => { void ctx.close().catch(() => {}); }, 300); },
  };
}
