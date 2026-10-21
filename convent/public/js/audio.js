// Sound: recorded effects from /assets/sounds, plus a few made here (rain, wind, the nun's hum,
// her bell, the ghosts, a heartbeat). Sounds in the house are placed in 3D around you.
// Any recording dropped into /assets/sounds with a name from FILES replaces the made-up version.

const FILES = {
  step: ['sfx-step-1', 'sfx-step-2', 'sfx-step-3', 'sfx-step-4'],
  doorOpen: ['sfx-door-open'],
  doorCreak: ['sfx-door-creak'],
  doorClose: ['sfx-knock'],
  search: ['sfx-open-wood'],
  found: ['sfx-pumpkin-found'],
  hit: ['sfx-hit'],
  win: ['sfx-win'],
  // optional recordings: drop these in to replace the made-up sounds
  ambience: ['ambience'],
  chase: ['chase'],
  hum: ['nun-hum'],
  bell: ['bell'],
  whisper: ['ghost-whisper'],
  boo: ['ghost-boo'],
  heartbeat: ['heartbeat'],
  thunder: ['thunder'],
  scare: ['jump-scare'],
  slam: ['door-slam'],
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.vol = { master: 0.8, music: 0.7, sfx: 0.9 };
  }
  start(files = []) {
    if (this.ctx) return this.ctx.resume();
    this.files = new Set(files);
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.setVolume(this.vol);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.ambience();
    for (const [k, names] of Object.entries(FILES)) this.load(k, names);
  }
  setVolume(v) {
    Object.assign(this.vol, v);
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.musicBus.gain.value = this.vol.music;
    this.sfxBus.gain.value = this.vol.sfx;
  }
  async load(key, names) {
    const list = [];
    for (const n of names) {
      for (const ext of ['mp3', 'ogg', 'wav']) {
        if (!this.files.has(`${n}.${ext}`)) continue;
        try {
          const r = await fetch(`/assets/sounds/${n}.${ext}`);
          if (!r.ok) continue;
          list.push(await this.ctx.decodeAudioData(await r.arrayBuffer()));
          break;
        } catch (e) {
          /* not there: the made-up version plays instead */
        }
      }
    }
    if (list.length) this.buffers.set(key, list);
    if (key === 'ambience' && list.length) this.loopFile('ambience', 0.5);
    if (key === 'chase' && list.length) {
      const l = this.loopFile('chase', 1);
      l.g.disconnect();
      l.g.connect(this.chaseGain);
      this.chaseSynth.gain.value = 0;
    }
  }
  has(key) {
    return this.buffers.has(key);
  }

  /* ---------- placing sounds around you ---------- */
  listen(x, z, yaw) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = 1.6;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(x, 1.6, z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }
  panner(x, z, { ref = 2, max = 40, roll = 1.2, y = 1.4 } = {}) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = max;
    p.rolloffFactor = roll;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
    return p;
  }
  movePanner(p, x, z, y = 1.4) {
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, this.ctx.currentTime, 0.05);
      p.positionY.value = y;
      p.positionZ.setTargetAtTime(z, this.ctx.currentTime, 0.05);
    } else p.setPosition(x, y, z);
  }
  // play a recording; at (x, z) in the house, or right at your ears
  play(key, { at, vol = 1, rate = 1, muffled = false, bus } = {}) {
    if (!this.ctx) return false;
    const list = this.buffers.get(key);
    if (!list) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    let node = src;
    if (muffled) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      node.connect(lp);
      node = lp;
    }
    node.connect(g);
    if (at) g.connect(this.panner(at[0], at[1])).connect(bus || this.sfxBus);
    else g.connect(bus || this.sfxBus);
    src.start();
    return src;
  }
  loopFile(key, vol) {
    const list = this.buffers.get(key);
    if (!list) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = list[0];
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.musicBus);
    src.start();
    return { src, g };
  }

  /* ---------- the house breathing: rain and wind ---------- */
  ambience() {
    const ctx = this.ctx;
    const noise = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.start();
      return s;
    };
    // rain on the roof: filtered noise, louder near the courtyard
    const rain = noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0.05;
    rain.connect(bp).connect(lp).connect(this.rainGain).connect(this.sfxBus);
    // wind moaning through the building
    const wind = noise();
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.Q.value = 6;
    wf.frequency.value = 400;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(wf).connect(wg).connect(this.musicBus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(wf.frequency);
    lfo.start();
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.11;
    const lfo2G = ctx.createGain();
    lfo2G.gain.value = 0.035;
    lfo2.connect(lfo2G).connect(wg.gain);
    lfo2.start();
    // a deep drone under everything
    this.drone = ctx.createGain();
    this.drone.gain.value = 0.0;
    for (const f of [41.2, 61.7, 82.4 * 1.06]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      o.connect(g).connect(this.drone);
      o.start();
    }
    this.drone.connect(this.musicBus);
    this.drone.gain.setTargetAtTime(0.06, ctx.currentTime, 4);
    // the chase: pulsing low strings and a screech, faded in when something hunts you
    this.chaseGain = ctx.createGain();
    this.chaseGain.gain.value = 0;
    this.chaseGain.connect(this.musicBus);
    this.chaseSynth = ctx.createGain();
    this.chaseSynth.connect(this.chaseGain);
    {
      for (const [f, type] of [[55, 'sawtooth'], [58.3, 'sawtooth'], [110, 'square']]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const flt = ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = 300;
        const g = ctx.createGain();
        g.gain.value = 0.12;
        const pulse = ctx.createOscillator();
        pulse.frequency.value = 4.2;
        const pg = ctx.createGain();
        pg.gain.value = 0.1;
        pulse.connect(pg).connect(g.gain);
        pulse.start();
        o.connect(flt).connect(g).connect(this.chaseSynth);
        o.start();
      }
      const screech = noise();
      const sf = ctx.createBiquadFilter();
      sf.type = 'bandpass';
      sf.Q.value = 30;
      sf.frequency.value = 2600;
      const sg = ctx.createGain();
      sg.gain.value = 0.25;
      const vib = ctx.createOscillator();
      vib.frequency.value = 7;
      const vg = ctx.createGain();
      vg.gain.value = 120;
      vib.connect(vg).connect(sf.frequency);
      vib.start();
      screech.connect(sf).connect(sg).connect(this.chaseSynth);
    }
  }
  setRain(near) {
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(0.025 + near * 0.12, this.ctx.currentTime, 0.4);
  }
  setChase(level) {
    if (this.chaseGain) this.chaseGain.gain.setTargetAtTime(level * 0.55, this.ctx.currentTime, level > 0 ? 0.3 : 2.5);
  }

  /* ---------- made-up voices ---------- */
  // a nun's hum: a breathy voice with formants singing a slow tune, carried in 3D
  makeHum(seed = 0) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = this.panner(0, 0, { ref: 1.5, max: 30, roll: 1.4, y: 1.7 });
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 6000;
    out.connect(muffle).connect(pan).connect(this.sfxBus);
    let voiceIn = null;
    if (this.buffers.has('hum')) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get('hum')[0];
      src.loop = true;
      src.playbackRate.value = 0.95 + seed * 0.04;
      src.connect(out);
      src.start(ctx.currentTime + seed * 1.7);
    } else {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      voiceIn = o;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      const vg = ctx.createGain();
      vg.gain.value = 3;
      vib.connect(vg).connect(o.frequency);
      vib.start();
      const sum = ctx.createGain();
      sum.gain.value = 0.5;
      for (const [f, q, g] of [[520, 8, 1], [880, 10, 0.5], [2700, 12, 0.15]]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const gg = ctx.createGain();
        gg.gain.value = g;
        o.connect(bp).connect(gg).connect(sum);
      }
      const env = ctx.createGain();
      env.gain.value = 0;
      sum.connect(env).connect(out);
      o.start();
      // a slow minor lullaby, a bit out of tune
      const tune = [220, 261.6, 246.9, 220, 196, 207.7, 220, 0, 220, 246.9, 261.6, 293.7, 261.6, 246.9, 220, 0];
      let i = seed * 5;
      const next = () => {
        if (!this.ctx) return;
        const f = tune[i++ % tune.length] * (1 + seed * 0.006);
        const now = ctx.currentTime;
        if (f) {
          o.frequency.setTargetAtTime(f * 0.5, now, 0.08);
          env.gain.setTargetAtTime(0.5, now, 0.15);
          env.gain.setTargetAtTime(0.25, now + 0.6, 0.3);
        } else env.gain.setTargetAtTime(0, now, 0.3);
        setTimeout(next, f ? 900 + Math.random() * 300 : 1800);
      };
      next();
    }
    return {
      out,
      pan,
      muffle,
      voiceIn,
      set: (x, z, level, muffled) => {
        this.movePanner(pan, x, z, 1.7);
        out.gain.setTargetAtTime(level, ctx.currentTime, 0.3);
        muffle.frequency.setTargetAtTime(muffled ? 650 : 6000, ctx.currentTime, 0.2);
      },
    };
  }
  // a small bell at the nun's belt, jingling as she moves
  bell(x, z, muffled) {
    if (this.play('bell', { at: [x, z], vol: 0.5, rate: 0.9 + Math.random() * 0.2, muffled })) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pan = this.panner(x, z, { ref: 1.5, max: 25, roll: 1.5, y: 1 });
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = muffled ? 900 : 9000;
    g.connect(lp).connect(pan).connect(this.sfxBus);
    const base = 1850 + Math.random() * 60;
    for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]]) {
      const o = ctx.createOscillator();
      o.frequency.value = base * m;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start(now);
      o.stop(now + 1.3);
    }
  }
  // a ghost noticing you: a falling, breathy "boo"
  boo(x, z) {
    if (this.play('boo', { at: [x, z], vol: 0.9 })) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pan = this.panner(x, z, { ref: 2, max: 25 });
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(330, now);
    o.frequency.exponentialRampToValueAtTime(140, now + 1.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    o.connect(bp).connect(g).connect(pan).connect(this.sfxBus);
    o.start(now);
    o.stop(now + 1.7);
    this.whisper(x, z, 0.5);
  }
  whisper(x, z, vol = 0.25) {
    if (this.play('whisper', { at: [x, z], vol })) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 9;
    bp.frequency.setValueAtTime(1800, now);
    bp.frequency.linearRampToValueAtTime(900, now + 0.6);
    bp.frequency.linearRampToValueAtTime(2400, now + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.3);
    g.gain.linearRampToValueAtTime(0, now + 1.4);
    s.connect(bp).connect(g).connect(this.panner(x, z, { ref: 1.5, max: 15 })).connect(this.sfxBus);
    s.start(now, Math.random());
    s.stop(now + 1.5);
  }
  heartbeat(vol) {
    if (vol < 0.02) return;
    if (this.play('heartbeat', { vol })) return;
    const ctx = this.ctx;
    for (const [dt, a] of [[0, 1], [0.24, 0.7]]) {
      const now = ctx.currentTime + dt;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, now);
      o.frequency.exponentialRampToValueAtTime(38, now + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol * a, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      o.connect(g).connect(this.sfxBus);
      o.start(now);
      o.stop(now + 0.25);
    }
  }
  thunder(dist = 1) {
    if (this.play('thunder', { vol: 0.6 * dist })) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.4 + Math.random() * 1.2;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.exponentialRampToValueAtTime(90, now + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.9 * dist, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.3 * dist, now + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 4);
    s.connect(lp).connect(g).connect(this.musicBus);
    s.start(now);
    s.stop(now + 4.2);
  }
  // when she sees you: a shriek; when you are caught: a sting
  shriek(x, z) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pan = this.panner(x, z, { ref: 3, max: 40 });
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 12;
    bp.frequency.setValueAtTime(1400, now);
    bp.frequency.exponentialRampToValueAtTime(3200, now + 0.35);
    bp.frequency.exponentialRampToValueAtTime(1800, now + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(1.2, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    s.connect(bp).connect(g).connect(pan).connect(this.sfxBus);
    s.start(now);
    s.stop(now + 1.3);
  }
  sting(gentle) {
    if (this.play('scare', { vol: gentle ? 0.4 : 1 })) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gentle ? 0.3 : 0.9, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    g.connect(this.sfxBus);
    for (const f of [146.8, 155.6, 207.7, 311.1, 329.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.frequency.exponentialRampToValueAtTime(f * 0.94, now + 2);
      o.connect(g);
      o.start(now);
      o.stop(now + 2.3);
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gentle ? 0.15 : 0.6, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    s.connect(ng).connect(this.sfxBus);
    s.start(now);
    s.stop(now + 0.7);
  }
  chime() {
    if (this.play('found', { vol: 0.5 })) return;
  }
  clunk(x, z) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(60, now + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    o.connect(lp).connect(g).connect(this.panner(x, z, { ref: 3, max: 60 })).connect(this.sfxBus);
    o.start(now);
    o.stop(now + 0.35);
  }
  powerUp() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(30, now);
    o.frequency.exponentialRampToValueAtTime(120, now + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15, now + 0.3);
    g.gain.exponentialRampToValueAtTime(0.02, now + 2);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    o.connect(lp).connect(g).connect(this.sfxBus);
    o.start(now);
    o.stop(now + 4);
  }
  click() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    o.connect(g).connect(this.sfxBus);
    o.start(now);
    o.stop(now + 0.04);
  }
}
