// Fully synthesized soundscape — no audio files. Wind, a deep water rumble,
// distant crowd murmur, a slow drone that swells as the sea parts, and thunder
// cracks triggered with the lightning. Built on the Web Audio API.
export function createAudio() {
  let ctx = null, master = null, started = false, enabled = true;
  const nodes = {};

  function noiseBuffer(seconds = 2) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;   // brownish
      d[i] = last * 3.0;
    }
    return buf;
  }

  function loopNoise() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(3);
    src.loop = true;
    src.start();
    return src;
  }

  function start() {
    if (started) return;
    started = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.0 : 0.0;
    master.connect(ctx.destination);
    // fade in
    master.gain.setValueAtTime(0.0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(enabled ? 0.9 : 0.0, ctx.currentTime + 3.0);

    // --- wind ---
    const wind = loopNoise();
    const windBP = ctx.createBiquadFilter();
    windBP.type = 'bandpass'; windBP.frequency.value = 600; windBP.Q.value = 0.7;
    const windGain = ctx.createGain(); windGain.gain.value = 0.12;
    wind.connect(windBP).connect(windGain).connect(master);
    const windLFO = ctx.createOscillator(); windLFO.frequency.value = 0.08;
    const windLFOg = ctx.createGain(); windLFOg.gain.value = 0.07;
    windLFO.connect(windLFOg).connect(windGain.gain); windLFO.start();
    nodes.windBP = windBP;

    // --- deep water rumble ---
    const rumble = loopNoise();
    const rumbleLP = ctx.createBiquadFilter();
    rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 90; rumbleLP.Q.value = 0.6;
    const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0.5;
    rumble.connect(rumbleLP).connect(rumbleGain).connect(master);
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 38;
    const subGain = ctx.createGain(); subGain.gain.value = 0.18;
    sub.connect(subGain).connect(master); sub.start();
    nodes.rumbleGain = rumbleGain; nodes.rumbleLP = rumbleLP;

    // --- crowd murmur (filtered noise, gently modulated) ---
    const crowd = loopNoise();
    const crowdBP = ctx.createBiquadFilter();
    crowdBP.type = 'bandpass'; crowdBP.frequency.value = 320; crowdBP.Q.value = 1.4;
    const crowdGain = ctx.createGain(); crowdGain.gain.value = 0.06;
    crowd.connect(crowdBP).connect(crowdGain).connect(master);
    const crLFO = ctx.createOscillator(); crLFO.frequency.value = 0.3;
    const crLFOg = ctx.createGain(); crLFOg.gain.value = 0.03;
    crLFO.connect(crLFOg).connect(crowdGain.gain); crLFO.start();

    // --- drone / choir-like swell for the parting ---
    const droneGain = ctx.createGain(); droneGain.gain.value = 0.0;
    droneGain.connect(master);
    [55, 82.4, 110, 164.8].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sawtooth' : 'sine';
      o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = i < 2 ? 0.06 : 0.10;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      o.connect(og).connect(lp).connect(droneGain); o.start();
      // slow detune shimmer
      const det = ctx.createOscillator(); det.frequency.value = 0.07 + i * 0.013;
      const detg = ctx.createGain(); detg.gain.value = 2.5;
      det.connect(detg).connect(o.detune); det.start();
    });
    nodes.droneGain = droneGain;
  }

  function thunder(intensity = 1) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * intensity, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(lp).connect(g).connect(master);
    src.start(t); src.stop(t + 2);
  }

  function setParting(v) { // 0..1 swell the drone
    if (!nodes.droneGain) return;
    nodes.droneGain.gain.setTargetAtTime(0.28 * v, ctx.currentTime, 0.8);
    if (nodes.rumbleLP) nodes.rumbleLP.frequency.setTargetAtTime(90 + 120 * v, ctx.currentTime, 1.0);
  }
  function setWind(v) {
    if (nodes.windBP) nodes.windBP.frequency.setTargetAtTime(500 + 700 * v, ctx.currentTime, 1.0);
  }

  function toggle() {
    enabled = !enabled;
    if (master) master.gain.setTargetAtTime(enabled ? 0.9 : 0.0, ctx.currentTime, 0.4);
    return enabled;
  }

  return { start, thunder, setParting, setWind, toggle, isEnabled: () => enabled };
}
