// Host screen: the big shared display presented on the video call.
/* global io, PS */
(function () {
  const { S, Sound, Particles, Shaker, Stage, hexA } = PS;
  const $ = (id) => document.getElementById(id);
  const key = new URLSearchParams(location.search).get('key') || '';
  const socket = io({ auth: { role: 'host', key }, transports: ['websocket', 'polling'] });
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const main = $('main');
  const root = $('root');

  const particles = new Particles(3000);
  const shaker = new Shaker();
  const stage = new Stage(particles, shaker);
  stage.cy = 0.6;
  let state = null;
  let viewKey = '';
  let lastFeedId = 0;
  let feedSeen = new Set();
  let timerBase = { remaining: null, at: 0, paused: false };
  let flash = null;
  let W = 0;
  let H = 0;
  const mild = new URLSearchParams(location.search).get('mild') === '1';
  Sound.mild = mild;
  stage.mild = mild;

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

  socket.on('denied', () => {
    main.innerHTML = '<div class="host-center denied">🔒 Wrong host key.</div>';
  });
  socket.on('hstate', (s) => {
    const prev = state;
    state = s;
    timerBase = { remaining: s.remaining, at: performance.now(), paused: s.paused };
    if (prev && prev.gameId !== s.gameId) {
      lastFeedId = 0;
      stage.clear();
    }
    handleFeedFx(s.feed, !prev);
    renderControls();
    render();
  });

  // ---------------- controls ----------------
  function renderControls() {
    const c = $('h-ctrl');
    const ph = state.phase;
    const btns = [];
    const add = (label, ev, primary, confirmText) =>
      btns.push(() => {
        const b = el('button', primary ? 'primary' : '', label);
        b.onclick = () => {
          if (confirmText && !confirm(confirmText)) return;
          send(ev);
        };
        return b;
      });
    if (ph === 'LOBBY') add('▶ Start', 'host:start', true);
    if (['RULES', 'HUNT', 'PITCHES', 'VOTE'].includes(ph)) add(state.paused ? '▶ Resume' : '⏸ Pause', 'host:pause');
    if (ph === 'HUNT') add('⏭ Skip act', 'host:skip', false);
    if (['RULES', 'PITCHES'].includes(ph)) add('Next ▶', 'host:next', true);
    if (ph === 'VOTE') add('Close vote ▶', 'host:next', true);
    if (ph !== 'LOBBY') add('↺ Reset', 'host:reset', ph === 'RESULT', ph === 'RESULT' ? null : 'Reset the game? Everyone goes back to the lobby.');
    const sig = ph + state.paused;
    if (c.dataset.sig === sig) return;
    c.dataset.sig = sig;
    c.innerHTML = '';
    btns.forEach((f) => c.appendChild(f()));
    const mute = el('button', '', Sound.isMuted() ? '🔇' : '🔊');
    mute.title = 'Mute (M)';
    mute.onclick = () => {
      Sound.unlock();
      Sound.toggleMute();
      mute.textContent = Sound.isMuted() ? '🔇' : '🔊';
    };
    const fs = el('button', '', '⛶');
    fs.title = 'Full screen (F)';
    fs.onclick = () => PS.toggleFullscreen();
    c.append(mute, fs);
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

  // ---------------- feed effects ----------------
  function handleFeedFx(feed, initial) {
    for (const f of feed) {
      if (f.id <= lastFeedId) continue;
      lastFeedId = f.id;
      if (initial) continue;
      if (f.kind === 'pumpkin') {
        Sound.claim();
        flash = { t: performance.now(), colors: [S.COLORS.magenta, S.COLORS.cyan, S.COLORS.orange] };
        shaker.add(10);
        const slot = document.querySelector(`.slot[data-n="${f.n}"]`);
        const r = slot ? slot.getBoundingClientRect() : { left: W / 2, top: H / 2, width: 0, height: 0 };
        particles.emit(r.left + r.width / 2, r.top + r.height / 2, { count: 120, color: [S.COLORS.orange, '#ffe14d', S.COLORS.magenta], speed: 700, life: 1.4, size: 4, shape: 'spark' });
      } else if (f.kind === 'hammer') {
        Sound.claim();
        flash = { t: performance.now(), colors: [S.COLORS.cyan, S.COLORS.violet, '#ffffff'] };
        shaker.add(14);
        particles.emit(W * 0.75, H * 0.35, { count: 140, color: [S.COLORS.cyan, '#fff', S.COLORS.violet], speed: 800, life: 1.4, size: 4, shape: 'spark' });
      } else if (f.kind === 'death') {
        if (!mild) Sound.glitch();
        flash = { t: performance.now(), colors: [S.COLORS.red], k: 0.35 };
      } else if (f.kind === 'event' || f.kind === 'act') {
        Sound.stinger();
        flash = { t: performance.now(), colors: [S.COLORS.violet, S.COLORS.magenta] };
        shaker.add(8);
      } else if (f.kind === 'spawn') {
        Sound.spawnBell();
      }
    }
  }

  // ---------------- views ----------------
  function render() {
    const ph = state.phase;
    const labels = {
      LOBBY: 'Lobby',
      RULES: 'The Rules',
      HUNT: state.act ? `Act ${state.act} · ${S.ACTS[state.act].name}` : 'Hunt',
      PITCHES: 'Pitches',
      VOTE: 'Vote',
      SMASH: 'Smash',
      RESULT: 'Result',
    };
    $('h-phase').textContent = labels[ph] + (state.paused ? ' · paused' : '');
    const k = ph === 'PITCHES' ? 'P' + state.pitchIndex : ph;
    if (k !== viewKey) {
      viewKey = k;
      main.innerHTML = '';
      build[ph]();
    }
    if (update[ph]) update[ph]();
  }

  const build = {
    LOBBY() {
      const url = location.origin + '/';
      main.innerHTML = `
        <div class="lobby-grid">
          <div class="qr-card">
            <img id="qr" alt="QR code to join" />
            <div class="qr-url" id="qr-url"></div>
            <div class="big-count"><b id="l-count">0</b> players in the house</div>
            <div class="tag">Scan or open the link, pick a name and a costume.</div>
          </div>
          <div class="wall" id="wall"></div>
        </div>`;
      $('qr').src = '/qr.svg?u=' + encodeURIComponent(url);
      $('qr-url').textContent = location.host;
    },
    RULES() {
      main.innerHTML = `
        <div class="host-center host-rules">
          <h1 class="title">Welcome to the House</h1>
          <ol class="rules-list">
            <li><span>🎃</span>Find pumpkins</li>
            <li><span>🔨</span>Find the hammer</li>
            <li><span><i class="soul-dot big"></i></span>Collect souls</li>
            <li><span>👻</span>Avoid ghosts</li>
          </ol>
          <p class="tag">Six pumpkins. One hides <b>Friday afternoon off</b>. Every soul you collect is +1 vote.</p>
        </div>`;
    },
    HUNT() {
      main.innerHTML = `
        <div class="hunt-grid">
          <div class="card feed-card"><h3>Live from the house</h3><div class="feed" id="feed"></div></div>
          <div class="card"><h3>The six pumpkins</h3><div class="slots" id="slots"></div><div class="hammer-line" id="hammer-line"></div></div>
          <div class="lower">
            <div class="card"><h3>Who is where</h3><div class="minimap" id="minimap"></div></div>
            <div class="card"><h3>Most souls</h3><ol class="lb" id="lb"></ol></div>
          </div>
        </div>`;
      const slots = $('slots');
      for (let n = 1; n <= S.NUM_PUMPKINS; n++) {
        const s = el('div', 'slot');
        s.dataset.n = n;
        const cv = el('canvas');
        cv.width = 140;
        cv.height = 140;
        s.append(cv, el('div', 'sw'));
        slots.appendChild(s);
      }
      const mm = $('minimap');
      S.ROOMS.forEach((r, i) => {
        const b = el('div', 'room-box');
        b.style.setProperty('--c', r.accent);
        b.dataset.r = i;
        b.innerHTML = `<div class="rn"><span></span><span class="flag"></span></div><div class="dots"></div>`;
        b.querySelector('.rn span').textContent = `${r.name} · ${S.GHOSTS[i].name}`;
        mm.appendChild(b);
      });
      feedSeen = new Set();
    },
    PITCHES() {
      const pk = state.pumpkins[state.pitchIndex];
      main.innerHTML = `
        <div class="host-center pitch-host">
          <div class="kicker">Pitch ${state.pitchIndex + 1} of ${S.NUM_PUMPKINS} · make your case!</div>
          <canvas class="pk-canvas" id="p-pk" width="400" height="400"></canvas>
          <div id="p-who"></div>
          <div class="pitch-n">Pumpkin ${pk.n}</div>
          <div class="bar" style="width:min(700px,80vw);max-width:none"><i id="p-bar"></i></div>
        </div>`;
      const cv = $('p-pk');
      PS.drawPumpkin(cv.getContext('2d'), 200, 215, 250, pk.n, {});
      $('p-who').appendChild(PS.whoEl(pk.holder, 'xl'));
      Sound.spawnBell();
    },
    VOTE() {
      main.innerHTML = `
        <div class="host-center">
          <h1 class="title small">Vote! Which pumpkin gets smashed?</h1>
          <p class="tag">Vote on your device. Weight = 1 + your souls. <b id="v-voted"></b></p>
          <div class="vote-bars" id="bars"></div>
        </div>`;
      const bars = $('bars');
      state.pumpkins.forEach((pk) => {
        const row = el('div', 'vbar');
        row.dataset.n = pk.n;
        const cv = el('canvas');
        cv.width = 128;
        cv.height = 128;
        PS.drawPumpkin(cv.getContext('2d'), 64, 70, 84, pk.n, {});
        const tr = el('div', 'track');
        tr.appendChild(el('div', 'fill'));
        row.append(cv, PS.whoEl(pk.holder), tr, el('div', 'wv', '0'));
        bars.appendChild(row);
      });
    },
    SMASH() {
      const sm = state.smash;
      const line = el('div', 'smash-line');
      line.append('🔨 ', PS.whoEl(sm.hammer), ` swings at Pumpkin ${sm.target} (`, PS.whoEl(sm.holder), ')…');
      const wrap = el('div', 'host-smash');
      wrap.appendChild(line);
      main.appendChild(wrap);
      stage.smash(sm, state.elapsed);
    },
    RESULT() {
      const r = state.result;
      stage.result(r);
      const text = r.win ? 'FRIDAY AFTERNOON OFF!' : 'ZOMBIE PUMPKIN';
      main.innerHTML = `
        <div class="host-result result ${r.win ? 'win' : 'lose'}">
          <h1 class="result-title" data-text="${text}">${text}</h1>
          <div class="result-sub" id="res-sub"></div>
          <div class="result-reveal" id="res-reveal" hidden></div>
          <div class="awards" id="res-awards"></div>
        </div>`;
      $('res-sub').append(`Pumpkin ${r.smashed} (`, PS.whoEl(r.smashedHolder), r.win ? ') held the prize! Enjoy your Friday afternoon!' : ') was hollow…');
      if (!r.win) {
        setTimeout(() => {
          const e = $('res-reveal');
          if (!e) return;
          e.hidden = false;
          e.append('The real prize was in ', Object.assign(el('b'), { textContent: `Pumpkin ${r.winning}` }), ' — held by ', PS.whoEl(r.winningHolder));
        }, 3000);
      }
      const aw = $('res-awards');
      const add = (icon, title, a, unit) => {
        const d = el('div', 'award');
        d.innerHTML = `<div class="aw-icon">${icon}</div><div class="aw-title">${title}</div>`;
        const who = el('div', 'aw-who');
        if (a) a.who.forEach((w) => who.appendChild(PS.whoEl(w)));
        else who.textContent = '—';
        d.appendChild(who);
        if (a && a.value != null) d.appendChild(el('div', 'aw-v', `${a.value} ${unit}`));
        aw.appendChild(d);
      };
      add('<i class="soul-dot big"></i>', 'Most Souls', r.awards.souls, 'souls');
      add('👻', 'Most Haunted', r.awards.haunted, 'deaths');
      add('🔨', 'Hammer Hero', r.awards.hammer, '');
    },
  };

  const update = {
    LOBBY() {
      $('l-count').textContent = state.playerCount;
      const wall = $('wall');
      const live = state.players.filter((p) => p.connected);
      const names = new Set(live.map((p) => p.name));
      wall.querySelectorAll('.wall-tile').forEach((t) => {
        if (!names.has(t.dataset.name)) t.remove();
      });
      const have = new Set([...wall.querySelectorAll('.wall-tile')].map((t) => t.dataset.name));
      for (const p of live) {
        if (have.has(p.name)) continue;
        const t = el('div', 'wall-tile');
        t.dataset.name = p.name;
        t.style.setProperty('--glow', PS.costumeById(p.costume).glow);
        t.append(PS.costumeEl(p.costume), el('b', '', p.name));
        wall.appendChild(t);
        Sound.blip();
      }
      // shrink tiles when the wall gets crowded
      const n = live.length;
      wall.style.zoom = n > 40 ? 0.62 : n > 28 ? 0.75 : n > 18 ? 0.88 : 1;
    },
    HUNT() {
      // feed
      const feed = $('feed');
      for (const f of state.feed) {
        if (feedSeen.has(f.id)) continue;
        feedSeen.add(f.id);
        const item = el('div', 'feed-item ' + f.kind);
        if (f.kind === 'death') item.append('💀 ');
        if (f.kind === 'hammer') item.append('🔨 ');
        if (f.kind === 'pumpkin') item.append('🎃 ');
        if (f.kind === 'spawn') item.append('✨ ');
        if (f.who) item.append(PS.whoEl(f.who), ' ');
        item.append(f.text);
        feed.prepend(item);
      }
      while (feed.children.length > 30) feed.lastChild.remove();
      // pumpkin slots
      state.pumpkins.forEach((pk) => {
        const s = document.querySelector(`.slot[data-n="${pk.n}"]`);
        if (!s) return;
        const sig = `${pk.spawned}|${pk.holder ? pk.holder.name : ''}|${pk.room}|${pk.house}`;
        if (s.dataset.sig === sig) return;
        s.dataset.sig = sig;
        s.className = 'slot' + (pk.holder || pk.house ? ' held' : pk.spawned ? ' loose' : '');
        const cv = s.querySelector('canvas');
        const c = cv.getContext('2d');
        c.clearRect(0, 0, cv.width, cv.height);
        c.globalAlpha = pk.spawned ? 1 : 0.18;
        PS.drawPumpkin(c, 70, 76, 92, pk.n, { dark: !pk.spawned, glow: pk.spawned ? 30 : 0 });
        c.globalAlpha = 1;
        const sw = s.querySelector('.sw');
        sw.innerHTML = '';
        if (pk.holder || pk.house) sw.appendChild(PS.whoEl(pk.holder));
        else if (pk.spawned) sw.appendChild(el('span', 'where', pk.room != null ? `loose in the ${S.ROOMS[pk.room].name}!` : 'loose!'));
        else sw.appendChild(el('span', 'tag', 'not yet…'));
      });
      // hammer
      const hl = $('hammer-line');
      hl.innerHTML = '';
      if (state.hammer.holder) hl.append('🔨 Hammer: ', PS.whoEl(state.hammer.holder));
      else if (state.hammer.room != null) hl.append(`🔨 The hammer is loose in the ${S.ROOMS[state.hammer.room].name}! (only non-holders can see it)`);
      else hl.append(state.act < 2 ? '🔨 The hammer appears in Act 2' : '🔨 The hammer is missing…');
      // minimap
      const byRoom = S.ROOMS.map(() => []);
      state.players.forEach((p) => p.connected && p.room != null && byRoom[p.room] && byRoom[p.room].push(p));
      document.querySelectorAll('.room-box').forEach((b) => {
        const r = Number(b.dataset.r);
        const ps = byRoom[r];
        const flags = [];
        state.pumpkins.forEach((pk) => pk.room === r && !pk.holder && flags.push(`🎃${pk.n}`));
        if (state.hammer.room === r) flags.push('🔨');
        state.events.forEach((e) => {
          if (e.room === r && e.type === 'ghostFlood') flags.push('👻👻👻');
          if (e.room === r && e.type === 'soulShower') flags.push('✨');
        });
        const sig = ps.map((p) => p.costume).join(',') + flags.join('');
        if (b.dataset.sig === sig) return;
        b.dataset.sig = sig;
        b.querySelector('.flag').textContent = `${ps.length} ${flags.join(' ')}`;
        const dots = b.querySelector('.dots');
        dots.innerHTML = '';
        ps.slice(0, 16).forEach((p) => dots.appendChild(PS.costumeEl(p.costume)));
        if (ps.length > 16) dots.append(`+${ps.length - 16}`);
      });
      // leaderboard
      const lb = $('lb');
      const sig = state.leaderboard.map((p) => p.name + p.souls).join('|');
      if (lb.dataset.sig !== sig) {
        lb.dataset.sig = sig;
        lb.innerHTML = '';
        if (!state.leaderboard.length) lb.appendChild(el('li', 'tag', 'No souls collected yet'));
        state.leaderboard.forEach((p, i) => {
          const li = el('li');
          const left = el('span');
          left.append(el('span', 'rk', `${i + 1}.`), PS.whoEl(p));
          li.append(left, el('span', 'n', String(p.souls)));
          lb.appendChild(li);
        });
      }
    },
    VOTE() {
      const { weights, total } = state.tally;
      const max = Math.max(1, ...weights);
      const best = Math.max(...weights);
      document.querySelectorAll('.vbar').forEach((row) => {
        const n = Number(row.dataset.n);
        row.querySelector('.fill').style.width = `${(weights[n - 1] / max) * 100}%`;
        row.querySelector('.wv').textContent = String(weights[n - 1]);
        row.classList.toggle('lead', best > 0 && weights[n - 1] === best);
      });
      const voted = state.players.filter((p) => p.voted).length;
      $('v-voted').textContent = `${voted} of ${state.players.length} voted · total weight ${total}`;
    },
  };

  // ---------------- frame loop ----------------
  let last = performance.now();
  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const fit = PS.fitCanvas(canvas, 1.5);
    W = fit.W;
    H = fit.H;
    const [sx, sy] = shaker.offset(dt);
    root.style.transform = sx || sy ? `translate(${sx * 0.6}px, ${sy * 0.6}px)` : '';
    ctx.setTransform(fit.dpr, 0, 0, fit.dpr, sx * fit.dpr, sy * fit.dpr);
    ctx.fillStyle = S.COLORS.bg;
    ctx.fillRect(-60, -60, W + 120, H + 120);
    // slow neon haze
    const t = now / 1000;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    [
      [S.COLORS.violet, 0.3, 0.2],
      [S.COLORS.magenta, 0.75, 0.75],
      [S.COLORS.orange, 0.2, 0.9],
    ].forEach(([c, x, y], i) => {
      const gx = W * (x + Math.sin(t * 0.13 + i) * 0.1);
      const gy = H * (y + Math.cos(t * 0.11 + i * 2) * 0.1);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * 0.55);
      g.addColorStop(0, hexA(c, 0.13));
      g.addColorStop(1, hexA(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    });
    ctx.restore();
    PS.ambientEmbers(particles, W, H, 1.5);
    if (state && (state.phase === 'SMASH' || state.phase === 'RESULT')) stage.render(ctx, W, H, dt);
    particles.update(dt);
    particles.draw(ctx);
    if (flash) {
      const k = (now - flash.t) / 380;
      if (k > 1) flash = null;
      else {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        flash.colors.forEach((c, i) => {
          ctx.globalAlpha = (1 - k) * 0.3 * (flash.k || 1) * (mild ? 0.3 : 1);
          ctx.fillStyle = c;
          const o = (i - 1) * 16 * (1 - k);
          ctx.fillRect(o, -o, W, H);
        });
        ctx.restore();
      }
    }
    if (state) {
      const rem = remaining();
      const ht = $('h-timer');
      if (state.phase === 'HUNT' && state.overtime) {
        ht.textContent = 'OVERTIME';
        ht.classList.add('ot');
      } else {
        ht.classList.remove('ot');
        ht.textContent = ['LOBBY', 'RESULT', 'SMASH'].includes(state.phase) ? '' : PS.fmtTime(rem);
      }
      if (state.phase === 'PITCHES' && $('p-bar')) $('p-bar').style.width = `${state.dur ? (rem / state.dur) * 100 : 0}%`;
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
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
})();
