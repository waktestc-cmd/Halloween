// Shared browser code: tokens, cut-paper silhouettes, light-source drawing, sound, motion.
// Art direction: light is the only colour. Flame/ember only on light sources, blood only for
// death and the zombie result, wraith only for ghosts. Everything else is ink and bone.
/* global SHARED */
(function () {
  const S = window.SHARED;
  const TAU = Math.PI * 2;
  const T = {
    ink: '#0A0908',
    soot: '#15120E',
    bone: '#EDE3CF',
    ash: '#7E7567',
    flame: '#FF7A1A',
    ember: '#FFC46B',
    blood: '#C3122B',
    wraith: '#A9E8DA',
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = {
    outBack: (t, s = 1.7) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
    inBack: (t, s = 1.7) => (s + 1) * t * t * t - s * t * t,
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
  };
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  // flicker for light sources only: 2–4% amplitude
  function flicker(t, seed = 0, amp = 0.03) {
    return 1 + amp * (0.6 * Math.sin(t * 11.3 + seed) + 0.3 * Math.sin(t * 23.7 + seed * 2.1) + 0.1 * Math.sin(t * 47.1 + seed * 3.7));
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
  // Cut-paper silhouettes (100 x 100). Solids and holes get opposite winding,
  // so with the nonzero rule the holes are true negative space.
  // =====================================================================
  function ell(cx, cy, rx, ry, n = 36, rot = 0) {
    const pts = [];
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = rx * Math.cos(a);
      const y = ry * Math.sin(a);
      pts.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return pts;
  }
  const circ = (cx, cy, r, n = 36) => ell(cx, cy, r, r, n);
  function bez(p0, p1, p2, p3, n = 10) {
    const out = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return out;
  }
  const rect = (x0, y0, x1, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const mirror = (pts) => pts.map(([x, y]) => [100 - x, y]).reverse();
  function shoulders(top = 78, w = 38, neck = 11) {
    return [[50 - w, 101]]
      .concat(bez([50 - w, 101], [50 - w, top + 5], [50 - neck - 12, top], [50 - neck, top]))
      .concat([[50 + neck, top]])
      .concat(bez([50 + neck, top], [50 + neck + 12, top], [50 + w, top + 5], [50 + w, 101]));
  }
  function leg(pts, w = 1.3) {
    // thick polyline as a polygon
    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const k = i === pts.length - 1 ? 0.35 : 1;
      left.push([pts[i][0] - (dy / l) * w * k, pts[i][1] + (dx / l) * w * k]);
      right.push([pts[i][0] + (dy / l) * w * k, pts[i][1] - (dx / l) * w * k]);
    }
    return left.concat(right.reverse());
  }
  function area(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    return a / 2;
  }
  const orient = (p, pos) => ((area(p) > 0) === pos ? p : p.slice().reverse());
  function toD(solids, holes) {
    return solids
      .map((p) => orient(p, true))
      .concat(holes.map((p) => orient(p, false)))
      .map((p) => 'M' + p.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z')
      .join('');
  }
  function pumpkinOutline(cx, cy, rx, ry, n = 72) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const k = 1 - 0.05 * Math.abs(Math.sin(a * 3));
      pts.push([cx + rx * k * Math.cos(a), cy + ry * (0.97 + 0.03 * Math.cos(a * 5)) * Math.sin(a)]);
    }
    return pts;
  }

  const SIL = {
    witch: toD(
      [
        shoulders(80, 38, 10),
        rect(45, 66, 55, 82),
        circ(50, 56, 15),
        ell(50, 41, 33, 5.5),
        [[35, 40]].concat(bez([35, 40], [40, 24], [52, 12], [70, 4])).concat(bez([70, 4], [60, 14], [62, 26], [65, 40])),
      ],
      [ell(44, 57, 2.2, 3), ell(56, 57, 2.2, 3), rect(46, 26, 54, 32)]
    ),
    vampire: toD(
      [
        shoulders(76, 40, 12),
        rect(44, 62, 56, 78),
        circ(50, 50, 16),
        [[34, 48], [35, 37], [43, 32], [50, 40], [57, 32], [65, 37], [66, 48]],
        [[18, 84], [20, 50], [34, 64], [50, 69], [66, 64], [80, 50], [82, 84]],
      ],
      [ell(44, 53, 3, 1.5, 16, 0.3), ell(56, 53, 3, 1.5, 16, -0.3), [[46, 60], [48.4, 60], [47.2, 64]], [[51.6, 60], [54, 60], [52.8, 64]]]
    ),
    mummy: toD(
      [shoulders(78, 38, 11), rect(44, 62, 56, 80), circ(50, 48, 19)],
      [[[38, 36.5], [62, 34.5], [62, 37.5], [38, 39.5]], [[38, 58.5], [62, 56.5], [62, 59.5], [38, 61.5]], circ(57, 47, 3.6), circ(43, 48, 2.1)]
    ),
    skeleton: toD(
      [circ(50, 42, 20), [[38, 56], [62, 56], [62, 68]].concat(bez([62, 68], [62, 72], [58, 73], [50, 73])).concat(bez([50, 73], [42, 73], [38, 72], [38, 68])), shoulders(80, 36, 9), rect(47, 70, 53, 82)],
      [circ(42, 43, 5.5), circ(58, 43, 5.5), [[48, 50], [52, 50], [50, 55]], rect(41.5, 64, 43.5, 69), rect(45.5, 64, 47.5, 69), rect(49.5, 64, 51.5, 69), rect(53.5, 64, 55.5, 69), rect(57.5, 64, 59.5, 69)]
    ),
    werewolf: toD(
      [
        [[30, 62], [27, 44], [29, 30], [31, 13], [42, 28], [50, 26], [58, 28], [69, 13], [71, 30], [73, 44], [70, 62], [62, 70], [56, 78], [50, 80], [44, 78], [38, 70]],
        [[10, 101], [14, 84], [22, 80], [26, 73], [32, 78], [38, 72], [44, 78], [50, 74], [56, 78], [62, 72], [68, 78], [74, 73], [78, 80], [86, 84], [90, 101]],
      ],
      [[[36, 44], [45, 47.5], [37, 49]], mirror([[36, 44], [45, 47.5], [37, 49]]), ell(50, 65, 3.5, 2.4)]
    ),
    zombie: toD(
      [
        ell(52, 48, 17, 19, 36, 0.15),
        [[38, 38], [39, 26], [45, 33], [48, 21], [53, 31], [58, 23], [61, 34], [67, 41]],
        rect(45, 64, 58, 80),
        [[8, 101], [10, 86], [24, 78], [40, 74], [60, 76], [80, 82], [92, 101]],
        [[13, 92], [8, 64], [4, 48], [2, 42], [4, 38], [8, 40], [10, 36], [13, 38], [15, 35], [18, 40], [19, 48], [22, 66], [27, 90]],
      ],
      [circ(45, 48, 4.5), circ(59, 47, 2.5), [[44, 57], [48, 55], [51, 58], [55, 55], [59, 57], [57, 61], [46, 61]]]
    ),
    ghost: toD(
      [
        (() => {
          const top = [];
          for (let i = 0; i <= 20; i++) {
            const a = Math.PI + (i / 20) * Math.PI;
            top.push([50 + 26 * Math.cos(a), 44 + 26 * Math.sin(a)]);
          }
          return top.concat([[78, 58], [79, 88], [72, 80], [65, 91], [58, 82], [50, 93], [42, 82], [35, 91], [28, 80], [21, 88], [22, 58]]);
        })(),
      ],
      [ell(41, 42, 3.5, 5), ell(59, 42, 3.5, 5), ell(50, 60, 4, 6)]
    ),
    pumpkin: toD(
      [pumpkinOutline(50, 50, 28, 22), [[47, 30], [46, 20], [50, 13], [55, 15], [53, 22], [53, 30]], rect(44, 68, 56, 84), shoulders(82, 36, 10)],
      [[[38, 46], [46, 46], [42, 38]], [[54, 46], [62, 46], [58, 38]], [[36, 54], [40, 58], [44, 54], [48, 59], [52, 54], [56, 59], [60, 54], [64, 54], [60, 62], [50, 65], [40, 62]]]
    ),
    bat: toD(
      [
        ell(50, 52, 8, 13),
        [[43, 42], [42, 29], [46, 36], [50, 35], [54, 36], [58, 29], [57, 42]],
        [[44, 46], [32, 34], [18, 30], [3, 36], [10, 46], [16, 44], [20, 54], [27, 50], [32, 60], [38, 56], [44, 63]],
        mirror([[44, 46], [32, 34], [18, 30], [3, 36], [10, 46], [16, 44], [20, 54], [27, 50], [32, 60], [38, 56], [44, 63]]),
      ],
      [circ(46.6, 45, 1.8, 16), circ(53.4, 45, 1.8, 16)]
    ),
    cat: toD(
      [
        circ(50, 34, 13),
        [[38, 30], [37, 13], [47, 23]],
        [[62, 30], [63, 13], [53, 23]],
        ell(50, 74, 23, 28).filter((p) => p[1] <= 101),
        [[70, 94], [84, 86], [91, 70], [88, 54], [82, 47], [77, 51], [83, 58], [84, 70], [80, 82], [67, 88]],
      ],
      [ell(44, 34, 3.2, 1.5, 18, 0.35), ell(56, 34, 3.2, 1.5, 18, -0.35)]
    ),
    spider: toD(
      [
        rect(49.3, 0, 50.7, 33),
        circ(50, 38, 8),
        ell(50, 60, 14, 16),
        ...[
          [[44, 50], [26, 33], [14, 48]],
          [[43, 55], [22, 45], [8, 62]],
          [[43, 60], [22, 62], [10, 80]],
          [[44, 65], [28, 77], [20, 95]],
        ].flatMap((l) => [leg(l), leg(l.map(([x, y]) => [100 - x, y]))]),
      ],
      [circ(46.6, 37, 1.9, 16), circ(53.4, 37, 1.9, 16), [[47, 57], [53, 57], [50, 61.5]], [[47, 66], [53, 66], [50, 61.5]]]
    ),
    devil: toD(
      [
        circ(50, 52, 17),
        [[37, 41], [31, 33], [27, 22], [29, 16], [34, 25], [40, 31], [45, 37]],
        mirror([[37, 41], [31, 33], [27, 22], [29, 16], [34, 25], [40, 31], [45, 37]]),
        [[45, 66], [55, 66], [50, 80]],
        rect(45, 66, 55, 82),
        shoulders(80, 38, 11),
      ],
      [[[40, 49], [47, 52.5], [41, 55]], mirror([[40, 49], [47, 52.5], [41, 55]]), [[40, 58]].concat(bez([40, 58], [44, 66], [56, 66], [60, 58])).concat(bez([60, 58], [56, 62], [44, 62], [40, 58]))]
    ),
  };
  const silPaths = {};
  const silPath = (id) => silPaths[id] || (silPaths[id] = new Path2D(SIL[id] || SIL.ghost));
  const costumeById = (id) => S.COSTUMES.find((c) => c.id === id) || S.COSTUMES[0];

  function silSVG(id, cls = '') {
    return `<svg class="sil ${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="${SIL[id] || SIL.ghost}"/></svg>`;
  }
  function silEl(id, cls) {
    const s = document.createElement('span');
    s.className = 'silw';
    s.innerHTML = silSVG(id, cls);
    return s;
  }
  function drawSil(ctx, id, x, y, size, color = T.bone) {
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 100, size / 100);
    ctx.fillStyle = color;
    ctx.fill(silPath(id));
    ctx.restore();
  }
  // name with a small silhouette before it (names are user input: textContent only)
  function whoEl(who, cls) {
    const s = document.createElement('span');
    s.className = 'who ' + (cls || '');
    if (!who) {
      s.appendChild(silEl('ghost'));
      const n = document.createElement('span');
      n.textContent = 'the House';
      s.appendChild(n);
      return s;
    }
    s.appendChild(silEl(who.costume));
    const n = document.createElement('span');
    n.textContent = who.name;
    s.appendChild(n);
    return s;
  }
  const nameOf = (who) => (who ? who.name : 'the House');
  const NameOf = (who) => (who ? who.name : 'The House'); // at the start of a sentence

  // =====================================================================
  // Light sources and objects
  // =====================================================================
  const PUMPKIN = new Path2D(toD([pumpkinOutline(50, 54, 40, 33)], []));
  const STEM = new Path2D(toD([[[47, 24], [45, 12], [50, 4], [56, 6], [53, 14], [54, 24]]], []));
  const EYES = new Path2D(toD([[[30, 44], [42, 44], [36, 32]], [[58, 44], [70, 44], [64, 32]]], []));
  const MOUTH = new Path2D(toD([[[28, 58], [34, 63], [40, 58], [46, 65], [54, 65], [60, 58], [66, 63], [72, 58], [66, 72], [50, 77], [34, 72]]], []));
  const RIBS = [
    [-0.42, 0.55],
    [-0.16, 0.8],
    [0.16, 0.8],
    [0.42, 0.55],
  ];
  const FIG = '"Fraunces", Georgia, serif';

  // A carved pumpkin. lit: 0 = unlit ash outline, 1 = burning. n: number carved as its mouth.
  // o.tint: colour of torch light falling on an unlit pumpkin (0..1 strength), o.zombie: lit in blood.
  function drawPumpkin(ctx, x, y, size, n, o = {}) {
    if (!(size > 2)) return;
    const lit = clamp(o.lit || 0, 0, 1);
    const t = o.t != null ? o.t : performance.now() / 1000;
    const fl = lit > 0 ? flicker(t, (n || 1) * 1.7, 0.035) : 1;
    const hot = o.zombie ? T.blood : T.flame;
    const core = o.zombie ? '#ff5a6e' : T.ember;
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    const k = size / 100;
    if (lit > 0 && o.glow !== false) {
      // light falloff around the lantern: radial, no outline
      const R = size * (0.55 + 0.65 * lit) * fl;
      const g = ctx.createRadialGradient(50 * k, 54 * k, size * 0.1, 50 * k, 54 * k, R);
      g.addColorStop(0, hexA(core, 0.42 * lit));
      g.addColorStop(0.35, hexA(hot, 0.2 * lit));
      g.addColorStop(1, hexA(hot, 0));
      ctx.fillStyle = g;
      ctx.fillRect(50 * k - R, 54 * k - R, R * 2, R * 2);
    }
    ctx.scale(k, k);
    if (lit > 0) {
      ctx.globalAlpha = 0.25 + 0.75 * lit;
      ctx.fillStyle = hot;
      ctx.fill(PUMPKIN);
      ctx.fill(STEM);
      ctx.globalAlpha = 1;
      // ribs: shadow lines, not outlines
      ctx.save();
      ctx.clip(PUMPKIN);
      ctx.strokeStyle = 'rgba(10,9,8,0.28)';
      ctx.lineWidth = 2.2;
      for (const [dx, sc] of RIBS) {
        ctx.beginPath();
        ctx.ellipse(50 + dx * 40, 54, 40 * 0.3 * sc, 33 * 0.96, 0, -Math.PI / 2, Math.PI / 2, dx < 0);
        ctx.stroke();
      }
      ctx.restore();
      // the carving glows from inside
      const cg = ctx.createRadialGradient(50, 56, 2, 50, 56, 40);
      cg.addColorStop(0, '#fff3d6');
      cg.addColorStop(0.45, core);
      cg.addColorStop(1, hot);
      ctx.fillStyle = cg;
      ctx.globalAlpha = lit * fl;
      ctx.fill(EYES);
      if (n) {
        ctx.font = `900 40px ${FIG}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), 50, 66);
      } else ctx.fill(MOUTH);
      ctx.globalAlpha = 1;
    } else {
      const tint = o.tint || 0;
      if (tint > 0) {
        // torchlight falling on an unlit pumpkin
        ctx.globalAlpha = tint;
        ctx.fillStyle = '#5a3418';
        ctx.fill(PUMPKIN);
        ctx.fillStyle = '#3b2a12';
        ctx.fill(STEM);
        ctx.globalAlpha = 1;
        ctx.fillStyle = T.ink;
        ctx.fill(EYES);
        if (n) {
          ctx.font = `900 40px ${FIG}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(n), 50, 66);
        } else ctx.fill(MOUTH);
      } else {
        ctx.strokeStyle = o.color || T.ash;
        ctx.lineWidth = o.line || 2.2;
        ctx.stroke(PUMPKIN);
        ctx.stroke(STEM);
        ctx.globalAlpha = 0.6;
        ctx.stroke(EYES);
        if (n) {
          ctx.font = `800 40px ${FIG}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 1.5;
          ctx.strokeText(String(n), 50, 66);
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  const HAMMER = new Path2D(toD([rect(46, 30, 54, 100), [[20, 6], [80, 6], [84, 10], [84, 30], [80, 34], [20, 34], [16, 30], [16, 10]]], [rect(26, 14, 74, 16)]));
  // pivot at the bottom of the handle; angle 0 = head straight up
  function drawHammer(ctx, x, y, size, angle = 0, color = T.bone) {
    if (!(size > 2)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.translate(-size / 2, -size);
    ctx.scale(size / 100, size / 100);
    ctx.fillStyle = color;
    ctx.fill(HAMMER);
    ctx.restore();
  }

  // Souls: pale motes of bone, only visible in light.
  function drawSoul(ctx, x, y, size, t, alpha = 1, v = 1) {
    if (!(size > 0.5) || alpha <= 0) return;
    const r = size * (1 + 0.06 * Math.sin(t * 3 + x));
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    g.addColorStop(0, hexA(T.bone, 0.95 * alpha));
    g.addColorStop(0.3, hexA(T.bone, 0.35 * alpha));
    g.addColorStop(1, hexA(T.bone, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, TAU);
    ctx.fill();
    if (v > 1) {
      ctx.fillStyle = hexA(T.bone, alpha);
      ctx.font = `700 ${Math.round(Math.max(11, r * 1.4))}px "Atkinson Hyperlegible", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('×' + v, x, y - r * 2.2);
    }
    ctx.restore();
  }

  // Ghosts: soft wraith smoke with two dark eye holes. Each has its own outline.
  const GHOST_SHAPES = {
    butler: [[50, 6], [62, 10], [66, 22], [64, 34], [76, 42], [78, 60], [72, 82], [66, 96], [58, 88], [50, 98], [42, 88], [34, 96], [28, 82], [22, 60], [24, 42], [36, 34], [34, 22], [38, 10]],
    ragdoll: [[44, 20], [60, 18], [70, 28], [70, 40], [64, 50], [74, 58], [72, 74], [62, 90], [52, 82], [44, 92], [34, 78], [28, 62], [34, 52], [28, 42], [30, 28]],
    warden: [[50, 14], [66, 18], [74, 30], [72, 42], [88, 52], [90, 72], [80, 92], [64, 86], [50, 96], [36, 86], [20, 92], [10, 72], [12, 52], [28, 42], [26, 30], [34, 18]],
    bride: [[50, 4], [64, 10], [70, 26], [74, 50], [82, 74], [94, 98], [72, 92], [56, 98], [40, 92], [24, 98], [14, 86], [24, 62], [28, 40], [32, 22], [38, 10]],
    choir: [[50, 2], [68, 16], [74, 36], [78, 62], [82, 92], [66, 86], [50, 96], [34, 86], [18, 92], [22, 62], [26, 36], [32, 16]],
  };
  const GHOST_EYES = {
    butler: [[43, 22, 3, 4], [57, 22, 3, 4]],
    ragdoll: [[44, 33, 4, 3], [58, 31, 2.4, 2.4]],
    warden: [[42, 30, 4.5, 3.5], [58, 30, 4.5, 3.5]],
    bride: [[44, 22, 2.6, 4.5], [56, 22, 2.6, 4.5]],
    choir: [[43, 30, 3.5, 2.2], [57, 30, 3.5, 2.2]],
  };
  const ghostCache = new Map();
  function ghostSprite(gi, px) {
    const id = S.GHOSTS[gi].id;
    const b = Math.max(24, Math.round(px / 16) * 16);
    const key = id + b;
    if (ghostCache.has(key)) return ghostCache.get(key);
    const pad = b * 0.35;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.ceil(b + pad * 2);
    const c = cv.getContext('2d');
    const path = new Path2D(toD([GHOST_SHAPES[id]], []));
    const k = b / 100;
    // smoke: only the blurred shadow of the shape is drawn (works in every browser)
    const layer = (blur, alpha, scale) => {
      c.save();
      c.shadowColor = hexA(T.wraith, alpha);
      c.shadowBlur = blur;
      c.shadowOffsetX = 10000;
      c.translate(pad - 10000 + (b * (1 - scale)) / 2, pad + (b * (1 - scale)) / 2);
      c.scale(k * scale, k * scale);
      c.fillStyle = '#000';
      c.fill(path);
      c.restore();
    };
    layer(b * 0.22, 0.35, 1.06);
    layer(b * 0.1, 0.45, 0.96);
    layer(b * 0.04, 0.4, 0.86);
    // eye holes
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.shadowColor = '#000';
    c.shadowBlur = b * 0.03;
    for (const [ex, ey, rx, ry] of GHOST_EYES[id]) {
      c.beginPath();
      c.ellipse(pad + ex * k, pad + ey * k, rx * k, ry * k, 0, 0, TAU);
      c.fill();
    }
    c.restore();
    const out = { cv, pad, b };
    ghostCache.set(key, out);
    return out;
  }
  function drawGhost(ctx, gi, x, y, size, t, alpha = 1) {
    if (!(size > 2) || alpha <= 0) return;
    const sp = ghostSprite(gi, size);
    const s = size / sp.b;
    const breathe = 1 + 0.03 * Math.sin(t * 1.7);
    const sway = Math.sin(t * 1.1) * 0.05;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(sway);
    ctx.scale(s * (2 - breathe), s * breathe);
    ctx.drawImage(sp.cv, -sp.cv.width / 2, -sp.cv.height / 2);
    ctx.restore();
  }

  // a small hand lantern: the one light every player carries
  function drawLantern(ctx, x, y, s, t, alpha = 1) {
    const fl = flicker(t, x * 0.01, 0.04);
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 2.6 * fl);
    g.addColorStop(0, hexA(T.ember, 0.55));
    g.addColorStop(1, hexA(T.flame, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
    ctx.fillStyle = T.bone;
    ctx.fillRect(x - s * 0.08, y - s * 0.75, s * 0.16, s * 0.2);
    ctx.fillRect(x - s * 0.42, y - s * 0.55, s * 0.84, s * 0.12);
    ctx.fillRect(x - s * 0.42, y + s * 0.45, s * 0.84, s * 0.12);
    ctx.fillStyle = T.ember;
    ctx.fillRect(x - s * 0.3, y - s * 0.43, s * 0.6, s * 0.88);
    ctx.fillStyle = '#fff3d6';
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.05, s * 0.1, s * 0.22 * fl, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // A zombie: a hunched cut-paper figure, arms out, feet at (x, y). Only light reveals it.
  // o: facing, light (0..1, how much torchlight falls on it), t
  function drawZombie(ctx, x, y, h, o = {}) {
    if (!(h > 6)) return;
    const f = o.facing < 0 ? -1 : 1;
    const t = o.t || 0;
    const L = clamp(o.light || 0, 0, 1);
    const step = Math.sin(t * 2.2 + (o.seed || 0));
    const r = Math.round(lerp(13, 122, L));
    const gcol = Math.round(lerp(11, 112, L));
    const b = Math.round(lerp(9, 96, L));
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 0.1 + 0.9 * L;
    ctx.translate(x, y);
    ctx.scale(f, 1);
    ctx.rotate(0.05 * step);
    ctx.fillStyle = `rgb(${r},${gcol},${b})`;
    // the dragging back leg and the stepping front leg
    ctx.beginPath();
    ctx.moveTo(-h * 0.08, -h * 0.42);
    ctx.lineTo(-h * 0.01, -h * 0.42);
    ctx.lineTo(-h * 0.1, -h * 0.03);
    ctx.lineTo(-h * 0.2, 0);
    ctx.lineTo(-h * 0.21, -h * 0.03);
    ctx.lineTo(-h * 0.15, -h * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-h * 0.01, -h * 0.42);
    ctx.lineTo(h * 0.08, -h * 0.42);
    ctx.lineTo(h * (0.12 + 0.04 * step), -h * 0.04);
    ctx.lineTo(h * (0.18 + 0.04 * step), -h * 0.01);
    ctx.lineTo(h * (0.04 + 0.04 * step), 0);
    ctx.closePath();
    ctx.fill();
    // hunched torso with a torn hem
    ctx.beginPath();
    ctx.moveTo(-h * 0.13, -h * 0.36);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-h * 0.13 + (i / 6) * h * 0.25, -h * (i % 2 ? 0.31 : 0.37));
    ctx.lineTo(h * 0.14, -h * 0.44);
    ctx.lineTo(h * 0.22, -h * 0.74);
    ctx.lineTo(h * 0.08, -h * 0.82);
    ctx.lineTo(-h * 0.06, -h * 0.76);
    ctx.closePath();
    ctx.fill();
    // arms reaching out, a little out of step with each other
    for (const [dy, k] of [
      [-0.74, 1],
      [-0.69, -1],
    ]) {
      const sway = Math.sin(t * 1.7 + k) * h * 0.02;
      ctx.beginPath();
      ctx.moveTo(h * 0.12, h * dy);
      ctx.lineTo(h * 0.5, h * (dy + 0.03) + sway);
      ctx.lineTo(h * 0.56, h * (dy + 0.015) + sway);
      ctx.lineTo(h * 0.55, h * (dy + 0.045) + sway);
      ctx.lineTo(h * 0.5, h * (dy + 0.07) + sway);
      ctx.lineTo(h * 0.13, h * (dy + 0.07));
      ctx.closePath();
      ctx.fill();
    }
    // head, hanging forward
    ctx.beginPath();
    ctx.ellipse(h * 0.21, -h * 0.86, h * 0.085, h * 0.1, 0.5, 0, TAU);
    ctx.fill();
    // eyes catch the light
    if (L > 0.12) {
      ctx.globalAlpha *= L;
      ctx.fillStyle = T.bone;
      ctx.beginPath();
      ctx.arc(h * 0.25, -h * 0.87, h * 0.011, 0, TAU);
      ctx.arc(h * 0.2, -h * 0.875, h * 0.009, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // =====================================================================
  // Particles: only at events (claim, death, smash). Additive light, flame shards.
  // =====================================================================
  class Particles {
    constructor(max = 1500) {
      this.list = [];
      this.max = max;
    }
    emit(x, y, o = {}) {
      const n = o.count || 20;
      for (let i = 0; i < n && this.list.length < this.max; i++) {
        const a = o.angle != null ? o.angle + rand(-(o.spread || TAU) / 2, (o.spread || TAU) / 2) : rand(0, TAU);
        const sp = rand((o.speed || 200) * 0.3, o.speed || 200);
        const life = rand((o.life || 1) * 0.6, o.life || 1);
        this.list.push({
          x: x + rand(-(o.jitter || 0), o.jitter || 0),
          y: y + rand(-(o.jitter || 0), o.jitter || 0),
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life,
          max: life,
          size: rand((o.size || 3) * 0.5, o.size || 3),
          color: Array.isArray(o.color) ? pick(o.color) : o.color || T.ember,
          g: o.gravity || 0,
          drag: o.drag != null ? o.drag : 0.985,
          shape: o.shape || 'ember',
          rot: rand(0, TAU),
          vr: rand(-12, 12),
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
        if (p.shape === 'shard') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(1, a * 1.6);
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(-p.size, -p.size * 0.4);
          ctx.lineTo(p.size * 1.2, 0);
          ctx.lineTo(-p.size * 0.6, p.size * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (p.shape === 'dust') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x, p.y, p.size, p.size);
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a;
          const r = p.size * (0.5 + a * 0.5);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
          g.addColorStop(0, p.color);
          g.addColorStop(1, hexA(p.color.length === 7 ? p.color : T.ember, 0));
          ctx.fillStyle = g;
          ctx.fillRect(p.x - r * 3, p.y - r * 3, r * 6, r * 6);
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
      if (reducedMotion) m *= 0.15;
      this.mag = Math.min(40, this.mag + m);
    }
    offset(dt) {
      this.mag *= Math.pow(0.004, dt);
      if (this.mag < 0.3) {
        this.mag = 0;
        return [0, 0];
      }
      return [rand(-1, 1) * this.mag, rand(-1, 1) * this.mag];
    }
  }

  // =====================================================================
  // Sound: synthesised with Web Audio
  // =====================================================================
  const Sound = (() => {
    let ctx = null;
    let master = null;
    let noiseBuf = null;
    let muted = store.get('ps_muted', false);
    let drone = null;
    let breath = null;
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

    api.chime = () => [880, 1318.5, 1760].forEach((f, i) => tone({ f, type: 'sine', vol: 0.14, dur: 1.4, at: i * 0.07 }));
    api.claim = () => {
      [392, 523.25, 659.25, 783.99].forEach((f, i) => tone({ f, type: 'triangle', vol: 0.16, dur: 0.9, at: i * 0.08, lp: 2400 }));
      noise({ f: 900, f2: 3500, q: 0.8, vol: 0.12, dur: 0.5 }); // the flame catching
    };
    api.ping = (pan) => {
      const f = rand(1200, 1500);
      tone({ f, f2: f * 1.25, type: 'sine', vol: 0.07, dur: 0.22, pan });
    };
    api.spawnBell = () => {
      tone({ f: 196, type: 'sine', vol: 0.14, dur: 2.6 });
      tone({ f: 293.7, type: 'sine', vol: 0.07, dur: 2.2, at: 0.02 });
    };
    api.creak = (pan, vol = 0.32) => {
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
      env(g, t, 0.05, vol, 0.95);
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
      g.connect(out(pan));
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 1);
      lfo.stop(t + 1);
    };
    api.door = (pan) => {
      api.creak(pan);
      noise({ f: 160, q: 1, vol: 0.35, dur: 0.35, at: 0.9, ft: 'lowpass', pan });
    };
    api.footstep = (pan) => {
      noise({ f: rand(140, 220), q: 0.8, vol: 0.09, dur: 0.12, ft: 'lowpass', pan });
      tone({ f: rand(60, 75), f2: 40, type: 'sine', vol: 0.06, dur: 0.1, pan });
    };
    api.knock = (pan) => [0, 0.32, 0.6].forEach((at) => noise({ f: 220, q: 1.2, vol: 0.16, dur: 0.12, ft: 'lowpass', at, pan }));
    api.flare = (pan) => noise({ f: 500, f2: 2200, q: 0.7, vol: 0.07, dur: 0.6, pan });
    api.whisper = (pan) => {
      if (!ensure() || muted) return;
      for (let i = 0; i < 3; i++) noise({ f: rand(1800, 4200), q: rand(3, 8), vol: rand(0.03, 0.07), dur: rand(0.25, 0.6), at: i * rand(0.12, 0.3), pan });
    };
    // continuous breathing that swells as a ghost closes in
    api.setBreath = (level, pan) => {
      if (!ensure() || muted) {
        if (breath) breath.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
        return;
      }
      if (!breath) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 700;
        bp.Q.value = 0.7;
        const lfoG = ctx.createGain();
        lfoG.gain.value = 0;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.32;
        const depth = ctx.createGain();
        depth.gain.value = 0.5;
        lfo.connect(depth);
        depth.connect(lfoG.gain);
        const g = ctx.createGain();
        g.gain.value = 0;
        const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        src.connect(bp);
        bp.connect(lfoG);
        lfoG.connect(g);
        if (p) {
          g.connect(p);
          p.connect(master);
        } else g.connect(master);
        src.start();
        lfo.start();
        breath = { g, p };
      }
      breath.g.gain.setTargetAtTime(clamp(level, 0, 1) * 0.22, ctx.currentTime, 0.3);
      if (breath.p) breath.p.pan.setTargetAtTime(clamp(pan || 0, -1, 1), ctx.currentTime, 0.2);
    };
    api.scream = () => {
      if (!ensure() || muted) return;
      if (api.mild) return api.moan();
      const t = ctx.currentTime;
      const sh = distortion(60);
      const g = ctx.createGain();
      env(g, t, 0.03, 0.3, 1.4);
      sh.connect(g);
      g.connect(master);
      [0, 7, -9].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det * 10;
        o.frequency.setValueAtTime(520, t);
        o.frequency.exponentialRampToValueAtTime(1300, t + 0.25);
        o.frequency.exponentialRampToValueAtTime(380, t + 1.4);
        o.connect(sh);
        o.start(t);
        o.stop(t + 1.45);
      });
      noise({ f: 3000, q: 0.6, vol: 0.18, dur: 1.1, ft: 'highpass' });
    };
    api.groan = (pan, vol = 0.16) => {
      if (!ensure() || muted) return;
      const t = ctx.currentTime;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(420, t);
      bp.frequency.linearRampToValueAtTime(300, t + 1.4);
      bp.Q.value = 3;
      const g = ctx.createGain();
      env(g, t, 0.15, vol, 1.6);
      bp.connect(g);
      g.connect(out(pan));
      [0, 9].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(82 + det, t);
        o.frequency.linearRampToValueAtTime(64 + det, t + 1.5);
        const l = ctx.createOscillator();
        const lg = ctx.createGain();
        l.frequency.value = 6;
        lg.gain.value = 5;
        l.connect(lg);
        lg.connect(o.frequency);
        o.connect(bp);
        o.start(t);
        l.start(t);
        o.stop(t + 1.65);
        l.stop(t + 1.65);
      });
      noise({ f: 600, q: 2, vol: vol * 0.4, dur: 1.2, pan });
    };
    api.shuffle = (pan, vol = 0.07) => noise({ f: 320, f2: 180, q: 0.8, vol, dur: 0.35, ft: 'lowpass', pan });
    api.moan = () => {
      tone({ f: 220, f2: 98, type: 'triangle', vol: 0.16, dur: 1.4, vib: [4, 6], lp: 900 });
      tone({ f: 165, f2: 82, type: 'sine', vol: 0.1, dur: 1.5 });
    };
    api.sting = () => {
      [110, 116.5].forEach((f) => tone({ f, type: 'sawtooth', vol: 0.09, dur: 1.8, lp: 900, a: 0.03 }));
      noise({ f: 120, q: 0.8, vol: 0.22, dur: 0.9, ft: 'lowpass' });
    };
    api.tick = () => tone({ f: 1500, type: 'sine', vol: 0.04, dur: 0.05 });
    api.blip = () => tone({ f: 520, f2: 640, type: 'sine', vol: 0.08, dur: 0.15 });
    api.drumroll = (dur = 3) => {
      if (!ensure() || muted) return;
      const n = Math.floor(dur / 0.045);
      for (let i = 0; i < n; i++) {
        const k = i / n;
        noise({ f: 1500 + k * 700, q: 0.9, vol: 0.04 + k * k * 0.26, dur: 0.05, at: i * 0.045 + rand(-0.004, 0.004) });
        if (i % 2 === 0) tone({ f: 90 + k * 35, type: 'sine', vol: 0.04 + k * 0.16, dur: 0.07, at: i * 0.045 });
      }
    };
    api.boom = () => {
      tone({ f: 150, f2: 26, glide: 1.1, type: 'sine', vol: 0.95, dur: 1.6, a: 0.003 });
      noise({ f: 1200, f2: 90, q: 0.6, vol: 0.7, dur: 1.4, ft: 'lowpass' });
      noise({ f: 5000, q: 0.7, vol: 0.3, dur: 0.2, ft: 'highpass' });
    };
    api.fanfare = () => {
      // a warm swell of bells rather than brass: the house exhaling
      [261.6, 329.6, 392, 523.25].forEach((f, i) => {
        tone({ f, type: 'triangle', vol: 0.11, dur: 3.2, at: i * 0.16, lp: 2200, a: 0.08 });
        tone({ f: f * 2, type: 'sine', vol: 0.04, dur: 2.6, at: i * 0.16 + 0.05 });
      });
      tone({ f: 130.8, type: 'sine', vol: 0.18, dur: 3.6, at: 0.1, a: 0.3 });
    };
    api.zombie = () => {
      if (!ensure() || muted) return;
      const t = ctx.currentTime;
      const sh = distortion(api.mild ? 10 : 70);
      const g = ctx.createGain();
      env(g, t, 0.05, api.mild ? 0.14 : 0.26, 1.8);
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
    };
    api.setDrone = (roomIdx) => {
      if (!ensure()) return;
      if (drone && drone.room === roomIdx) return;
      api.stopDrone();
      if (roomIdx == null || roomIdx < 0) return;
      const t = ctx.currentTime;
      const base = S.ROOMS[roomIdx].drone;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 2.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 280;
      lp.Q.value = 3;
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 0.07 + roomIdx * 0.025;
      lfoG.gain.value = 140;
      lfo.connect(lfoG);
      lfoG.connect(lp.frequency);
      lp.connect(g);
      g.connect(master);
      const nodes = [lfo];
      const ratios = [
        [1, 1.006, 2],
        [1, 1.5, 4.01],
        [0.5, 1, 1.003],
        [1, 1.01, 1.498],
        [1, 1.5, 2, 3],
      ][roomIdx];
      ratios.forEach((r, i) => {
        const o = ctx.createOscillator();
        o.type = roomIdx === 4 && i ? 'triangle' : 'sawtooth';
        o.frequency.value = base * r;
        const og = ctx.createGain();
        og.gain.value = i === 0 ? 0.6 : 0.3;
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
  // The smash and the result, shared by the host and the players.
  // Timeline (seconds into SMASH): 0 one line types in · 1–4 drumroll while the hammer
  // rises · 3.6 wind-up · 4.0 slam · 4.08 impact: bone flash, 120 ms hit-stop, flame shards
  // · then silence and one line of type.
  // =====================================================================
  const HIT = 4.08;
  class Stage {
    constructor(particles, shaker) {
      this.p = particles;
      this.sh = shaker;
      this.mode = null;
      this.flags = {};
      this.mild = false;
      this.scale = 1;
      this.cy = 0.56;
      this.hold = 0; // hit-stop accumulator (ms)
      this.objects = true; // false: the result draws light only (the page carries the words)
    }
    clear() {
      this.mode = null;
      this.flags = {};
    }
    smash(info, elapsedMs) {
      if (this.mode === 'smash') return;
      this.mode = 'smash';
      this.info = info;
      this.clock = (elapsedMs || 0) / 1000;
      this.flags = {};
    }
    result(res) {
      if (this.mode === 'result') return;
      this.mode = 'result';
      this.res = res;
      this.clock = 0;
      this.flags = {};
    }
    once(key, fn) {
      if (!this.flags[key]) {
        this.flags[key] = true;
        fn();
      }
    }
    // returns {flash} so pages can react (e.g. hide text during the flash)
    render(ctx, W, H, dt) {
      if (!this.mode) return {};
      // hit-stop freezes the clock for 120 ms after impact
      if (this.hold > 0) this.hold -= dt * 1000;
      else this.clock += dt;
      const t = this.clock;
      const cx = W / 2;
      const cy = H * this.cy;
      const size = Math.min(W, H) * 0.36 * this.scale;
      const now = performance.now() / 1000;
      const gentle = this.mild || reducedMotion;
      let flash = 0;
      if (this.mode === 'smash') {
        if (t >= 1.0 && t < 3.6) this.once('roll', () => Sound.drumroll(Math.max(0.4, HIT - t)));
        const px = cx + size * 0.95;
        const py = cy + size * 0.58;
        if (t < HIT) {
          // anticipation: rise slowly, pull back, then slam
          let ang;
          if (t < 1) ang = lerp(0.15, 0.25, ease.out(t));
          else if (t < 3.6) ang = lerp(0.25, 0.75, ease.inOut((t - 1) / 2.6));
          else if (t < 4.0) ang = lerp(0.75, 1.05, ease.out((t - 3.6) / 0.4));
          else ang = lerp(1.05, -1.0, ease.inBack(Math.min(1, (t - 4.0) / 0.08), 0.6));
          const k = clamp((t - 1) / 3, 0, 1);
          const tremble = gentle ? 0 : k * k * size * 0.012;
          drawPumpkin(ctx, cx + rand(-tremble, tremble), cy, size, this.info.target, { lit: 0.55 + 0.45 * k, t: now });
          drawHammer(ctx, px, py, size * 1.25, ang);
        } else {
          this.once('hit', () => {
            Sound.boom();
            this.hold = 120;
            this.flashAt = t;
            this.sh.add(gentle ? 6 : 34);
            if (!gentle || true) {
              const n = gentle ? 40 : 160;
              this.p.emit(cx, cy, { count: n, color: [T.flame, T.ember, '#ffa65a'], speed: size * 5, life: 1.8, size: size * 0.05, gravity: size * 2.6, shape: 'shard', drag: 0.965 });
              this.p.emit(cx, cy, { count: gentle ? 20 : 80, color: [T.ember, T.flame], speed: size * 2.2, life: 2.6, size: 4, gravity: -size * 0.15, shape: 'ember', drag: 0.97 });
            }
          });
          // the 1-frame bone flash (skipped in Mild / reduced motion)
          if (!gentle && t - this.flashAt < 0.02 && this.hold > 80) flash = 1;
          drawHammer(ctx, px, py, size * 1.25, -1.0);
          // what is left of the pumpkin: a dying glow on the floor
          const fade = clamp(1 - (t - HIT) / 2.5, 0, 1);
          if (fade > 0) {
            const g = ctx.createRadialGradient(cx, cy + size * 0.4, 0, cx, cy + size * 0.4, size * 1.2);
            g.addColorStop(0, hexA(T.flame, 0.35 * fade));
            g.addColorStop(1, hexA(T.flame, 0));
            ctx.fillStyle = g;
            ctx.fillRect(cx - size * 1.2, cy - size * 0.8, size * 2.4, size * 2.4);
          }
        }
      } else if (this.mode === 'result') {
        const r = this.res;
        if (r.win) {
          this.once('fan', () => Sound.fanfare());
          const k = ease.outBack(clamp(t / 1.2, 0, 1), 1.2);
          // the house lights up: the prize pumpkin burns, embers rise
          if (this.objects) drawPumpkin(ctx, cx, cy, size * (0.6 + 0.4 * k), r.smashed, { lit: 1, t: now });
          if (t < 8 && Math.random() < (gentle ? 0.15 : 0.6)) {
            this.p.emit(cx + rand(-size, size), cy + size * 0.3, { count: 1, color: [T.ember, T.flame], speed: 70, angle: -Math.PI / 2, spread: 0.7, life: 3.5, size: rand(2, 5), drag: 0.995 });
          }
        } else {
          this.once('z', () => {
            Sound.zombie();
            this.sh.add(gentle ? 2 : 12);
          });
          const reveal = t > 3;
          const zx = reveal ? lerp(cx, W * 0.32, ease.inOut(clamp((t - 3) / 0.8, 0, 1))) : cx;
          if (this.objects) drawPumpkin(ctx, zx, cy, size * 0.85, r.smashed, { lit: 0.8, zombie: true, t: now });
          if (reveal && this.objects) {
            const k = ease.outBack(clamp((t - 3.3) / 0.9, 0, 1), 1.4);
            this.once('rev', () => Sound.chime());
            if (k > 0) drawPumpkin(ctx, W * 0.68, cy, size * 0.85 * k, r.winning, { lit: 1, t: now });
          }
        }
      }
      return { flash };
    }
  }

  function fmtTime(ms) {
    if (ms == null) return '—';
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
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
    } else (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
  }

  window.PS = Object.assign(window.PS || {}, {
    S,
    T,
    TAU,
    rand,
    pick,
    clamp,
    lerp,
    ease,
    hexA,
    flicker,
    reducedMotion,
    store,
    SIL,
    silSVG,
    silEl,
    drawSil,
    whoEl,
    nameOf,
    NameOf,
    costumeById,
    drawPumpkin,
    drawHammer,
    drawSoul,
    drawGhost,
    drawLantern,
    drawZombie,
    Particles,
    Shaker,
    Sound,
    Stage,
    fmtTime,
    fitCanvas,
    toggleFullscreen,
  });
})();
