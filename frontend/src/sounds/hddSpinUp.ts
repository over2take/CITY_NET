// An old hard drive spinning up, built in code like the bank's sounds - no file to ship.
//
// Three parts: the spindle motor, a whine that climbs as the platters come up to speed; the
// air, a band of hiss rising with it; and the heads, dry seek clicks at random while the
// boot text types. It then settles to a steady hum and fades, which is where the app's own
// ambient hum loop takes over.
//
// Browsers keep audio suspended until the page has been clicked or typed in. The boot does
// not wait for either, so where the browser says no this plays nothing - a drive spinning up
// after the boot is over would make no sense.

export interface HddSound {
  /** Fade out now - the boot was skipped. */
  stop: () => void;
}

export function playHddSpinUp(vol = 1, seconds = 4.4): HddSound | null {
  let ctx: AudioContext;
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return null;
  }
  // Suspended means the browser wants a click first; try once, and stay quiet if refused.
  void ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const end = now + seconds;
  const spun = now + Math.min(2.4, seconds * 0.55);

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(vol, now + 0.25);
  master.gain.setValueAtTime(vol, end - 0.9);
  master.gain.exponentialRampToValueAtTime(0.0001, end);
  master.connect(ctx.destination);

  // Spindle motor: a climbing whine with a softer octave under it.
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.setValueAtTime(40, now);
  motor.frequency.exponentialRampToValueAtTime(360, spun);
  motor.frequency.setValueAtTime(360, end);
  const motorTone = ctx.createBiquadFilter();
  motorTone.type = 'lowpass';
  motorTone.frequency.setValueAtTime(300, now);
  motorTone.frequency.exponentialRampToValueAtTime(1400, spun);
  const motorGain = ctx.createGain();
  motorGain.gain.setValueAtTime(0.0001, now);
  motorGain.gain.exponentialRampToValueAtTime(0.05, spun);
  motorGain.gain.exponentialRampToValueAtTime(0.022, spun + 0.6); // settles once up to speed
  motor.connect(motorTone).connect(motorGain).connect(master);

  const hum = ctx.createOscillator();
  hum.type = 'sine';
  hum.frequency.setValueAtTime(20, now);
  hum.frequency.exponentialRampToValueAtTime(120, spun);
  const humGain = ctx.createGain();
  humGain.gain.setValueAtTime(0.0001, now);
  humGain.gain.exponentialRampToValueAtTime(0.12, spun);
  humGain.gain.exponentialRampToValueAtTime(0.07, spun + 0.6);
  hum.connect(humGain).connect(master);

  // Air moving over the platters: band-passed noise that rises with the speed.
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const air = ctx.createBufferSource();
  air.buffer = noiseBuf;
  air.loop = true;
  const airBand = ctx.createBiquadFilter();
  airBand.type = 'bandpass';
  airBand.Q.value = 0.8;
  airBand.frequency.setValueAtTime(400, now);
  airBand.frequency.exponentialRampToValueAtTime(2200, spun);
  const airGain = ctx.createGain();
  airGain.gain.setValueAtTime(0.0001, now);
  airGain.gain.exponentialRampToValueAtTime(0.035, spun);
  air.connect(airBand).connect(airGain).connect(master);

  // The heads seeking: short dry clicks, in little bursts, once the drive is up.
  const clickBand = ctx.createBiquadFilter();
  clickBand.type = 'highpass';
  clickBand.frequency.value = 1800;
  clickBand.connect(master);
  let t = now + seconds * 0.35;
  while (t < end - 0.8) {
    const burst = 1 + Math.floor(Math.random() * 4);
    for (let b = 0; b < burst && t < end - 0.8; b += 1) {
      const click = ctx.createBufferSource();
      click.buffer = noiseBuf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18 + Math.random() * 0.12, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      click.connect(g).connect(clickBand);
      click.start(t, Math.random(), 0.02);
      t += 0.03 + Math.random() * 0.05;
    }
    t += 0.12 + Math.random() * 0.35;
  }

  [motor, hum, air].forEach((s) => { s.start(now); s.stop(end + 0.05); });
  const close = setTimeout(() => { void ctx.close().catch(() => {}); }, (seconds + 0.3) * 1000);

  return {
    stop: () => {
      const at = ctx.currentTime;
      master.gain.cancelScheduledValues(at);
      master.gain.setValueAtTime(master.gain.value || 0.0001, at);
      master.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      clearTimeout(close);
      setTimeout(() => { void ctx.close().catch(() => {}); }, 400);
    },
  };
}
