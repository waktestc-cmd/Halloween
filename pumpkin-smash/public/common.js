// Shared browser code: synthesised sound, particles, and every graphic drawn in code.
/* global SHARED */
(function () {
  const S = window.SHARED;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const NEON = [S.COLORS.violet, S.COLORS.green, S.COLORS.orange, S.COLORS.magenta, S.COLORS.cyan, S.COLORS.red, '#ffe14d'];

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* private mode */
      }
    },
  };

  // =====================================================================
  // Sound: everything synthesised with Web Audio
  // =====================================================================
  const Sound = (() => {
    let ctx = null;
    let master = null;
    let noiseBuf = null;
    let muted = store.get('ps_muted', false);
    let drone = null;
    const api = { mild: false };

    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.85;
        master.connect(comp);
        comp.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    api.unlock = ensure;
    api.isMuted = () => muted;
    api.setMuted = (m) => {
      muted = m;
      store.set('ps_muted', m);
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.05);
    };
    api.toggleMute = () => api.setMuted(!muted);

    function out(pan) {
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        p.connect(master);
        return p;
      }
      return master;
    }
    function env(g, t, a, peak, dur) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    function tone(o) {
      if (!ensure() || muted) return;
      const t = ctx.currentTime + (o.at || 0);
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur));
      if (o.detune) osc.detune.value = o.detune;
      const g = ctx.createGain();
      env(g, t, o.a || 0.01, o.vol || 0.2, o.dur);
      let node = osc;
      if (o.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = o.lp;
        node.connect(f);
        node = f;
      }
      if (o.vib) {
        const l = ctx.createOscillator();
        const lg = ctx.createGain();
        l.frequency.value = o.vib[0];
        lg.gain.value = o.vib[1];
        l.connect(lg);
        lg.connect(osc.frequency);
        l.start(t);
        l.stop(t + o.dur + 0.05);
      }
      node.connect(g);
      g.connect(out(o.pan));
      osc.start(t);
      osc.stop(t + o.dur + 0.05);
      return osc;
    }
    function noise(o) {
      if (!ensure() || muted) return;
      const t = ctx.currentTime + (o.at || 0);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = o.ft || 'bandpass';
      f.frequency.setValueAtTime(o.f || 1000, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
      f.Q.value = o.q || 1;
      const g = ctx.createGain();
      env(g, t, o.a || 0.005, o.vol || 0.2, o.dur);
      src.connect(f);
      f.connect(g);
      g.connect(out(o.pan));
      src.start(t, Math.random());
      src.stop(t + o.dur + 0.05);
    }
    function distortion(amount) {
      const c = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        c[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
      }
      const w = ctx.createWaveShaper();
      w.curve = c;
      return w;
    }

    api.chime = () => {
      [880, 1318.5, 1760, 2637].forEach((f, i) => tone({ f, type: 'sine', vol: 0.18, dur: 1.1, at: i * 0.05 }));
    };
    api.claim = () => {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
        tone({ f, type: 'triangle', vol: 0.22, dur: 0.6, at: i * 0.07 })
      );
      tone({ f: 2093, type: 'sine', vol: 0.08, dur: 1.4, at: 0.35 });
      noise({ f: 6000, q: 0.7, vol: 0.06, dur: 0.6, at: 0.3, ft: 'highpass' });
    };
    api.ping = () => {
      const f = rand(1300, 1700);
      tone({ f, f2: f * 1.5, type: 'sine', vol: 0.12, dur: 0.16 });
      tone({ f: f * 2, type: 'sine', vol: 0.04, dur: 0.25, at: 0.04 });
    };
    api.spawnBell = () => {
      tone({ f: 196, type: 'sine', vol: 0.18, dur: 2.2 });
      tone({ f: 293.7, type: 'sine', vol: 0.1, dur: 2.0, at: 0.02 });
      tone({ f: 466, type: 'sine', vol: 0.05, dur: 1.6, at: 0.03 });
    };
    api.creak = () => {
      if (!ensure() || muted) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(70, t);
      osc.frequency.linearRampToValueAtTime(115, t + 0.35);
      osc.frequency.linearRampToValueAtTime(85, t + 0.6);
      osc.frequency.linearRampToValueAtTime(130, t + 0.85);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 6;
      const g = ctx.createGain();
      env(g, t, 0.05, 0.35, 0.95);
      const trem = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.setValueAtTime(22, t);
      lfo.frequency.linearRampToValueAtTime(38, t + 0.9);
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg);
      lg.connect(trem.gain);
      osc.connect(bp);
      bp.connect(trem);
      trem.connect(g);
      g.connect(master);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 1);
      lfo.stop(t + 1);
      noise({ f: 160, q: 1, vol: 0.35, dur: 0.35, at: 0.9, ft: 'lowpass' });
    };
    api.whoosh = () => noise({ f: 300, f2: 3000, q: 1.2, vol: 0.16, dur: 0.5 });
    api.whisper = (pan) => {
      if (!ensure() || muted) return;
      for (let i = 0; i < 3; i++) {
        noise({ f: rand(1800, 4200), q: rand(3, 8), vol: rand(0.04, 0.09), dur: rand(0.25, 0.6), at: i * rand(0.12, 0.3), pan });
      }
      tone({ f: rand(180, 260), f2: rand(120, 160), type: 'sine', vol: 0.05, dur: 1.2, pan, vib: [6, 8] });
    };
    api.scream = () => {
      if (!ensure() || muted) return;
      if (api.mild) return api.moan();
      const t = ctx.currentTime;
      const sh = distortion(60);
      const g = ctx.createGain();
      env(g, t, 0.03, 0.32, 1.5);
      sh.connect(g);
      g.connect(master);
      [0, 7, -9].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det * 10;
        o.frequency.setValueAtTime(520, t);
        o.frequency.exponentialRampToValueAtTime(1350, t + 0.25);
        o.frequency.exponentialRampToValueAtTime(900, t + 0.9);
        o.frequency.exponentialRampToValueAtTime(380, t + 1.5);
        const l = ctx.createOscillator();
        const lg = ctx.createGain();
        l.frequency.value = 11;
        lg.gain.value = 60;
        l.connect(lg);
        lg.connect(o.frequency);
        o.connect(sh);
        o.start(t);
        l.start(t);
        o.stop(t + 1.55);
        l.stop(t + 1.55);
      });
      noise({ f: 3000, q: 0.6, vol: 0.2, dur: 1.2, ft: 'highpass' });
    };
    api.moan = () => {
      tone({ f: 220, f2: 98, type: 'triangle', vol: 0.18, dur: 1.4, vib: [4, 6], lp: 900 });
      tone({ f: 165, f2: 82, type: 'sine', vol: 0.12, dur: 1.5 });
    };
    api.glitch = () => {
      for (let i = 0; i < 6; i++) noise({ f: rand(400, 5000), q: 4, vol: 0.12, dur: 0.05, at: i * 0.06 });
      tone({ f: 60, type: 'square', vol: 0.12, dur: 0.3, lp: 400 });
    };
    api.stinger = () => {
      [110, 116.5, 164.8].forEach((f) => tone({ f, type: 'sawtooth', vol: 0.12, dur: 1.6, lp: 1200, a: 0.02 }));
      noise({ f: 120, q: 0.8, vol: 0.3, dur: 0.8, ft: 'lowpass' });
    };
    api.tick = () => tone({ f: 1800, type: 'square', vol: 0.04, dur: 0.04, lp: 4000 });
    api.blip = () => tone({ f: 660, f2: 990, type: 'triangle', vol: 0.12, dur: 0.12 });
    api.drumroll = (dur = 3) => {
      if (!ensure() || muted) return;
      const n = Math.floor(dur / 0.045);
      for (let i = 0; i < n; i++) {
        const k = i / n;
        noise({ f: 1700 + k * 900, q: 0.9, vol: 0.05 + k * k * 0.3, dur: 0.05, at: i * 0.045 + rand(-0.004, 0.004) });
        if (i % 2 === 0) tone({ f: 95 + k * 40, type: 'sine', vol: 0.05 + k * 0.18, dur: 0.07, at: i * 0.045 });
      }
    };
    api.boom = () => {
      tone({ f: 150, f2: 26, glide: 1.1, type: 'sine', vol: 0.95, dur: 1.6, a: 0.003 });
      tone({ f: 75, f2: 30, type: 'square', vol: 0.25, dur: 0.6, lp: 300, a: 0.003 });
      noise({ f: 1200, f2: 90, q: 0.6, vol: 0.7, dur: 1.4, ft: 'lowpass' });
      noise({ f: 5000, q: 0.7, vol: 0.3, dur: 0.25, ft: 'highpass' });
    };
    api.fanfare = () => {
      const seq = [392, 523.25, 659.25, 783.99];
      seq.forEach((f, i) => {
        tone({ f, type: 'sawtooth', vol: 0.12, dur: 0.22, at: i * 0.14, lp: 2600 });
        tone({ f: f / 2, type: 'square', vol: 0.05, dur: 0.22, at: i * 0.14, lp: 1200 });
      });
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => {
        tone({ f, type: 'sawtooth', vol: 0.11, dur: 2.2, at: 0.6, lp: 3000, vib: [5.5, 4], a: 0.04 });
        tone({ f: f * 2, type: 'sine', vol: 0.03, dur: 2.2, at: 0.6 });
      });
      tone({ f: 130.8, type: 'triangle', vol: 0.2, dur: 2.4, at: 0.6 });
      for (let i = 0; i < 10; i++) tone({ f: rand(2000, 4200), type: 'sine', vol: 0.04, dur: 0.3, at: 0.7 + i * 0.12 });
    };
    api.zombie = () => {
      if (!ensure() || muted) return;
      const t = ctx.currentTime;
      const sh = distortion(api.mild ? 10 : 80);
      const g = ctx.createGain();
      env(g, t, 0.05, api.mild ? 0.15 : 0.3, 1.8);
      sh.connect(g);
      g.connect(master);
      [0, 13].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(110 + det, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 1.7);
        o.connect(sh);
        o.start(t);
        o.stop(t + 1.8);
      });
      if (!api.mild) api.glitch();
    };

    // Ambient per-room drone with crossfade.
    api.setDrone = (roomIdx) => {
      if (!ensure()) return;
      if (drone && drone.room === roomIdx) return;
      api.stopDrone();
      if (roomIdx == null || roomIdx < 0) return;
      const t = ctx.currentTime;
      const base = S.ROOMS[roomIdx].drone;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 2.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      lp.Q.value = 4;
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 0.07 + roomIdx * 0.025;
      lfoG.gain.value = 180;
      lfo.connect(lfoG);
      lfoG.connect(lp.frequency);
      lp.connect(g);
      g.connect(master);
      const nodes = [lfo];
      const ratios = [
        [1, 1.006, 2], // hall
        [1, 1.5, 4.01], // attic: hollow fifth + whistle
        [0.5, 1, 1.003], // crypt: sub-heavy
        [1, 1.01, 1.498], // swamp
        [1, 1.5, 2, 3], // chapel: organ
      ][roomIdx];
      ratios.forEach((r, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sawtooth' : roomIdx === 4 ? 'triangle' : 'sawtooth';
        o.frequency.value = base * r;
        const og = ctx.createGain();
        og.gain.value = i === 0 ? 0.6 : 0.35;
        o.connect(og);
        og.connect(lp);
        nodes.push(o);
      });
      if (roomIdx === 3 || roomIdx === 1) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = roomIdx === 3 ? 260 : 900;
        bp.Q.value = roomIdx === 3 ? 6 : 2;
        const ng = ctx.createGain();
        ng.gain.value = 0.5;
        src.connect(bp);
        bp.connect(ng);
        ng.connect(g);
        nodes.push(src);
      }
      nodes.forEach((n) => n.start(t));
      drone = { room: roomIdx, g, nodes };
    };
    api.stopDrone = () => {
      if (!drone || !ctx) return;
      const d = drone;
      drone = null;
      const t = ctx.currentTime;
      d.g.gain.cancelScheduledValues(t);
      d.g.gain.setTargetAtTime(0.0001, t, 0.4);
      d.nodes.forEach((n) => n.stop(t + 2));
    };
    return api;
  })();

  // =====================================================================
  // Particles, shake, flashes
  // =====================================================================
  class Particles {
    constructor(max = 2200) {
      this.list = [];
      this.max = max;
    }
    emit(x, y, o = {}) {
      const n = o.count || 20;
      for (let i = 0; i < n && this.list.length < this.max; i++) {
        const a = o.angle != null ? o.angle + rand(-(o.spread || TAU) / 2, (o.spread || TAU) / 2) : rand(0, TAU);
        const sp = rand(o.speedMin != null ? o.speedMin : (o.speed || 200) * 0.3, o.speed || 200);
        const life = rand((o.life || 1) * 0.6, o.life || 1);
        this.list.push({
          x: x + rand(-(o.jitter || 0), o.jitter || 0),
          y: y + rand(-(o.jitter || 0), o.jitter || 0),
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life,
          max: life,
          size: rand((o.size || 3) * 0.5, o.size || 3),
          color: Array.isArray(o.color) ? pick(o.color) : o.color || '#fff',
          g: o.gravity || 0,
          drag: o.drag != null ? o.drag : 0.985,
          shape: o.shape || 'dot',
          rot: rand(0, TAU),
          vr: rand(-10, 10),
        });
      }
    }
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.list.splice(i, 1);
          continue;
        }
        const d = Math.pow(p.drag, dt * 60);
        p.vx *= d;
        p.vy *= d;
        p.vy += p.g * dt;
        if (p.shape === 'confetti') p.vx += Math.sin(p.rot * 2) * 30 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    }
    draw(ctx) {
      if (!this.list.length) return;
      ctx.save();
      for (const p of this.list) {
        const a = clamp(p.life / p.max, 0, 1);
        if (p.shape === 'confetti' || p.shape === 'chunk') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = Math.min(1, a * 2);
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          if (p.shape === 'confetti') ctx.scale(1, Math.cos(p.rot * 1.7));
          if (p.shape === 'chunk') {
            ctx.beginPath();
            ctx.moveTo(-p.size, -p.size * 0.6);
            ctx.lineTo(p.size, -p.size * 0.3);
            ctx.lineTo(p.size * 0.4, p.size * 0.8);
            ctx.lineTo(-p.size * 0.7, p.size * 0.5);
            ctx.fill();
          } else ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
          ctx.restore();
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color;
          if (p.shape === 'spark') {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size * 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
            ctx.stroke();
          } else if (p.shape === 'ring') {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 3 * a + 0.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 - a) * 40 + 4, 0, TAU);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, TAU);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  class Shaker {
    constructor() {
      this.mag = 0;
    }
    add(m) {
      this.mag = Math.min(60, this.mag + m);
    }
    offset(dt) {
      this.mag *= Math.pow(0.02, dt);
      if (this.mag < 0.3) {
        this.mag = 0;
        return [0, 0];
      }
      return [rand(-1, 1) * this.mag, rand(-1, 1) * this.mag];
    }
  }

  // =====================================================================
  // Costumes (emoji or code-drawn)
  // =====================================================================
  const costumeById = (id) => S.COSTUMES.find((c) => c.id === id) || S.COSTUMES[0];
  const MUMMY_SVG =
    '<svg viewBox="0 0 100 100" class="mummy-svg" aria-hidden="true"><defs><clipPath id="mh"><circle cx="50" cy="52" r="38"/></clipPath></defs>' +
    '<circle cx="50" cy="52" r="38" fill="#e9dcc0"/><g clip-path="url(#mh)" stroke="#b8a682" stroke-width="5" fill="none">' +
    '<path d="M5 22 L95 36"/><path d="M5 40 L95 30"/><path d="M5 70 L95 58"/><path d="M5 84 L95 80"/><path d="M5 56 L60 64"/></g>' +
    '<rect x="18" y="40" width="64" height="16" rx="6" fill="#1a0f22"/><circle cx="36" cy="48" r="5" fill="#39ff14"/><circle cx="64" cy="48" r="5" fill="#39ff14"/></svg>';

  function costumeHTML(id) {
    const c = costumeById(id);
    // the zero-width space gives the drawn glyph a text baseline, so it lines up inline like the emoji
    return c.emoji ? `<span class="emoji">${c.emoji}</span>` : `\u200b${MUMMY_SVG}`;
  }
  function costumeEl(id) {
    const s = document.createElement('span');
    s.className = 'costume';
    s.innerHTML = costumeHTML(id);
    return s;
  }
  // Name + costume as safe DOM (names are user input, so never innerHTML).
  function whoEl(who, cls) {
    const s = document.createElement('span');
    s.className = 'who ' + (cls || '');
    if (!who) {
      s.textContent = '👻 the House';
      return s;
    }
    s.appendChild(costumeEl(who.costume));
    const n = document.createElement('b');
    n.textContent = who.name;
    s.appendChild(n);
    return s;
  }

  function drawMummy(ctx, x, y, s) {
    const r = s * 0.42;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = '#e9dcc0';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#b8a682';
    ctx.lineWidth = r * 0.13;
    [
      [-0.75, 0.35],
      [-0.35, -0.55],
      [0.4, 0.15],
      [0.75, 0.6],
    ].forEach(([yy, tilt]) => {
      ctx.beginPath();
      ctx.moveTo(-r, yy * r);
      ctx.lineTo(r, (yy + tilt * 0.3) * r);
      ctx.stroke();
    });
    ctx.restore();
    ctx.fillStyle = '#1a0f22';
    ctx.fillRect(-r * 0.8, -r * 0.3, r * 1.6, r * 0.42);
    ctx.fillStyle = '#39ff14';
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = r * 0.5;
    ctx.beginPath();
    ctx.arc(-r * 0.36, -r * 0.09, r * 0.12, 0, TAU);
    ctx.arc(r * 0.36, -r * 0.09, r * 0.12, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  function drawCostume(ctx, id, x, y, size, glow = true) {
    const c = costumeById(id);
    ctx.save();
    if (glow) {
      ctx.shadowColor = c.glow;
      ctx.shadowBlur = size * 0.6;
    }
    if (c.emoji) {
      ctx.font = `${Math.round(size)}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.emoji, x, y + size * 0.06);
    } else drawMummy(ctx, x, y, size);
    ctx.restore();
  }

  // =====================================================================
  // Items: pumpkin, hammer, soul, door
  // =====================================================================
  function drawPumpkin(ctx, x, y, size, n, o = {}) {
    if (!(size > 1)) return;
    const r = size / 2;
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    const body = o.zombie ? ['#7bff4a', '#2c7a12', '#123d08'] : o.gold ? ['#fff3a0', '#ffb300', '#a35a00'] : ['#ffa040', '#ff5a00', '#8a2500'];
    ctx.shadowColor = o.zombie ? S.COLORS.green : o.gold ? '#ffd84d' : S.COLORS.orange;
    ctx.shadowBlur = o.glow != null ? o.glow : r * 0.8;
    // ribs: overlapping ellipses
    const ribs = [-0.62, -0.32, 0.32, 0.62, 0];
    ribs.forEach((dx) => {
      const g = ctx.createRadialGradient(dx * r - r * 0.2, -r * 0.3, r * 0.1, dx * r, 0, r * 0.9);
      g.addColorStop(0, body[0]);
      g.addColorStop(0.55, body[1]);
      g.addColorStop(1, body[2]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(dx * r, r * 0.05, r * (dx === 0 ? 0.5 : 0.46), r * 0.82, 0, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    // stem
    ctx.fillStyle = o.zombie ? '#3d2a12' : '#2f8a1a';
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.7);
    ctx.quadraticCurveTo(-r * 0.05, -r * 1.05, r * 0.22, -r * 1.12);
    ctx.lineTo(r * 0.16, -r * 0.95);
    ctx.quadraticCurveTo(r * 0.08, -r * 0.85, r * 0.1, -r * 0.7);
    ctx.fill();
    // carved face, lit from inside
    const lit = o.zombie ? '#c6ff5a' : o.gold ? '#ffffff' : '#ffe14d';
    ctx.fillStyle = o.dark ? '#1a0700' : lit;
    ctx.shadowColor = lit;
    ctx.shadowBlur = o.dark ? 0 : r * 0.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.48, -r * 0.08);
    ctx.lineTo(-r * 0.3, -r * 0.42);
    ctx.lineTo(-r * 0.12, -r * 0.08);
    ctx.moveTo(r * 0.48, -r * 0.08);
    ctx.lineTo(r * 0.3, -r * 0.42);
    ctx.lineTo(r * 0.12, -r * 0.08);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, r * 0.18);
    const teeth = 6;
    for (let i = 0; i <= teeth; i++) {
      const tx = -r * 0.55 + (i / teeth) * r * 1.1;
      ctx.lineTo(tx, r * 0.18 + (i % 2 ? r * 0.12 : 0));
    }
    ctx.quadraticCurveTo(0, r * 0.75, -r * 0.55, r * 0.18);
    ctx.fill();
    if (o.zombie) {
      ctx.strokeStyle = '#0c2205';
      ctx.lineWidth = r * 0.05;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(r * 0.1, -r * 0.8);
      ctx.lineTo(r * 0.25, -r * 0.55);
      ctx.lineTo(r * 0.12, -r * 0.45);
      ctx.lineTo(r * 0.3, -r * 0.2);
      ctx.stroke();
    }
    if (n) {
      const bx = r * 0.62;
      const by = -r * 0.62;
      ctx.shadowBlur = r * 0.4;
      ctx.shadowColor = S.COLORS.violet;
      ctx.fillStyle = '#12021f';
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.34, 0, TAU);
      ctx.fill();
      ctx.lineWidth = r * 0.07;
      ctx.strokeStyle = o.zombie ? S.COLORS.green : '#ffe14d';
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(r * 0.46)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), bx, by + r * 0.02);
    }
    ctx.restore();
  }

  function drawHammer(ctx, x, y, size, angle = -0.5, glow = true) {
    if (!(size > 1)) return;
    const s = size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (glow) {
      ctx.shadowColor = S.COLORS.cyan;
      ctx.shadowBlur = s * 0.4;
    }
    // handle (pivot at the grip end)
    const hg = ctx.createLinearGradient(-s * 0.05, 0, s * 0.05, 0);
    hg.addColorStop(0, '#5a2d0c');
    hg.addColorStop(0.5, '#a0612a');
    hg.addColorStop(1, '#4a240a');
    ctx.fillStyle = hg;
    ctx.fillRect(-s * 0.05, -s * 0.85, s * 0.1, s * 0.85);
    ctx.fillStyle = S.COLORS.magenta;
    ctx.fillRect(-s * 0.065, -s * 0.2, s * 0.13, s * 0.2);
    // head
    const g = ctx.createLinearGradient(0, -s, 0, -s * 0.72);
    g.addColorStop(0, '#f2fbff');
    g.addColorStop(0.5, '#8aa3b8');
    g.addColorStop(1, '#3b4b5a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-s * 0.36, -s * 1.02, s * 0.72, s * 0.3, s * 0.05);
    ctx.fill();
    ctx.lineWidth = s * 0.03;
    ctx.strokeStyle = S.COLORS.cyan;
    ctx.stroke();
    ctx.restore();
  }

  function drawSoul(ctx, x, y, size, t, v = 1) {
    if (!(size > 0.5)) return;
    const r = size * (0.5 + 0.08 * Math.sin(t * 5 + x));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const col = v > 1 ? S.COLORS.magenta : S.COLORS.cyan;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.25, hexA(col, 0.8));
    g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, TAU);
    ctx.fill();
    // wisp tail
    ctx.strokeStyle = hexA(col, 0.6);
    ctx.lineWidth = r * 0.35;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.4);
    ctx.quadraticCurveTo(x + Math.sin(t * 4 + y) * r, y + r * 1.4, x - Math.sin(t * 3) * r * 0.6, y + r * 2.2);
    ctx.stroke();
    if (v > 1) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(r * 0.9)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('×' + v, x, y - r * 1.4);
    }
    ctx.restore();
  }

  function drawDoor(ctx, x, y, h, alpha, color, t) {
    const w = h * 0.58;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.shadowColor = color;
    ctx.shadowBlur = h * 0.35 * (0.8 + 0.2 * Math.sin(t * 6));
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, hexA(color, 0.55));
    g.addColorStop(1, hexA(color, 0.15));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, -h / 2 + w / 2);
    ctx.arc(0, -h / 2 + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = h * 0.04;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = h * 0.02;
    ctx.strokeStyle = hexA('#ffffff', 0.35);
    ctx.strokeRect(-w * 0.32, -h * 0.12, w * 0.64, h * 0.22);
    ctx.strokeRect(-w * 0.32, h * 0.16, w * 0.64, h * 0.26);
    ctx.fillStyle = '#ffe14d';
    ctx.shadowColor = '#ffe14d';
    ctx.shadowBlur = h * 0.1;
    ctx.beginPath();
    ctx.arc(w * 0.3, h * 0.12, h * 0.035, 0, TAU);
    ctx.fill();
    // light spilling under the door
    ctx.globalCompositeOperation = 'lighter';
    const sp = ctx.createRadialGradient(0, h / 2, 0, 0, h / 2, w);
    sp.addColorStop(0, hexA(color, 0.5));
    sp.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = sp;
    ctx.fillRect(-w, h / 2 - w * 0.3, w * 2, w * 0.6);
    ctx.restore();
  }

  // =====================================================================
  // Ghosts: five originals, drawn in code. (x, y) is the ghost's centre.
  // =====================================================================
  function sheet(ctx, w, h, t, waves = 4, amp = 0.06) {
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.arc(0, -h / 2 + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(w / 2, h / 2);
    for (let i = waves * 2; i >= 0; i--) {
      const px = -w / 2 + (i / (waves * 2)) * w;
      const py = h / 2 - (i % 2 ? h * 0.1 : 0) + Math.sin(t * 6 + i) * h * amp;
      ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function eye(ctx, x, y, r, color, hollow) {
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.75, r, 0, 0, TAU);
    ctx.fillStyle = '#05010a';
    ctx.fill();
    if (hollow) {
      ctx.lineWidth = r * 0.25;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  function drawGhost(ctx, gi, x, y, size, t, alpha = 1) {
    if (!(size > 1)) return;
    const G = S.GHOSTS[gi];
    const c = G.color;
    const s = size;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = c;
    ctx.shadowBlur = s * 0.35;
    const body = ctx.createLinearGradient(0, -s / 2, 0, s / 2);
    body.addColorStop(0, hexA(c, 0.75));
    body.addColorStop(0.7, hexA(c, 0.35));
    body.addColorStop(1, hexA(c, 0.02));
    ctx.fillStyle = body;
    ctx.strokeStyle = hexA(c, 0.9);
    ctx.lineWidth = s * 0.02;

    if (G.id === 'butler') {
      sheet(ctx, s * 0.56, s, t, 4);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      eye(ctx, -s * 0.1, -s * 0.24, s * 0.07, c, true);
      eye(ctx, s * 0.1, -s * 0.24, s * 0.07, c, true);
      // thin pursed mouth
      ctx.strokeStyle = '#05010a';
      ctx.lineWidth = s * 0.02;
      ctx.beginPath();
      ctx.moveTo(-s * 0.06, -s * 0.09);
      ctx.lineTo(s * 0.06, -s * 0.09);
      ctx.stroke();
      // bow tie
      ctx.fillStyle = S.COLORS.magenta;
      ctx.shadowColor = S.COLORS.magenta;
      ctx.shadowBlur = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.02);
      ctx.lineTo(-s * 0.12, -s * 0.04);
      ctx.lineTo(-s * 0.12, s * 0.08);
      ctx.closePath();
      ctx.moveTo(0, s * 0.02);
      ctx.lineTo(s * 0.12, -s * 0.04);
      ctx.lineTo(s * 0.12, s * 0.08);
      ctx.closePath();
      ctx.fill();
      // white-gloved arm holding a tray
      ctx.strokeStyle = hexA(c, 0.8);
      ctx.lineWidth = s * 0.03;
      ctx.beginPath();
      ctx.moveTo(s * 0.26, s * 0.08);
      ctx.quadraticCurveTo(s * 0.42, s * 0.05, s * 0.44, -s * 0.06);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s * 0.44, -s * 0.08, s * 0.16, s * 0.03, 0, 0, TAU);
      ctx.stroke();
    } else if (G.id === 'ragdoll') {
      const jerk = Math.sin(t * 17) > 0.8 ? 0.15 : 0;
      ctx.rotate(Math.sin(t * 2.3) * 0.12 + jerk);
      sheet(ctx, s * 0.62, s * 0.78, t * 1.6, 3, 0.09);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      // yarn hair
      ctx.strokeStyle = '#ff7a3d';
      ctx.lineWidth = s * 0.025;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s * 0.05, -s * 0.37);
        ctx.quadraticCurveTo(i * s * 0.09, -s * 0.5, i * s * 0.12 + Math.sin(t * 4 + i) * s * 0.04, -s * 0.52);
        ctx.stroke();
      }
      // X button eyes
      ctx.strokeStyle = '#05010a';
      ctx.lineWidth = s * 0.03;
      [-1, 1].forEach((d) => {
        const ex = d * s * 0.11;
        const ey = -s * 0.17;
        ctx.beginPath();
        ctx.moveTo(ex - s * 0.05, ey - s * 0.05);
        ctx.lineTo(ex + s * 0.05, ey + s * 0.05);
        ctx.moveTo(ex + s * 0.05, ey - s * 0.05);
        ctx.lineTo(ex - s * 0.05, ey + s * 0.05);
        ctx.stroke();
      });
      // stitched grin
      ctx.lineWidth = s * 0.018;
      ctx.beginPath();
      ctx.moveTo(-s * 0.13, -s * 0.03);
      ctx.quadraticCurveTo(0, s * 0.05, s * 0.13, -s * 0.03);
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s * 0.05, -s * 0.03);
        ctx.lineTo(i * s * 0.05, s * 0.03);
        ctx.stroke();
      }
    } else if (G.id === 'warden') {
      // skull
      ctx.beginPath();
      ctx.arc(0, -s * 0.18, s * 0.24, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(s * 0.13, s * 0.06);
      ctx.lineTo(-s * 0.13, s * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // ribcage wisps
      for (let i = 0; i < 4; i++) {
        const yy = s * (0.13 + i * 0.08);
        const ww = s * (0.2 - i * 0.03);
        ctx.globalAlpha = alpha * (0.9 - i * 0.18);
        ctx.beginPath();
        ctx.ellipse(0, yy, ww, s * 0.025, 0, Math.PI, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.08);
      ctx.lineTo(0, s * 0.42);
      ctx.stroke();
      ctx.shadowBlur = 0;
      eye(ctx, -s * 0.09, -s * 0.18, s * 0.07, c, false);
      eye(ctx, s * 0.09, -s * 0.18, s * 0.07, c, false);
      ctx.fillStyle = S.COLORS.cyan;
      ctx.shadowColor = S.COLORS.cyan;
      ctx.shadowBlur = s * 0.1;
      ctx.beginPath();
      ctx.arc(-s * 0.09, -s * 0.17, s * 0.022, 0, TAU);
      ctx.arc(s * 0.09, -s * 0.17, s * 0.022, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#05010a';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.09);
      ctx.lineTo(-s * 0.03, -s * 0.04);
      ctx.lineTo(s * 0.03, -s * 0.04);
      ctx.fill();
      ctx.strokeStyle = '#05010a';
      ctx.lineWidth = s * 0.012;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s * 0.035, -s * 0.01);
        ctx.lineTo(i * s * 0.035, s * 0.05);
        ctx.stroke();
      }
      // swinging lantern on a chain
      ctx.save();
      ctx.translate(s * 0.32, s * 0.02);
      ctx.rotate(Math.sin(t * 2.2) * 0.25);
      ctx.strokeStyle = hexA(c, 0.8);
      ctx.lineWidth = s * 0.01;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, s * 0.1);
      ctx.stroke();
      ctx.fillStyle = '#ffe14d';
      ctx.shadowColor = '#ffb300';
      ctx.shadowBlur = s * 0.18;
      ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(t * 9));
      ctx.beginPath();
      ctx.ellipse(0, s * 0.15, s * 0.035, s * 0.05, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else if (G.id === 'bride') {
      // trailing veil
      ctx.save();
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, -s * 0.38);
      ctx.quadraticCurveTo(-s * 0.55, s * 0.1 + Math.sin(t * 2) * s * 0.05, -s * 0.42 + Math.sin(t * 3) * s * 0.06, s * 0.55);
      ctx.lineTo(s * 0.42 + Math.sin(t * 3 + 1) * s * 0.06, s * 0.55);
      ctx.quadraticCurveTo(s * 0.55, s * 0.1, s * 0.18, -s * 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      sheet(ctx, s * 0.42, s * 0.95, t * 0.7, 5, 0.04);
      ctx.fill();
      ctx.stroke();
      // long dripping hair
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hexA('#0c3a2c', 0.9);
      ctx.lineWidth = s * 0.03;
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1;
        const k = i % 3;
        ctx.beginPath();
        ctx.moveTo(side * s * (0.06 + k * 0.045), -s * 0.42);
        ctx.quadraticCurveTo(side * s * (0.2 + k * 0.03), -s * 0.1, side * s * (0.16 + k * 0.04), s * (0.15 + k * 0.08) + Math.sin(t * 2 + i) * s * 0.02);
        ctx.stroke();
      }
      eye(ctx, -s * 0.07, -s * 0.2, s * 0.05, c, false);
      eye(ctx, s * 0.07, -s * 0.2, s * 0.05, c, false);
      // tears
      ctx.strokeStyle = hexA(S.COLORS.cyan, 0.9);
      ctx.lineWidth = s * 0.012;
      ctx.beginPath();
      ctx.moveTo(-s * 0.07, -s * 0.15);
      ctx.lineTo(-s * 0.075, -s * 0.03 + (t % 1) * s * 0.05);
      ctx.moveTo(s * 0.07, -s * 0.15);
      ctx.lineTo(s * 0.075, -s * 0.05 + ((t + 0.5) % 1) * s * 0.05);
      ctx.stroke();
      ctx.fillStyle = '#05010a';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.06, s * 0.025, s * 0.04, 0, 0, TAU);
      ctx.fill();
    } else {
      // choir shade: hooded robe, singing mouth, music notes
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.52);
      ctx.quadraticCurveTo(s * 0.3, -s * 0.4, s * 0.3, -s * 0.05);
      ctx.lineTo(s * 0.36, s * 0.5);
      for (let i = 6; i >= 0; i--) ctx.lineTo(-s * 0.36 + (i / 6) * s * 0.72, s * 0.5 - (i % 2 ? s * 0.06 : 0) + Math.sin(t * 5 + i) * s * 0.02);
      ctx.lineTo(-s * 0.3, -s * 0.05);
      ctx.quadraticCurveTo(-s * 0.3, -s * 0.4, 0, -s * 0.52);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#05010a';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.18, s * 0.17, s * 0.21, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffe14d';
      ctx.shadowColor = '#ffe14d';
      ctx.shadowBlur = s * 0.08;
      ctx.beginPath();
      ctx.ellipse(-s * 0.06, -s * 0.24, s * 0.03, s * 0.015, 0.2, 0, TAU);
      ctx.ellipse(s * 0.06, -s * 0.24, s * 0.03, s * 0.015, -0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = hexA(c, 0.95);
      ctx.lineWidth = s * 0.02;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.09, s * 0.045, s * (0.05 + 0.02 * Math.sin(t * 7)), 0, 0, TAU);
      ctx.stroke();
      // notes
      ctx.fillStyle = hexA(c, 0.9);
      ctx.font = `${Math.round(s * 0.16)}px serif`;
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.5 + i / 3) % 1;
        ctx.globalAlpha = alpha * (1 - k);
        ctx.fillText(i % 2 ? '♪' : '♫', s * (0.25 + k * 0.25), -s * (0.2 + k * 0.4));
      }
    }
    ctx.restore();
  }

  // =====================================================================
  // Stage: the smash + result showpiece, shared by host and players
  // =====================================================================
  class Stage {
    constructor(particles, shaker) {
      this.p = particles;
      this.sh = shaker;
      this.mode = null;
      this.t0 = 0;
      this.flags = {};
      this.mild = false;
      this.scale = 1;
      this.cy = 0.56;
      this.resultPumpkins = true;
    }
    clear() {
      this.mode = null;
      this.flags = {};
    }
    smash(info, elapsedMs) {
      if (this.mode === 'smash') return;
      this.mode = 'smash';
      this.info = info;
      this.t0 = performance.now() - (elapsedMs || 0);
      this.flags = {};
    }
    result(res) {
      if (this.mode === 'result') return;
      this.mode = 'result';
      this.res = res;
      this.t0 = performance.now();
      this.flags = {};
    }
    once(key, fn) {
      if (!this.flags[key]) {
        this.flags[key] = true;
        fn();
      }
    }
    render(ctx, W, H, dt) {
      if (!this.mode) return;
      const t = (performance.now() - this.t0) / 1000;
      const cx = W / 2;
      const cy = H * this.cy;
      const size = Math.min(W, H) * 0.34 * this.scale;
      if (this.mode === 'smash') {
        const HIT = 4.8;
        if (t < 1.8) this.once('in', () => Sound.stinger());
        if (t >= 1.8 && t < 4.6) this.once('roll', () => Sound.drumroll(Math.max(0.5, HIT - t)));
        if (t < HIT) {
          const k = clamp((t - 1.8) / 3, 0, 1);
          const shake = k * k * size * 0.05;
          const pulse = 1 + Math.sin(t * (6 + k * 20)) * 0.02 * (1 + k * 3);
          drawPumpkin(ctx, cx + rand(-shake, shake), cy + rand(-shake, shake), size * pulse * Math.min(1, t * 2), this.info.target, {
            glow: size * (0.3 + k * 0.8),
          });
          // pivot sits low-right of the pumpkin; positive angles lift the head away from it
          const ang = t < 1.8 ? lerp(-0.2, 0.45, clamp(t / 1.2, 0, 1)) : lerp(0.45, 0.95, k);
          drawHammer(ctx, cx + size * 1.1, cy + size * 0.5, size * 1.25, ang);
          if (this.mild) return;
          if (k > 0.5) this.sh.add(k * 1.2);
        } else {
          this.once('hit', () => {
            Sound.boom();
            this.sh.add(this.mild ? 14 : 55);
            const cols = [S.COLORS.orange, '#ffa040', '#ffe14d', '#8a2500'];
            this.p.emit(cx, cy, { count: 140, color: cols, speed: size * 4, life: 2.2, size: size * 0.06, gravity: size * 2.2, shape: 'chunk', drag: 0.97 });
            this.p.emit(cx, cy, { count: 220, color: NEON, speed: size * 6, life: 1.6, size: 4, shape: 'spark', drag: 0.95 });
            this.p.emit(cx, cy, { count: 120, color: ['#ffe14d', '#fff3a0'], speed: size * 3, life: 2.4, size: 3, gravity: size * 1.5 });
            this.p.emit(cx, cy, { count: 6, color: [S.COLORS.magenta, S.COLORS.cyan, S.COLORS.violet], speed: 1, life: 1.2, size: size * 0.1, shape: 'ring' });
            this.flashT = performance.now();
          });
          const ft = (performance.now() - (this.flashT || 0)) / 1000;
          if (ft < 0.5) {
            ctx.save();
            ctx.globalAlpha = (1 - ft / 0.5) * (this.mild ? 0.3 : 0.9);
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
          }
          drawHammer(ctx, cx + size * 1.1, cy + size * 0.5, size * 1.25, Math.max(-1.12, 0.95 - (t - HIT) * 25));
        }
      } else if (this.mode === 'result') {
        const r = this.res;
        if (r.win) {
          this.once('fan', () => Sound.fanfare());
          // colour storm
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const hue = (t * (this.mild ? 30 : 160)) % 360;
          for (let i = 0; i < 3; i++) {
            const gx = cx + Math.cos(t * (1 + i * 0.7) + i * 2) * W * 0.35;
            const gy = H / 2 + Math.sin(t * (1.3 + i * 0.4) + i) * H * 0.3;
            const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.5);
            g.addColorStop(0, `hsla(${(hue + i * 120) % 360},100%,55%,${this.mild ? 0.18 : 0.35})`);
            g.addColorStop(1, 'hsla(0,0%,0%,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
          }
          ctx.restore();
          if (t < 9) {
            const rate = this.mild ? 4 : 14;
            for (let i = 0; i < rate; i++) {
              this.p.emit(rand(0, W), -20, { count: 1, color: NEON.concat(['#ffffff']), speed: 120, angle: Math.PI / 2, spread: 0.6, life: 4, size: rand(5, 10), gravity: 180, shape: 'confetti', drag: 0.99 });
            }
            if (Math.random() < (this.mild ? 0.02 : 0.08)) {
              const bx = rand(W * 0.1, W * 0.9);
              const by = rand(H * 0.1, H * 0.6);
              this.p.emit(bx, by, { count: 80, color: NEON, speed: 500, life: 1.6, size: 7, gravity: 260, shape: 'confetti', drag: 0.96 });
              this.p.emit(bx, by, { count: 40, color: NEON, speed: 400, life: 1, size: 3, shape: 'spark' });
            }
          }
          const bob = Math.sin(t * 3) * size * 0.04;
          if (this.resultPumpkins) drawPumpkin(ctx, cx, cy + bob, size * Math.min(1, t * 1.5) * 0.9, r.smashed, { gold: true, glow: size });
        } else {
          this.once('z', () => {
            Sound.zombie();
            this.sh.add(this.mild ? 4 : 18);
          });
          const glitching = t < 1.6;
          if (glitching && !this.mild && Math.random() < 0.5) {
            ctx.save();
            ctx.globalAlpha = rand(0.15, 0.45);
            ctx.fillStyle = S.COLORS.red;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
          }
          ctx.save();
          ctx.fillStyle = hexA(S.COLORS.red, this.mild ? 0.08 : 0.12 + 0.05 * Math.sin(t * 8));
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
          const reveal = t > 3;
          const zx = reveal ? lerp(cx, W * 0.3, clamp((t - 3) * 2, 0, 1)) : cx;
          const jitter = glitching && !this.mild ? rand(-12, 12) : 0;
          if (this.resultPumpkins) drawPumpkin(ctx, zx + jitter, cy, size * 0.85, r.smashed, { zombie: true });
          if (glitching && !this.mild) {
            // RGB split slices
            const k = ctx.canvas.height / H;
            for (let i = 0; i < 6; i++) {
              const sy = rand(0, H - 40);
              const sh = rand(4, 40);
              ctx.drawImage(ctx.canvas, 0, sy * k, ctx.canvas.width, sh * k, rand(-40, 40), sy, W, sh);
            }
          }
          if (reveal && this.resultPumpkins) {
            const k = clamp((t - 3) * 1.5, 0, 1);
            this.once('rev', () => {
              Sound.chime();
              this.p.emit(W * 0.7, cy, { count: 90, color: ['#ffe14d', '#fff3a0', S.COLORS.orange], speed: size * 3, life: 1.6, size: 4, shape: 'spark' });
            });
            ctx.save();
            ctx.globalAlpha = k;
            drawPumpkin(ctx, W * 0.7, cy + Math.sin(t * 2.5) * size * 0.03, size * 0.85 * k, r.winning, { gold: true, glow: size * 0.9 });
            ctx.restore();
          }
        }
      }
    }
  }

  // Ambient floating embers for menu screens.
  function ambientEmbers(particles, W, H, density = 1) {
    if (Math.random() < 0.35 * density) {
      particles.emit(rand(0, W), H + 10, {
        count: 1,
        color: [S.COLORS.orange, S.COLORS.violet, S.COLORS.magenta, S.COLORS.cyan],
        speed: 60,
        speedMin: 25,
        angle: -Math.PI / 2,
        spread: 0.5,
        life: 7,
        size: rand(1.5, 3.5),
        drag: 1,
      });
    }
  }

  function fmtTime(ms) {
    if (ms == null) return '∞';
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // Fit a canvas to its CSS size with a capped device pixel ratio.
  function fitCanvas(canvas, maxDpr = 1.75) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    return { W, H, dpr };
  }

  function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
    }
  }

  window.PS = {
    S,
    TAU,
    NEON,
    rand,
    pick,
    clamp,
    lerp,
    hexA,
    store,
    Sound,
    Particles,
    Shaker,
    Stage,
    costumeById,
    costumeHTML,
    costumeEl,
    whoEl,
    drawCostume,
    drawPumpkin,
    drawHammer,
    drawSoul,
    drawDoor,
    drawGhost,
    ambientEmbers,
    fmtTime,
    fitCanvas,
    toggleFullscreen,
  };
})();
