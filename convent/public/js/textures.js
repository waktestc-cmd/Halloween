// Surfaces for the manor: two photo textures from the three.js examples (hardwood floor, brick)
// and the rest painted on canvases here, so the house needs no other image files.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function tex(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function file(url, { repeat = [1, 1], srgb = true } = {}) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// deterministic noise so every player sees the same stains
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function speckle(g, w, h, n, colors, size = [1, 3], alpha = 0.08) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.4 + rnd());
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const s = size[0] + rnd() * (size[1] - size[0]);
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
  g.globalAlpha = 1;
}
function stains(g, w, h, n, color) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 20 + rnd() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// an inside wall, one tile wide: old plaster above dark wooden panelling and a rail
function wallCanvas(plaster = '#8d826d') {
  return canvas(512, 870, (g, w, h) => {
    g.fillStyle = plaster;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, ['#5a5043', '#a79d86', '#6e6455'], [1, 4], 0.12);
    stains(g, w, h * 0.6, 7, 'rgba(60,48,30,0.28)');
    // damp running down from the ceiling
    for (let i = 0; i < 4; i++) {
      const x = rnd() * w;
      const grd = g.createLinearGradient(0, 0, 0, h * (0.3 + rnd() * 0.3));
      grd.addColorStop(0, 'rgba(45,38,25,0.45)');
      grd.addColorStop(1, 'rgba(45,38,25,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 10 + rnd() * 40, h * 0.6);
    }
    // cracks
    g.strokeStyle = 'rgba(40,32,22,0.55)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      let x = rnd() * w;
      let y = rnd() * h * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) g.lineTo((x += (rnd() - 0.5) * 30), (y += rnd() * 25));
      g.stroke();
    }
    // panelling up to 1.1 m of 3.4 m
    const py = h * (1 - 1.1 / 3.4);
    g.fillStyle = '#3a2618';
    g.fillRect(0, py, w, h - py);
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = `rgba(${20 + rnd() * 30},${12 + rnd() * 15},${6 + rnd() * 8},0.25)`;
      g.fillRect(x, py, 2, h - py);
    }
    g.strokeStyle = '#1e130b';
    g.lineWidth = 6;
    for (const x0 of [16, w / 2 + 8]) g.strokeRect(x0, py + 28, w / 2 - 40, h - py - 60);
    g.fillStyle = '#4a3220';
    g.fillRect(0, py - 10, w, 18);
    g.fillStyle = '#21150c';
    g.fillRect(0, py + 8, w, 4);
    g.fillRect(0, h - 22, w, 22);
  });
}

function stoneCanvas() {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#4a4741';
    g.fillRect(0, 0, w, h);
    const s = w / 4;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = 60 + rnd() * 30;
        g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
        g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
      }
    speckle(g, w, h, 6000, ['#2c2a26', '#77736a'], [1, 3], 0.18);
    stains(g, w, h, 6, 'rgba(25,22,18,0.35)');
  });
}
function tileCanvas() {
  return canvas(512, 512, (g, w, h) => {
    const s = w / 8;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 2 ? '#2a2724' : '#8a8273';
        g.fillRect(x * s, y * s, s, s);
      }
    g.strokeStyle = 'rgba(20,18,15,0.6)';
    g.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, h);
      g.moveTo(0, i * s);
      g.lineTo(w, i * s);
      g.stroke();
    }
    stains(g, w, h, 8, 'rgba(30,25,15,0.4)');
    speckle(g, w, h, 3000, ['#111', '#bbb'], [1, 2], 0.08);
  });
}
function groundCanvas() {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#1d2117';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 14000, ['#2c3322', '#14170f', '#3a3a2a', '#2a2418'], [1, 4], 0.35);
    stains(g, w, h, 10, 'rgba(10,10,6,0.5)');
  });
}
function ceilingCanvas() {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#4e463b';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 3000, ['#2e281f', '#6a6152'], [1, 3], 0.15);
    stains(g, w, h, 5, 'rgba(30,24,15,0.4)');
    g.fillStyle = '#24170d';
    g.fillRect(0, h / 2 - 14, w, 28);
  });
}
function woodCanvas(base = '#3b2616') {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      g.fillStyle = `rgba(${10 + rnd() * 25},${6 + rnd() * 12},${2 + rnd() * 6},${0.15 + rnd() * 0.2})`;
      g.fillRect(0, y, w, 1 + rnd() * 2);
    }
    speckle(g, w, h, 600, ['#120a05', '#5a3c25'], [1, 3], 0.2);
  });
}
function clothCanvas(color) {
  return canvas(128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2500, ['#000', '#fff'], [1, 2], 0.05);
    stains(g, w, h, 3, 'rgba(60,50,30,0.25)');
  });
}
// an old torn cobweb on a transparent sheet: the hub low in the middle, spokes out to every edge,
// sagging spiral threads between them, dust caught near the hub
function cobwebCanvas() {
  seed = 31031;
  return canvas(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const spokes = [];
    for (let a = 0; a < Math.PI * 2; a += 0.26 + rnd() * 0.22) spokes.push(a);
    g.strokeStyle = 'rgba(235,235,230,0.85)';
    g.lineWidth = 1.6;
    for (const a of spokes) {
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * h);
      g.stroke();
    }
    // the spiral, sagging between spokes, torn here and there
    g.lineWidth = 1.1;
    for (let r = 14; r < w * 0.75; r *= 1.16 + rnd() * 0.05) {
      for (let i = 0; i < spokes.length; i++) {
        if (rnd() < 0.12) continue;
        const a0 = spokes[i];
        const a1 = spokes[(i + 1) % spokes.length] + (i === spokes.length - 1 ? Math.PI * 2 : 0);
        const x0 = cx + Math.cos(a0) * r;
        const y0 = cy + Math.sin(a0) * r;
        const x1 = cx + Math.cos(a1) * r;
        const y1 = cy + Math.sin(a1) * r;
        const am = (a0 + a1) / 2;
        const sag = r * 0.82;
        g.strokeStyle = `rgba(230,230,225,${0.45 + rnd() * 0.35})`;
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(cx + Math.cos(am) * sag, cy + Math.sin(am) * sag + r * 0.04, x1, y1);
        g.stroke();
      }
    }
    // loose strands hanging down, and dust round the hub
    for (let i = 0; i < 7; i++) {
      const x = rnd() * w;
      const y = rnd() * h * 0.6;
      g.strokeStyle = 'rgba(220,220,215,0.5)';
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 30, y + 60, x + (rnd() - 0.5) * 20, y + 90 + rnd() * 80);
      g.stroke();
    }
    const dust = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.3);
    dust.addColorStop(0, 'rgba(200,195,185,0.35)');
    dust.addColorStop(1, 'rgba(200,195,185,0)');
    g.fillStyle = dust;
    g.fillRect(0, 0, w, h);
  });
}

// the night sky over the graveyard: a dark violet dome with stars, the full moon and its halo
let skySheets;
export function skyTextures() {
  if (skySheets) return skySheets;
  seed = 3110;
  const sky = canvas(2048, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#020206');
    grd.addColorStop(0.55, '#080612');
    grd.addColorStop(0.85, '#120e22');
    grd.addColorStop(1, '#181228');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // stars: the sheet is stretched round the dome, so each is a few pixels wide and one high
    for (let i = 0; i < 220; i++) {
      const y = rnd() * h * 0.75;
      const b = 0.25 + rnd() * 0.6;
      g.fillStyle = `rgba(220,215,255,${b})`;
      g.fillRect(rnd() * w, y, 2, 1);
    }
    // thin clouds drifting low
    for (let i = 0; i < 22; i++) {
      const x = rnd() * w;
      const y = h * (0.6 + rnd() * 0.32);
      const c = g.createRadialGradient(x, y, 0, x, y, 120);
      c.addColorStop(0, 'rgba(60,50,90,0.3)');
      c.addColorStop(1, 'rgba(60,50,90,0)');
      g.save();
      g.translate(x, y);
      g.scale(2.5, 0.3);
      g.translate(-x, -y);
      g.fillStyle = c;
      g.fillRect(x - 120, y - 120, 240, 240);
      g.restore();
    }
  });
  const moon = canvas(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = w * 0.46;
    const disc = g.createRadialGradient(w * 0.46, h * 0.44, r * 0.1, w / 2, h / 2, r);
    disc.addColorStop(0, '#fffdf2');
    disc.addColorStop(0.85, '#e6e2d6');
    disc.addColorStop(1, '#c8c2c8');
    g.fillStyle = disc;
    g.beginPath();
    g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.clip();
    // the dark seas and a few craters
    for (const [x, y, rr, a] of [[0.38, 0.36, 0.16, 0.28], [0.58, 0.32, 0.12, 0.22], [0.62, 0.55, 0.15, 0.25], [0.42, 0.6, 0.1, 0.2], [0.3, 0.52, 0.08, 0.18]]) {
      const m = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, rr * w);
      m.addColorStop(0, `rgba(120,118,130,${a})`);
      m.addColorStop(1, 'rgba(120,118,130,0)');
      g.fillStyle = m;
      g.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = 'rgba(130,125,135,0.25)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(w * (0.2 + rnd() * 0.6), h * (0.2 + rnd() * 0.6), 2 + rnd() * 7, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  });
  const halo = canvas(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.12, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(200,190,255,0.6)');
    grd.addColorStop(0.35, 'rgba(140,120,220,0.18)');
    grd.addColorStop(1, 'rgba(100,80,180,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  const t = (c) => {
    const x = new THREE.CanvasTexture(c);
    x.colorSpace = THREE.SRGBColorSpace;
    return x;
  };
  skySheets = { sky: t(sky), moon: t(moon), halo: t(halo) };
  return skySheets;
}

// gloomy portraits in gilt frames: dark figures with pale faces, nothing recognisable
export function portraitCanvas(i, haunted = false) {
  seed = 99 + i * 31;
  return canvas(256, 192, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, ['#2b2418', '#1d2422', '#2a1d1a'][i % 3]);
    bg.addColorStop(1, '#0b0906');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (i % 2 === 0) {
      // a figure in a veil
      g.fillStyle = '#0a0806';
      g.beginPath();
      g.ellipse(w / 2, h * 0.95, w * 0.3, h * 0.55, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = '#d7cdb8';
      g.beginPath();
      g.ellipse(w / 2, h * 0.42, w * 0.12, h * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#9b927f';
      g.beginPath();
      g.ellipse(w / 2, h * 0.47, w * 0.08, h * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1b130b';
      g.fillRect(w / 2 - 14, h * 0.43, 9, 5);
      g.fillRect(w / 2 + 5, h * 0.43, 9, 5);
      if (haunted) {
        // in the lightning the face is not quite a face: hollow eyes that glint, a gaping mouth
        g.fillStyle = '#7d7464';
        g.beginPath();
        g.ellipse(w / 2, h * 0.45, w * 0.1, h * 0.16, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#050302';
        for (const sx of [-1, 1]) {
          g.beginPath();
          g.ellipse(w / 2 + sx * 11, h * 0.42, 8, 10, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.beginPath();
        g.ellipse(w / 2, h * 0.58, 7, 13, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffe6b0';
        g.fillRect(w / 2 - 12, h * 0.42 - 1, 3, 3);
        g.fillRect(w / 2 + 10, h * 0.42 - 1, 3, 3);
      }
    } else {
      // a landscape with a lone house
      g.fillStyle = '#131813';
      g.beginPath();
      g.moveTo(0, h * 0.7);
      g.quadraticCurveTo(w * 0.4, h * 0.5, w, h * 0.68);
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.fill();
      g.fillStyle = '#0a0a08';
      g.fillRect(w * 0.6, h * 0.45, 40, 40);
      g.beginPath();
      g.moveTo(w * 0.6 - 6, h * 0.45);
      g.lineTo(w * 0.6 + 20, h * 0.3);
      g.lineTo(w * 0.6 + 46, h * 0.45);
      g.fill();
      g.fillStyle = '#c9a24a';
      g.fillRect(w * 0.6 + 16, h * 0.5, 7, 9);
      if (haunted) {
        // someone stands in the field, looking out of the picture
        g.fillStyle = '#d8d0bc';
        g.fillRect(w * 0.28, h * 0.5, 9, 30);
        g.beginPath();
        g.arc(w * 0.28 + 4.5, h * 0.5 - 3, 6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#d04020';
        g.fillRect(w * 0.6 + 16, h * 0.5, 7, 9);
      }
    }
    speckle(g, w, h, 2500, ['#000', '#7a6a50'], [1, 2], 0.15);
    g.strokeStyle = '#8a6a2a';
    g.lineWidth = 14;
    g.strokeRect(0, 0, w, h);
    g.strokeStyle = '#3a2a10';
    g.lineWidth = 3;
    g.strokeRect(12, 12, w - 24, h - 24);
  });
}

export function makeMaterials(maxAniso) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const m = {
    wall: std({ map: tex(wallCanvas()), roughness: 0.95 }),
    wallCold: std({ map: tex(wallCanvas('#7a7c74')), roughness: 0.95 }),
    brick: std({ map: file('/assets/textures/brick_diffuse.jpg', { repeat: [1, 1.7] }), bumpMap: file('/assets/textures/brick_bump.jpg', { repeat: [1, 1.7], srgb: false }), bumpScale: 2, roughness: 1, color: 0x8a7a6a }),
    wood: std({ map: file('/assets/textures/hardwood2_diffuse.jpg', { repeat: [1, 1] }), bumpMap: file('/assets/textures/hardwood2_bump.jpg', { srgb: false }), bumpScale: 0.6, roughness: 0.75, color: 0x9a8270 }),
    stone: std({ map: tex(stoneCanvas()), roughness: 0.9 }),
    tiles: std({ map: tex(tileCanvas()), roughness: 0.55 }),
    ground: std({ map: tex(groundCanvas(), { repeat: [1, 1] }), roughness: 1 }),
    ceiling: std({ map: tex(ceilingCanvas()), roughness: 1 }),
    darkWood: std({ map: tex(woodCanvas('#2c1b0f')), roughness: 0.7 }),
    oldWood: std({ map: tex(woodCanvas('#4a3522')), roughness: 0.8 }),
    door: std({ map: tex(woodCanvas('#3a2312')), roughness: 0.65 }),
    linen: std({ map: tex(clothCanvas('#a59c88')), roughness: 1 }),
    blanket: std({ map: tex(clothCanvas('#3d2a2a')), roughness: 1 }),
    curtain: std({ map: tex(clothCanvas('#5a5040')), roughness: 1, side: THREE.DoubleSide }),
    altarCloth: std({ map: tex(clothCanvas('#8a8270')), roughness: 1 }),
    iron: std({ color: 0x2a2826, metalness: 0.7, roughness: 0.5 }),
    rust: std({ color: 0x4a2a18, metalness: 0.4, roughness: 0.8 }),
    brass: std({ color: 0xa8843a, metalness: 0.9, roughness: 0.35 }),
    porcelain: std({ color: 0xb8b2a4, roughness: 0.3 }),
    chalk: std({ color: 0x1b2420, roughness: 0.9 }),
    stoneProp: std({ map: tex(stoneCanvas()), roughness: 0.95, color: 0x8a8a84 }),
    bark: std({ map: tex(woodCanvas('#1e1812')), roughness: 1 }),
    book: [0x4a1c14, 0x1c2a3a, 0x2a3a1c, 0x3a2a14, 0x2a1830].map((c) => std({ color: c, roughness: 0.8 })),
    wax: std({ color: 0xe8dcc0, roughness: 0.6 }),
    leather: std({ color: 0x3a2416, roughness: 0.8 }),
    copper: std({ color: 0xb06a3a, metalness: 0.6, roughness: 0.4 }),
    pumpkin: std({ color: 0xb05a18, roughness: 0.7, emissive: 0x401800, emissiveIntensity: 0.5 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffb04a }),
    cobweb: std({ map: tex(cobwebCanvas()), color: 0xc8c4bc, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    spider: std({ color: 0x0d0b0c, roughness: 0.45 }),
  };
  for (const v of Object.values(m)) for (const k of ['map', 'bumpMap']) if (v[k]) v[k].anisotropy = Math.min(8, maxAniso);
  return m;
}
// each painting has a second, wrong version that shows only while lightning flashes
export const paintings = [0, 1, 2, 3, 4, 5].map((i) => {
  const calm = tex(portraitCanvas(i));
  const m = new THREE.MeshStandardMaterial({ map: calm, roughness: 0.6 });
  m.userData = { calm, haunted: tex(portraitCanvas(i, true)) };
  return m;
});

/* ---------- the monsters' skin and clothes ----------
   Each monster wears two painted sheets: one for its skin (head, hands, ears, eyes, teeth) and one
   for its clothes. A part of the body says which patch of the sheet it shows: [u0, v0, u1, v1], with
   v going up as three.js reads it. The heads are spheres pushed into shape in actors.js, so a face
   is painted where each direction from the centre of the head lands on the sheet (onHead below). */
export const COUNT_UV = {
  head: [0, 0.5, 1, 1], skin: [0, 0.25, 0.5, 0.5], ear: [0.5, 0.25, 0.75, 0.5], eye: [0.75, 0.375, 1, 0.5], nail: [0.75, 0.25, 0.875, 0.375], tooth: [0.875, 0.25, 1, 0.375],
  coat: [0, 0.25, 1, 1], sleeve: [0, 0, 0.5, 0.25], collar: [0.5, 0.125, 1, 0.25], button: [0.5, 0, 0.75, 0.125], shoe: [0.75, 0, 1, 0.125],
};
export const BRUTE_UV = {
  head: [0, 0.5, 1, 1], hand: [0, 0.25, 0.5, 0.5], neck: [0.5, 0.25, 0.75, 0.5], arm: [0.75, 0.25, 1, 0.5], eye: [0, 0, 0.125, 0.125], eye2: [0.125, 0, 0.25, 0.125], ear: [0.25, 0, 0.5, 0.25],
  coat: [0, 0.375, 1, 1], sleeve: [0, 0.25, 0.5, 0.375], trousers: [0.5, 0.25, 1, 0.375], boot: [0, 0.125, 0.5, 0.25], hair: [0.5, 0.125, 1, 0.25], button: [0, 0, 0.25, 0.125], lapel: [0.25, 0, 0.5, 0.125],
};
function inRegion(g, W, H, [u0, v0, u1, v1], draw) {
  const x = u0 * W;
  const y = (1 - v1) * H;
  const w = (u1 - u0) * W;
  const h = (v1 - v0) * H;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.translate(x, y);
  draw(g, w, h);
  g.restore();
}
// where the direction (x, y, z) from the centre of a sphere lands on its sheet (three.js sphere uv)
function onHead(w, h, x, y, z) {
  const l = Math.hypot(x, y, z);
  let phi = Math.atan2(z / l, -x / l);
  if (phi < 0) phi += Math.PI * 2;
  return [(phi / (Math.PI * 2)) * w, (Math.acos(y / l) / Math.PI) * h];
}
function blot(g, x, y, r, color, sx = 1, sy = 1) {
  g.save();
  g.translate(x, y);
  g.scale(sx, sy);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
  grd.addColorStop(0, color);
  grd.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = grd;
  g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();
}
// thin wandering lines: veins, wrinkles, cracks
function wander(g, x, y, len, step, dir, jitter, color, width) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  let a = dir;
  for (let i = 0; i < len; i++) {
    a += (rnd() - 0.5) * jitter;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    g.lineTo(x, y);
  }
  g.stroke();
}
// a seam closed with crude stitches across it
function stitches(g, x0, y0, x1, y1, gap = 12, size = 7, width = 2.5) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  g.strokeStyle = 'rgba(70,30,30,0.6)';
  g.lineWidth = width * 2.2;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = '#15100c';
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  for (let d = gap / 2; d < len; d += gap) {
    const x = x0 + ((x1 - x0) * d) / len + (rnd() - 0.5) * 2;
    const y = y0 + ((y1 - y0) * d) / len + (rnd() - 0.5) * 2;
    const s = size * (0.8 + rnd() * 0.4);
    g.beginPath();
    g.moveTo(x - nx * s + (rnd() - 0.5) * 3, y - ny * s);
    g.lineTo(x + nx * s, y + ny * s + (rnd() - 0.5) * 3);
    g.stroke();
  }
}
function cloth(g, w, h, base, { folds = 0, foldColor = 'rgba(0,0,0,0.35)', lite = 'rgba(255,255,255,0.05)', grain = 3000 } = {}) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // the weave
  for (let y = 0; y < h; y += 2) {
    g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.08})`;
    g.fillRect(0, y, w, 1);
  }
  speckle(g, w, h, grain, ['#000', '#8a8478'], [1, 2], 0.12);
  // long vertical folds: a dark crease with a lighter edge beside it
  for (let i = 0; i < folds; i++) {
    const x = rnd() * w;
    const fw = 6 + rnd() * 14;
    const grd = g.createLinearGradient(x - fw, 0, x + fw, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.45, foldColor);
    grd.addColorStop(0.6, lite);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    const top = rnd() * h * 0.4;
    g.fillRect(x - fw, top, fw * 2, h - top);
  }
}
function skinBase(g, w, h, base, mottle, spots = 900) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) blot(g, rnd() * w, rnd() * h, 10 + rnd() * 40, mottle[i % mottle.length]);
  speckle(g, w, h, spots, ['#2a2018', '#d8d0b8', '#5a4a40'], [1, 3], 0.1);
}

let countSheets;
// the Count: corpse-pale, bald, deep dark sockets with glowing eyes, heavy brows, a rat's front teeth
export function countTextures() {
  if (countSheets) return countSheets;
  seed = 1922;
  const U = COUNT_UV;
  const glow = canvas(512, 512, (g, W, H) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
  });
  const gg = glow.getContext('2d');
  const skin = canvas(1024, 1024, (g, W, H) => {
    inRegion(g, W, H, U.head, (g, w, h) => {
      const P = (x, y, z) => onHead(w, h, x, y, z);
      // pale parchment skin, lighter over the dome and the face, sallow in the hollows
      const v = g.createLinearGradient(0, 0, 0, h);
      v.addColorStop(0, '#a7a491');
      v.addColorStop(0.45, '#8e8b78');
      v.addColorStop(0.8, '#6d6a5a');
      v.addColorStop(1, '#4e4b40');
      g.fillStyle = v;
      g.fillRect(0, 0, w, h);
      const [fx, fy] = P(0, 0.05, 1);
      blot(g, fx, fy, 230, 'rgba(176,172,150,0.55)', 1, 1.2);
      // the back of the head is darker
      const [bx, by] = P(0, 0.1, -1);
      blot(g, bx, by, 260, 'rgba(40,38,32,0.45)', 1.3, 1);
      // age spots and mottling over the scalp
      for (let i = 0; i < 70; i++) blot(g, rnd() * w, rnd() * h * 0.45, 4 + rnd() * 14, `rgba(${90 + rnd() * 30},${78 + rnd() * 20},${55},${0.18 + rnd() * 0.25})`);
      speckle(g, w, h, 4000, ['#3a3226', '#c8c4ae', '#6a5a48'], [1, 3], 0.12);
      // veins at the temples and over the dome
      for (const sx of [-1, 1]) {
        const [tx, ty] = P(sx * 0.85, 0.3, 0.45);
        for (let i = 0; i < 5; i++) wander(g, tx + (rnd() - 0.5) * 30, ty + (rnd() - 0.5) * 30, 12, 7, -Math.PI / 2 + (rnd() - 0.5) * 1.5, 0.9, 'rgba(70,72,110,0.35)', 1.6);
      }
      for (let i = 0; i < 8; i++) wander(g, rnd() * w, h * 0.12 + rnd() * h * 0.2, 14, 8, rnd() * 6.28, 0.8, 'rgba(80,80,110,0.22)', 1.4);
      // hollow cheeks and temples
      for (const sx of [-1, 1]) {
        const [cx, cy] = P(sx * 0.62, -0.35, 0.68);
        blot(g, cx, cy, 55, 'rgba(45,38,40,0.55)', 0.8, 1.3);
        const [qx, qy] = P(sx * 0.85, 0.25, 0.45);
        blot(g, qx, qy, 45, 'rgba(50,44,40,0.4)');
      }
      // deep, bruised sockets around the eyes
      for (const sx of [-1, 1]) {
        const [ex, ey] = P(sx * 0.33, 0.05, 0.94);
        blot(g, ex, ey, 58, 'rgba(26,14,20,0.97)', 1.15, 0.9);
        blot(g, ex, ey + 26, 44, 'rgba(70,36,52,0.6)', 1.2, 0.6);
        g.fillStyle = '#080405';
        g.beginPath();
        g.ellipse(ex, ey, 24, 15, sx * 0.25, 0, Math.PI * 2);
        g.fill();
        // creases under the eyes
        g.strokeStyle = 'rgba(40,30,30,0.6)';
        g.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.arc(ex, ey + 6 + k * 7, 26 + k * 4, 0.35 * Math.PI, 0.65 * Math.PI);
          g.stroke();
        }
      }
      // heavy, dark, bushy brows that sweep up at the outside
      for (const sx of [-1, 1]) {
        const [ix, iy] = P(sx * 0.12, 0.2, 0.98);
        const [ox, oy] = P(sx * 0.58, 0.3, 0.76);
        for (let i = 0; i < 160; i++) {
          const t = rnd();
          const x = ix + (ox - ix) * t + (rnd() - 0.5) * 6;
          const y = iy + (oy - iy) * t - Math.sin(t * Math.PI) * 10 + (rnd() - 0.5) * (12 - t * 6);
          g.strokeStyle = `rgba(${15 + rnd() * 20},${12 + rnd() * 12},${10},${0.6 + rnd() * 0.4})`;
          g.lineWidth = 1.5 + rnd() * 1.5;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (ox - ix) * 0.06 + (rnd() - 0.5) * 3, y - 4 - rnd() * 4);
          g.stroke();
        }
      }
      // a furrowed brow and forehead lines
      const [mx, my] = P(0, 0.3, 0.95);
      g.strokeStyle = 'rgba(45,38,30,0.55)';
      g.lineWidth = 2;
      for (const dx of [-7, 7]) {
        g.beginPath();
        g.moveTo(mx + dx, my + 22);
        g.quadraticCurveTo(mx + dx * 1.6, my, mx + dx * 0.8, my - 18);
        g.stroke();
      }
      for (let k = 0; k < 4; k++) {
        const [lx, ly] = P(0, 0.48 + k * 0.08, 0.88);
        g.strokeStyle = `rgba(50,42,34,${0.35 - k * 0.05})`;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(lx - 80 + rnd() * 10, ly + 6);
        g.bezierCurveTo(lx - 30, ly - 4, lx + 30, ly + 4, lx + 80, ly - 4);
        g.stroke();
      }
      // a thin, dark, downturned mouth
      const [ux, uy] = P(0, -0.5, 0.86);
      blot(g, ux, uy + 6, 50, 'rgba(50,30,35,0.5)', 1.3, 0.5);
      g.strokeStyle = '#1a0c0e';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(ux - 42, uy + 12);
      g.quadraticCurveTo(ux, uy - 4, ux + 42, uy + 12);
      g.stroke();
      g.strokeStyle = 'rgba(80,40,50,0.6)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(ux - 28, uy + 12);
      g.quadraticCurveTo(ux, uy + 20, ux + 28, uy + 12);
      g.stroke();
      // creases from the nose down past the mouth, wrinkles on the chin
      for (const sx of [-1, 1]) {
        g.strokeStyle = 'rgba(40,32,28,0.5)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(ux + sx * 22, uy - 50);
        g.quadraticCurveTo(ux + sx * 52, uy - 10, ux + sx * 48, uy + 30);
        g.stroke();
      }
      const [cx, cy] = P(0, -0.85, 0.52);
      for (let k = 0; k < 3; k++) {
        g.strokeStyle = 'rgba(45,38,30,0.35)';
        g.beginPath();
        g.arc(cx, cy - 10 + k * 8, 20 + k * 5, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
      }
      // a shadow down the side of the nose
      const [nx, ny] = P(0, -0.15, 1);
      blot(g, nx, ny, 40, 'rgba(50,40,36,0.35)', 0.6, 1.4);
    });
    // a faint pallor of the face that shows in the dark
    inRegion(gg, 512, 512, U.head, (g, w, h) => {
      const [fx, fy] = onHead(w, h, 0, 0, 1);
      blot(g, fx, fy, 75, 'rgba(40,42,36,1)', 1, 1.3);
      // the sockets smoulder around the eyes, so they show from across a dark room
      for (const sx of [-1, 1]) {
        const [ex, ey] = onHead(w, h, sx * 0.33, 0.05, 0.94);
        blot(g, ex, ey, 22, 'rgba(150,60,8,1)', 1.2, 0.8);
      }
    });
    // hands, neck and nose: the same pale skin, with veins and knuckle creases
    inRegion(g, W, H, U.skin, (g, w, h) => {
      skinBase(g, w, h, '#8a8775', ['rgba(110,100,80,0.25)', 'rgba(70,70,60,0.25)', 'rgba(120,110,95,0.2)']);
      for (let i = 0; i < 16; i++) wander(g, rnd() * w, rnd() * h, 16, 9, Math.PI / 2 + (rnd() - 0.5) * 0.6, 0.5, 'rgba(60,64,100,0.35)', 1.6);
      // creases at the knuckles: the fingers run up the sheet, joints at about a third and two thirds
      for (const kv of [0.02, 0.36, 0.69]) {
        const y = (1 - kv) * h;
        for (let i = 0; i < 6; i++) {
          g.strokeStyle = `rgba(45,36,30,${0.4 + rnd() * 0.2})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(0, y + (rnd() - 0.5) * 10);
          g.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 14, w * 0.6, y + (rnd() - 0.5) * 14, w, y + (rnd() - 0.5) * 10);
          g.stroke();
        }
        blot(g, w * 0.5, y, 30, 'rgba(60,45,40,0.25)', 8, 0.6);
      }
    });
    inRegion(g, W, H, U.ear, (g, w, h) => {
      skinBase(g, w, h, '#8d8676', ['rgba(120,90,85,0.3)', 'rgba(80,70,60,0.3)'], 400);
      // the inside of the ear, darker and veined
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(40,25,28,0)');
      grd.addColorStop(0.5, 'rgba(60,35,40,0.65)');
      grd.addColorStop(1, 'rgba(40,25,28,0)');
      g.fillStyle = grd;
      g.fillRect(w * 0.1, 0, w * 0.8, h);
      for (let i = 0; i < 10; i++) wander(g, w * (0.3 + rnd() * 0.4), h, 20, 9, -Math.PI / 2 + (rnd() - 0.5) * 0.4, 0.5, 'rgba(90,50,60,0.45)', 1.5);
    });
    inRegion(g, W, H, U.eye, (g, w, h) => {
      const grd = g.createRadialGradient(w * 0.25, h * 0.5, 2, w * 0.25, h * 0.5, w * 0.25);
      grd.addColorStop(0, '#120804');
      grd.addColorStop(0.12, '#ffcf70');
      grd.addColorStop(0.4, '#d08a20');
      grd.addColorStop(0.75, '#5a3a10');
      grd.addColorStop(1, '#241408');
      g.fillStyle = '#241408';
      g.fillRect(0, 0, w, h);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    inRegion(gg, 512, 512, U.eye, (g, w, h) => {
      const grd = g.createRadialGradient(w * 0.25, h * 0.5, 2, w * 0.25, h * 0.5, w * 0.24);
      grd.addColorStop(0, '#401400');
      grd.addColorStop(0.09, '#fff0b0');
      grd.addColorStop(0.5, '#f0a030');
      grd.addColorStop(1, '#200c00');
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    inRegion(g, W, H, U.nail, (g, w, h) => {
      const grd = g.createLinearGradient(0, h, 0, 0);
      grd.addColorStop(0, '#5a5444');
      grd.addColorStop(0.6, '#3a3428');
      grd.addColorStop(1, '#16120c');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '150,140,110'},0.25)`;
        g.fillRect(rnd() * w, 0, 1 + rnd() * 2, h);
      }
    });
    inRegion(g, W, H, U.tooth, (g, w, h) => {
      const grd = g.createLinearGradient(0, h, 0, 0);
      grd.addColorStop(0, '#6a5a3a');
      grd.addColorStop(0.35, '#c8bc98');
      grd.addColorStop(1, '#e0d6b4');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
  });
  // the long black coat: worn wool with deep folds, a double row of buttons down the front
  const coat = canvas(512, 1024, (g, W, H) => {
    inRegion(g, W, H, U.coat, (g, w, h) => {
      cloth(g, w, h, '#121116', { folds: 34, foldColor: 'rgba(0,0,0,0.65)', lite: 'rgba(120,115,130,0.05)' });
      // dust and wear toward the hem
      const hem = g.createLinearGradient(0, h * 0.75, 0, h);
      hem.addColorStop(0, 'rgba(90,85,80,0)');
      hem.addColorStop(1, 'rgba(90,85,80,0.3)');
      g.fillStyle = hem;
      g.fillRect(0, 0, w, h);
      // the front opening (u = 0 and 1) and a seam down each side and the back
      for (const x of [3, w - 3]) {
        g.fillStyle = '#050407';
        g.fillRect(x - 3, 0, 6, h);
      }
      for (const x of [w * 0.07, w * 0.93]) {
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(x - 2, h * 0.08, 4, h * 0.92);
      }
      for (const x of [w * 0.25, w * 0.5, w * 0.75]) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x - 1, 0, 2, h);
      }
      // a belt line at the waist
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, h * 0.06, w, 5);
    });
    inRegion(g, W, H, U.sleeve, (g, w, h) => {
      cloth(g, w, h, '#16141a', { folds: 10 });
      // creases at the elbow
      for (let i = 0; i < 7; i++) wander(g, 0, h * (0.35 + rnd() * 0.3), 20, w / 18, (rnd() - 0.5) * 0.3, 0.3, 'rgba(0,0,0,0.5)', 2.5);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(0, 2, w, 6);
    });
    inRegion(g, W, H, U.collar, (g, w, h) => {
      cloth(g, w, h, '#121016', { folds: 6 });
      g.strokeStyle = 'rgba(90,85,95,0.35)';
      g.lineWidth = 2;
      g.setLineDash([5, 4]);
      g.strokeRect(6, 6, w - 12, h - 12);
      g.setLineDash([]);
    });
    inRegion(g, W, H, U.button, (g, w, h) => {
      const grd = g.createRadialGradient(w * 0.3, h * 0.4, 2, w * 0.5, h * 0.5, w * 0.6);
      grd.addColorStop(0, '#5a5248');
      grd.addColorStop(1, '#16130f');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    inRegion(g, W, H, U.shoe, (g, w, h) => {
      g.fillStyle = '#0d0b0b';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 300, ['#3a3430'], [1, 3], 0.3);
    });
  });
  const t = (c) => {
    const x = new THREE.CanvasTexture(c);
    x.colorSpace = THREE.SRGBColorSpace;
    x.anisotropy = 4;
    return x;
  };
  countSheets = { skin: t(skin), glow: t(glow), cloth: t(coat) };
  return countSheets;
}

let bruteSheets;
// the Doctor's Monster: sallow, mismatched skin sewn together, long black matted hair, watery eyes,
// a dark coat too small for him
export function bruteTextures() {
  if (bruteSheets) return bruteSheets;
  seed = 1818;
  const U = BRUTE_UV;
  const glow = canvas(512, 512, (g, W, H) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
  });
  const gg = glow.getContext('2d');
  const skin = canvas(1024, 1024, (g, W, H) => {
    inRegion(g, W, H, U.head, (g, w, h) => {
      const P = (x, y, z) => onHead(w, h, x, y, z);
      // sallow, yellow-grey skin, darker under the jaw
      const v = g.createLinearGradient(0, 0, 0, h);
      v.addColorStop(0, '#706a52');
      v.addColorStop(0.5, '#7a735c');
      v.addColorStop(0.85, '#5e5848');
      v.addColorStop(1, '#3e3a30');
      g.fillStyle = v;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 50; i++) blot(g, rnd() * w, rnd() * h, 10 + rnd() * 40, ['rgba(110,96,70,0.25)', 'rgba(70,74,60,0.25)', 'rgba(120,90,80,0.2)'][i % 3]);
      // patches taken from someone else: a greyer forehead piece and a darker piece round the right eye
      const [ax, ay] = P(0, 0.62, 0.78);
      g.fillStyle = 'rgba(150,150,140,0.35)';
      g.beginPath();
      g.moveTo(ax - 170, ay + 40);
      g.lineTo(ax + 160, ay + 34);
      g.lineTo(ax + 140, ay - 70);
      g.lineTo(ax - 150, ay - 60);
      g.fill();
      const [px, py] = P(0.4, -0.05, 0.92);
      g.fillStyle = 'rgba(90,62,52,0.45)';
      g.beginPath();
      g.moveTo(px - 50, py - 40);
      g.lineTo(px + 60, py - 50);
      g.lineTo(px + 72, py + 70);
      g.lineTo(px - 30, py + 80);
      g.closePath();
      g.fill();
      speckle(g, w, h, 4500, ['#2a2418', '#b0a888', '#5a4636'], [1, 3], 0.14);
      // the seams, stitched shut
      stitches(g, ax - 172, ay + 40, ax + 162, ay + 34, 16, 11, 4.5);
      stitches(g, px - 50, py - 40, px + 60, py - 50, 15, 10, 4);
      stitches(g, px + 60, py - 50, px + 72, py + 70, 15, 10, 4);
      stitches(g, px + 72, py + 70, px - 30, py + 80, 15, 10, 4);
      const [sx0, sy0] = P(-0.5, -0.2, 0.84);
      const [sx1, sy1] = P(-0.3, -0.75, 0.6);
      stitches(g, sx0, sy0, sx1, sy1, 15, 10, 4);
      // old scars
      for (let i = 0; i < 6; i++) wander(g, rnd() * w, h * (0.2 + rnd() * 0.6), 8, 6, rnd() * 6.28, 0.4, 'rgba(120,80,70,0.4)', 2.5);
      // a heavy brow throwing the eyes into shadow
      const [bx, by] = P(0, 0.22, 1);
      blot(g, bx, by + 26, 150, 'rgba(20,15,10,0.75)', 1.3, 0.4);
      for (const sx of [-1, 1]) {
        const [ex, ey] = P(sx * 0.36, 0.08, 0.92);
        blot(g, ex, ey, 54, 'rgba(22,14,12,0.95)', 1.2, 0.9);
        g.fillStyle = '#080404';
        g.beginPath();
        g.ellipse(ex, ey, 24, 15, 0, 0, Math.PI * 2);
        g.fill();
        // thick dark brows
        for (let i = 0; i < 90; i++) {
          const t = rnd();
          const x = ex - sx * 40 + sx * t * 80;
          const y = ey - 30 - Math.sin(t * Math.PI) * 4 + (rnd() - 0.5) * 9;
          g.strokeStyle = `rgba(14,10,8,${0.6 + rnd() * 0.4})`;
          g.lineWidth = 2 + rnd() * 2;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + sx * 6, y - 3);
          g.stroke();
        }
      }
      // straight black lips
      const [ux, uy] = P(0, -0.52, 0.85);
      g.fillStyle = '#16100e';
      g.fillRect(ux - 46, uy - 4, 92, 9);
      g.fillStyle = 'rgba(30,20,18,0.5)';
      g.fillRect(ux - 40, uy + 5, 80, 6);
      // a broad nose's shadow
      const [nx, ny] = P(0, -0.2, 1);
      blot(g, nx, ny, 40, 'rgba(40,30,24,0.4)', 0.8, 1.4);
    });
    inRegion(g, W, H, U.hand, (g, w, h) => {
      skinBase(g, w, h, '#7d7862', ['rgba(110,96,70,0.3)', 'rgba(70,74,60,0.3)']);
      for (const kv of [0.38, 0.7]) blot(g, w * 0.5, (1 - kv) * h, 30, 'rgba(50,40,32,0.4)', 8, 0.5);
      // dark, broken nails at the fingertips
      g.fillStyle = 'rgba(40,32,22,0.85)';
      g.fillRect(0, 0, w, h * 0.08);
      // the palm and back of the hand sewn on from someone else
      g.fillStyle = 'rgba(120,96,86,0.3)';
      g.fillRect(0, h * 0.75, w, h * 0.25);
      stitches(g, 0, h * 0.75, w, h * 0.75, 14, 8, 3);
    });
    inRegion(g, W, H, U.neck, (g, w, h) => {
      skinBase(g, w, h, '#7a745e', ['rgba(110,96,70,0.3)', 'rgba(60,64,50,0.3)']);
      g.fillStyle = 'rgba(100,100,92,0.3)';
      g.fillRect(0, h * 0.45, w, h * 0.55);
      stitches(g, 0, h * 0.45, w, h * 0.45, 12, 9, 3);
    });
    inRegion(g, W, H, U.arm, (g, w, h) => {
      skinBase(g, w, h, '#857c66', ['rgba(110,96,70,0.3)', 'rgba(70,74,60,0.3)']);
      g.fillStyle = 'rgba(70,60,50,0.4)';
      g.fillRect(0, h * 0.55, w, h * 0.45);
      stitches(g, 0, h * 0.55, w, h * 0.55, 12, 9, 3);
      for (let i = 0; i < 6; i++) wander(g, rnd() * w, rnd() * h * 0.5, 10, 8, Math.PI / 2, 0.5, 'rgba(60,70,90,0.3)', 2);
    });
    inRegion(g, W, H, U.ear, (g, w, h) => skinBase(g, w, h, '#76705a', ['rgba(110,80,70,0.35)'], 300));
    for (const [key, iris, pale] of [['eye', '#c8b050', false], ['eye2', '#c0c4b8', true]])
      inRegion(g, W, H, U[key], (g, w, h) => {
        g.fillStyle = pale ? '#a8aa9c' : '#8a7a50';
        g.fillRect(0, 0, w, h);
        const grd = g.createRadialGradient(w * 0.25, h * 0.5, 1, w * 0.25, h * 0.5, w * 0.2);
        grd.addColorStop(0, pale ? '#8a8c80' : '#080604');
        grd.addColorStop(0.3, iris);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      });
  });
  // watery, yellowish eyes that catch the light; the milky one barely
  for (const [key, c] of [['eye', '#d8b050'], ['eye2', '#6a6e60']])
    inRegion(gg, 512, 512, U[key], (g, w, h) => {
      const grd = g.createRadialGradient(w * 0.25, h * 0.5, 1, w * 0.25, h * 0.5, w * 0.24);
      grd.addColorStop(0, c);
      grd.addColorStop(1, '#000');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
  const clothes = canvas(512, 1024, (g, W, H) => {
    inRegion(g, W, H, U.coat, (g, w, h) => {
      cloth(g, w, h, '#241e19', { folds: 22, foldColor: 'rgba(0,0,0,0.55)', lite: 'rgba(140,120,100,0.07)' });
      // patched and mended
      for (const [x, y, pw, ph, c] of [[w * 0.62, h * 0.35, 70, 60, '#2e271e'], [w * 0.2, h * 0.62, 56, 74, '#1a1a1c'], [w * 0.86, h * 0.75, 48, 40, '#28231c']]) {
        g.fillStyle = c;
        g.fillRect(x, y, pw, ph);
        g.strokeStyle = 'rgba(160,140,110,0.22)';
        g.lineWidth = 2;
        g.setLineDash([4, 4]);
        g.strokeRect(x + 3, y + 3, pw - 6, ph - 6);
        g.setLineDash([]);
      }
      // stains and grime, worse toward the hem
      stains(g, w, h, 10, 'rgba(10,8,5,0.45)');
      const hem = g.createLinearGradient(0, h * 0.7, 0, h);
      hem.addColorStop(0, 'rgba(60,50,35,0)');
      hem.addColorStop(1, 'rgba(60,50,35,0.45)');
      g.fillStyle = hem;
      g.fillRect(0, 0, w, h);
      // the front edges and seams, pulled tight
      for (const x of [4, w - 4]) {
        g.fillStyle = '#0a0806';
        g.fillRect(x - 4, 0, 8, h);
      }
      for (const x of [w * 0.25, w * 0.5, w * 0.75]) {
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(x - 1.5, 0, 3, h);
      }
      // lapels folded back from the collar to the chest
      for (const [x0, dir] of [[0, 1], [w, -1]]) {
        g.fillStyle = '#16120e';
        g.beginPath();
        g.moveTo(x0, 0);
        g.lineTo(x0 + dir * w * 0.11, 0);
        g.lineTo(x0 + dir * w * 0.05, h * 0.3);
        g.lineTo(x0, h * 0.42);
        g.fill();
        g.strokeStyle = 'rgba(120,100,80,0.35)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x0 + dir * w * 0.11, 0);
        g.lineTo(x0 + dir * w * 0.05, h * 0.3);
        g.lineTo(x0, h * 0.42);
        g.stroke();
      }
      // strain lines across the back
      for (let i = 0; i < 12; i++) wander(g, w * 0.35 + rnd() * w * 0.3, h * (0.05 + rnd() * 0.2), 12, 9, (rnd() - 0.5) * 0.6, 0.3, 'rgba(0,0,0,0.4)', 2);
    });
    inRegion(g, W, H, U.sleeve, (g, w, h) => {
      cloth(g, w, h, '#221c17', { folds: 8 });
      // frayed cuffs
      for (let x = 0; x < w; x += 3) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '90,80,60'},0.6)`;
        g.fillRect(x, h - 4 - rnd() * 10, 2, 14);
      }
    });
    inRegion(g, W, H, U.trousers, (g, w, h) => {
      cloth(g, w, h, '#1d1c1e', { folds: 12 });
      blot(g, w * 0.25, h * 0.5, 40, 'rgba(80,72,60,0.3)', 1, 0.7);
      blot(g, w * 0.75, h * 0.5, 40, 'rgba(80,72,60,0.3)', 1, 0.7);
      for (let x = 0; x < w; x += 3) {
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(x, h - 3 - rnd() * 9, 2, 12);
      }
    });
    inRegion(g, W, H, U.boot, (g, w, h) => {
      g.fillStyle = '#100d0b';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 600, ['#4a4038', '#000'], [1, 4], 0.3);
      for (let i = 0; i < 8; i++) wander(g, rnd() * w, rnd() * h, 6, 7, rnd() * 6, 0.5, 'rgba(90,80,70,0.35)', 1.5);
    });
    inRegion(g, W, H, U.hair, (g, w, h) => {
      g.fillStyle = '#0b0908';
      g.fillRect(0, 0, w, h);
      // long matted strands
      for (let i = 0; i < 260; i++) {
        const x = rnd() * w;
        g.strokeStyle = `rgba(${30 + rnd() * 30},${24 + rnd() * 20},${20 + rnd() * 14},${0.3 + rnd() * 0.4})`;
        g.lineWidth = 1 + rnd() * 2;
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + (rnd() - 0.5) * 20, h * 0.3, x + (rnd() - 0.5) * 20, h * 0.6, x + (rnd() - 0.5) * 30, h);
        g.stroke();
      }
    });
    inRegion(g, W, H, U.button, (g, w, h) => {
      g.fillStyle = '#4a3a24';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 200, ['#000', '#8a7050'], [1, 3], 0.3);
    });
    inRegion(g, W, H, U.lapel, (g, w, h) => cloth(g, w, h, '#1c1713', { folds: 3 }));
  });
  const t = (c) => {
    const x = new THREE.CanvasTexture(c);
    x.colorSpace = THREE.SRGBColorSpace;
    x.anisotropy = 4;
    return x;
  };
  bruteSheets = { skin: t(skin), glow: t(glow), cloth: t(clothes) };
  return bruteSheets;
}
