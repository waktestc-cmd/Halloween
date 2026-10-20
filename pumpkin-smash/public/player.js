// Player screen: join, the dark-house hunt, pitches, vote, smash, result.
/* global io, PS */
(function () {
  const { S, Sound, Particles, Shaker, Stage, rand, pick, clamp, hexA, store, TAU } = PS;
  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const screenEl = $('screen');

  const socket = io({ transports: ['websocket', 'polling'] });
  let session = store.get('ps_session', null); // {name, costume, token}
  let mode = store.get('ps_mode', 'spooky');
  let joined = false;
  let me = null;
  let state = null;
  let items = new Map();
  let screenKey = '';
  let timerBase = { remaining: null, at: 0, paused: false };

  const particles = new Particles();
  const shaker = new Shaker();
  const stage = new Stage(particles, shaker);
  stage.scale = 0.9;
  stage.resultPumpkins = false; // the result text and awards fill the player screen
  const floaters = [];
  let flash = null;
  let W = 0;
  let H = 0;
  let dpr = 1;

  const isMild = () => mode === 'mild';
  function applyMode() {
    Sound.mild = isMild();
    stage.mild = isMild();
    document.body.classList.toggle('mild', isMild());
    $('btn-mode').textContent = isMild() ? '🌙 Mild' : '💀 Spooky';
    $('btn-mute').textContent = Sound.isMuted() ? '🔇' : '🔊';
  }
  applyMode();
  $('btn-mode').onclick = () => {
    mode = isMild() ? 'spooky' : 'mild';
    store.set('ps_mode', mode);
    applyMode();
    toast(isMild() ? 'Mild mode: gentler effects, no screams' : 'Spooky mode: full fright');
  };
  $('btn-mute').onclick = () => {
    Sound.unlock();
    Sound.toggleMute();
    applyMode();
  };
  $('btn-fs').onclick = () => PS.toggleFullscreen();

  function toast(text, ms = 2200) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => (t.hidden = true), ms);
  }
  function banner(title, sub, color, ms = 3200) {
    const b = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub || '';
    b.style.setProperty('--c', color || S.COLORS.orange);
    b.hidden = false;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    clearTimeout(banner.h);
    banner.h = setTimeout(() => (b.hidden = true), ms);
  }
  function doFlash(colors, strength = 1) {
    flash = { t: performance.now(), colors, k: isMild() ? 0.25 * strength : strength };
  }
  function remaining() {
    if (timerBase.remaining == null) return null;
    if (timerBase.paused) return timerBase.remaining;
    return Math.max(0, timerBase.remaining - (performance.now() - timerBase.at));
  }
  const fastMul = () => (state && state.fast ? 0.15 : 1);

  // ===================================================================
  // Join screen
  // ===================================================================
  function showJoin(error) {
    joined = false;
    screenKey = 'join';
    $('hud').hidden = true;
    document.body.classList.remove('hunting');
    screenEl.hidden = false;
    screenEl.innerHTML = `
      <div class="panel join">
        <h1 class="title">Pumpkin Smash</h1>
        <p class="tag">Enter the haunted house. Find pumpkins. One hides <b>Friday afternoon off</b>.</p>
        <input id="j-name" maxlength="${S.MAX_NAME}" placeholder="Your name" autocomplete="off" />
        <div class="costumes" id="j-costumes"></div>
        <div class="row">
          <div class="seg" id="j-mode">
            <button data-m="spooky">💀 Spooky</button><button data-m="mild">🌙 Mild</button>
          </div>
          <button class="ghost-btn" id="j-fs">⛶ Go full screen</button>
        </div>
        <button class="big-btn" id="j-go">Enter the house</button>
        <div class="err" id="j-err"></div>
      </div>`;
    const name = $('j-name');
    name.value = (session && session.name) || '';
    let costume = (session && session.costume) || pick(S.COSTUMES).id;
    const grid = $('j-costumes');
    S.COSTUMES.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'tile';
      b.style.setProperty('--glow', c.glow);
      b.dataset.id = c.id;
      b.innerHTML = PS.costumeHTML(c.id) + `<small>${c.name}</small>`;
      b.onclick = () => {
        costume = c.id;
        sync();
        Sound.unlock();
        Sound.blip();
      };
      grid.appendChild(b);
    });
    const modeBtns = $('j-mode').querySelectorAll('button');
    function sync() {
      grid.querySelectorAll('.tile').forEach((t) => t.classList.toggle('on', t.dataset.id === costume));
      modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    }
    modeBtns.forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.m;
        store.set('ps_mode', mode);
        applyMode();
        sync();
      };
    });
    sync();
    $('j-fs').onclick = () => PS.toggleFullscreen();
    $('j-err').textContent = error || '';
    const go = () => {
      Sound.unlock();
      const n = name.value.trim();
      if (!n) {
        $('j-err').textContent = 'Every ghost needs a name.';
        return name.focus();
      }
      const token = session && session.name && session.name.toLowerCase() === n.toLowerCase() ? session.token : null;
      doJoin({ name: n, costume, token });
    };
    $('j-go').onclick = go;
    name.onkeydown = (e) => e.key === 'Enter' && go();
  }

  function doJoin(data) {
    socket.emit('join', data, (res) => {
      if (!res || !res.ok) {
        session = null;
        return showJoin((res && res.error) || 'Could not join');
      }
      session = { name: res.me.name, costume: res.me.costume, token: res.token };
      store.set('ps_session', session);
      joined = true;
      setMe(res.me);
      if (res.rejoined) toast(`Welcome back, ${res.me.name}. Your souls are safe.`);
      screenKey = '';
      render();
    });
  }

  // ===================================================================
  // Socket
  // ===================================================================
  socket.on('connect', () => {
    if (session && session.name) doJoin(session);
    else if (!joined) showJoin();
  });
  socket.on('disconnect', () => toast('Connection lost… reconnecting', 4000));
  socket.on('kicked', () => {
    joined = false;
    showJoin('You joined from another tab or device.');
  });
  socket.on('state', (s) => {
    const prev = state;
    state = s;
    timerBase = { remaining: s.remaining, at: performance.now(), paused: s.paused };
    if (prev && prev.gameId !== s.gameId) resetLocal();
    $('paused').hidden = !(s.paused && joined);
    if (joined) render();
  });
  socket.on('me', (m) => setMe(m));
  socket.on('items', (list) => {
    items = new Map(list.map((it) => [it.id, Object.assign(it, { born: performance.now() })]));
  });
  socket.on('item+', (it) => {
    it.born = performance.now();
    items.set(it.id, it);
  });
  socket.on('item~', (m) => {
    const it = items.get(m.id);
    if (!it) return;
    if (it.t === 'h' && Hunt.room === it.r && it.r === m.r) sparkle(it, S.COLORS.cyan, 14);
    Object.assign(it, m);
    it.born = performance.now();
  });
  socket.on('item-', (m) => {
    const it = items.get(m.id);
    items.delete(m.id);
    if (!it || !me || m.by === me.name) return;
    if (it.r === Hunt.room && state && state.phase === 'HUNT') {
      sparkle(it, it.t === 'p' ? S.COLORS.orange : S.COLORS.cyan, it.t === 's' ? 6 : 24);
      if (it.t === 'p' && m.by) toast(`🎃 ${m.by} grabbed Pumpkin ${it.n} right in front of you!`);
      if (it.t === 'h' && m.by) toast(`🔨 ${m.by} snatched the hammer!`);
    }
  });
  socket.on('announce', (a) => {
    if (!joined || !state) return;
    if (a.kind === 'act') {
      const act = S.ACTS[a.act];
      let sub = act.sub;
      if (a.act === 2 && me && me.pumpkin) sub = 'You hold a pumpkin, so the hammer is hidden from you. Harvest souls!';
      banner(`ACT ${a.act} · ${act.name}`, sub, [null, S.COLORS.orange, S.COLORS.cyan, S.COLORS.magenta][a.act], 4200);
      Sound.stinger();
      Hunt.lastCollect = performance.now();
      Hunt.respawnGhosts();
    } else if (a.kind === 'event') {
      const ev = S.EVENTS[a.type];
      const sub = a.room != null ? `${ev.sub} ${S.ROOMS[a.room].name}` : ev.sub;
      banner(ev.name.toUpperCase(), sub, ev.color, 3800);
      Sound.stinger();
      doFlash([ev.color], 0.6);
      if (a.type === 'soulShower' && a.room === Hunt.room) {
        for (let i = 0; i < 40; i++) particles.emit(rand(0, W), -10, { count: 1, color: [S.COLORS.cyan, '#fff'], speed: 300, angle: Math.PI / 2, spread: 0.3, life: 2, size: 3 });
      }
    } else if (a.kind === 'pumpkinSpawn') {
      Sound.spawnBell();
      const here = a.room === Hunt.room;
      toast(`🎃 Pumpkin ${a.n} appeared in the ${S.ROOMS[a.room].name}${here ? ' (that’s here!)' : ''}`, 3000);
    } else if (a.kind === 'overtime') {
      banner('OVERTIME', 'The house will not let go until every pumpkin is claimed.', S.COLORS.red, 4000);
      Sound.stinger();
    }
  });

  function setMe(m) {
    const prev = me;
    me = m;
    if (prev && prev.gameId !== m.gameId) resetLocal();
    $('inv-souls-n').textContent = m.souls;
    $('inv-pumpkin').hidden = !m.pumpkin;
    $('inv-pumpkin').textContent = m.pumpkin ? `🎃${m.pumpkin}` : '';
    $('inv-hammer').hidden = !m.hammer;
    if (state && state.phase === 'HUNT' && !Hunt.dead && !Hunt.trans && m.room != null && m.room !== Hunt.room) Hunt.enterRoom(m.room);
    if (state && state.phase === 'VOTE') updateVote();
  }

  function resetLocal() {
    Hunt.reset();
    stage.clear();
    screenKey = '';
  }

  // ===================================================================
  // Phase screens
  // ===================================================================
  function render() {
    if (!joined || !state || !me) return;
    const ph = state.phase;
    const key = ph === 'PITCHES' ? `P${state.pitchIndex}` : ph;
    document.body.classList.toggle('hunting', ph === 'HUNT');
    $('hud').hidden = ph !== 'HUNT';
    screenEl.hidden = ph === 'HUNT';
    if (ph === 'HUNT') {
      Hunt.onState();
      if (screenKey !== key) {
        screenKey = key;
        screenEl.innerHTML = '';
      }
      return;
    }
    Hunt.leave();
    if (ph !== 'SMASH' && ph !== 'RESULT') stage.clear();
    if (screenKey !== key) {
      screenKey = key;
      buildScreen(ph);
    }
    updateScreen(ph);
  }

  function buildScreen(ph) {
    const c = PS.costumeById(me.costume);
    if (ph === 'LOBBY') {
      screenEl.innerHTML = `
        <div class="panel lobby">
          <div class="me-big" style="--glow:${c.glow}">${PS.costumeHTML(me.costume)}</div>
          <h2 id="l-name"></h2>
          <p class="tag">You're in. Watch the shared screen. The host will open the doors soon…</p>
          <p class="count"><b id="l-count">0</b> souls in the lobby</p>
          <button class="ghost-btn" id="l-leave">Not you? Change name</button>
        </div>`;
      $('l-name').textContent = me.name;
      $('l-leave').onclick = () => {
        session = null;
        store.set('ps_session', null);
        location.reload();
      };
    } else if (ph === 'RULES') {
      screenEl.innerHTML = `
        <div class="panel rules">
          <h1 class="title small">The House Rules</h1>
          <ol class="rules-list">
            <li><span>🎃</span>Find pumpkins</li>
            <li><span>🔨</span>Find the hammer</li>
            <li><span><i class="soul-dot big"></i></span>Collect souls</li>
            <li><span>👻</span>Avoid ghosts</li>
          </ol>
          <p class="tag">Your torch follows your ${'ontouchstart' in window ? 'finger' : 'mouse'}. Click things in the light. Glowing doors lead to other rooms.</p>
          <div class="timer" id="r-timer"></div>
        </div>`;
    } else if (ph === 'PITCHES') {
      const pk = state.pumpkins[state.pitchIndex];
      const mine = me.pumpkin === pk.n;
      screenEl.innerHTML = `
        <div class="panel pitch">
          <div class="kicker">Pitch ${state.pitchIndex + 1} of ${S.NUM_PUMPKINS}</div>
          <canvas class="pk-canvas" id="p-pk" width="220" height="220"></canvas>
          <div class="pitch-who" id="p-who"></div>
          <p class="tag">${mine ? '<b class="hot">YOU\'RE UP!</b> Unmute and convince the room your pumpkin hides Friday afternoon off.' : 'Listen to the pitch. Does this pumpkin hide the prize?'}</p>
          <div class="bar"><i id="p-bar"></i></div>
        </div>`;
      drawPkCanvas($('p-pk'), pk.n);
      $('p-who').appendChild(PS.whoEl(pk.holder, 'xl'));
    } else if (ph === 'VOTE') {
      screenEl.innerHTML = `
        <div class="panel vote">
          <h1 class="title small">Which pumpkin gets smashed?</h1>
          <p class="tag" id="v-weight"></p>
          <div class="vote-grid" id="v-grid"></div>
          <div class="timer" id="v-timer"></div>
        </div>`;
      const grid = $('v-grid');
      state.pumpkins.forEach((pk) => {
        const b = document.createElement('button');
        b.className = 'vote-card';
        b.dataset.n = pk.n;
        b.innerHTML = `<canvas width="120" height="120"></canvas><div class="vc-who"></div><div class="vc-bar"><i></i></div><div class="vc-w"></div>`;
        drawPkCanvas(b.querySelector('canvas'), pk.n);
        b.querySelector('.vc-who').appendChild(PS.whoEl(pk.holder));
        b.onclick = () => {
          Sound.unlock();
          Sound.blip();
          me.vote = pk.n;
          updateVote();
          socket.emit('vote', { n: pk.n });
        };
        grid.appendChild(b);
      });
    } else if (ph === 'SMASH') {
      const sm = state.smash;
      screenEl.innerHTML = `<div class="panel smash"><div class="smash-line" id="s-line"></div></div>`;
      const line = $('s-line');
      line.append('🔨 ', PS.whoEl(sm.hammer), ` swings at Pumpkin ${sm.target} (`, PS.whoEl(sm.holder), ')…');
      stage.smash(sm, state.elapsed);
    } else if (ph === 'RESULT') {
      const r = state.result;
      stage.result(r);
      screenEl.innerHTML = `
        <div class="panel result ${r.win ? 'win' : 'lose'}">
          <h1 class="result-title" data-text="${r.win ? 'FRIDAY AFTERNOON OFF!' : 'ZOMBIE PUMPKIN'}">${r.win ? 'FRIDAY AFTERNOON OFF!' : 'ZOMBIE PUMPKIN'}</h1>
          <div class="result-sub" id="res-sub"></div>
          <div class="result-reveal" id="res-reveal" hidden></div>
          <div class="awards" id="res-awards"></div>
          <p class="tag">You: <b>${me.souls}</b> souls · <b>${me.deaths}</b> deaths${me.pumpkin ? ` · held Pumpkin ${me.pumpkin}` : ''}${me.hammer ? ' · swung the hammer' : ''}</p>
        </div>`;
      $('res-sub').append(`Pumpkin ${r.smashed} (`, PS.whoEl(r.smashedHolder), r.win ? ') held the prize!' : ') was hollow…');
      if (!r.win) {
        setTimeout(() => {
          const el = $('res-reveal');
          if (!el) return;
          el.hidden = false;
          el.append('The real prize was in ', Object.assign(document.createElement('b'), { textContent: `Pumpkin ${r.winning}` }), ' — held by ', PS.whoEl(r.winningHolder));
        }, 3000);
      }
      renderAwards($('res-awards'), r.awards);
    }
  }

  function renderAwards(el, aw) {
    const add = (icon, title, a, unit) => {
      const d = document.createElement('div');
      d.className = 'award';
      d.innerHTML = `<div class="aw-icon">${icon}</div><div class="aw-title">${title}</div>`;
      const who = document.createElement('div');
      who.className = 'aw-who';
      if (a) a.who.forEach((w) => who.appendChild(PS.whoEl(w)));
      else who.textContent = '—';
      d.appendChild(who);
      if (a && a.value != null) {
        const v = document.createElement('div');
        v.className = 'aw-v';
        v.textContent = `${a.value} ${unit}`;
        d.appendChild(v);
      }
      el.appendChild(d);
    };
    add('<i class="soul-dot big"></i>', 'Most Souls', aw.souls, 'souls');
    add('👻', 'Most Haunted', aw.haunted, 'deaths');
    add('🔨', 'Hammer Hero', aw.hammer, '');
  }

  function drawPkCanvas(cv, n, opts) {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    PS.drawPumpkin(c, cv.width / 2, cv.height * 0.55, cv.width * 0.62, n, opts || {});
  }

  function updateScreen(ph) {
    const rem = remaining();
    if (ph === 'LOBBY' && $('l-count')) $('l-count').textContent = state.playerCount;
    if (ph === 'RULES' && $('r-timer')) $('r-timer').textContent = PS.fmtTime(rem);
    if (ph === 'VOTE') updateVote();
  }
  function updateVote() {
    const grid = $('v-grid');
    if (!grid || !state.tally) return;
    const { weights, counts, total } = state.tally;
    const max = Math.max(1, ...weights);
    grid.querySelectorAll('.vote-card').forEach((b) => {
      const n = Number(b.dataset.n);
      b.classList.toggle('on', me.vote === n);
      b.classList.toggle('mine', me.pumpkin === n);
      b.querySelector('.vc-bar i').style.width = `${(weights[n - 1] / max) * 100}%`;
      b.querySelector('.vc-w').textContent = `${weights[n - 1]} · ${counts[n - 1]} vote${counts[n - 1] === 1 ? '' : 's'}`;
    });
    $('v-weight').innerHTML = `Your vote weighs <b>${1 + me.souls}</b> (1 + ${me.souls} souls).${me.vote ? ` You picked <b>Pumpkin ${me.vote}</b>; you can change it until time's up.` : ' Tap a pumpkin.'}`;
    void total;
  }

  // ===================================================================
  // The hunt
  // ===================================================================
  const Hunt = {
    room: null,
    active: false,
    torch: { x: 0, y: 0 },
    hasPointer: false,
    ghosts: [],
    doors: [],
    nextDoor: 0,
    decor: null,
    decorRoom: -1,
    dead: false,
    trans: null,
    graceUntil: 0,
    invisUntil: 0,
    lastCollect: 0,
    lastWhisper: 0,
    splash: null,
    deathInfo: null,

    reset() {
      this.room = null;
      this.ghosts = [];
      this.doors = [];
      this.dead = false;
      this.trans = null;
      this.deathInfo = null;
      $('death').hidden = true;
    },
    leave() {
      if (!this.active) return;
      this.active = false;
      this.reset();
      Sound.stopDrone();
    },
    onState() {
      const t = performance.now();
      if (!this.active) {
        this.active = true;
        this.lastCollect = t;
        this.graceUntil = t + 2500;
        if (!this.hasPointer) {
          this.torch.x = W / 2;
          this.torch.y = H / 2;
        }
      }
      if (this.room == null && me.room != null) this.enterRoom(me.room);
      const act = S.ACTS[state.act];
      $('hud-act-name').textContent = act ? `ACT ${state.act} · ${act.name}` : '';
      document.body.classList.toggle('overtime', !!state.overtime);
      const ev = state.events.filter((e) => e.type !== 'soulShower' || e.room === this.room);
      const tick = state.feed[state.feed.length - 1];
      const tk = $('hud-ticker');
      if (tick && tk.dataset.id !== String(tick.id)) {
        tk.dataset.id = tick.id;
        tk.innerHTML = '';
        if (tick.who) tk.appendChild(PS.whoEl(tick.who));
        tk.append(' ' + tick.text);
        tk.classList.remove('pop');
        void tk.offsetWidth;
        tk.classList.add('pop');
      }
      document.body.classList.toggle('bloodmoon', ev.some((e) => e.type === 'bloodMoon'));
    },
    hasEvent(type, room) {
      return !!state && state.events.some((e) => e.type === type && (room == null || e.room === room));
    },
    radius() {
      let r = Math.max(W * 0.08, Math.min(W, H) * 0.11, 56);
      if (this.hasEvent('bloodMoon')) r *= 0.5;
      const t = performance.now() / 1000;
      const fl = isMild() ? 0.01 * Math.sin(t * 3) : 0.035 * Math.sin(t * 13) + 0.02 * Math.sin(t * 31 + 1) + rand(-0.012, 0.012);
      return r * (1 + fl);
    },
    enterRoom(r) {
      this.room = r;
      this.doors = [];
      this.nextDoor = performance.now() + rand(1500, 3500) * fastMul();
      this.decor = buildDecor(r, W, H, dpr);
      this.decorRoom = r;
      this.respawnGhosts();
      this.graceUntil = Math.max(this.graceUntil, performance.now() + 1500);
      this.splash = { t: performance.now(), room: r };
      $('hud-room').textContent = S.ROOMS[r].name;
      $('hud-room').style.color = S.ROOMS[r].accent;
      document.body.style.setProperty('--accent', S.ROOMS[r].accent);
      Sound.setDrone(r);
    },
    respawnGhosts() {
      if (this.room == null) return;
      this.ghosts = [];
      const n = state && state.act === 3 ? 2 : 1;
      for (let i = 0; i < n; i++) this.ghosts.push(makeGhost(this.room, false));
    },
  };

  function speedMul() {
    return [1, 1, 1.35, 1.75][(state && state.act) || 1];
  }
  function makeGhost(room, extra) {
    // spawn away from the torch
    let x;
    let y;
    let tries = 0;
    do {
      x = rand(W * 0.1, W * 0.9);
      y = rand(H * 0.15, H * 0.9);
      tries++;
    } while (Math.hypot(x - Hunt.torch.x, y - Hunt.torch.y) < Math.min(W, H) * 0.35 && tries < 30);
    return {
      gi: room,
      x,
      y,
      vx: rand(-1, 1),
      vy: rand(-1, 1),
      tx: rand(W * 0.1, W * 0.9),
      ty: rand(H * 0.15, H * 0.9),
      cx: x,
      cy: y,
      phase: rand(0, TAU),
      mode: 'drift',
      modeUntil: performance.now() + rand(3000, 7000),
      hop: 0,
      extra,
    };
  }

  function updateGhosts(dt, now) {
    const want = Hunt.hasEvent('ghostFlood', Hunt.room) ? 3 : 0;
    const extras = Hunt.ghosts.filter((g) => g.extra).length;
    if (extras < want) for (let i = extras; i < want; i++) Hunt.ghosts.push(makeGhost(Hunt.room, true));
    if (extras > want) Hunt.ghosts = Hunt.ghosts.filter((g) => !g.extra);

    const base = Math.min(W, H) * 0.075 * speedMul();
    const R = Hunt.radius();
    const torch = Hunt.torch;
    const t = now / 1000;
    for (const g of Hunt.ghosts) {
      if (now > g.modeUntil) {
        if (g.mode === 'drift') {
          g.mode = 'home';
          g.modeStart = now;
          g.modeUntil = now + rand(1800, 3000);
        } else {
          g.mode = 'drift';
          const k = state.act === 3 ? 0.6 : 1;
          g.modeUntil = now + rand(5000, 10000) * k;
          g.tx = rand(W * 0.1, W * 0.9);
          g.ty = rand(H * 0.15, H * 0.9);
        }
      }
      const id = S.GHOSTS[g.gi].id;
      if (g.mode === 'home' && !Hunt.dead) {
        const dx = torch.x - g.x;
        const dy = torch.y - g.y;
        const d = Math.hypot(dx, dy) || 1;
        let sp = base * { butler: 1.9, ragdoll: 2.3, warden: 2.7, bride: 1.6, choir: 1.9 }[id];
        if (id === 'ragdoll') sp *= Math.sin(t * 9 + g.phase) > 0 ? 1.7 : 0.15; // lurching
        if (id === 'warden') sp *= now - g.modeStart > 600 ? 1 : 0.2; // pause, then charge
        g.x += (dx / d) * sp * dt;
        g.y += (dy / d) * sp * dt;
      } else {
        if (id === 'butler') {
          const dx = g.tx - g.x;
          const dy = g.ty - g.y;
          const d = Math.hypot(dx, dy);
          if (d < 10) {
            g.tx = rand(W * 0.1, W * 0.9);
            g.ty = rand(H * 0.15, H * 0.9);
          } else {
            g.x += (dx / d) * base * dt;
            g.y += (dy / d) * base * dt;
          }
          g.y += Math.sin(t * 2 + g.phase) * 8 * dt;
        } else if (id === 'ragdoll') {
          g.hop -= dt;
          if (g.hop <= 0) {
            g.hop = rand(0.35, 0.9);
            const a = rand(0, TAU);
            g.vx = Math.cos(a) * base * 4;
            g.vy = Math.sin(a) * base * 4;
          }
          const k = g.hop > 0.2 ? 0.05 : 1;
          g.x += g.vx * dt * k;
          g.y += g.vy * dt * k;
        } else if (id === 'warden') {
          g.x += Math.sign(g.vx || 1) * base * 0.75 * dt;
          if (g.x < W * 0.08 || g.x > W * 0.92) g.vx = -Math.sign(g.vx || 1);
          g.y += (g.ty - g.y) * 0.3 * dt;
        } else if (id === 'bride') {
          g.x += Math.cos(t * 0.5 + g.phase) * base * 0.9 * dt;
          g.y += Math.sin(t * 1.1 + g.phase) * base * 0.6 * dt;
        } else {
          g.cx += (g.tx - g.cx) * 0.15 * dt;
          g.cy += (g.ty - g.cy) * 0.15 * dt;
          const rr = Math.min(W, H) * 0.16;
          const a = t * 0.9 * speedMul() + g.phase;
          g.x += (g.cx + Math.cos(a) * rr - g.x) * 2 * dt;
          g.y += (g.cy + Math.sin(a) * rr * 0.7 - g.y) * 2 * dt;
        }
      }
      g.x = clamp(g.x, W * 0.03, W * 0.97);
      g.y = clamp(g.y, H * 0.06, H * 0.97);

      const d = Math.hypot(g.x - torch.x, g.y - torch.y);
      if (d < R * 2.6 && now - Hunt.lastWhisper > 2600 && !Hunt.dead) {
        Hunt.lastWhisper = now;
        Sound.whisper(clamp((g.x - torch.x) / (W / 2), -1, 1));
      }
      const size = ghostSize();
      const safe = now < Hunt.graceUntil || now < Hunt.invisUntil || Hunt.trans || Hunt.dead || state.paused;
      if (!safe && d < size * 0.26) die(g);
    }
  }
  const ghostSize = () => Math.max(70, Math.min(W, H) * 0.17);

  function die(g) {
    Hunt.dead = true;
    const gi = g.gi;
    Hunt.deathInfo = { gi, t: performance.now(), dropped: 0 };
    socket.emit('died', { ghost: gi, x: Hunt.torch.x / W, y: Hunt.torch.y / H }, (res) => {
      if (res && res.ok && Hunt.deathInfo) {
        Hunt.deathInfo.dropped = res.dropped;
        $('death-sub').textContent = res.dropped ? `You dropped ${res.dropped} soul${res.dropped === 1 ? '' : 's'}. Someone else may grab them…` : 'Your pumpkin and hammer are safe. Souls, less so.';
      }
    });
    if (isMild()) {
      Sound.moan();
      shaker.add(4);
    } else {
      Sound.scream();
      Sound.glitch();
      shaker.add(30);
    }
    doFlash([S.COLORS.red], 1);
    particles.emit(Hunt.torch.x, Hunt.torch.y, { count: 60, color: [S.COLORS.red, S.GHOSTS[gi].color], speed: 500, life: 1, size: 4, shape: 'spark' });
    const el = $('death');
    setTimeout(() => {
      if (!Hunt.dead) return;
      el.hidden = false;
      el.classList.toggle('mild', isMild());
      $('death-title').textContent = `YOU WERE TAKEN BY THE ${S.GHOSTS[gi].name.toUpperCase()}`;
      $('death-title').style.color = S.GHOSTS[gi].color;
      $('death-sub').textContent = $('death-sub').textContent || '';
    }, isMild() ? 300 : 700);
    const start = performance.now();
    const countdown = () => {
      if (!Hunt.dead) return;
      const left = 5 - (performance.now() - start) / 1000;
      if (left > 0) {
        $('death-count').textContent = `Respawning in ${Math.ceil(left)}…`;
        setTimeout(countdown, 200);
        return;
      }
      socket.emit('respawn', {}, (res) => {
        Hunt.dead = false;
        Hunt.deathInfo = null;
        el.hidden = true;
        $('death-sub').textContent = '';
        Hunt.invisUntil = performance.now() + 3000;
        Hunt.lastCollect = performance.now();
        if (res && res.ok && res.room != null) Hunt.enterRoom(res.room);
        toast('You are invisible for 3 seconds. Move!');
      });
    };
    countdown();
  }

  function useDoor(door) {
    if (Hunt.trans) return;
    Sound.creak();
    door.used = true;
    Hunt.trans = { t: performance.now(), room: null };
    socket.emit('door', {}, (res) => {
      if (!res || !res.ok) {
        Hunt.trans = null;
        if (res && res.reason === 'locked') toast('🔒 The doors are locked!');
        return;
      }
      Hunt.trans.room = res.room;
    });
  }

  function sparkle(it, color, n) {
    particles.emit(it.x * W, it.y * H, { count: n, color: [color, '#fff'], speed: 220, life: 0.8, size: 3 });
  }
  function floater(x, y, text, color) {
    floaters.push({ x, y, text, color, t: performance.now() });
  }

  const visibleTo = (it) => it.t !== 'h' || (me && !me.pumpkin && !me.hammer);
  const itemSize = (it, R) => (it.t === 's' ? Math.max(8, R * 0.13) : Math.max(34, R * 0.72));

  function claim(it) {
    if (it.pending) return;
    it.pending = true;
    socket.emit('claim', { id: it.id }, (res) => {
      if (!res || !res.ok) {
        it.pending = false;
        if (res && res.reason === 'has-pumpkin') toast(`You already carry Pumpkin ${me.pumpkin}. It's safe with you.`);
        if (res && res.reason === 'has-hammer') toast('You hold the hammer. Pumpkins are for others now.');
        return;
      }
      Hunt.lastCollect = performance.now();
      const x = it.x * W;
      const y = it.y * H;
      if (res.t === 's') {
        Sound.ping();
        particles.emit(x, y, { count: 10, color: [S.COLORS.cyan, '#fff'], speed: 160, life: 0.6, size: 2.5 });
        floater(x, y, `+${res.v || 1}`, S.COLORS.cyan);
      } else {
        Sound.claim();
        shaker.add(isMild() ? 4 : 16);
        doFlash([S.COLORS.magenta, S.COLORS.cyan, S.COLORS.green], 1);
        const cols = res.t === 'p' ? [S.COLORS.orange, '#ffe14d', S.COLORS.magenta] : [S.COLORS.cyan, '#fff', S.COLORS.violet];
        particles.emit(x, y, { count: 120, color: cols, speed: 650, life: 1.3, size: 4, shape: 'spark' });
        particles.emit(x, y, { count: 3, color: cols, speed: 1, life: 0.9, size: 6, shape: 'ring' });
        if (res.t === 'p') banner(`PUMPKIN ${res.n} IS YOURS!`, 'Safe once claimed. Get ready to pitch it later.', S.COLORS.orange);
        else banner('YOU FOUND THE HAMMER!', 'You will swing at whichever pumpkin the room votes for.', S.COLORS.cyan);
      }
    });
  }

  function handlePress(x, y, litFrom) {
    if (!state || state.phase !== 'HUNT' || state.paused || Hunt.dead || Hunt.trans) return;
    Sound.unlock();
    const R = Hunt.radius();
    for (const d of Hunt.doors) {
      const h = doorH(R);
      if (d.alpha > 0.25 && Math.abs(x - d.x * W) < h * 0.4 && Math.abs(y - d.y * H) < h * 0.55) return useDoor(d);
    }
    const lx = litFrom ? litFrom.x : x;
    const ly = litFrom ? litFrom.y : y;
    let best = null;
    let bestD = Infinity;
    for (const it of items.values()) {
      if (it.r !== Hunt.room || !visibleTo(it)) continue;
      const ix = it.x * W;
      const iy = it.y * H;
      const d = Math.hypot(ix - x, iy - y);
      const hit = it.t === 's' ? itemSize(it, R) * 3 + 10 : itemSize(it, R) * 0.65 + 8;
      if (d < hit && Math.hypot(ix - lx, iy - ly) < R * 1.05 && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    if (best) claim(best);
  }
  const doorH = (R) => Math.max(70, R * 1.15);

  canvas.addEventListener('pointermove', (e) => {
    Hunt.hasPointer = true;
    Hunt.torch.x = e.clientX;
    Hunt.torch.y = e.clientY;
  });
  canvas.addEventListener('pointerdown', (e) => {
    const prev = { x: Hunt.torch.x, y: Hunt.torch.y };
    const touch = e.pointerType !== 'mouse';
    Hunt.hasPointer = true;
    Hunt.torch.x = e.clientX;
    Hunt.torch.y = e.clientY;
    handlePress(e.clientX, e.clientY, touch ? prev : null);
  });

  // Room decor, drawn once per room into an offscreen canvas.
  function buildDecor(room, w, h, ratio) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * ratio));
    cv.height = Math.max(1, Math.round(h * ratio));
    const c = cv.getContext('2d');
    c.scale(ratio, ratio);
    const col = S.ROOMS[room].accent;
    let seed = room * 9301 + 49297;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const bg = c.createRadialGradient(w / 2, h * 0.6, 0, w / 2, h * 0.6, Math.max(w, h) * 0.7);
    bg.addColorStop(0, hexA(col, 0.22));
    bg.addColorStop(1, hexA(col, 0.04));
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = hexA(col, 0.75);
    c.fillStyle = hexA(col, 0.12);
    c.lineWidth = 2;
    c.shadowColor = col;
    c.shadowBlur = 12;
    const line = (x1, y1, x2, y2) => {
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
    };
    const arch = (x, y, aw, ah) => {
      c.beginPath();
      c.moveTo(x - aw / 2, y + ah);
      c.lineTo(x - aw / 2, y + aw / 2);
      c.arc(x, y + aw / 2, aw / 2, Math.PI, 0);
      c.lineTo(x + aw / 2, y + ah);
      c.closePath();
      c.fill();
      c.stroke();
    };
    if (room === 0) {
      // Hall: arched windows, portraits, checker floor, chandelier
      const fy = h * 0.68;
      line(0, fy, w, fy);
      for (let i = -12; i <= 12; i++) line(w / 2 + i * w * 0.03, fy, w / 2 + i * w * 0.16, h);
      for (let k = 1; k < 6; k++) {
        const yy = fy + (h - fy) * Math.pow(k / 6, 1.6);
        line(0, yy, w, yy);
      }
      [0.18, 0.5, 0.82].forEach((x) => {
        arch(w * x, h * 0.14, w * 0.11, h * 0.42);
        line(w * x, h * 0.2, w * x, h * 0.56);
        line(w * x - w * 0.055, h * 0.36, w * x + w * 0.055, h * 0.36);
      });
      [0.34, 0.66].forEach((x) => {
        c.strokeRect(w * x - w * 0.05, h * 0.22, w * 0.1, h * 0.22);
        c.beginPath();
        c.ellipse(w * x, h * 0.33, w * 0.03, h * 0.07, 0, 0, TAU);
        c.stroke();
      });
      line(w / 2, 0, w / 2, h * 0.08);
      c.beginPath();
      c.ellipse(w / 2, h * 0.1, w * 0.08, h * 0.025, 0, 0, Math.PI);
      c.stroke();
      for (let i = -3; i <= 3; i++) {
        c.fillStyle = '#ffe14d';
        c.fillRect(w / 2 + i * w * 0.022 - 2, h * 0.075, 4, 10);
      }
    } else if (room === 1) {
      // Attic: roof beams, round window, crates, cobwebs
      line(0, h * 0.55, w / 2, 0);
      line(w, h * 0.55, w / 2, 0);
      for (let i = 1; i < 6; i++) {
        line(w * (i / 12), h * 0.55 - h * 0.55 * (i / 6), w * (i / 12), h);
        line(w - w * (i / 12), h * 0.55 - h * 0.55 * (i / 6), w - w * (i / 12), h);
      }
      c.beginPath();
      c.arc(w / 2, h * 0.3, Math.min(w, h) * 0.09, 0, TAU);
      c.fill();
      c.stroke();
      line(w / 2 - Math.min(w, h) * 0.09, h * 0.3, w / 2 + Math.min(w, h) * 0.09, h * 0.3);
      line(w / 2, h * 0.3 - Math.min(w, h) * 0.09, w / 2, h * 0.3 + Math.min(w, h) * 0.09);
      for (let i = 0; i < 5; i++) {
        const bw = w * (0.06 + rnd() * 0.05);
        const bx = w * (0.08 + rnd() * 0.84);
        const by = h * (0.8 + rnd() * 0.1);
        c.strokeRect(bx, by - bw * 0.8, bw, bw * 0.8);
        line(bx, by - bw * 0.8, bx + bw, by);
        line(bx + bw, by - bw * 0.8, bx, by);
      }
      [
        [0, 0, 1],
        [w, 0, -1],
      ].forEach(([cx, cy, s]) => {
        for (let i = 0; i < 6; i++) {
          const a = (i / 5) * (Math.PI / 2);
          line(cx, cy, cx + s * Math.cos(a) * w * 0.14, cy + Math.sin(a) * w * 0.14);
        }
        for (let r = 1; r < 5; r++) {
          c.beginPath();
          c.arc(cx, cy, r * w * 0.03, s > 0 ? 0 : Math.PI / 2, s > 0 ? Math.PI / 2 : Math.PI);
          c.stroke();
        }
      });
    } else if (room === 2) {
      // Crypt: bricks, arches, tombstones
      c.lineWidth = 1;
      for (let y = 0; y < h * 0.7; y += 26) {
        line(0, y, w, y);
        for (let x = (y / 26) % 2 ? 0 : 30; x < w; x += 60) line(x, y, x, y + 26);
      }
      c.lineWidth = 2.5;
      [0.2, 0.5, 0.8].forEach((x) => arch(w * x, h * 0.18, w * 0.2, h * 0.52));
      for (let i = 0; i < 7; i++) {
        const tx = w * (0.07 + i * 0.145) + rnd() * 20;
        const tw = w * 0.06;
        const th = h * (0.12 + rnd() * 0.06);
        const ty = h * 0.95 - th;
        c.beginPath();
        c.moveTo(tx - tw / 2, h * 0.95);
        c.lineTo(tx - tw / 2, ty + tw / 2);
        c.arc(tx, ty + tw / 2, tw / 2, Math.PI, 0);
        c.lineTo(tx + tw / 2, h * 0.95);
        c.fill();
        c.stroke();
        line(tx, ty + tw * 0.3, tx, ty + tw * 1.2);
        line(tx - tw * 0.25, ty + tw * 0.6, tx + tw * 0.25, ty + tw * 0.6);
      }
      line(0, h * 0.95, w, h * 0.95);
    } else if (room === 3) {
      // Swamp: horizon, moon, dead trees, reeds, ripples
      const hy = h * 0.55;
      line(0, hy, w, hy);
      c.beginPath();
      c.arc(w * 0.8, h * 0.18, Math.min(w, h) * 0.08, 0, TAU);
      c.fill();
      c.stroke();
      for (let i = 0; i < 6; i++) line(w * 0.8 - 30 + rnd() * 20, hy + 12 + i * 14, w * 0.8 + 30 - rnd() * 20, hy + 12 + i * 14);
      const tree = (x, y, len, a, depth) => {
        if (depth === 0) return;
        const x2 = x + Math.cos(a) * len;
        const y2 = y + Math.sin(a) * len;
        c.lineWidth = depth;
        line(x, y, x2, y2);
        tree(x2, y2, len * 0.7, a - 0.4 - rnd() * 0.3, depth - 1);
        tree(x2, y2, len * 0.7, a + 0.4 + rnd() * 0.3, depth - 1);
      };
      tree(w * 0.12, hy, h * 0.16, -Math.PI / 2, 5);
      tree(w * 0.42, hy, h * 0.11, -Math.PI / 2 - 0.1, 4);
      tree(w * 0.93, hy, h * 0.13, -Math.PI / 2 + 0.1, 5);
      c.lineWidth = 2;
      for (let i = 0; i < 26; i++) {
        const rx = rnd() * w;
        const rh = h * (0.06 + rnd() * 0.1);
        c.beginPath();
        c.moveTo(rx, h);
        c.quadraticCurveTo(rx + 8, h - rh / 2, rx + rnd() * 10, h - rh);
        c.stroke();
        if (i % 3 === 0) {
          c.beginPath();
          c.ellipse(rx + 5, h - rh, 3, 9, 0, 0, TAU);
          c.fill();
          c.stroke();
        }
      }
      for (let i = 0; i < 9; i++) {
        c.beginPath();
        c.ellipse(rnd() * w, hy + 30 + rnd() * (h * 0.3), 20 + rnd() * 40, 4 + rnd() * 6, 0, 0, TAU);
        c.stroke();
      }
    } else {
      // Chapel: gothic stained glass window, pews, candles
      const ww = w * 0.24;
      const wx = w / 2;
      c.beginPath();
      c.moveTo(wx - ww / 2, h * 0.55);
      c.lineTo(wx - ww / 2, h * 0.25);
      c.quadraticCurveTo(wx - ww / 2, h * 0.07, wx, h * 0.03);
      c.quadraticCurveTo(wx + ww / 2, h * 0.07, wx + ww / 2, h * 0.25);
      c.lineTo(wx + ww / 2, h * 0.55);
      c.closePath();
      c.save();
      c.clip();
      const glass = [S.COLORS.magenta, S.COLORS.violet, S.COLORS.cyan, S.COLORS.orange, S.COLORS.green];
      for (let i = 0; i < 14; i++) {
        c.fillStyle = hexA(glass[i % glass.length], 0.35);
        c.beginPath();
        c.moveTo(wx, h * 0.3);
        const a1 = (i / 14) * TAU;
        const a2 = ((i + 1) / 14) * TAU;
        c.lineTo(wx + Math.cos(a1) * ww, h * 0.3 + Math.sin(a1) * ww);
        c.lineTo(wx + Math.cos(a2) * ww, h * 0.3 + Math.sin(a2) * ww);
        c.fill();
        c.stroke();
      }
      c.restore();
      c.stroke();
      c.fillStyle = hexA(col, 0.12);
      for (let r = 0; r < 4; r++) {
        const py = h * (0.66 + r * 0.08);
        const inset = (3 - r) * w * 0.03;
        c.strokeRect(w * 0.06 + inset, py, w * 0.36 - inset, h * 0.035);
        c.strokeRect(w * 0.58, py, w * 0.36 - inset, h * 0.035);
      }
      [0.12, 0.88].forEach((x) => {
        for (let i = 0; i < 3; i++) {
          const cx2 = w * x + (i - 1) * 22;
          const ch = 40 + i * 14;
          c.strokeRect(cx2 - 5, h * 0.6 - ch, 10, ch);
          c.fillStyle = '#ffe14d';
          c.beginPath();
          c.ellipse(cx2, h * 0.6 - ch - 8, 4, 8, 0, 0, TAU);
          c.fill();
          c.fillStyle = hexA(col, 0.12);
        }
      });
    }
    return cv;
  }

  function drawHunt(dt, now) {
    const t = now / 1000;
    if (Hunt.room == null) return;
    if (!Hunt.decor || Hunt.decor.width !== Math.round(W * dpr) || Hunt.decorRoom !== Hunt.room) {
      Hunt.decor = buildDecor(Hunt.room, W, H, dpr);
      Hunt.decorRoom = Hunt.room;
    }
    const R = Hunt.radius();
    const torch = Hunt.torch;
    const accent = S.ROOMS[Hunt.room].accent;
    const paused = state.paused;

    // doors
    const locked = Hunt.hasEvent('lockedDoors');
    if (!paused && !locked && now > Hunt.nextDoor && !Hunt.trans) {
      Hunt.nextDoor = now + rand(5000, 8000) * Math.max(0.4, fastMul());
      Hunt.doors.push({ x: rand(0.08, 0.92), y: rand(0.22, 0.86), born: now, life: 3500 });
    }
    Hunt.doors = Hunt.doors.filter((d) => now - d.born < d.life && !d.used);
    for (const d of Hunt.doors) {
      const k = (now - d.born) / d.life;
      d.alpha = locked ? 0 : Math.min(1, k * 5, (1 - k) * 4);
    }

    if (!paused) updateGhosts(dt, now);

    // darkness with a whisper of the room's structure
    ctx.fillStyle = '#030006';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = isMild() ? 0.08 : 0.05;
    ctx.drawImage(Hunt.decor, 0, 0, W, H);
    ctx.globalAlpha = 1;

    // lit circle
    if (!Hunt.dead) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(torch.x, torch.y, R * 1.2, 0, TAU);
      ctx.clip();
      ctx.drawImage(Hunt.decor, 0, 0, W, H);
      const warm = ctx.createRadialGradient(torch.x, torch.y, 0, torch.x, torch.y, R);
      warm.addColorStop(0, Hunt.hasEvent('bloodMoon') ? 'rgba(255,40,60,0.25)' : 'rgba(255,220,170,0.18)');
      warm.addColorStop(1, 'rgba(255,200,150,0)');
      ctx.fillStyle = warm;
      ctx.fillRect(torch.x - R * 1.2, torch.y - R * 1.2, R * 2.4, R * 2.4);
      for (const it of items.values()) {
        if (it.r !== Hunt.room || !visibleTo(it)) continue;
        const ix = it.x * W;
        const iy = it.y * H;
        const sz = itemSize(it, R);
        if (Math.hypot(ix - torch.x, iy - torch.y) > R * 1.2 + sz) continue;
        const pop = clamp((now - (it.born || 0)) / 250, 0.05, 1);
        if (it.t === 's') PS.drawSoul(ctx, ix, iy + Math.sin(t * 2 + it.id) * 3, sz * pop, t, it.v);
        else if (it.t === 'p') PS.drawPumpkin(ctx, ix, iy + Math.sin(t * 1.7 + it.id) * 2, sz * pop, it.n, { glow: sz * 0.5 });
        else PS.drawHammer(ctx, ix, iy + sz * 0.45, sz * pop, Math.sin(t * 4) * 0.3);
      }
      // soft edge of the light
      const edge = ctx.createRadialGradient(torch.x, torch.y, R * 0.35, torch.x, torch.y, R * 1.2);
      edge.addColorStop(0, 'rgba(3,0,6,0)');
      edge.addColorStop(0.75, 'rgba(3,0,6,0.85)');
      edge.addColorStop(1, 'rgba(3,0,6,1)');
      ctx.fillStyle = edge;
      ctx.fillRect(torch.x - R * 1.2, torch.y - R * 1.2, R * 2.4, R * 2.4);
      ctx.restore();
    }

    // doors glow in the dark
    for (const d of Hunt.doors) if (d.alpha > 0) PS.drawDoor(ctx, d.x * W, d.y * H, doorH(R), d.alpha, accent, t);

    // ghosts (faint in the dark, vivid in the light)
    const gs = ghostSize();
    for (const g of Hunt.ghosts) {
      const d = Math.hypot(g.x - torch.x, g.y - torch.y);
      const lit = clamp(1 - d / (R * 1.8), 0, 1);
      PS.drawGhost(ctx, g.gi, g.x, g.y, gs, t + g.phase, 0.22 + lit * 0.7);
    }

    // auto-collect souls the torch centre touches
    if (!Hunt.dead && !Hunt.trans && !paused) {
      for (const it of items.values()) {
        if (it.t === 's' && it.r === Hunt.room && !it.pending && Math.hypot(it.x * W - torch.x, it.y * H - torch.y) < itemSize(it, R) * 2.2 + 10) claim(it);
      }
    }

    drawHint(R, now);
    particles.update(dt);
    particles.draw(ctx);

    // floating "+1"s
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      const k = (now - f.t) / 900;
      if (k > 1) {
        floaters.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 10;
      ctx.font = '900 20px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - 20 - k * 40);
      ctx.restore();
    }

    // the player's costume at the torch centre
    if (!Hunt.dead) {
      const invis = now < Hunt.invisUntil;
      ctx.save();
      ctx.globalAlpha = invis ? 0.25 + 0.25 * Math.sin(t * 20) : 1;
      const halo = ctx.createRadialGradient(torch.x, torch.y, R * 0.7, torch.x, torch.y, R * 1.25);
      halo.addColorStop(0, hexA(accent, 0));
      halo.addColorStop(0.6, hexA(accent, 0.1));
      halo.addColorStop(1, hexA(accent, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(torch.x - R * 1.3, torch.y - R * 1.3, R * 2.6, R * 2.6);
      PS.drawCostume(ctx, me.costume, torch.x, torch.y, Math.max(26, R * 0.32));
      ctx.restore();
    }

    // room-change transition and room title splash
    if (Hunt.trans) {
      const k = (now - Hunt.trans.t) / 380;
      ctx.fillStyle = `rgba(3,0,6,${clamp(k, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
      if (k >= 1 && Hunt.trans.room != null) {
        const r = Hunt.trans.room;
        Hunt.trans = null;
        Sound.whoosh();
        Hunt.enterRoom(r);
      } else if (k > 8) Hunt.trans = null;
    }
    if (Hunt.splash) {
      const k = (now - Hunt.splash.t) / 1600;
      if (k > 1) Hunt.splash = null;
      else {
        ctx.fillStyle = `rgba(3,0,6,${clamp(1 - k * 2.5, 0, 1)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.globalAlpha = Math.sin(k * Math.PI);
        const c = S.ROOMS[Hunt.splash.room].accent;
        ctx.fillStyle = c;
        ctx.shadowColor = c;
        ctx.shadowBlur = 30;
        ctx.font = `${Math.round(Math.min(W, H) * 0.12)}px Creepster, cursive`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`THE ${S.ROOMS[Hunt.splash.room].name.toUpperCase()}`, W / 2, H / 2);
        ctx.restore();
      }
    }
    if (Hunt.hasEvent('bloodMoon')) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,23,68,0.06)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = S.COLORS.red;
      ctx.shadowColor = S.COLORS.red;
      ctx.shadowBlur = 40;
      ctx.beginPath();
      ctx.arc(W - 70, 90, 26, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawHint(R, now) {
    if (Hunt.dead || Hunt.trans || !me) return;
    const strong = state.act === 1 && state.overtime && !me.pumpkin && !me.hammer;
    const idle = now - Hunt.lastCollect > 30000 * fastMul();
    if (!strong && !idle) return;
    const torch = Hunt.torch;
    let target = null;
    let best = Infinity;
    let color = S.COLORS.violet;
    for (const it of items.values()) {
      if (it.r !== Hunt.room || !visibleTo(it)) continue;
      if (strong && it.t !== 'p') continue;
      if ((it.t === 'p' && (me.pumpkin || me.hammer)) || (it.t === 'h' && (me.pumpkin || me.hammer))) continue;
      const d = Math.hypot(it.x * W - torch.x, it.y * H - torch.y);
      const w = it.t === 's' ? d : d * 0.5; // prefer pumpkins and the hammer
      if (w < best) {
        best = w;
        target = { x: it.x * W, y: it.y * H, d };
        color = it.t === 'p' ? S.COLORS.orange : S.COLORS.cyan;
      }
    }
    if (!target) {
      for (const dr of Hunt.doors) {
        const d = Math.hypot(dr.x * W - torch.x, dr.y * H - torch.y);
        if (d < best) {
          best = d;
          target = { x: dr.x * W, y: dr.y * H, d };
          color = S.COLORS.violet;
        }
      }
    }
    if (!target || target.d < R * 0.8) return;
    const ang = Math.atan2(target.y - torch.y, target.x - torch.x);
    const m = 26;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const tx = dx > 0 ? (W - m - torch.x) / dx : dx < 0 ? (m - torch.x) / dx : Infinity;
    const ty = dy > 0 ? (H - m - torch.y) / dy : dy < 0 ? (m - torch.y) / dy : Infinity;
    const k = Math.min(tx, ty);
    const ex = torch.x + dx * k;
    const ey = torch.y + dy * k;
    const pulse = 0.5 + 0.5 * Math.sin(now / (strong ? 140 : 380));
    const rad = strong ? 150 : 90;
    const a = strong ? 0.45 + 0.4 * pulse : 0.12 + 0.18 * pulse;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, rad);
    g.addColorStop(0, hexA(color, a));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(ex - rad, ey - rad, rad * 2, rad * 2);
    ctx.translate(ex - dx * 18, ey - dy * 18);
    ctx.rotate(ang);
    ctx.fillStyle = hexA(color, Math.min(1, a * 1.6));
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -8);
    ctx.lineTo(-6, 8);
    ctx.fill();
    ctx.restore();
  }

  function drawDeathFace(now) {
    const info = Hunt.deathInfo;
    const dc = $('death-canvas');
    if (!info || $('death').hidden) return;
    const r = PS.fitCanvas(dc, 1.5);
    const c = dc.getContext('2d');
    c.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    c.clearRect(0, 0, r.W, r.H);
    const k = (now - info.t) / 1000;
    const zoom = isMild() ? 1 : 1 + Math.max(0, 0.5 - k) * 1.2;
    const size = Math.min(r.W, r.H) * 0.75 * zoom;
    const jx = isMild() ? 0 : rand(-3, 3);
    PS.drawGhost(c, info.gi, r.W / 2 + jx, r.H * 0.42, size, k, isMild() ? clamp(k, 0, 0.85) : 0.95);
  }

  // ===================================================================
  // Main loop
  // ===================================================================
  let last = performance.now();
  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const fit = PS.fitCanvas(canvas, 1.5);
    if (fit.W !== W || fit.H !== H) {
      if (W && Hunt.ghosts.length) {
        Hunt.ghosts.forEach((g) => {
          g.x *= fit.W / W;
          g.y *= fit.H / H;
        });
      }
      W = fit.W;
      H = fit.H;
      Hunt.decor = null;
    }
    dpr = fit.dpr;
    const [sx, sy] = shaker.offset(dt);
    ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
    const hunting = joined && state && state.phase === 'HUNT';
    if (hunting) {
      drawHunt(dt, now);
      const rem = remaining();
      $('hud-timer').textContent = state.overtime ? 'OVERTIME' : PS.fmtTime(rem);
      drawDeathFace(now);
    } else {
      ctx.fillStyle = PS.S.COLORS.bg;
      ctx.fillRect(-50, -50, W + 100, H + 100);
      const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.8);
      g.addColorStop(0, 'rgba(139,43,255,0.18)');
      g.addColorStop(1, 'rgba(5,1,10,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      PS.ambientEmbers(particles, W, H, 1);
      stage.render(ctx, W, H, dt);
      particles.update(dt);
      particles.draw(ctx);
      if (joined && state) {
        const rem = remaining();
        if (state.phase === 'PITCHES' && $('p-bar')) $('p-bar').style.width = `${state.dur ? (rem / state.dur) * 100 : 0}%`;
        if (state.phase === 'VOTE' && $('v-timer')) $('v-timer').textContent = PS.fmtTime(rem);
        if (state.phase === 'RULES' && $('r-timer')) $('r-timer').textContent = PS.fmtTime(rem);
      }
    }
    // chromatic flash
    if (flash) {
      const k = (now - flash.t) / 320;
      if (k > 1) flash = null;
      else {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        flash.colors.forEach((c, i) => {
          ctx.globalAlpha = (1 - k) * 0.35 * flash.k;
          ctx.fillStyle = c;
          const o = (i - 1) * 12 * (1 - k);
          ctx.fillRect(o, -o, W, H);
        });
        ctx.restore();
      }
    }
  }
  // Schedule first so one bad frame can never stop the render loop.
  function frame(now) {
    requestAnimationFrame(frame);
    try {
      draw(now);
    } catch (err) {
      console.error(err);
      canvas.width = canvas.width; // drop any unbalanced save()/clip state
    }
  }
  requestAnimationFrame(frame);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' && e.target.tagName !== 'INPUT') {
      Sound.toggleMute();
      applyMode();
    }
  });
  if (!session) showJoin();

  // Test hook for automated browser runs (?debug=1). Exposes nothing secret: items are broadcast anyway.
  if (/[?&]debug=1/.test(location.search)) {
    window.__ps = {
      get items() {
        return [...items.values()];
      },
      get me() {
        return me;
      },
      get state() {
        return state;
      },
      get doors() {
        return Hunt.doors.map((d) => ({ x: d.x * W, y: d.y * H, alpha: d.alpha }));
      },
      get ghosts() {
        return Hunt.ghosts.map((g) => ({ x: g.x, y: g.y }));
      },
      get room() {
        return Hunt.room;
      },
      get dead() {
        return Hunt.dead;
      },
      size: () => ({ W, H }),
    };
  }
})();
