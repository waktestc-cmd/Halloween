// Sound: recorded effects from /assets/sounds, plus a few made here (rain, wind, the ghosts' hum,
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
  laugh: ['evil-laugh'], // the house laughs as the night starts (from Pumpkin Smash)
  // optional recordings: drop these in to replace the made-up sounds
  ambience: ['ambience'],
  chase: ['chase'],
  hum: ['nun-hum'], // the ghosts' humming (named for the convent this game began as)
  bell: ['bell'],
  whisper: ['ghost-whisper'],
  boo: ['ghost-boo'],
  heartbeat: ['heartbeat'],
  thunder: ['thunder', 'thunder-2'],
  scare: ['jump-scare', 'jump-scare-2'],
  slam: ['door-slam'],
  groan: ['zombie-groan'],
  snarl: ['zombie-snarl'],
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
    if (key === 'ambience' && list.length) this.loopFile('ambience', 0.6);
    if (key === 'heartbeat' && list.length) {
      // a recorded heartbeat loops quietly all the time; setHeart turns it up and speeds it up
      this.heart = this.loopFile('heartbeat', 0);
      this.heart.g.disconnect();
      this.heart.g.connect(this.sfxBus);
    }
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
  // len cuts a long recording short with a quick fade
  play(key, { at, vol = 1, rate = 1, muffled = false, bus, len } = {}) {
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
    if (len) {
      const end = this.ctx.currentTime + len;
      g.gain.setValueAtTime(vol, end - 0.15);
      g.gain.linearRampToValueAtTime(0.0001, end);
      src.stop(end + 0.05);
    }
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
  // a ghostly woman's hum: a breathy voice with formants singing a slow tune, carried in 3D
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
  // a handbell somewhere in the house: a short jingle, or rung for a while
  bell(x, z, muffled, long = false) {
    if (this.play('bell', { at: [x, z], vol: long ? 0.6 : 0.35, rate: 0.95 + Math.random() * 0.1, muffled, len: long ? 3.5 : 0.6 })) return;
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
  // how near danger is, 0 to 1: drives the recorded heartbeat when there is one
  setHeart(level) {
    if (!this.heart) return;
    const now = this.ctx.currentTime;
    this.heart.g.gain.setTargetAtTime(level > 0 ? 0.25 + level * 0.75 : 0, now, 0.4);
    this.heart.src.playbackRate.setTargetAtTime(0.9 + level * 0.5, now, 0.5);
  }
  heartbeat(vol) {
    if (vol < 0.02 || this.heart) return;
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
  // when the Count sees you: a shriek; when you are caught: a sting
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
  /* ---------- the monsters ---------- */
  // the Count's slow, wet breathing, carried in 3D; set(level) turns it up when he hunts
  makeBreath() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = this.panner(0, 0, { ref: 1.5, max: 25, roll: 1.5, y: 1.8 });
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 6000;
    out.connect(muffle).connect(pan).connect(this.sfxBus);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const breath = ctx.createGain();
    breath.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.32;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(breath.gain);
    for (const [f, q, a] of [[700, 1.5, 0.5], [260, 3, 0.7]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = a;
      s.connect(bp).connect(g).connect(breath);
    }
    breath.connect(out);
    s.start(0, Math.random());
    lfo.start();
    return {
      out,
      set: (x, z, level, muffled) => {
        this.movePanner(pan, x, z, 1.8);
        out.gain.setTargetAtTime(level, ctx.currentTime, 0.3);
        lfo.frequency.setTargetAtTime(level > 0.7 ? 0.7 : 0.32, ctx.currentTime, 0.5);
        muffle.frequency.setTargetAtTime(muffled ? 650 : 6000, ctx.currentTime, 0.2);
      },
    };
  }
  // the Doctor's Monster's heavy footsteps
  stomp(x, z, muffled) {
    this.thud(x, z, muffled ? 0.45 : 0.9);
  }
  // his growl, and the roar when he wakes or sees you
  roar(x, z, muffled, loud) {
    if (this.play('snarl', { at: [x, z], vol: loud ? 1.3 : 0.6, rate: 0.5 + Math.random() * 0.08, muffled })) return;
    this.wail(x, z);
  }
  // a zombie's groan; louder, with a snarl, when it has seen you
  groan(x, z, muffled, loud) {
    this.play('groan', { at: [x, z], vol: loud ? 1 : 0.5, rate: 0.85 + Math.random() * 0.2, muffled });
    if (loud) this.play('snarl', { at: [x, z], vol: 0.7, rate: 0.8, muffled });
  }
  // the Count hissing as your light hits his face
  hiss(x, z) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(3500, now);
    bp.frequency.linearRampToValueAtTime(2500, now + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.8, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    s.connect(bp).connect(g).connect(this.panner(x, z, { ref: 2, max: 25, y: 1.8 })).connect(this.sfxBus);
    s.start(now, Math.random());
    s.stop(now + 1);
  }

  /* ---------- the house acting up ---------- */
  // something knocks three times behind a closed door
  knock(x, z, muffled) {
    [0, 0.42, 0.84].forEach((dt, i) =>
      setTimeout(() => {
        if (this.play('doorClose', { at: [x, z], vol: 0.9 - i * 0.1, rate: 0.75, muffled })) return;
        this.thud(x, z, 0.5);
      }, dt * 1000),
    );
  }
  // a door slamming shut on its own: louder and deeper than a hand closing it
  slam(x, z, muffled) {
    if (!this.play('slam', { at: [x, z], vol: 1.1, muffled })) this.play('doorClose', { at: [x, z], vol: 1.3, rate: 0.55, muffled });
    this.thud(x, z, 0.8);
  }
  thud(x, z, vol = 0.5) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, now);
    o.frequency.exponentialRampToValueAtTime(40, now + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.6, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    const out = this.panner(x, z, { ref: 2, max: 30, y: 0.3 });
    o.connect(g).connect(out);
    s.connect(lp).connect(ng).connect(out);
    out.connect(this.sfxBus);
    o.start(now);
    o.stop(now + 0.4);
    s.start(now, Math.random());
    s.stop(now + 0.15);
  }
  // a floorboard giving under a weight that isn't yours
  creak(x, z, vol = 0.35) {
    if (this.play('doorCreak', { at: [x, z], vol, rate: 1.6 + Math.random() * 0.3 })) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, now);
    o.frequency.linearRampToValueAtTime(55, now + 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 14;
    bp.frequency.setValueAtTime(700, now);
    bp.frequency.linearRampToValueAtTime(1100, now + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    o.connect(bp).connect(g).connect(this.panner(x, z, { ref: 1.5, max: 20, y: 0.2 })).connect(this.sfxBus);
    o.start(now);
    o.stop(now + 0.75);
  }
  // a long, sad voice far off in the house
  wail(x, z) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, now);
    o.frequency.linearRampToValueAtTime(470, now + 0.8);
    o.frequency.exponentialRampToValueAtTime(230, now + 3);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vg = ctx.createGain();
    vg.gain.value = 9;
    vib.connect(vg).connect(o.frequency);
    const sum = ctx.createGain();
    for (const [f, q, a] of [[700, 7, 1], [1150, 9, 0.5], [2600, 10, 0.15]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = a;
      o.connect(bp).connect(gg).connect(sum);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + 0.6);
    g.gain.setValueAtTime(0.5, now + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    sum.connect(lp).connect(g).connect(this.panner(x, z, { ref: 6, max: 60, roll: 0.8, y: 1.6 })).connect(this.sfxBus);
    o.start(now);
    vib.start(now);
    o.stop(now + 3.3);
    vib.stop(now + 3.3);
  }
  // a music box winding down in an empty room
  musicBox(x, z) {
    const ctx = this.ctx;
    const out = this.panner(x, z, { ref: 2, max: 25, y: 1 });
    out.connect(this.sfxBus);
    const notes = [659.3, 587.3, 523.3, 493.9, 523.3, 440, 0, 493.9, 523.3, 587.3, 493.9, 440];
    let t = ctx.currentTime + 0.1;
    notes.forEach((f, i) => {
      t += 0.42 + i * 0.03; // slowing as the spring runs down
      if (!f) return;
      for (const [m, a, len] of [[1, 0.16, 1.4], [3.01, 0.04, 0.5], [5.2, 0.015, 0.25]]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * m * (1 - i * 0.002);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(a, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + len + 0.05);
      }
    });
  }
  // the hall clock
  tick(x, z, tock) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 8;
    bp.frequency.value = tock ? 1500 : 2300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    s.connect(bp).connect(g).connect(this.panner(x, z, { ref: 1.2, max: 16, roll: 1.6, y: 1.9 })).connect(this.sfxBus);
    s.start(now, Math.random());
    s.stop(now + 0.05);
  }
  drip(x, z) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const f = 900 + Math.random() * 500;
    o.frequency.setValueAtTime(f, now);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, now + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g).connect(this.panner(x, z, { ref: 1, max: 12, y: 0.8 })).connect(this.sfxBus);
    o.start(now);
    o.stop(now + 0.13);
  }
  // the boiler's low rumble, always running
  rumble(x, z) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 110;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    const o = ctx.createOscillator();
    o.frequency.value = 49;
    const og = ctx.createGain();
    og.gain.value = 0.12;
    const out = this.panner(x, z, { ref: 2, max: 20, roll: 1.6, y: 1 });
    s.connect(lp).connect(g).connect(out);
    o.connect(og).connect(out);
    out.connect(this.sfxBus);
    s.start();
    o.start();
  }
  // the lamps stuttering: an electric buzz from the fuse box
  buzz(x, z, sec = 2.5) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    for (let k = 0; k < sec / 0.12; k++) g.gain.setValueAtTime(Math.random() < 0.6 ? 0.08 : 0.0001, now + k * 0.12);
    g.gain.setValueAtTime(0.0001, now + sec);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    o.connect(hp).connect(g).connect(this.panner(x, z, { ref: 4, max: 50, roll: 0.7 })).connect(this.sfxBus);
    o.start(now);
    o.stop(now + sec + 0.1);
  }
  // a cold breath of air as something vanishes
  whoosh(vol = 0.3) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(1800, now + 0.5);
    bp.frequency.exponentialRampToValueAtTime(400, now + 1.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    s.connect(bp).connect(g).connect(this.musicBus);
    s.start(now, Math.random());
    s.stop(now + 1.5);
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
  // the flash (Q): a sharp pop and a fading whine, like an old flashgun; at (x, z) when it is someone else's
  flashPop(x, z) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    let out = this.sfxBus;
    if (x != null) {
      out = this.panner(x, z, { ref: 3, max: 40 });
      out.connect(this.sfxBus);
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.45, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    src.connect(hp).connect(g).connect(out);
    src.start(now, Math.random(), 0.15);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(220, now);
    o.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.5, now);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    o.connect(g2).connect(out);
    o.start(now);
    o.stop(now + 0.2);
    const w = ctx.createOscillator();
    w.type = 'triangle';
    w.frequency.setValueAtTime(5200, now + 0.05);
    w.frequency.exponentialRampToValueAtTime(2200, now + 0.9);
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.0001, now);
    g3.gain.exponentialRampToValueAtTime(0.025, now + 0.1);
    g3.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    w.connect(g3).connect(out);
    w.start(now);
    w.stop(now + 0.95);
  }
  // a sweet picked up: two quick, soft, bright notes
  sweet() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    [1046.5, 1568].forEach((f, i) => {
      const t0 = now + i * 0.075;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      o.connect(g).connect(this.sfxBus);
      o.start(t0);
      o.stop(t0 + 0.3);
    });
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
