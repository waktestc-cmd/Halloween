// Player screen: join, the dark house, pitches, vote, smash, result.
/* global io, PS */
(function () {
  const { S, T, Sound, Particles, Shaker, Stage, rand, pick, clamp, lerp, ease, hexA, store, TAU, flicker } = PS;
  const $ = (id) => document.getElementById(id);
  const fx = $('fx');
  const ctx = fx.getContext('2d');
  const screenEl = $('screen');
  const view = new PS.RoomView($('room'));
  const roomCv = view.canvas; // the renderer may swap in a fresh canvas for its 2D fallback
  let META = null;
  fetch('/rooms/rooms.json')
    .then((r) => r.json())
    .then((m) => (META = m))
    .catch(() => (META = { rooms: [] }));

  const socket = io({ transports: ['websocket', 'polling'] });
  let session = store.get('ps_session', null); // {name, costume, token}
  let mode = store.get('ps_mode', 'spooky');
  let joined = false;
  let me = null;
  let state = null;
  let items = new Map();
  let screenKey = '';
  let timerBase = { remaining: null, at: 0, paused: false };
  let lamps = []; // small canvases with live light sources, redrawn every frame

  const particles = new Particles();
  const shaker = new Shaker();
  const stage = new Stage(particles, shaker);
  stage.scale = 0.85;
  stage.cy = 0.6;
  stage.objects = false;
  let W = 0;
  let H = 0;
  let dpr = 1;

  const isMild = () => mode === 'mild' || PS.reducedMotion;
  function applyMode() {
    Sound.mild = isMild();
    stage.mild = isMild();
    $('btn-mode').textContent = mode === 'mild' ? 'Mild' : 'Spooky';
    $('btn-mute').textContent = Sound.isMuted() ? 'Sound off' : 'Sound on';
  }
  applyMode();
  $('btn-mode').onclick = () => {
    mode = mode === 'mild' ? 'spooky' : 'mild';
    store.set('ps_mode', mode);
    applyMode();
    toast(mode === 'mild' ? 'Mild. Gentler, and no screaming.' : 'Spooky. As intended.');
  };
  $('btn-mute').onclick = () => {
    Sound.unlock();
    Sound.toggleMute();
    applyMode();
  };
  $('btn-fs').onclick = () => PS.toggleFullscreen();
  $('inv-hammer').innerHTML = '<svg viewBox="0 0 100 100" class="sil"><path d="M46 30H54V100H46ZM20 6H80L84 10V30L80 34H20L16 30V10Z"/></svg>';

  function toast(text, ms = 2600) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toast.h);
    toast.h = setTimeout(() => (t.hidden = true), ms);
  }
  function banner(title, sub, lit, ms = 3600) {
    const b = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub || '';
    b.classList.toggle('flame', !!lit);
    b.hidden = false;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    clearTimeout(banner.h);
    banner.h = setTimeout(() => (b.hidden = true), ms);
  }
  function remaining() {
    if (timerBase.remaining == null) return null;
    if (timerBase.paused) return timerBase.remaining;
    return Math.max(0, timerBase.remaining - (performance.now() - timerBase.at));
  }
  const fastMul = () => (state && state.fast ? 0.15 : 1);
  const owner = (who) => (who ? `${who.name}’s` : 'the House’s');
  const nameOf = PS.nameOf;
  function lamp(cv, fn) {
    lamps.push({ cv, fn });
  }

  // ===================================================================
  // Join
  // ===================================================================
  function showJoin(error) {
    joined = false;
    screenKey = 'join';
    lamps = [];
    $('hud').hidden = true;
    document.body.classList.remove('hunting');
    screenEl.hidden = false;
    screenEl.innerHTML = `
      <div class="panel join">
        <h1 class="title display">Pumpkin Smash</h1>
        <p class="lede">Somewhere in this house is a Friday afternoon off. Bring a torch.</p>
        <input id="j-name" class="field" maxlength="${S.MAX_NAME}" placeholder="Your name" autocomplete="off" spellcheck="false" />
        <div class="picker" id="j-pick"></div>
        <div class="chosen" id="j-chosen"></div>
        <button class="cta" id="j-go">Enter the house</button>
        <div class="row">
          <span><button class="textbtn" data-m="spooky">Spooky</button> <span class="quiet">·</span> <button class="textbtn" data-m="mild">Mild</button></span>
          <button class="textbtn" id="j-fs">Full screen</button>
        </div>
        <div class="err" id="j-err"></div>
      </div>`;
    const name = $('j-name');
    name.value = (session && session.name) || '';
    let costume = (session && session.costume) || pick(S.COSTUMES).id;
    const grid = $('j-pick');
    S.COSTUMES.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'pick';
      b.dataset.id = c.id;
      b.title = c.name;
      b.innerHTML = PS.silSVG(c.id) + `<small>${c.name}</small>`;
      b.onclick = () => {
        costume = c.id;
        sync();
        Sound.unlock();
        Sound.blip();
      };
      grid.appendChild(b);
    });
    const modeBtns = screenEl.querySelectorAll('[data-m]');
    function sync() {
      grid.querySelectorAll('.pick').forEach((t) => t.classList.toggle('on', t.dataset.id === costume));
      modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      $('j-chosen').textContent = `You are the ${PS.costumeById(costume).name.toLowerCase()}.`;
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
        $('j-err').textContent = 'The house needs a name.';
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
        return showJoin((res && res.error) || 'The door would not open.');
      }
      session = { name: res.me.name, costume: res.me.costume, token: res.token };
      store.set('ps_session', session);
      joined = true;
      setMe(res.me);
      if (res.rejoined) toast(`Welcome back, ${res.me.name}. Nothing was lost.`);
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
  socket.on('disconnect', () => toast('Lost the connection. Trying the door again…', 4000));
  socket.on('kicked', () => {
    joined = false;
    showJoin('You came in through another tab or device.');
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
    Object.assign(it, m);
    it.born = performance.now();
  });
  socket.on('item-', (m) => {
    const it = items.get(m.id);
    items.delete(m.id);
    if (!it || !me || m.by === me.name) return;
    if (it.r === Hunt.room && state && state.phase === 'HUNT') {
      if (it.t === 'p' && m.by) toast(`${m.by} took Pumpkin ${it.n}. Right in front of you.`);
      if (it.t === 'h' && m.by && !me.pumpkin) toast(`${m.by} took the hammer.`);
    }
  });
  socket.on('announce', (a) => {
    if (!joined || !state) return;
    if (a.kind === 'act') {
      const act = S.ACTS[a.act];
      let sub = act.sub;
      if (a.act === 2 && me && me.pumpkin) sub = 'You have a pumpkin. The hammer will not show itself to you.';
      banner(`Act ${act.ordinal}. ${act.name}.`, sub, false, 4200);
      Sound.sting();
      Hunt.lastCollect = performance.now();
      Hunt.respawnGhosts();
    } else if (a.kind === 'event') {
      const ev = S.EVENTS[a.type];
      banner(ev.line(a.room != null ? S.ROOMS[a.room].name : ''), '', false, 3800);
      Sound.sting();
    } else if (a.kind === 'pumpkinSpawn') {
      Sound.spawnBell();
      toast(a.room === Hunt.room ? 'Something just turned up in here.' : `Pumpkin ${a.n} is somewhere in the ${S.ROOMS[a.room].name}.`, 3200);
    } else if (a.kind === 'overtime') {
      banner('Nobody leaves until every pumpkin has a keeper.', '', false, 4200);
      Sound.sting();
    }
  });

  function setMe(m) {
    const prev = me;
    me = m;
    if (prev && prev.gameId !== m.gameId) resetLocal();
    $('inv-souls').textContent = m.souls;
    $('inv-pumpkin').hidden = !m.pumpkin;
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
    const hunting = ph === 'HUNT';
    document.body.classList.toggle('hunting', hunting);
    $('hud').hidden = !hunting;
    roomCv.hidden = !hunting;
    screenEl.hidden = hunting;
    if (hunting) {
      Hunt.onState();
      if (screenKey !== key) {
        screenKey = key;
        screenEl.innerHTML = '';
        lamps = [];
      }
      return;
    }
    Hunt.leave();
    if (ph !== 'SMASH' && ph !== 'RESULT') stage.clear();
    if (screenKey !== key) {
      screenKey = key;
      lamps = [];
      buildScreen(ph);
    }
    if (ph === 'LOBBY' && $('l-count')) $('l-count').textContent = state.playerCount === 1 ? 'You are alone in here. For now.' : `${state.playerCount} people are inside.`;
    if (ph === 'VOTE') updateVote();
  }

  function pumpkinCanvas(px, n, litFn) {
    const cv = document.createElement('canvas');
    const r = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = cv.height = Math.round(px * r);
    cv.style.width = cv.style.height = px + 'px';
    cv.className = 'lamp';
    lamp(cv, (c, w, h, t) => {
      c.clearRect(0, 0, w, h);
      PS.drawPumpkin(c, w / 2, h * 0.52, w * 0.44, n, Object.assign({ t }, litFn()));
    });
    return cv;
  }

  function buildScreen(ph) {
    screenEl.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel';
    screenEl.appendChild(panel);
    if (ph === 'LOBBY') {
      panel.innerHTML = `<div class="window">${PS.silSVG(me.costume)}</div><h1 class="hero display" id="l-name"></h1><p class="quiet" id="l-count"></p><p class="quiet">Watch the shared screen. The house opens when the host says so.</p><div class="row"><button class="textbtn" id="l-leave">Not you? Change your name</button></div>`;
      $('l-name').textContent = 'You’re in.';
      $('l-leave').onclick = () => {
        session = null;
        store.set('ps_session', null);
        location.reload();
      };
    } else if (ph === 'RULES') {
      panel.className = 'panel rules';
      panel.innerHTML = `<p class="display">Find pumpkins.</p><p class="display">Find the hammer.</p><p class="display">Collect souls.</p><p class="display">Avoid ghosts.</p>
        <p class="quiet">Your light follows your ${'ontouchstart' in window ? 'finger' : 'mouse'}. Click what it finds. Doors open now and then; light leaks out.</p>`;
    } else if (ph === 'PITCHES') {
      const pk = state.pumpkins[state.pitchIndex];
      const mine = me.pumpkin === pk.n;
      panel.className = 'panel pitch';
      panel.innerHTML = `<p class="quiet">Pitch ${state.pitchIndex + 1} of ${S.NUM_PUMPKINS}</p>`;
      panel.appendChild(pumpkinCanvas(300, pk.n, () => ({ lit: 1 })));
      const who = PS.whoEl(pk.holder);
      panel.appendChild(who);
      const p = document.createElement('p');
      p.className = 'quiet';
      p.textContent = mine ? 'Your turn. Unmute and make your case.' : `Pumpkin ${pk.n}. Is it this one?`;
      panel.appendChild(p);
      const bar = document.createElement('div');
      bar.className = 'burn';
      bar.id = 'p-bar';
      panel.appendChild(bar);
    } else if (ph === 'VOTE') {
      panel.innerHTML = `<h1 class="display" style="font-size:clamp(38px,7vw,76px);margin:0">Which one do we smash?</h1><p class="quiet" id="v-weight"></p><div class="votes" id="v-grid"></div><div class="timer num" id="v-timer"></div>`;
      const grid = $('v-grid');
      state.pumpkins.forEach((pk) => {
        const b = document.createElement('button');
        b.className = 'vote';
        b.dataset.n = pk.n;
        b.appendChild(pumpkinCanvas(190, pk.n, () => ({ lit: voteLight(pk.n) })));
        b.appendChild(PS.whoEl(pk.holder));
        const w = document.createElement('span');
        w.className = 'w num';
        b.appendChild(w);
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
      panel.innerHTML = `<div class="smash-line display"><span class="typed" id="s-line"></span></div><div class="after" id="s-after" hidden>Smashed.</div>`;
      $('s-line').textContent = `${PS.NameOf(sm.hammer)} swings at Pumpkin ${sm.target}.`;
      stage.smash(sm, state.elapsed);
      setTimeout(() => $('s-after') && ($('s-after').hidden = false), Math.max(0, 5600 - state.elapsed));
    } else if (ph === 'RESULT') {
      const r = state.result;
      stage.result(r);
      panel.innerHTML = `<h1 class="result-title display ${r.win ? 'win' : 'lose'}">${r.win ? 'Friday afternoon off.' : 'Zombie pumpkin.'}</h1>`;
      const line = (text, delay) => {
        const p = document.createElement('p');
        p.className = 'result-line';
        p.style.animationDelay = delay + 's';
        p.textContent = text;
        panel.appendChild(p);
      };
      line(r.win ? `Pumpkin ${r.smashed} was ${owner(r.smashedHolder)}. It held the prize.` : `Pumpkin ${r.smashed} was ${owner(r.smashedHolder)}. Hollow.`, 1.0);
      if (!r.win) line(`The prize was in Pumpkin ${r.winning}. ${PS.NameOf(r.winningHolder)} had it all along.`, 3.2);
      panel.appendChild(credits(r.awards, 4.2));
      const you = document.createElement('p');
      you.className = 'quiet';
      you.style.marginTop = '40px';
      you.textContent = `You: ${me.souls} soul${me.souls === 1 ? '' : 's'}, ${me.deaths} death${me.deaths === 1 ? '' : 's'}.`;
      panel.appendChild(you);
    }
  }

  function credits(aw, delay) {
    const box = document.createElement('div');
    box.className = 'credits';
    const add = (label, a, unit, i) => {
      const d = document.createElement('div');
      d.className = 'credit';
      d.style.animationDelay = delay + i * 0.5 + 's';
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = label + (a && a.value != null ? ` · ${a.value} ${unit}` : '');
      const n = document.createElement('div');
      n.className = 'names';
      if (a) a.who.forEach((w) => n.appendChild(PS.whoEl(w)));
      else n.textContent = 'Nobody';
      d.append(l, n);
      box.appendChild(d);
    };
    add('Most souls', aw.souls, 'souls', 0);
    add('Most haunted', aw.haunted, 'deaths', 1);
    add('Hammer hero', aw.hammer, '', 2);
    return box;
  }

  function voteLight(n) {
    if (!state || !state.tally) return 0.15;
    const { weights } = state.tally;
    const max = Math.max(...weights);
    if (max <= 0) return 0.15;
    return weights[n - 1] === max ? 1 : 0.12 + 0.6 * (weights[n - 1] / max);
  }
  function updateVote() {
    const grid = $('v-grid');
    if (!grid || !state.tally) return;
    const { weights, counts } = state.tally;
    grid.querySelectorAll('.vote').forEach((b) => {
      const n = Number(b.dataset.n);
      b.classList.toggle('on', me.vote === n);
      b.querySelector('.w').textContent = counts[n - 1] ? `${weights[n - 1]} from ${counts[n - 1]}` : '';
    });
    $('v-weight').textContent = `Your vote weighs ${1 + me.souls}.` + (me.vote ? ` You chose Pumpkin ${me.vote}. You can change your mind.` : '');
  }

  // ===================================================================
  // The hunt (all positions in room space: u, v in 0..1 of the painting)
  // ===================================================================
  const Hunt = {
    room: null,
    active: false,
    ready: false,
    torch: { x: 0, y: 0 },
    hasPointer: false,
    ghosts: [],
    door: null,
    nextDoor: 0,
    flare: null,
    nextFlare: 0,
    nextDistant: 0,
    dust: [],
    dead: false,
    trans: null,
    graceUntil: 0,
    invisUntil: 0,
    lastCollect: 0,
    lastWhisper: 0,
    zombies: [],
    lastPos: 0,
    sentPos: null,
    walk: 0,
    lastStep: 0,
    splash: null,
    deathInfo: null,
    ignite: [],

    reset() {
      this.room = null;
      this.ghosts = [];
      this.zombies = [];
      this.door = null;
      this.flare = null;
      this.dead = false;
      this.trans = null;
      this.deathInfo = null;
      this.ignite = [];
      $('death').hidden = true;
    },
    leave() {
      if (!this.active) return;
      this.active = false;
      this.reset();
      Sound.stopDrone();
      Sound.setBreath(0);
    },
    onState() {
      const t = performance.now();
      if (!this.active) {
        this.active = true;
        this.lastCollect = t;
        this.graceUntil = t + 2500;
        if (!this.hasPointer) {
          this.torch.x = W / 2;
          this.torch.y = H * 0.55;
        }
      }
      if (this.room == null && me.room != null) this.enterRoom(me.room);
      const tick = state.feed[state.feed.length - 1];
      const tk = $('hud-ticker');
      if (tick && tk.dataset.id !== String(tick.id)) {
        tk.dataset.id = tick.id;
        tk.textContent = tick.text;
        tk.classList.remove('pop');
        void tk.offsetWidth;
        tk.classList.add('pop');
      }
    },
    meta() {
      return (META && META.rooms.find((r) => r.id === S.ROOMS[this.room].id)) || { doors: [], candles: [], surfaces: [] };
    },
    hasEvent(type, room) {
      return !!state && state.events.some((e) => e.type === type && (room == null || e.room === room));
    },
    baseRadius() {
      let r = Math.max(W * 0.08, Math.min(W, H) * 0.11, 56);
      if (this.hasEvent('bloodMoon')) r *= 0.5;
      return r;
    },
    enterRoom(r) {
      this.room = r;
      this.ready = false;
      this.door = null;
      this.flare = null;
      this.dust = [];
      peers.clear();
      const now = performance.now();
      this.nextDoor = now + rand(1500, 3500) * fastMul();
      this.nextFlare = now + rand(8000, 16000);
      this.nextDistant = now + rand(6000, 12000);
      view.use(S.ROOMS[r].id).then(() => {
        if (this.room !== r) return;
        this.ready = true;
        this.respawnGhosts();
        this.splash = { t: performance.now(), room: r };
        // warm the cache for the other rooms
        S.ROOMS.forEach((x) => x.id !== S.ROOMS[r].id && setTimeout(() => view.load(x.id), 1500));
      });
      this.graceUntil = Math.max(this.graceUntil, now + 1500);
      $('hud-room').textContent = `The ${S.ROOMS[r].name.toLowerCase()}`;
      Sound.setDrone(r);
    },
    respawnGhosts() {
      if (this.room == null) return;
      this.ghosts = [];
      const n = state && state.act === 3 ? 2 : 1;
      for (let i = 0; i < n; i++) this.ghosts.push(makeGhost(this.room, false));
      this.zombies = [];
      const nz = state && state.act === 3 ? 2 : 1;
      for (let i = 0; i < nz; i++) this.zombies.push(makeZombie(this.room));
    },
  };

  const speedMul = () => [1, 1, 1.35, 1.75][(state && state.act) || 1];
  function torchRoom() {
    return view.toRoom(Hunt.torch.x, Hunt.torch.y);
  }
  function makeGhost(room, extra) {
    const tr = torchRoom();
    let u;
    let v;
    let tries = 0;
    do {
      u = rand(0.08, 0.92);
      v = rand(0.2, 0.85);
      tries++;
    } while (Math.hypot((u - tr.u) * 1.78, v - tr.v) < 0.45 && tries < 30);
    return { gi: room, u, v, tu: rand(0.1, 0.9), tv: rand(0.25, 0.8), cu: u, cv: v, vu: 0, vv: 0, phase: rand(0, TAU), mode: 'drift', modeUntil: performance.now() + rand(3000, 7000), hop: 0, extra };
  }
  const ghostPx = () => 290 * view.view.scale;

  // ---- zombies: slow, floor-bound, drawn to light
  const AS = 1080 / 1920;
  function makeZombie(room) {
    const tr = torchRoom();
    let u;
    let tries = 0;
    do {
      u = rand(0.06, 0.94);
      tries++;
    } while (Math.abs(u - tr.u) < 0.3 && tries < 30);
    return { gi: room, u, v: rand(0.74, 0.9), tu: rand(0.1, 0.9), tv: rand(0.74, 0.9), f: 1, seed: rand(0, TAU), nextGroan: performance.now() + rand(2000, 6000), nextStep: 0 };
  }
  const zombieH = (z) => lerp(250, 480, clamp((z.v - 0.7) / 0.24, 0, 1)) * view.view.scale;
  function updateZombies(dt, now, R) {
    const tr = torchRoom();
    const t = now / 1000;
    const base = 0.02 * speedMul();
    for (const z of Hunt.zombies) {
      const du = (tr.u - z.u) / AS;
      const dv = tr.v - z.v;
      const near = Math.hypot(du, dv) < 0.5 && !Hunt.dead && now > Hunt.invisUntil;
      // a lurching gait: fast, slow, fast
      const lurch = 0.45 + 0.55 * Math.abs(Math.sin(t * 2.2 + z.seed));
      if (near) {
        const sp = base * 1.8 * lurch;
        const tv = clamp(tr.v + 0.12, 0.72, 0.93);
        const d = Math.hypot(du, (tv - z.v)) || 1;
        z.u += (du / d) * sp * dt * AS;
        z.v += ((tv - z.v) / d) * sp * dt;
        if (Math.abs(du) > 0.01) z.f = du < 0 ? -1 : 1;
      } else {
        const wu = (z.tu - z.u) / AS;
        const wv = z.tv - z.v;
        const d = Math.hypot(wu, wv);
        if (d < 0.02) {
          z.tu = rand(0.08, 0.92);
          z.tv = rand(0.74, 0.92);
        } else {
          z.u += (wu / d) * base * lurch * dt * AS;
          z.v += (wv / d) * base * lurch * dt;
          z.f = wu < 0 ? -1 : 1;
        }
      }
      z.u = clamp(z.u, 0.04, 0.96);
      z.v = clamp(z.v, 0.72, 0.94);
      const sp = view.toScreen(z.u, z.v);
      z.sx = sp.x;
      z.sy = sp.y;
      z.h = zombieH(z);
      const cx = sp.x + z.f * z.h * 0.12;
      const cy = sp.y - z.h * 0.6;
      const d = Math.hypot(cx - Hunt.torch.x, cy - Hunt.torch.y);
      const pan = clamp((cx - Hunt.torch.x) / (W / 2), -1, 1);
      if (d < R * 3.2 && now > z.nextGroan && !Hunt.dead) {
        z.nextGroan = now + rand(3500, 7500);
        Sound.groan(pan, 0.08 + 0.12 * clamp(1 - d / (R * 3.2), 0, 1));
      }
      if (near && d < R * 2.5 && now > z.nextStep) {
        z.nextStep = now + 700 / lurch;
        Sound.shuffle(pan);
      }
      const safe = now < Hunt.graceUntil || now < Hunt.invisUntil || Hunt.trans || Hunt.dead || state.paused;
      // it has to get its hands on the lantern: the upper body, near the reaching arms
      const hx = Hunt.torch.x - (sp.x + z.f * z.h * 0.22);
      const hy = Hunt.torch.y - sp.y;
      if (!safe && Math.abs(hx) < z.h * 0.2 && hy > -z.h * 0.95 && hy < -z.h * 0.4) die(z, 'zombie');
    }
  }

  // ---- other players in this room: where their lanterns are
  const peers = new Map(); // name -> {c, u, v, tu, tv, d}
  socket.on('peers', (list) => {
    if (!state || state.phase !== 'HUNT') return;
    const seen = new Set();
    for (const p of list) {
      seen.add(p.n);
      let q = peers.get(p.n);
      if (!q) {
        q = { u: p.u, v: p.v };
        peers.set(p.n, q);
      }
      Object.assign(q, { c: p.c, tu: p.u, tv: p.v, d: p.d });
    }
    for (const k of [...peers.keys()]) if (!seen.has(k)) peers.delete(k);
  });
  // a player is their light: the costume silhouette at its centre and a small hand lantern
  const presenceSize = (R) => Math.max(28, R * 0.34);
  function drawPresence(costume, x, y, size, alpha, t) {
    ctx.save();
    ctx.globalAlpha = alpha;
    PS.drawSil(ctx, costume, x, y, size, T.bone);
    ctx.restore();
    PS.drawLantern(ctx, x + size * 0.58, y + size * 0.22, size * 0.3, t, alpha);
  }
  function sendPos(now) {
    if (now - Hunt.lastPos < 120 || !Hunt.ready) return;
    const r = torchRoom();
    const s = Hunt.sentPos;
    if (s && Math.abs(s.u - r.u) < 0.002 && Math.abs(s.v - r.v) < 0.002 && now - Hunt.lastPos < 1000) return;
    Hunt.lastPos = now;
    Hunt.sentPos = r;
    socket.volatile.emit('pos', { u: r.u, v: r.v });
  }

  function updateGhosts(dt, now, R) {
    const want = Hunt.hasEvent('ghostFlood', Hunt.room) ? 3 : 0;
    const extras = Hunt.ghosts.filter((g) => g.extra).length;
    if (extras < want) for (let i = extras; i < want; i++) Hunt.ghosts.push(makeGhost(Hunt.room, true));
    if (extras > want) Hunt.ghosts = Hunt.ghosts.filter((g) => !g.extra);
    const tr = torchRoom();
    const base = 0.04 * speedMul(); // room heights per second
    const t = now / 1000;
    let nearest = Infinity;
    let nearPan = 0;
    for (const g of Hunt.ghosts) {
      if (now > g.modeUntil) {
        if (g.mode === 'drift') {
          g.mode = 'home';
          g.modeStart = now;
          g.modeUntil = now + rand(1800, 3000);
        } else {
          g.mode = 'drift';
          g.modeUntil = now + rand(5000, 10000) * (state.act === 3 ? 0.6 : 1);
          g.tu = rand(0.1, 0.9);
          g.tv = rand(0.25, 0.8);
        }
      }
      const id = S.GHOSTS[g.gi].id;
      // u is stretched by the aspect ratio so speeds are even in both directions
      const AS = 1080 / 1920;
      if (g.mode === 'home' && !Hunt.dead) {
        const du = (tr.u - g.u) / AS;
        const dv = tr.v - g.v;
        const d = Math.hypot(du, dv) || 1;
        let sp = base * { butler: 1.9, ragdoll: 2.3, warden: 2.7, bride: 1.6, choir: 1.9 }[id];
        if (id === 'ragdoll') sp *= Math.sin(t * 9 + g.phase) > 0 ? 1.7 : 0.15;
        if (id === 'warden') sp *= now - g.modeStart > 600 ? 1 : 0.2;
        g.u += (du / d) * sp * dt * AS;
        g.v += (dv / d) * sp * dt;
      } else if (id === 'butler') {
        const du = (g.tu - g.u) / AS;
        const dv = g.tv - g.v;
        const d = Math.hypot(du, dv);
        if (d < 0.02) {
          g.tu = rand(0.1, 0.9);
          g.tv = rand(0.25, 0.8);
        } else {
          g.u += (du / d) * base * dt * AS;
          g.v += (dv / d) * base * dt;
        }
      } else if (id === 'ragdoll') {
        g.hop -= dt;
        if (g.hop <= 0) {
          g.hop = rand(0.35, 0.9);
          const a = rand(0, TAU);
          g.vu = Math.cos(a) * base * 4 * AS;
          g.vv = Math.sin(a) * base * 4;
        }
        const k = g.hop > 0.2 ? 0.05 : 1;
        g.u += g.vu * dt * k;
        g.v += g.vv * dt * k;
      } else if (id === 'warden') {
        g.vu = g.vu || 1;
        g.u += Math.sign(g.vu) * base * 0.75 * dt * AS;
        if (g.u < 0.08 || g.u > 0.92) g.vu = -Math.sign(g.vu);
        g.v += (g.tv - g.v) * 0.3 * dt;
      } else if (id === 'bride') {
        g.u += Math.cos(t * 0.5 + g.phase) * base * 0.9 * dt * AS;
        g.v += Math.sin(t * 1.1 + g.phase) * base * 0.6 * dt;
      } else {
        g.cu += (g.tu - g.cu) * 0.15 * dt;
        g.cv += (g.tv - g.cv) * 0.15 * dt;
        const a = t * 0.9 * speedMul() + g.phase;
        g.u += (g.cu + Math.cos(a) * 0.16 * AS - g.u) * 2 * dt;
        g.v += (g.cv + Math.sin(a) * 0.12 - g.v) * 2 * dt;
      }
      g.u = clamp(g.u, 0.03, 0.97);
      g.v = clamp(g.v, 0.1, 0.92);
      const sp = view.toScreen(g.u, g.v);
      g.sx = sp.x;
      g.sy = sp.y;
      const d = Math.hypot(sp.x - Hunt.torch.x, sp.y - Hunt.torch.y);
      if (d < nearest) {
        nearest = d;
        nearPan = clamp((sp.x - Hunt.torch.x) / (W / 2), -1, 1);
      }
      if (d < R * 2.4 && now - Hunt.lastWhisper > 3200 && !Hunt.dead) {
        Hunt.lastWhisper = now;
        Sound.whisper(nearPan);
      }
      const safe = now < Hunt.graceUntil || now < Hunt.invisUntil || Hunt.trans || Hunt.dead || state.paused;
      if (!safe && d < ghostPx() * 0.2) die(g);
    }
    Sound.setBreath(Hunt.dead ? 0 : clamp(1 - nearest / (R * 4.5), 0, 1), nearPan);
  }

  function die(g, kind = 'ghost') {
    Hunt.dead = true;
    const gi = g.gi;
    Hunt.deathInfo = { gi, kind, t: performance.now() };
    const tr = torchRoom();
    socket.emit('died', { ghost: gi, zombie: kind === 'zombie', x: tr.u, y: tr.v }, (res) => {
      if (res && res.ok && Hunt.deathInfo) {
        $('death-sub').textContent = res.dropped ? `You dropped ${res.dropped} soul${res.dropped === 1 ? '' : 's'}. They are on the floor somewhere.` : 'Your pumpkin is safe. Your souls, less so.';
      }
    });
    if (isMild()) {
      Sound.moan();
      shaker.add(3);
    } else {
      Sound.scream();
      shaker.add(22);
    }
    const el = $('death');
    $('death-title').textContent = kind === 'zombie' ? `The ${S.ZOMBIES[gi].name} dragged you into the dark.` : `You were taken by the ${S.GHOSTS[gi].name}.`;
    $('death-sub').textContent = '';
    setTimeout(() => Hunt.dead && (el.hidden = false), isMild() ? 250 : 120);
    const start = performance.now();
    const countdown = () => {
      if (!Hunt.dead) return;
      const left = 5 - (performance.now() - start) / 1000;
      if (left > 0) {
        $('death-count').textContent = `Back in ${Math.ceil(left)}.`;
        setTimeout(countdown, 200);
        return;
      }
      socket.emit('respawn', {}, (res) => {
        Hunt.dead = false;
        Hunt.deathInfo = null;
        el.hidden = true;
        Hunt.invisUntil = performance.now() + 3000;
        Hunt.lastCollect = performance.now();
        if (res && res.ok && res.room != null) Hunt.enterRoom(res.room);
        toast('Nothing can see you for three seconds.');
      });
    };
    countdown();
  }

  function useDoor() {
    if (Hunt.trans) return;
    const d = Hunt.door;
    Sound.door(d ? clamp(((d.x + d.w / 2) - 0.5) * 2, -1, 1) : 0);
    Hunt.door = null;
    Hunt.trans = { t: performance.now(), room: null };
    socket.emit('door', {}, (res) => {
      if (!res || !res.ok) {
        Hunt.trans = null;
        if (res && res.reason === 'locked') toast('Locked.');
        return;
      }
      Hunt.trans.room = res.room;
    });
  }

  const visibleTo = (it) => it.t !== 'h' || (me && !me.pumpkin && !me.hammer);
  // screen geometry of an item resting on its surface
  function itemGeom(it) {
    const sp = view.toScreen(it.x, it.y);
    const k = (it.s || 1) * view.view.scale;
    if (it.t === 'p') {
      const size = 135 * k;
      return { x: sp.x, y: sp.y - size * 0.37, size, hit: size * 0.45, base: sp.y };
    }
    if (it.t === 'h') {
      const size = 120 * k;
      return { x: sp.x, y: sp.y - size * 0.15, size, hit: size * 0.5, base: sp.y };
    }
    const size = Math.max(4, 9 * k);
    return { x: sp.x, y: sp.y - size * 2.4, size, hit: size * 4 + 8, base: sp.y };
  }
  function lightAt(x, y, R) {
    const d = Math.hypot(x - Hunt.torch.x, y - Hunt.torch.y) / R;
    const t = clamp((1.3 - d) / 1.2, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function claim(it) {
    if (it.pending) return;
    it.pending = true;
    socket.emit('claim', { id: it.id }, (res) => {
      if (!res || !res.ok) {
        it.pending = false;
        if (res && res.reason === 'has-pumpkin') toast(`You already carry Pumpkin ${me.pumpkin}.`);
        if (res && res.reason === 'has-hammer') toast('You have the hammer. Leave the pumpkins to the others.');
        return;
      }
      Hunt.lastCollect = performance.now();
      const g = itemGeom(it);
      if (res.t === 's') {
        Sound.ping(clamp((g.x - W / 2) / (W / 2), -1, 1));
        particles.emit(g.x, g.y, { count: 6, color: [T.bone], speed: 60, life: 0.7, size: 2.5, shape: 'ember' });
      } else {
        Sound.claim();
        shaker.add(isMild() ? 2 : 8);
        Hunt.ignite.push({ t: performance.now(), x: g.x, y: g.y, size: g.size, n: it.n, kind: res.t });
        particles.emit(g.x, g.y, { count: isMild() ? 20 : 60, color: [T.ember, T.flame], speed: 260, life: 1.4, size: 4, gravity: -60, shape: 'ember' });
        if (res.t === 'p') banner(`Pumpkin ${res.n} is yours.`, 'It is safe now. You will pitch it later.', true);
        else banner('The hammer is yours.', 'You will be the one who swings it.', true);
      }
    });
  }

  function doorRect(d) {
    const a = view.toScreen(d.x, d.y);
    const b = view.toScreen(d.x + d.w, d.y + d.h);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  function handlePress(x, y, litFrom) {
    if (!state || state.phase !== 'HUNT' || state.paused || Hunt.dead || Hunt.trans || !Hunt.ready) return;
    Sound.unlock();
    const R = Hunt.baseRadius();
    if (Hunt.door && Hunt.door.k > 0.3) {
      const r = doorRect(Hunt.door);
      const pad = 12;
      if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return useDoor();
    }
    const lx = litFrom ? litFrom.x : x;
    const ly = litFrom ? litFrom.y : y;
    let best = null;
    let bestD = Infinity;
    for (const it of items.values()) {
      if (it.r !== Hunt.room || !visibleTo(it)) continue;
      const g = itemGeom(it);
      const d = Math.hypot(g.x - x, g.y - y);
      if (d < g.hit + 6 && Math.hypot(g.x - lx, g.y - ly) < R * 1.1 && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    if (best) claim(best);
  }

  fx.addEventListener('pointermove', (e) => {
    Hunt.hasPointer = true;
    Hunt.walk += Math.hypot(e.clientX - Hunt.torch.x, e.clientY - Hunt.torch.y);
    Hunt.torch.x = e.clientX;
    Hunt.torch.y = e.clientY;
  });
  fx.addEventListener('pointerdown', (e) => {
    const prev = { x: Hunt.torch.x, y: Hunt.torch.y };
    const touch = e.pointerType !== 'mouse';
    Hunt.hasPointer = true;
    Hunt.torch.x = e.clientX;
    Hunt.torch.y = e.clientY;
    handlePress(e.clientX, e.clientY, touch ? prev : null);
  });

  function huntEvents(now, paused) {
    const m = Hunt.meta();
    const locked = Hunt.hasEvent('lockedDoors');
    // a door opens a crack and light leaks out
    if (!paused && !locked && !Hunt.door && now > Hunt.nextDoor && !Hunt.trans && m.doors.length) {
      Hunt.door = Object.assign({ t0: now, life: 3500 }, pick(m.doors));
      Sound.creak(clamp(((Hunt.door.x + Hunt.door.w / 2) - 0.5) * 2, -1, 1), 0.18);
    }
    if (Hunt.door) {
      const k = (now - Hunt.door.t0) / Hunt.door.life;
      if (k >= 1 || locked) {
        Hunt.door = null;
        Hunt.nextDoor = now + rand(5000, 8000) * Math.max(0.4, fastMul());
      } else Hunt.door.k = Math.min(ease.out(Math.min(1, k * 6)), (1 - k) * 5, 1);
    }
    // a candle somewhere flares and dies
    if (!paused && !Hunt.flare && now > Hunt.nextFlare && m.candles.length) {
      Hunt.flare = Object.assign({ t0: now }, pick(m.candles));
      Sound.flare(clamp((Hunt.flare.x - 0.5) * 2, -1, 1));
    }
    if (Hunt.flare) {
      const k = (now - Hunt.flare.t0) / 2600;
      if (k >= 1) {
        Hunt.flare = null;
        Hunt.nextFlare = now + rand(12000, 24000);
      } else Hunt.flare.k = k < 0.15 ? ease.outBack(k / 0.15) : k < 0.5 ? 1 : 1 - ease.inOut((k - 0.5) / 0.5);
    }
    // a distant sound
    if (!paused && now > Hunt.nextDistant) {
      Hunt.nextDistant = now + rand(14000, 28000);
      const p = rand(-1, 1);
      pick([() => Sound.knock(p), () => Sound.creak(p, 0.12), () => Sound.footstep(p)])();
    }
  }

  function drawHunt(dt, now) {
    if (Hunt.room == null) return;
    const t = now / 1000;
    const paused = state.paused;
    const fl = isMild() ? 1 + 0.01 * Math.sin(t * 3) : flicker(t, 0, 0.03);
    const R = Hunt.baseRadius() * (1 + (fl - 1) * 0.6);
    view.layout(W, H, Hunt.torch, dt);
    huntEvents(now, paused);
    if (!paused && Hunt.ready) {
      updateGhosts(dt, now, R);
      updateZombies(dt, now, R);
    }
    if (!paused && !Hunt.dead) sendPos(now);
    for (const q of peers.values()) {
      const k = Math.min(1, dt * 8);
      q.u += (q.tu - q.u) * k;
      q.v += (q.tv - q.v) * k;
    }

    // footsteps as the light moves
    if (Hunt.walk > 160 && now - Hunt.lastStep > 340 && !paused) {
      Hunt.walk = 0;
      Hunt.lastStep = now;
      Sound.footstep(clamp((Hunt.torch.x - W / 2) / (W / 2), -1, 1) * 0.6);
    }

    const lights = [];
    if (Hunt.door) {
      const d = Hunt.door;
      lights.push({ u: d.x + d.w / 2, v: d.y + d.h * 0.92, intensity: 2.6 * d.k * flicker(t, 3, 0.04), color: [1, 0.48, 0.1] });
    }
    if (Hunt.flare) lights.push({ u: Hunt.flare.x, v: Hunt.flare.y, intensity: 1.4 * Hunt.flare.k * flicker(t, 5, 0.04), color: [1, 0.62, 0.25] });
    for (const ig of Hunt.ignite) {
      const k = 1 - (now - ig.t) / 1400;
      if (k > 0) {
        const r = view.toRoom(ig.x, ig.y);
        lights.push({ u: r.u, v: r.v, intensity: 2.2 * k, color: [1, 0.5, 0.12] });
      }
    }
    // other players' lanterns light the room around them (nearest two)
    [...peers.values()]
      .filter((q) => !q.d)
      .map((q) => ({ q, sp: view.toScreen(q.u, q.v) }))
      .sort((a, b) => Math.hypot(a.sp.x - Hunt.torch.x, a.sp.y - Hunt.torch.y) - Math.hypot(b.sp.x - Hunt.torch.x, b.sp.y - Hunt.torch.y))
      .slice(0, 2)
      .forEach(({ q }) => lights.push({ u: q.u, v: q.v, intensity: 0.7 * flicker(t, q.u * 9, 0.04), color: [1, 0.55, 0.2] }));
    const torchOn = Hunt.ready && !Hunt.dead;
    view.render(
      {
        torch: Hunt.torch,
        radius: torchOn ? R : 0.001,
        time: t,
        flicker: fl,
        lights,
        ambient: torchOn ? 0.0035 : 0,
        gain: torchOn ? 3.2 : 0,
      },
      roomCv.width / W
    );

    // ---- 2D overlay: things in the room, lit only by the light that reaches them
    ctx.clearRect(-50, -50, W + 100, H + 100);
    if (!Hunt.ready) return;
    for (const it of items.values()) {
      if (it.r !== Hunt.room || !visibleTo(it)) continue;
      const g = itemGeom(it);
      const L = Hunt.dead ? 0 : lightAt(g.x, g.y, R);
      if (L < 0.02) continue;
      const pop = clamp((now - (it.born || 0)) / 300, 0.05, 1);
      if (it.t === 'p') PS.drawPumpkin(ctx, g.x, g.y, g.size * ease.outBack(pop), it.n, { tint: L * 0.95 });
      else if (it.t === 's') PS.drawSoul(ctx, g.x, g.y + Math.sin(t * 2 + it.id) * 2, g.size * pop, t, L, it.v);
      else {
        ctx.save();
        ctx.globalAlpha = L;
        PS.drawHammer(ctx, g.x + g.size * 0.5, g.base - g.size * 0.17, g.size * pop, -Math.PI / 2, T.bone);
        ctx.restore();
      }
    }
    // claimed items ignite, then fade into the player's keeping
    Hunt.ignite = Hunt.ignite.filter((ig) => now - ig.t < 1400);
    for (const ig of Hunt.ignite) {
      const k = (now - ig.t) / 1400;
      ctx.save();
      ctx.globalAlpha = 1 - ease.inOut(Math.max(0, (k - 0.5) / 0.5));
      const lift = ease.out(k) * ig.size * 0.4;
      if (ig.kind === 'p') PS.drawPumpkin(ctx, ig.x, ig.y - lift, ig.size * (1 + 0.15 * ease.outBack(Math.min(1, k * 3))), ig.n, { lit: Math.min(1, k * 4), t });
      else PS.drawHammer(ctx, ig.x, ig.y + ig.size * 0.5 - lift, ig.size, Math.sin(k * 6) * 0.2, T.bone);
      ctx.restore();
    }

    // the crack of light from an opening door
    if (Hunt.door) {
      const d = Hunt.door;
      const r = doorRect(d);
      const k = d.k * flicker(t, 2, 0.04);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      let cx;
      let w;
      if (d.kind === 'double') {
        cx = r.x + r.w / 2;
        w = Math.max(2, r.w * 0.05 * k);
      } else if (d.kind === 'gate') {
        cx = r.x + r.w / 2;
        w = r.w * 0.8 * k;
      } else if (d.kind === 'side') {
        cx = r.x + r.w * 0.15;
        w = Math.max(2, r.w * 0.12 * k);
      } else {
        cx = r.x + r.w * 0.9;
        w = Math.max(2, r.w * 0.08 * k);
      }
      const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
      g.addColorStop(0, hexA(T.flame, 0));
      g.addColorStop(0.5, hexA(T.ember, 0.95 * k));
      g.addColorStop(1, hexA(T.flame, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - w, r.y, w * 2, r.h);
      const spill = ctx.createRadialGradient(cx, r.y + r.h, 0, cx, r.y + r.h, r.w * 1.2);
      spill.addColorStop(0, hexA(T.flame, 0.35 * k));
      spill.addColorStop(1, hexA(T.flame, 0));
      ctx.fillStyle = spill;
      ctx.fillRect(cx - r.w * 1.2, r.y + r.h - r.w * 0.3, r.w * 2.4, r.w * 0.6);
      ctx.restore();
    }
    // a candle flame
    if (Hunt.flare) {
      const sp = view.toScreen(Hunt.flare.x, Hunt.flare.y);
      const s = 26 * (Hunt.flare.s || 1) * view.view.scale * Hunt.flare.k;
      drawFlame(ctx, sp.x, sp.y, s, t);
    }

    // other players: their light, their silhouette, their name
    const ps = presenceSize(R) * 0.85;
    for (const [name, q] of peers) {
      if (q.d) continue;
      const sp = view.toScreen(q.u, q.v);
      const L = lightAt(sp.x, sp.y, R);
      drawPresence(q.c, sp.x, sp.y, ps, 0.35 + 0.5 * L, t);
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.4 * L;
      ctx.fillStyle = T.ash;
      ctx.font = 'italic 500 15px Fraunces, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(name, sp.x, sp.y + ps * 0.62);
      ctx.restore();
    }
    // zombies: only light shows them
    for (const z of Hunt.zombies) {
      if (z.sx == null) continue;
      const L = lightAt(z.sx + z.f * z.h * 0.1, z.sy - z.h * 0.55, R);
      PS.drawZombie(ctx, z.sx, z.sy, z.h, { facing: z.f, light: L * 0.9, t: t + z.seed, seed: z.seed, alpha: 0.05 + 0.9 * L });
    }

    // ghosts: a faint shape in the dark, real in the light
    const gs = ghostPx();
    for (const g of Hunt.ghosts) {
      const L = lightAt(g.sx, g.sy, R);
      PS.drawGhost(ctx, g.gi, g.sx, g.sy, gs, t + g.phase, 0.07 + 0.85 * L);
    }

    // dust in the beam
    if (!Hunt.dead && !PS.reducedMotion) {
      while (Hunt.dust.length < 46) {
        const a = rand(0, TAU);
        const rr = Math.sqrt(Math.random()) * R * 1.2;
        const r = view.toRoom(Hunt.torch.x + Math.cos(a) * rr, Hunt.torch.y + Math.sin(a) * rr);
        Hunt.dust.push({ u: r.u, v: r.v, vu: rand(-1, 1) * 0.002, vv: rand(-0.4, 1) * 0.003, life: rand(3, 8), age: 0, sz: rand(0.8, 1.9) });
      }
      ctx.save();
      ctx.fillStyle = T.bone;
      Hunt.dust = Hunt.dust.filter((p) => {
        p.age += dt;
        p.u += p.vu * dt;
        p.v += p.vv * dt;
        if (p.age > p.life) return false;
        const sp = view.toScreen(p.u, p.v);
        const L = lightAt(sp.x, sp.y, R);
        if (L <= 0.01 && p.age > 0.5) return false;
        ctx.globalAlpha = L * 0.45 * Math.sin((p.age / p.life) * Math.PI);
        ctx.fillRect(sp.x, sp.y, p.sz, p.sz);
        return true;
      });
      ctx.restore();
    }

    if (!Hunt.dead && !Hunt.trans && !paused) {
      // souls the light's centre touches are gathered
      for (const it of items.values()) {
        if (it.t !== 's' || it.r !== Hunt.room || it.pending) continue;
        const g = itemGeom(it);
        if (Math.hypot(g.x - Hunt.torch.x, g.y - Hunt.torch.y) < g.hit) claim(it);
      }
    }
    drawHint(R, now);
    particles.update(dt);
    particles.draw(ctx);

    // the player, at the centre of their own light
    if (!Hunt.dead) {
      const invis = now < Hunt.invisUntil;
      drawPresence(me.costume, Hunt.torch.x, Hunt.torch.y, presenceSize(R), invis ? 0.3 + 0.2 * Math.sin(t * 8) : 0.92, t);
    }

    // room change: a fade to ink and the room's name
    if (Hunt.trans) {
      const k = (now - Hunt.trans.t) / 380;
      ctx.fillStyle = hexA(T.ink, clamp(k, 0, 1));
      ctx.fillRect(-50, -50, W + 100, H + 100);
      if (k >= 1 && Hunt.trans.room != null) {
        const r = Hunt.trans.room;
        Hunt.trans = null;
        Hunt.enterRoom(r);
      } else if (k > 10) Hunt.trans = null;
    }
    if (Hunt.splash) {
      const k = (now - Hunt.splash.t) / 1800;
      if (k > 1) Hunt.splash = null;
      else {
        ctx.fillStyle = hexA(T.ink, clamp(1 - k * 2.2, 0, 1));
        ctx.fillRect(-50, -50, W + 100, H + 100);
        ctx.save();
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9;
        ctx.fillStyle = T.bone;
        ctx.font = `italic 600 ${Math.round(Math.min(W, H) * 0.075)}px Fraunces, Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`The ${S.ROOMS[Hunt.splash.room].name.toLowerCase()}.`, W / 2, H * 0.45);
        ctx.restore();
      }
    }
  }

  function drawFlame(c, x, y, s, t) {
    if (s < 0.5) return;
    const f = flicker(t, x, 0.04);
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(x, y, 0, x, y, s * 3 * f);
    g.addColorStop(0, hexA(T.ember, 0.5));
    g.addColorStop(1, hexA(T.flame, 0));
    c.fillStyle = g;
    c.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
    c.fillStyle = T.ember;
    c.beginPath();
    c.moveTo(x, y - s * 1.1 * f);
    c.quadraticCurveTo(x + s * 0.4, y - s * 0.2, x, y + s * 0.3);
    c.quadraticCurveTo(x - s * 0.4, y - s * 0.2, x, y - s * 1.1 * f);
    c.fill();
    c.restore();
  }

  function drawHint(R, now) {
    if (Hunt.dead || Hunt.trans || !me) return;
    const strong = state.act === 1 && state.overtime && !me.pumpkin && !me.hammer;
    const idle = now - Hunt.lastCollect > 30000 * fastMul();
    if (!strong && !idle) return;
    const torch = Hunt.torch;
    let target = null;
    let best = Infinity;
    for (const it of items.values()) {
      if (it.r !== Hunt.room || !visibleTo(it)) continue;
      if (strong && it.t !== 'p') continue;
      if (it.t !== 's' && (me.pumpkin || me.hammer)) continue;
      const g = itemGeom(it);
      const d = Math.hypot(g.x - torch.x, g.y - torch.y);
      const w = it.t === 's' ? d : d * 0.5;
      if (w < best) {
        best = w;
        target = { x: g.x, y: g.y, d };
      }
    }
    if (!target && Hunt.door) {
      const r = doorRect(Hunt.door);
      target = { x: r.x + r.w / 2, y: r.y + r.h / 2, d: Math.hypot(r.x + r.w / 2 - torch.x, r.y + r.h / 2 - torch.y) };
    }
    if (!target || target.d < R * 0.8) return;
    const ang = Math.atan2(target.y - torch.y, target.x - torch.x);
    const m = 24;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const tx = dx > 0 ? (W - m - torch.x) / dx : dx < 0 ? (m - torch.x) / dx : Infinity;
    const ty = dy > 0 ? (H - m - torch.y) / dy : dy < 0 ? (m - torch.y) / dy : Infinity;
    const k = Math.min(tx, ty);
    const ex = torch.x + dx * k;
    const ey = torch.y + dy * k;
    const pulse = 0.5 + 0.5 * Math.sin(now / (strong ? 260 : 520));
    const rad = strong ? 170 : 110;
    const a = strong ? 0.3 + 0.25 * pulse : 0.08 + 0.1 * pulse;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, rad);
    g.addColorStop(0, hexA(T.ember, a));
    g.addColorStop(1, hexA(T.flame, 0));
    ctx.fillStyle = g;
    ctx.fillRect(ex - rad, ey - rad, rad * 2, rad * 2);
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
    const k = Math.max(0, (now - info.t) / 1000);
    const mild = isMild();
    const zoom = mild ? 1 : 1 + Math.max(0, 0.35 - k) * 1.6;
    const size = Math.min(r.W, r.H) * 0.62 * zoom;
    if (info.kind === 'zombie') {
      c.save();
      c.globalAlpha = mild ? clamp(k * 1.2, 0, 1) : 1;
      const bg = c.createRadialGradient(r.W / 2, r.H * 0.36, 0, r.W / 2, r.H * 0.36, size * 0.8);
      bg.addColorStop(0, PS.hexA(T.blood, 0.22));
      bg.addColorStop(1, PS.hexA(T.blood, 0));
      c.fillStyle = bg;
      c.fillRect(0, 0, r.W, r.H);
      PS.drawZombie(c, r.W / 2 - size * 0.15, r.H * 0.57, size * 0.62, { facing: 1, light: 0.6, t: k, alpha: 1 });
      c.restore();
    } else PS.drawGhost(c, info.gi, r.W / 2, r.H * 0.4, size, k, mild ? clamp(k * 1.2, 0, 0.9) : 0.95);
  }

  // ===================================================================
  // Main loop
  // ===================================================================
  let last = performance.now();
  function draw(now) {
    const rawDt = Math.min(0.5, (now - last) / 1000);
    const dt = Math.min(0.05, rawDt);
    last = now;
    const fit = PS.fitCanvas(fx, 1.75);
    W = fit.W;
    H = fit.H;
    dpr = fit.dpr;
    const [sx, sy] = shaker.offset(dt);
    ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
    const hunting = joined && state && state.phase === 'HUNT';
    if (hunting) {
      PS.fitCanvas(roomCv, 1.25);
      roomCv.style.transform = sx || sy ? `translate(${sx}px,${sy}px)` : '';
      drawHunt(dt, now);
      const rem = remaining();
      const ht = $('hud-timer');
      ht.classList.toggle('over', !!state.overtime);
      ht.textContent = state.overtime ? 'Not until every pumpkin is taken.' : PS.fmtTime(rem);
      drawDeathFace(now);
    } else {
      ctx.clearRect(-50, -50, W + 100, H + 100);
      const res = stage.render(ctx, W, H, rawDt);
      if (res.flash) {
        ctx.fillStyle = T.bone;
        ctx.fillRect(-50, -50, W + 100, H + 100);
      }
      particles.update(dt);
      particles.draw(ctx);
      if (joined && state) {
        const rem = remaining();
        if (state.phase === 'PITCHES' && $('p-bar')) $('p-bar').style.transform = `scaleX(${state.dur ? rem / state.dur : 0})`;
        if (state.phase === 'VOTE' && $('v-timer')) $('v-timer').textContent = PS.fmtTime(rem);
      }
    }
    // small live lights (pumpkins on cards, the inventory)
    const t = now / 1000;
    for (const l of lamps) {
      if (!l.cv.isConnected) continue;
      l.fn(l.cv.getContext('2d'), l.cv.width, l.cv.height, t);
    }
    if (me && me.pumpkin) {
      const ic = $('inv-pumpkin');
      const c = ic.getContext('2d');
      c.clearRect(0, 0, ic.width, ic.height);
      PS.drawPumpkin(c, ic.width / 2, ic.height * 0.55, ic.width * 0.8, me.pumpkin, { lit: 1, t, glow: false });
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    try {
      draw(now);
    } catch (err) {
      console.error(err);
      fx.width = fx.width;
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
        return [...items.values()].map((it) => Object.assign({}, it, it.r === Hunt.room && Hunt.ready ? { screen: itemGeom(it) } : {}));
      },
      get me() {
        return me;
      },
      get state() {
        return state;
      },
      get door() {
        return Hunt.door && Hunt.door.k > 0.5 ? doorRect(Hunt.door) : null;
      },
      get ghosts() {
        return Hunt.ghosts.map((g) => ({ x: g.sx, y: g.sy }));
      },
      get zombies() {
        return Hunt.zombies.filter((z) => z.sx != null).map((z) => ({ x: z.sx + z.f * z.h * 0.22, y: z.sy - z.h * 0.65 }));
      },
      get peers() {
        return [...peers.keys()];
      },
      get room() {
        return Hunt.room;
      },
      get ready() {
        return Hunt.ready;
      },
      get dead() {
        return Hunt.dead;
      },
      gl: !!view.gl,
      size: () => ({ W, H }),
    };
  }
})();
