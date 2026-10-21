// The house's residents: one per room, each with one easy rule (see RESIDENTS in shared.js).
// Client-side, like the ghosts. Built for people who do not play games: everything is slow,
// warned about and forgiving. Light on them and they stop; hold it there and they leave. If one
// reaches you, you get a fright and drop a soul. Nobody dies of a resident.
/* global PS */
(function () {
  const { S, T, rand, pick, clamp, lerp, ease, hexA } = PS;

  PS.Residents = function (env) {
    // env: view, torch(), player() {u, v}, lightAt(x, y, R), mild(), fast(), toast(text), scare(id, loss), phone()
    const { view } = env;
    let room = null; // the room id
    let meta = null;
    let r = null; // the resident's state in this room
    const told = new Set(); // rules already explained, once per game

    const sc = () => view.view.scale;
    // how tall something `m` metres tall looks standing at room height v, in screen px
    const hpx = (v, m) => (m * Math.max(20, v * 1080 - 500)) / 1.6 * sc();
    const slow = (ms) => ms * Math.max(0.35, env.fast());
    const now = () => performance.now();
    function tell() {
      const def = S.RESIDENTS[room];
      if (def && !told.has(room)) {
        told.add(room);
        env.toast(def.rule, 4200);
      }
    }

    // ---------------------------------------------------------------- walkers
    // Michael, Jason, Valak and Samara come towards you, slowly, only while your light is
    // elsewhere. Light on them freezes them; three seconds of light sends them away.
    const WALK = {
      michael: { sprite: 'michael', m: 1.85, speed: 0.011, step: 0.9 },
      jason: { sprite: 'jason', m: 1.95, speed: 0.01, step: 1.0 },
      valak: { sprite: 'valak', m: 1.8, speed: 0.012, step: 0 },
      samara: { sprite: 'samara', m: 1.05, speed: 0.013, step: 0 },
    };
    function walker(id) {
      return { kind: 'walk', id, def: WALK[id], st: 'wait', until: now() + slow(rand(6000, 10000)), u: 0.5, v: 0.72, lit: 0, f: 1, a: 0, nextStep: 0 };
    }
    function startPos() {
      const s = meta.spots || {};
      if (r.id === 'valak') return s.home || [0.5, 0.72];
      if (r.id === 'jason') return s.rise || [0.52, 0.62];
      if (r.id === 'samara') return s.tv ? [s.tv[0] + s.tv[2] / 2, 0.68] : [0.5, 0.68];
      return s.home || [0.7, 0.7];
    }
    function updateWalker(dt, R) {
      const t = now();
      if (r.st === 'wait') {
        // Valak waits in her painting; looking at the painting keeps her there
        if (r.id === 'valak' && frameLit(R) > 0.4) r.until = Math.max(r.until, t + slow(3000));
        if (t > r.until) {
          r.st = 'appear';
          r.t0 = t;
          [r.u, r.v] = startPos();
          r.lit = 0;
          r.f = r.u < 0.5 ? 1 : -1;
          tell();
          if (r.id === 'jason') {
            PS.Sound.splash(pan(r.u));
            setTimeout(() => PS.Sound.voice('jason', pan(r.u)), 500);
          }
          if (r.id === 'samara') r.tvOn = t;
          if (r.id === 'valak') env.toast('She is not in the painting.', 2600);
        }
        return;
      }
      const sp = view.toScreen(r.u, r.v);
      const h = hpx(r.v, r.def.m);
      const L = env.lightAt(sp.x, sp.y - h * 0.55, R);
      r.L = L;
      r.sx = sp.x;
      r.sy = sp.y - h * 0.55;
      if (r.st === 'appear') {
        const len = r.id === 'samara' ? 3200 : r.id === 'jason' ? 1600 : 1200;
        r.a = clamp((t - r.t0 - (r.id === 'samara' ? 2400 : 0)) / 800, 0, 1);
        if (t - r.t0 > len) r.st = 'come';
        return;
      }
      if (r.st === 'go') {
        r.a = 1 - clamp((t - r.t0) / 900, 0, 1);
        if (r.a <= 0) rest(false);
        return;
      }
      // come: frozen while lit, otherwise a little closer
      if (L > 0.3) {
        r.lit += dt;
        if (r.lit > 3) {
          r.st = 'go';
          r.t0 = t;
          if (!r.sentAway) env.toast(r.id === 'valak' ? 'She went back into the painting.' : 'Gone. For now.', 2400);
          r.sentAway = true;
        }
        return;
      }
      r.lit = Math.max(0, r.lit - dt * 0.5);
      // towards where you stand, slowly
      const me = env.player();
      const AS = 1080 / 1920;
      const du = (me.u - r.u) / AS;
      const dv = me.v - r.v;
      const dist = Math.hypot(du, dv) || 1;
      const step = (r.def.speed * 1.6 * dt) / Math.max(0.35, env.fast());
      r.u += (du / dist) * step * AS;
      r.v += (dv / dist) * step;
      r.f = du < 0 ? -1 : 1;
      if (r.def.step && t > r.nextStep) {
        r.nextStep = t + r.def.step * 1000;
        PS.Sound.footstep(pan(r.u));
      }
      if (dist < 0.07) {
        env.scare(r.id, true);
        rest(true);
      }
    }
    function rest(long) {
      r.st = 'wait';
      r.a = 0;
      r.tvOn = 0;
      r.until = now() + slow(long ? rand(22000, 30000) : rand(15000, 22000));
    }
    function drawWalker(ctx, R, tt) {
      const s = meta.spots || {};
      // Valak's painting: she is in it until she is not
      if (r.id === 'valak' && s.frame) {
        const [fx, fy, fw, fh] = s.frame;
        const a = view.toScreen(fx, fy);
        const b = view.toScreen(fx + fw, fy + fh);
        if (r.st === 'wait') {
          const img = PS.sprite('valak');
          const L = frameLit(R);
          if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
            ctx.clip();
            const h = (b.y - a.y) * 1.25;
            PS.drawLitSprite(ctx, img, (a.x + b.x) / 2, a.y + h * 0.97, h, { torch: env.torch(), R, alpha: 0.12 + 0.88 * L });
            ctx.restore();
          }
        }
      }
      // Samara's television
      if (r.id === 'samara' && s.tv && r.tvOn) {
        const [x, y, w, h] = s.tv;
        const a = view.toScreen(x + w * 0.08, y + h * 0.12);
        const b = view.toScreen(x + w * 0.66, y + h * 0.85);
        drawStatic(ctx, a.x, a.y, b.x - a.x, b.y - a.y, tt);
      }
      if (r.st === 'wait' || !(r.a > 0)) return;
      const img = PS.sprite(r.def.sprite);
      const sp = view.toScreen(r.u, r.v);
      let h = hpx(r.v, r.def.m);
      const o = { torch: env.torch(), R, facing: r.id === 'michael' || r.id === 'jason' ? r.f : 1, alpha: r.a * (0.16 + 0.84 * (r.L || 0)) };
      if (r.st === 'appear' && r.id === 'jason') {
        // rising out of the water
        const k = ease.out(clamp((now() - r.t0) / 1600, 0, 1));
        o.clip = sp.y;
        PS.drawLitSprite(ctx, img, sp.x, sp.y + h * (1 - k), h, o);
        return;
      }
      if (r.st === 'appear' && r.id === 'samara') h *= 0.4 + 0.6 * ease.out(r.a);
      // a breath when frozen in the light, so you know it is alive
      if (r.L > 0.3) o.rot = Math.sin(tt * 30) * 0.004;
      PS.drawLitSprite(ctx, img, sp.x, sp.y, h, o);
    }
    function frameLit(R) {
      const f = (meta.spots || {}).frame;
      if (!f) return 0;
      const c = view.toScreen(f[0] + f[2] / 2, f[1] + f[3] / 2);
      return env.lightAt(c.x, c.y, R);
    }
    function drawStatic(ctx, x, y, w, h, tt) {
      ctx.save();
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(tt * 40);
      ctx.fillStyle = '#cfd6d4';
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#3a3f3e';
      const n = 70;
      for (let i = 0; i < n; i++) ctx.fillRect(x + Math.random() * w, y + Math.random() * h, w * 0.06, Math.max(1, h * 0.02));
      ctx.restore();
    }

    // ---------------------------------------------------------------- Freddy
    // Stand still too long in the boiler room and he comes. Keep moving and he never does.
    function freddy() {
      return { kind: 'freddy', id: 'freddy', still: 0, warned: false, show: 0, last: null, entered: now() };
    }
    function updateFreddy(dt) {
      const tr = env.torch();
      const moved = r.last ? Math.hypot(tr.x - r.last.x, tr.y - r.last.y) : 0;
      r.last = { x: tr.x, y: tr.y };
      if (now() - r.entered < slow(3000)) return;
      if (!r.toldRule) {
        r.toldRule = true;
        tell();
      }
      if (moved > 40 * dt * 2) {
        if (r.show) env.toast('Close. Keep moving.', 2200);
        r.still = Math.max(0, r.still - dt * 4);
        r.show = 0;
        if (r.still === 0) r.warned = false;
        return;
      }
      r.still += dt / Math.max(0.35, env.fast());
      if (r.still > 8 && !r.warned) {
        r.warned = true;
        PS.Sound.voice('freddy', 0, () => PS.Sound.lullaby());
        env.toast('One, two. Freddy is coming for you.', 3600);
      }
      if (r.still > 13 && !r.show) r.show = now();
      if (r.show && now() - r.show > 700) {
        env.scare('freddy', true);
        r.still = 0;
        r.show = 0;
        r.warned = false;
      }
    }
    function drawFreddy(ctx, R) {
      if (!r.show) return;
      const tr = env.torch();
      const h = Math.min(window.innerHeight * 0.75, hpx(0.86, 1.8));
      const k = ease.out(clamp((now() - r.show) / 500, 0, 1));
      PS.drawLitSprite(ctx, PS.sprite('freddy'), tr.x + R * 0.95, tr.y + h * 0.5, h, { torch: tr, R: R * 1.4, alpha: k });
    }

    // ---------------------------------------------------------------- Annabelle
    // She sits where you left her. Look away too long and she is somewhere closer.
    function annabelle() {
      return { kind: 'doll', id: 'annabelle', i: 0, dark: 0 };
    }
    function dollAt() {
      const list = (meta.spots || {}).doll || [[0.5, 0.7]];
      return list[Math.min(r.i, list.length - 1)];
    }
    function updateDoll(dt, R) {
      const [u, v] = dollAt();
      const sp = view.toScreen(u, v);
      const h = hpx(v, 0.8);
      r.L = env.lightAt(sp.x, sp.y - h * 0.5, R);
      if (r.L > 0.3) {
        tell();
        r.dark = 0;
        return;
      }
      r.dark += dt / Math.max(0.35, env.fast());
      if (r.dark > 7) {
        r.dark = 0;
        r.i++;
        const n = ((meta.spots || {}).doll || []).length;
        PS.Sound.giggle(pan(u));
        if (r.i >= n) {
          env.scare('annabelle', true);
          r.i = 0;
        } else if (r.i === n - 1) env.toast('She is right in front of you.', 2400);
      }
    }
    function drawDoll(ctx, R) {
      const [u, v] = dollAt();
      const sp = view.toScreen(u, v);
      PS.drawLitSprite(ctx, PS.sprite('annabelle'), sp.x, sp.y, hpx(v, 0.8), { torch: env.torch(), R, alpha: 0.1 + 0.9 * (r.L || 0) });
    }

    // ---------------------------------------------------------------- Ghostface
    // The telephone rings now and then. Answer it for two souls and a fright. Ignoring it is fine.
    function ghostface() {
      return { kind: 'phone', id: 'ghostface', ring: 0, next: now() + slow(rand(9000, 16000)), lastBell: 0 };
    }
    function phoneRect() {
      const p = (meta.spots || {}).phone;
      if (!p) return null;
      const a = view.toScreen(p[0], p[1]);
      const b = view.toScreen(p[0] + p[2], p[1] + p[3]);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    }
    function updatePhone() {
      const t = now();
      if (!r.ring && t > r.next) {
        r.ring = t;
        tell();
      }
      if (r.ring) {
        if (t - r.lastBell > 1600) {
          r.lastBell = t;
          const pr = phoneRect();
          PS.Sound.ring(pr ? pan(view.toRoom(pr.x, pr.y).u) : 0);
        }
        if (t - r.ring > 9000) {
          r.ring = 0;
          r.next = t + slow(rand(20000, 32000));
        }
      }
    }
    function drawPhone(ctx, R, tt) {
      if (!r.ring) return;
      // while it rings, he stands in the dark across the hall with the receiver to his ear
      const st = (meta.spots || {}).stand;
      if (st) {
        const sp = view.toScreen(st[0], st[1]);
        const h = hpx(st[1], 1.9);
        const L = env.lightAt(sp.x, sp.y - h * 0.6, R);
        const k = ease.out(clamp((now() - r.ring) / 1500, 0, 1));
        PS.drawLitSprite(ctx, PS.sprite('ghostface'), sp.x, sp.y, h, { torch: env.torch(), R, alpha: k * (0.1 + 0.9 * L) });
      }
      const pr = phoneRect();
      if (!pr) return;
      // the bell shakes the receiver: a small warm flicker on the table
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cx = pr.x + pr.w / 2;
      const cy = pr.y + pr.h * 0.4;
      const k = 0.5 + 0.5 * Math.sin(tt * 40);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr.w * 1.6);
      g.addColorStop(0, hexA(T.ember, 0.35 * k));
      g.addColorStop(1, hexA(T.flame, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - pr.w * 2, cy - pr.w * 2, pr.w * 4, pr.w * 4);
      ctx.restore();
    }

    // ---------------------------------------------------------------- Pennywise
    // He waits by the drain. A red balloon drifts about. Do not take the balloon.
    function pennywise() {
      return { kind: 'balloon', id: 'pennywise', seen: false, gone: 0, ph: rand(0, 6) };
    }
    function balloonPos(tt) {
      return { u: 0.5 + 0.28 * Math.sin(tt * 0.11 + r.ph), v: 0.42 + 0.1 * Math.sin(tt * 0.17 + r.ph * 2) };
    }
    function updateBalloon(dt, R) {
      const home = (meta.spots || {}).drain || [0.48, 0.8];
      const sp = view.toScreen(home[0], home[1] - 0.04);
      const h = hpx(home[1] - 0.04, 1.85);
      r.L = env.lightAt(sp.x, sp.y - h * 0.6, R);
      // the first time your light finds him, and now and then after, he speaks
      if (r.L > 0.35 && now() > (r.nextVoice || 0)) {
        r.nextVoice = now() + slow(25000);
        PS.Sound.voice('pennywise', pan(home[0]), () => PS.Sound.giggle(pan(home[0])));
        if (!r.seen) tell();
        r.seen = true;
      }
    }
    function drawBalloon(ctx, R, tt) {
      const home = (meta.spots || {}).drain || [0.48, 0.8];
      const sp = view.toScreen(home[0], home[1] - 0.04);
      PS.drawLitSprite(ctx, PS.sprite('pennywise'), sp.x, sp.y, hpx(home[1] - 0.04, 1.85), { torch: env.torch(), R, alpha: 0.08 + 0.92 * (r.L || 0) });
      if (now() < r.gone) return;
      const b = balloonPos(tt);
      const p = view.toScreen(b.u, b.v);
      const rad = 30 * sc();
      const L = env.lightAt(p.x, p.y, R);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * L;
      ctx.strokeStyle = hexA(T.bone, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + rad * 1.15);
      ctx.quadraticCurveTo(p.x + rad * 0.4, p.y + rad * 2.5, p.x - rad * 0.2, p.y + rad * 4.2);
      ctx.stroke();
      const g = ctx.createRadialGradient(p.x - rad * 0.35, p.y - rad * 0.4, rad * 0.1, p.x, p.y, rad * 1.2);
      g.addColorStop(0, '#ff6b6b');
      g.addColorStop(0.5, '#c3122b');
      g.addColorStop(1, '#5a0712');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rad, rad * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    function balloonHit(x, y, tt) {
      if (now() < r.gone) return false;
      const b = balloonPos(tt);
      const p = view.toScreen(b.u, b.v);
      return Math.hypot(x - p.x, y - p.y) < 46 * sc() + 12;
    }

    const pan = (u) => clamp((u - 0.5) * 2, -1, 1);
    const MAKE = { michael: () => walker('michael'), jason: () => walker('jason'), valak: () => walker('valak'), samara: () => walker('samara'), freddy, annabelle, ghostface, pennywise };

    return {
      reset() {
        told.clear();
        r = null;
      },
      enter(roomId, roomMeta) {
        room = roomId;
        meta = roomMeta || {};
        const def = S.RESIDENTS[roomId];
        r = def ? MAKE[def.id]() : null;
      },
      leave() {
        r = null;
      },
      update(dt, R) {
        if (!r) return;
        if (r.kind === 'walk') updateWalker(dt, R);
        else if (r.kind === 'freddy') updateFreddy(dt);
        else if (r.kind === 'doll') updateDoll(dt, R);
        else if (r.kind === 'phone') updatePhone();
        else if (r.kind === 'balloon') updateBalloon(dt, R);
      },
      draw(ctx, R, tt) {
        if (!r) return;
        if (r.kind === 'walk') drawWalker(ctx, R, tt);
        else if (r.kind === 'freddy') drawFreddy(ctx, R);
        else if (r.kind === 'doll') drawDoll(ctx, R);
        else if (r.kind === 'phone') drawPhone(ctx, R, tt);
        else if (r.kind === 'balloon') drawBalloon(ctx, R, tt);
      },
      // extra light for the room shader: the television, the telephone
      lights(tt) {
        if (!r) return [];
        const s = meta.spots || {};
        if (r.kind === 'walk' && r.id === 'samara' && r.tvOn && s.tv) {
          return [{ u: s.tv[0] + s.tv[2] * 0.4, v: s.tv[1] + s.tv[3] * 0.5, intensity: 1.3 * (0.8 + 0.2 * Math.sin(tt * 37)), color: [0.62, 0.72, 0.78] }];
        }
        if (r.kind === 'phone' && r.ring && s.phone) return [{ u: s.phone[0] + s.phone[2] / 2, v: s.phone[1], intensity: 0.5 * (0.5 + 0.5 * Math.sin(tt * 40)), color: [1, 0.6, 0.25] }];
        return [];
      },
      // what clicking here would do, in words (shown by the lantern)
      label(x, y, tt) {
        if (!r) return null;
        if (r.kind === 'phone' && r.ring) {
          const pr = phoneRect();
          if (pr && x > pr.x - 40 && x < pr.x + pr.w + 40 && y > pr.y - 40 && y < pr.y + pr.h + 40) return 'Answer the telephone';
        }
        if (r.kind === 'balloon' && balloonHit(x, y, tt)) return 'Take the balloon';
        return null;
      },
      // a click on a resident's thing: where to stand to do it, and what doing it is
      target(x, y, tt) {
        if (!r) return null;
        if (r.kind === 'phone' && r.ring && this.label(x, y, tt)) {
          const p = meta.spots.phone;
          return { u: p[0] + p[2] / 2 - 0.05, v: p[1] + p[3] + 0.18, act: 'phone' };
        }
        if (r.kind === 'balloon' && balloonHit(x, y, tt)) {
          const b = balloonPos(tt);
          return { u: b.u, v: Math.max(b.v + 0.3, 0.72), act: 'balloon' };
        }
        return null;
      },
      // you got there: do it, if it is still there to do
      activate(act) {
        if (!r) return;
        if (act === 'phone' && r.kind === 'phone') {
          if (!r.ring) return env.toast('It stopped ringing.', 1800);
          r.ring = 0;
          r.next = now() + slow(rand(25000, 35000));
          env.scare('ghostface', false);
          env.phone();
        } else if (act === 'balloon' && r.kind === 'balloon' && now() >= r.gone) {
          r.gone = now() + slow(20000);
          env.scare('pennywise', true);
        }
      },
      // a click: true if a resident took it
      press(x, y, tt) {
        if (!r) return false;
        if (r.kind === 'phone' && r.ring && this.label(x, y, tt)) {
          r.ring = 0;
          r.next = now() + slow(rand(25000, 35000));
          env.scare('ghostface', false);
          env.phone();
          return true;
        }
        if (r.kind === 'balloon' && balloonHit(x, y, tt)) {
          r.gone = now() + slow(20000);
          env.scare('pennywise', true);
          return true;
        }
        return false;
      },
      get debug() {
        if (!r) return null;
        const d = { id: r.id, st: r.st || r.kind, v: r.v, i: r.i, ring: !!r.ring, still: r.still, x: r.sx, y: r.sy, L: r.L, lit: r.lit, dark: r.dark };
        if (r.kind === 'phone') {
          const pr = phoneRect();
          if (pr) Object.assign(d, { x: pr.x + pr.w / 2, y: pr.y + pr.h / 2 });
        }
        if (r.kind === 'balloon') {
          const b = balloonPos(performance.now() / 1000);
          const p = view.toScreen(b.u, b.v);
          Object.assign(d, { x: p.x, y: p.y });
        }
        if (r.kind === 'doll') {
          const [u, v] = dollAt();
          const p = view.toScreen(u, v);
          Object.assign(d, { x: p.x, y: p.y - 30 });
        }
        return d;
      },
    };
  };
})();
