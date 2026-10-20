// Host screen: a broadcast for the shared screen on the call. One hero per view.
/* global io, PS */
(function () {
  const { S, T, Sound, Particles, Shaker, Stage, clamp, ease, hexA, flicker, TAU } = PS;
  const $ = (id) => document.getElementById(id);
  const key = new URLSearchParams(location.search).get('key') || '';
  const socket = io({ auth: { role: 'host', key }, transports: ['websocket', 'polling'] });
  const stageCv = $('stage');
  const sctx = stageCv.getContext('2d');
  const main = $('main');
  const root = $('root');
  const particles = new Particles(2000);
  const shaker = new Shaker();
  const stage = new Stage(particles, shaker);
  stage.cy = 0.5;
  stage.scale = 0.78;
  const mild = new URLSearchParams(location.search).get('mild') === '1';
  Sound.mild = mild;
  stage.mild = mild;

  let state = null;
  let viewKey = '';
  let lastFeedId = 0;
  let timerBase = { remaining: null, at: 0, paused: false };
  let painters = []; // per-view canvas painters, run every frame
  let W = 0;
  let H = 0;
  const windows = new Map(); // player name -> {i, t}
  const slotFx = new Array(S.NUM_PUMPKINS).fill(null).map(() => ({ holder: null, t: 0 }));

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const remaining = () => {
    if (timerBase.remaining == null) return null;
    if (timerBase.paused) return timerBase.remaining;
    return Math.max(0, timerBase.remaining - (performance.now() - timerBase.at));
  };
  const send = (ev) => {
    Sound.unlock();
    socket.emit(ev);
  };
  const owner = (who) => (who ? `${who.name}’s` : 'the House’s');
  function canvasIn(parent) {
    const cv = el('canvas');
    parent.appendChild(cv);
    return cv;
  }
  function paint(cv, fn) {
    painters.push({ cv, fn });
  }

  socket.on('denied', () => {
    main.innerHTML = '<div class="hcenter"><p class="denied">The house does not know that key.</p></div>';
  });
  socket.on('hstate', (s) => {
    const prev = state;
    state = s;
    timerBase = { remaining: s.remaining, at: performance.now(), paused: s.paused };
    if (prev && prev.gameId !== s.gameId) {
      lastFeedId = 0;
      stage.clear();
      slotFx.forEach((f) => (f.holder = null));
    }
    handleFeed(s.feed, !prev);
    if (prev && prev.phase === 'LOBBY' && s.phase === 'RULES') Sound.laugh();
    renderControls();
    render();
  });

  // ---------------- controls: quiet text, bottom right ----------------
  function renderControls() {
    const c = $('h-ctrl');
    const ph = state.phase;
    const sig = ph + state.paused + Sound.isMuted();
    if (c.dataset.sig === sig) return;
    c.dataset.sig = sig;
    c.innerHTML = '';
    const add = (label, fn, cls = 'textbtn') => {
      const b = el('button', cls, label);
      b.onclick = fn;
      c.appendChild(b);
    };
    if (ph === 'LOBBY') add('Open the house', () => send('host:start'), 'cta');
    if (['RULES', 'HUNT', 'PITCHES', 'VOTE'].includes(ph)) add(state.paused ? 'Resume' : 'Pause', () => send('host:pause'));
    if (ph === 'HUNT') add('Skip act', () => send('host:skip'));
    if (['RULES', 'PITCHES'].includes(ph)) add('Next', () => send('host:next'));
    if (ph === 'VOTE') add('Close the vote', () => send('host:next'));
    if (ph !== 'LOBBY')
      add('Reset', () => {
        if (ph === 'RESULT' || confirm('Reset the game? Everyone goes back to the lobby.')) send('host:reset');
      });
    add(Sound.isMuted() ? 'Sound off' : 'Sound on', () => {
      Sound.unlock();
      Sound.toggleMute();
      c.dataset.sig = '';
      renderControls();
    });
    add('Full screen', () => PS.toggleFullscreen());
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'f') PS.toggleFullscreen();
    if (e.key === 'm') {
      Sound.toggleMute();
      $('h-ctrl').dataset.sig = '';
      renderControls();
    }
    if (e.key === ' ' && state && ['RULES', 'HUNT', 'PITCHES', 'VOTE'].includes(state.phase)) {
      e.preventDefault();
      send('host:pause');
    }
    if (e.key === 'ArrowRight' && state && state.phase !== 'HUNT') send('host:next');
  });

  // ---------------- sound for the room on the call ----------------
  function handleFeed(feed, initial) {
    for (const f of feed) {
      if (f.id <= lastFeedId) continue;
      lastFeedId = f.id;
      if (initial) continue;
      if (f.kind === 'pumpkin' || f.kind === 'hammer') Sound.claim();
      else if (f.kind === 'death') Sound.whisper(0);
      else if (f.kind === 'event' || f.kind === 'act') Sound.sting();
      else if (f.kind === 'spawn') Sound.spawnBell();
    }
  }

  // ---------------- views ----------------
  function render() {
    const ph = state.phase;
    const k = ph === 'PITCHES' ? 'P' + state.pitchIndex : ph;
    if (k !== viewKey) {
      viewKey = k;
      main.innerHTML = '';
      painters = [];
      build[ph]();
    }
    if (update[ph]) update[ph]();
  }

  const build = {
    LOBBY() {
      const v = el('div', 'hview');
      main.appendChild(v);
      const wrap = el('div', 'house-wrap');
      v.appendChild(wrap);
      paint(canvasIn(wrap), drawHouse);
      const title = el('div', 'htitle display', S.TITLE);
      const sub = el('div', 'hphase', 'One of six pumpkins holds a Friday afternoon off.');
      const url = location.origin + '/';
      const inv = el('div', 'invite');
      inv.innerHTML = `<img alt="QR code to join" /><div class="display">Come in.</div><div class="url"></div>`;
      inv.querySelector('img').src = '/qr.svg?u=' + encodeURIComponent(url);
      inv.querySelector('.url').textContent = location.host;
      const count = el('div', 'count-line');
      count.id = 'l-count';
      v.append(title, sub, inv, count);
    },
    RULES() {
      main.innerHTML = `<div class="hcenter rules-x">
        <p class="display">Find pumpkins.</p><p class="display">Find the hammer.</p><p class="display">Collect souls.</p><p class="display">Avoid ghosts.</p>
        <p class="quiet">Six pumpkins. One holds Friday afternoon off. Every soul is one more vote.</p></div>`;
    },
    HUNT() {
      const v = el('div', 'hview');
      main.appendChild(v);
      const mantel = el('div', 'mantel');
      paint(canvasIn(mantel), drawMantel);
      const candle = el('div', 'candle');
      paint(canvasIn(candle), drawCandle);
      const num = el('div', 'num');
      num.id = 'h-timer';
      candle.appendChild(num);
      const actLabel = el('div', 'candle-label');
      actLabel.id = 'h-act';
      const seance = el('div', 'seance');
      seance.id = 'seance';
      const plan = el('div', 'plan');
      paint(canvasIn(plan), drawPlan);
      const leaders = el('div', 'leaders');
      leaders.id = 'leaders';
      v.append(mantel, candle, actLabel, seance, plan, leaders);
    },
    PITCHES() {
      const pk = state.pumpkins[state.pitchIndex];
      const v = el('div', 'hcenter pitch-x');
      main.appendChild(v);
      const cv = canvasIn(v);
      paint(cv, (c, w, h, t) => PS.drawPumpkin(c, w / 2, h * 0.52, w * 0.42, pk.n, { lit: 1, t }));
      v.appendChild(PS.whoEl(pk.holder));
      v.appendChild(el('div', 'quiet', `Pumpkin ${pk.n} · pitch ${state.pitchIndex + 1} of ${S.NUM_PUMPKINS}`));
      const bar = el('div', 'burn');
      bar.id = 'p-bar';
      bar.style.width = 'min(560px, 60vw)';
      bar.style.maxWidth = 'none';
      v.appendChild(bar);
      Sound.spawnBell();
    },
    VOTE() {
      const v = el('div', 'vote-x');
      main.appendChild(v);
      const vc = canvasIn(v);
      vc.className = 'fill';
      paint(vc, drawVote);
      const head = el('div', 'vote-head');
      head.innerHTML = `<div class="display">Which one do we smash?</div><div class="quiet" id="v-voted"></div>`;
      const timer = el('div', 'candle');
      timer.style.top = '6vh';
      paint(canvasIn(timer), drawCandle);
      const num = el('div', 'num');
      num.id = 'h-timer';
      timer.appendChild(num);
      v.append(head, timer);
    },
    SMASH() {
      const sm = state.smash;
      const v = el('div', 'hview');
      main.appendChild(v);
      const line = el('div', 'smash-x display');
      const span = el('span', 'typed', `${PS.NameOf(sm.hammer)} swings at Pumpkin ${sm.target}.`);
      line.appendChild(span);
      const after = el('div', 'after', `Pumpkin ${sm.target} was ${owner(sm.holder)}.`);
      after.hidden = true;
      v.append(line, after);
      setTimeout(() => (after.hidden = false), Math.max(0, 5400 - state.elapsed));
      stage.smash(sm, state.elapsed);
    },
    RESULT() {
      const r = state.result;
      stage.result(r);
      const v = el('div', 'result-x');
      main.appendChild(v);
      v.appendChild(el('h1', `result-title display ${r.win ? 'win' : 'lose'}`, r.win ? 'Friday afternoon off.' : 'Zombie pumpkin.'));
      const line = (text, delay) => {
        const p = el('p', 'result-line', text);
        p.style.animationDelay = delay + 's';
        v.appendChild(p);
      };
      line(r.win ? `Pumpkin ${r.smashed} was ${owner(r.smashedHolder)}. It held the prize.` : `Pumpkin ${r.smashed} was ${owner(r.smashedHolder)}. Hollow.`, 1);
      if (!r.win) line(`The prize was in Pumpkin ${r.winning}. ${PS.NameOf(r.winningHolder)} had it all along.`, 3.4);
      const cr = el('div', 'credits');
      const add = (label, a, unit, i) => {
        const d = el('div', 'credit');
        d.style.animationDelay = 4.6 + i * 0.6 + 's';
        d.appendChild(el('div', 'label', label + (a && a.value != null ? ` · ${a.value} ${unit}` : '')));
        const n = el('div', 'names');
        if (a) a.who.forEach((w) => n.appendChild(PS.whoEl(w)));
        else n.textContent = 'Nobody';
        d.appendChild(n);
        cr.appendChild(d);
      };
      add('Most souls', r.awards.souls, 'souls', 0);
      add('Most haunted', r.awards.haunted, 'deaths', 1);
      add('Hammer hero', r.awards.hammer, '', 2);
      const snd = el('div', 'credit fine');
      snd.style.animationDelay = 4.6 + 3 * 0.6 + 's';
      snd.appendChild(el('div', 'label', 'Sounds'));
      snd.appendChild(el('div', 'names', S.SOUND_CREDITS.join(', ')));
      cr.appendChild(snd);
      v.appendChild(cr);
    },
  };

  const update = {
    LOBBY() {
      const live = state.players.filter((p) => p.connected);
      const names = new Set(live.map((p) => p.name));
      for (const n of [...windows.keys()]) if (!names.has(n)) windows.delete(n);
      const used = new Set([...windows.values()].map((w) => w.i));
      for (const p of live) {
        if (windows.has(p.name)) continue;
        let i = 0;
        while (used.has(i)) i++;
        used.add(i);
        windows.set(p.name, { i, t: performance.now(), costume: p.costume });
        Sound.blip();
      }
      const n = live.length;
      $('l-count').innerHTML = '';
      $('l-count').append(el('span', 'num', String(n)), 'inside.');
    },
    HUNT() {
      const act = S.ACTS[state.act];
      $('h-act').textContent = act ? `Act ${act.ordinal}. ${act.name}.` : '';
      // the séance log: newest line large and lit, older lines shrink into the dark
      const box = $('seance');
      const lines = state.feed.slice(-5).reverse();
      const sig = lines.map((f) => f.id).join(',');
      if (box.dataset.sig !== sig) {
        box.dataset.sig = sig;
        box.innerHTML = '';
        lines.forEach((f, i) => box.appendChild(el('p', 'l' + i, f.text)));
      }
      const lb = $('leaders');
      const top = state.leaderboard.slice(0, 3);
      const lsig = top.map((p) => p.name + p.souls).join('|');
      if (lb.dataset.sig !== lsig) {
        lb.dataset.sig = lsig;
        lb.innerHTML = '';
        if (!top.length) lb.appendChild(el('div', '', 'No souls gathered yet.'));
        top.forEach((p) => {
          const d = el('div');
          d.append(el('b', '', p.name), el('span', 'num', String(p.souls)), ' souls');
          lb.appendChild(d);
        });
      }
    },
    VOTE() {
      const voted = state.players.filter((p) => p.voted).length;
      $('v-voted').textContent = `Vote on your phone. Souls count. ${voted} of ${state.players.length} have voted.`;
    },
  };

  // ---------------- painters ----------------
  function houseGeom(w, h) {
    const base = h * 0.93;
    const m = { x0: w * 0.36, x1: w * 0.81, top: h * 0.38, apex: h * 0.15 };
    const tw = { x0: w * 0.235, x1: w * 0.36, top: h * 0.3, apex: h * 0.1 };
    const wins = [];
    const cols = 7;
    const rows = 4;
    const cw = (m.x1 - m.x0) / cols;
    const rh = (base - h * 0.1 - m.top) / rows;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (r === rows - 1 && c === 3) continue; // the front door
        wins.push({ x: m.x0 + cw * (c + 0.5), y: m.top + rh * (r + 0.42), w: cw * 0.44, h: rh * 0.5 });
      }
    const tcw = (tw.x1 - tw.x0) / 2;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) wins.push({ x: tw.x0 + tcw * (c + 0.5), y: tw.top + rh * 0.35 + r * rh * 0.92, w: tcw * 0.42, h: rh * 0.48 });
    wins.push({ x: (m.x0 + m.x1) / 2 - cw * 0.6, y: m.top - rh * 0.55, w: cw * 0.34, h: rh * 0.42 });
    wins.push({ x: (m.x0 + m.x1) / 2 + cw * 0.6, y: m.top - rh * 0.55, w: cw * 0.34, h: rh * 0.42 });
    return { base, m, tw, wins, cw, rh };
  }
  function drawHouse(c, w, h, t) {
    const g = houseGeom(w, h);
    const { m, tw, base } = g;
    c.clearRect(0, 0, w, h);
    // the facade: a soot silhouette with bone hairlines where the roof meets the sky
    c.fillStyle = T.soot;
    c.beginPath();
    c.moveTo(m.x0 - g.cw * 0.25, m.top);
    c.lineTo((m.x0 + m.x1) / 2, m.apex);
    c.lineTo(m.x1 + g.cw * 0.25, m.top);
    c.lineTo(m.x1, m.top);
    c.lineTo(m.x1, base);
    c.lineTo(m.x0, base);
    c.closePath();
    c.fill();
    c.fillRect(m.x1 - g.cw * 1.4, m.apex + (m.top - m.apex) * 0.2, g.cw * 0.4, (m.top - m.apex) * 0.6);
    c.beginPath();
    c.moveTo(tw.x0 - g.cw * 0.12, tw.top);
    c.lineTo((tw.x0 + tw.x1) / 2, tw.apex);
    c.lineTo(tw.x1 + g.cw * 0.12, tw.top);
    c.lineTo(tw.x1, tw.top);
    c.lineTo(tw.x1, base);
    c.lineTo(tw.x0, base);
    c.lineTo(tw.x0, tw.top);
    c.closePath();
    c.fill();
    c.strokeStyle = hexA(T.bone, 0.18);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(m.x0 - g.cw * 0.25, m.top);
    c.lineTo((m.x0 + m.x1) / 2, m.apex);
    c.lineTo(m.x1 + g.cw * 0.25, m.top);
    c.moveTo(tw.x0 - g.cw * 0.12, tw.top);
    c.lineTo((tw.x0 + tw.x1) / 2, tw.apex);
    c.lineTo(tw.x1 + g.cw * 0.12, tw.top);
    c.moveTo(w * 0.05, base);
    c.lineTo(w * 0.95, base);
    c.stroke();
    // string courses between floors, a cornice under the eaves, the tower's finial
    c.strokeStyle = hexA(T.bone, 0.07);
    c.beginPath();
    for (let r = 1; r < 4; r++) {
      const y = m.top + g.rh * r - g.rh * 0.06;
      c.moveTo(m.x0, y);
      c.lineTo(m.x1, y);
      c.moveTo(tw.x0, y + g.rh * 0.3);
      c.lineTo(tw.x1, y + g.rh * 0.3);
    }
    c.moveTo(m.x0 - g.cw * 0.1, m.top + 6);
    c.lineTo(m.x1 + g.cw * 0.1, m.top + 6);
    c.stroke();
    c.fillStyle = T.soot;
    const fx0 = (tw.x0 + tw.x1) / 2;
    c.fillRect(fx0 - 1.5, tw.apex - h * 0.05, 3, h * 0.05);
    c.beginPath();
    c.arc(fx0, tw.apex - h * 0.05, 4, 0, TAU);
    c.fill();
    // front door under a porch roof, with steps
    const dx = (m.x0 + m.x1) / 2;
    c.fillStyle = T.ink;
    c.fillRect(dx - g.cw * 0.26, base - g.rh * 0.78, g.cw * 0.52, g.rh * 0.78);
    c.fillStyle = T.soot;
    c.beginPath();
    c.moveTo(dx - g.cw * 0.8, base - g.rh * 0.86);
    c.lineTo(dx, base - g.rh * 1.18);
    c.lineTo(dx + g.cw * 0.8, base - g.rh * 0.86);
    c.closePath();
    c.fill();
    c.fillRect(dx - g.cw * 0.72, base - g.rh * 0.86, g.cw * 0.06, g.rh * 0.86);
    c.fillRect(dx + g.cw * 0.66, base - g.rh * 0.86, g.cw * 0.06, g.rh * 0.86);
    for (let i = 0; i < 3; i++) c.fillRect(dx - g.cw * (0.5 + i * 0.1), base - g.rh * 0.06 * (3 - i), g.cw * (1 + i * 0.2), g.rh * 0.06);
    // windows: dark until somebody arrives
    const byIndex = new Map();
    for (const [name, wd] of windows) byIndex.set(wd.i, { name, ...wd });
    g.wins.forEach((win, i) => {
      const p = byIndex.get(i);
      const x = win.x - win.w / 2;
      const y = win.y - win.h / 2;
      if (!p) {
        c.fillStyle = T.ink;
        c.fillRect(x, y, win.w, win.h);
        return;
      }
      const age = (performance.now() - p.t) / 1000;
      // the light comes on: a stutter, then it holds
      let on = age < 0.15 ? age / 0.15 : age < 0.3 ? 0.35 : age < 0.45 ? 1.1 : 1;
      on *= flicker(t, i * 1.3, 0.03);
      const spill = c.createRadialGradient(win.x, win.y, 0, win.x, win.y, win.w * 1.9);
      spill.addColorStop(0, hexA(T.flame, 0.22 * on));
      spill.addColorStop(1, hexA(T.flame, 0));
      c.fillStyle = spill;
      c.fillRect(win.x - win.w * 2, win.y - win.w * 2, win.w * 4, win.w * 4);
      const gl = c.createRadialGradient(win.x, win.y + win.h * 0.15, 0, win.x, win.y + win.h * 0.15, win.h * 0.8);
      gl.addColorStop(0, T.ember);
      gl.addColorStop(0.5, T.flame);
      gl.addColorStop(1, '#5a2205');
      c.save();
      c.globalAlpha = clamp(on, 0, 1);
      c.fillStyle = gl;
      c.fillRect(x, y, win.w, win.h);
      c.restore();
      c.save();
      c.beginPath();
      c.rect(x, y, win.w, win.h);
      c.clip();
      PS.drawSil(c, p.costume, win.x, y + win.h * 0.62, win.h * 0.9, T.ink);
      c.restore();
      c.fillStyle = T.ink;
      c.fillRect(win.x - 1.5, y, 3, win.h);
      c.fillRect(x, y + win.h * 0.4, win.w, 3);
      c.fillStyle = T.bone;
      c.font = `700 ${Math.round(clamp(win.w * 0.26, 13, 18))}px "Atkinson Hyperlegible", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.globalAlpha = clamp(age * 2, 0, 1);
      c.fillText(p.name, win.x, y + win.h + 5, g.cw * 0.96);
      c.globalAlpha = 1;
    });
  }

  function drawMantel(c, w, h, t) {
    c.clearRect(0, 0, w, h);
    const shelfY = h * 0.6;
    c.fillStyle = T.soot;
    c.fillRect(0, shelfY, w, h * 0.06);
    c.fillStyle = hexA(T.bone, 0.35);
    c.fillRect(0, shelfY, w, 1);
    const slot = w / S.NUM_PUMPKINS;
    const size = Math.min(slot * 0.6, h * 0.42);
    state.pumpkins.forEach((pk, i) => {
      const x = slot * (i + 0.5);
      const fxs = slotFx[i];
      const holderName = pk.holder ? pk.holder.name : pk.house ? '#house' : null;
      if (holderName !== fxs.holder) {
        if (holderName && fxs.holder == null) {
          fxs.t = performance.now();
          particles.emit(x, h * 0.04 + shelfY - size * 0.3, { count: mild ? 16 : 50, color: [T.ember, T.flame], speed: size * 2.2, life: 1.6, size: 4, gravity: -size * 0.3, shape: 'ember' });
        }
        fxs.holder = holderName;
      }
      const y = shelfY - size * 0.37;
      if (holderName) {
        const k = clamp((performance.now() - fxs.t) / 700, 0, 1);
        const s = size * (k < 1 ? 0.92 + 0.08 * ease.outBack(k, 2.2) : 1);
        PS.drawPumpkin(c, x, y, s, pk.n, { lit: Math.max(0.05, ease.out(k)), t });
        if (pk.holder) {
          PS.drawSil(c, pk.holder.costume, x, shelfY + h * 0.13, h * 0.1, T.bone);
          c.fillStyle = T.bone;
          c.font = `800 ${Math.round(clamp(h * 0.075, 14, 30))}px Fraunces, Georgia, serif`;
          c.textAlign = 'center';
          c.textBaseline = 'top';
          c.fillText(pk.holder.name, x, shelfY + h * 0.19, slot * 0.92);
        } else {
          c.fillStyle = T.ash;
          c.font = `italic 500 ${Math.round(clamp(h * 0.06, 13, 22))}px Fraunces, Georgia, serif`;
          c.textAlign = 'center';
          c.textBaseline = 'top';
          c.fillText('the House', x, shelfY + h * 0.12);
        }
      } else if (pk.spawned) {
        PS.drawPumpkin(c, x, y, size, pk.n, { line: 2 });
        c.fillStyle = T.ash;
        c.font = `italic 500 ${Math.round(clamp(h * 0.06, 13, 22))}px Fraunces, Georgia, serif`;
        c.textAlign = 'center';
        c.textBaseline = 'top';
        c.fillText(pk.room != null ? `hidden ${S.ROOMS[pk.room].at}` : 'hidden', x, shelfY + h * 0.12, slot * 0.95);
      } else {
        c.globalAlpha = 0.22;
        PS.drawPumpkin(c, x, y, size, pk.n, { line: 1.5 });
        c.globalAlpha = 1;
      }
    });
  }

  function drawCandle(c, w, h, t) {
    c.clearRect(0, 0, w, h);
    const rem = remaining();
    const frac = state.dur ? clamp(rem / state.dur, 0, 1) : state.overtime ? 0.04 : 1;
    const top = h - 8 - (h - 36) * frac;
    c.fillStyle = T.bone;
    c.fillRect(w * 0.3, top, w * 0.4, h - top);
    c.fillRect(w * 0.6, top, w * 0.08, Math.min(18, h - top));
    c.fillStyle = T.ink;
    c.fillRect(w / 2 - 0.75, top - 6, 1.5, 6);
    const f = flicker(t, 1, 0.04);
    const fx = w / 2;
    const fy = top - 8;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(fx, fy, 0, fx, fy, 22 * f);
    g.addColorStop(0, hexA(T.ember, 0.6));
    g.addColorStop(1, hexA(T.flame, 0));
    c.fillStyle = g;
    c.fillRect(0, fy - 24, w, 48);
    c.fillStyle = T.ember;
    c.beginPath();
    c.moveTo(fx, fy - 14 * f);
    c.quadraticCurveTo(fx + 5, fy - 2, fx, fy + 4);
    c.quadraticCurveTo(fx - 5, fy - 2, fx, fy - 14 * f);
    c.fill();
    c.restore();
  }

  // the floor plan: one row per floor (upstairs, ground floor, below, the grounds)
  const PLAN = {};
  S.FLOORS.forEach((fl, fi) => fl.rooms.forEach((ri, j) => (PLAN[S.ROOMS[ri].id] = [j / fl.rooms.length, fi / S.FLOORS.length, 1 / fl.rooms.length, 1 / S.FLOORS.length])));
  function drawPlan(c, w, h, t) {
    c.clearRect(0, 0, w, h);
    const byRoom = S.ROOMS.map(() => []);
    state.players.forEach((p) => p.connected && p.room != null && byRoom[p.room] && byRoom[p.room].push(p));
    S.ROOMS.forEach((room, ri) => {
      const [px, py, pw, ph] = PLAN[room.id];
      const x = px * w + 4;
      const y = py * h + 4;
      const rw = pw * w - 8;
      const rh = ph * h - 8;
      const ps = byRoom[ri];
      // the room glows with the lights of the people in it
      if (ps.length) {
        const a = Math.min(0.28, 0.035 * ps.length) * flicker(t, ri, 0.03);
        const g = c.createRadialGradient(x + rw / 2, y + rh / 2, 0, x + rw / 2, y + rh / 2, Math.max(rw, rh) * 0.7);
        g.addColorStop(0, hexA(T.flame, a));
        g.addColorStop(1, hexA(T.flame, 0));
        c.fillStyle = g;
        c.fillRect(x, y, rw, rh);
      }
      if (state.events.some((e) => e.type === 'ghostFlood' && e.room === ri)) {
        c.fillStyle = hexA(T.wraith, 0.08);
        c.fillRect(x, y, rw, rh);
      }
      // rooms not yet open are a faint dotted outline
      const shut = ri >= (state.open || S.ROOMS.length);
      c.strokeStyle = hexA(T.bone, shut ? 0.14 : 0.5);
      c.lineWidth = 1;
      c.setLineDash(shut || room.id === 'lake' ? [3, 5] : []);
      c.strokeRect(x + 0.5, y + 0.5, rw, rh);
      c.setLineDash([]);
      c.fillStyle = shut ? hexA(T.ash, 0.4) : T.ash;
      c.font = 'italic 500 14px Fraunces, Georgia, serif';
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.fillText(room.name.toLowerCase(), x + 8, y + 6);
      const dot = 15;
      const cols = Math.max(1, Math.floor((rw - 12) / (dot + 3)));
      const cap = cols * Math.max(1, Math.floor((rh - 30) / (dot + 3)));
      ps.slice(0, cap).forEach((p, i) => {
        const cx = x + 8 + (i % cols) * (dot + 3) + dot / 2;
        const cy = y + 28 + Math.floor(i / cols) * (dot + 3) + dot / 2;
        PS.drawSil(c, p.costume, cx, cy, dot, T.bone);
      });
      if (ps.length > cap) {
        c.fillStyle = T.ash;
        c.font = '700 12px "Atkinson Hyperlegible", sans-serif';
        c.fillText(`+${ps.length - cap}`, x + rw - 30, y + rh - 18);
      }
      // what is loose in there
      let ix = x + rw - 22;
      state.pumpkins.forEach((pk) => {
        if (pk.room === ri && !pk.holder) {
          PS.drawPumpkin(c, ix, y + 16, 22, null, { line: 4 });
          ix -= 24;
        }
      });
      if (state.hammer.room === ri) PS.drawHammer(c, ix, y + 26, 20, 0.5, T.bone);
    });
  }

  function drawVote(c, w, h, t) {
    c.clearRect(0, 0, w, h);
    const { weights } = state.tally || { weights: [0, 0, 0, 0, 0, 0] };
    const max = Math.max(...weights);
    const slot = w / S.NUM_PUMPKINS;
    const size = Math.min(slot * 0.72, h * 0.34);
    state.pumpkins.forEach((pk, i) => {
      const x = slot * (i + 0.5);
      const y = h * 0.54;
      const share = max > 0 ? weights[i] / max : 0;
      const lead = max > 0 && weights[i] === max;
      // vote weight is brightness: the favourite burns brightest
      const lit = lead ? 1 : 0.1 + 0.6 * share;
      PS.drawPumpkin(c, x, y, size * (lead ? 1.08 : 1), pk.n, { lit, t });
      c.textAlign = 'center';
      c.textBaseline = 'top';
      c.fillStyle = lead ? T.bone : T.ash;
      c.font = `800 ${Math.round(clamp(h * 0.03, 16, 30))}px Fraunces, Georgia, serif`;
      c.fillText(PS.nameOf(pk.holder), x, y + size * 0.62, slot * 0.92);
      c.fillStyle = T.ash;
      c.font = `700 ${Math.round(clamp(h * 0.02, 13, 20))}px "Atkinson Hyperlegible", sans-serif`;
      if (weights[i]) c.fillText(`${weights[i]}`, x, y + size * 0.62 + h * 0.045);
    });
  }

  // ---------------- frame loop ----------------
  let last = performance.now();
  function draw(now) {
    const rawDt = Math.min(0.5, (now - last) / 1000);
    const dt = Math.min(0.05, rawDt);
    last = now;
    const fit = PS.fitCanvas(stageCv, 1.5);
    W = fit.W;
    H = fit.H;
    const [sx, sy] = shaker.offset(dt);
    root.style.transform = sx || sy ? `translate(${sx * 0.6}px, ${sy * 0.6}px)` : '';
    sctx.setTransform(fit.dpr, 0, 0, fit.dpr, 0, 0);
    sctx.clearRect(0, 0, W, H);
    const t = now / 1000;
    if (state) {
      for (const p of painters) {
        if (!p.cv.isConnected) continue;
        const f = PS.fitCanvas(p.cv, 1.5);
        const c = p.cv.getContext('2d');
        c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
        p.fn(c, f.W, f.H, t);
      }
      if (state.phase === 'SMASH' || state.phase === 'RESULT') {
        const res = stage.render(sctx, W, H, rawDt);
        if (res.flash) {
          sctx.fillStyle = T.bone;
          sctx.fillRect(0, 0, W, H);
        }
      }
      // particles live on the stage layer; mantel embers are emitted in mantel coordinates
      sctx.save();
      const m = document.querySelector('.mantel');
      if (m && state.phase === 'HUNT') {
        const r = m.getBoundingClientRect();
        sctx.translate(r.left, r.top);
      }
      particles.update(dt);
      particles.draw(sctx);
      sctx.restore();
      const rem = remaining();
      const ht = $('h-timer');
      if (ht) {
        ht.classList.toggle('over', !!state.overtime);
        ht.textContent = state.overtime ? 'Overtime.' : PS.fmtTime(rem);
      }
      const pb = $('p-bar');
      if (pb && state.phase === 'PITCHES') pb.style.transform = `scaleX(${state.dur ? rem / state.dur : 0})`;
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    try {
      draw(now);
    } catch (err) {
      console.error(err);
    }
  }
  requestAnimationFrame(frame);
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
})();
