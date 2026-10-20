// Room renderer: a fixed-camera painted room lit only by the player's lantern.
// WebGL path: normal-mapped lighting with positions rebuilt from the depth map, depth parallax,
// a foreground silhouette layer, film grain and vignette. Falls back to a Canvas 2D radial mask.
/* global PS */
(function () {
  const RW = 1920;
  const RH = 1080;
  const F = 1280;
  const CX = 960;
  const CY = 500;
  const ZN = 0.8;
  const ZF = 16;
  const MAX_LIGHTS = 4;

  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uAlb, uNrm, uDat, uFg;
uniform vec2 uRes, uOff, uScale, uPar, uTorch;
uniform float uRadius, uTime, uAmbient, uGain, uGrain, uFlash;
uniform vec3 uLamp, uLampCol;
uniform vec4 uLights[${MAX_LIGHTS}];
uniform vec3 uLightCol[${MAX_LIGHTS}];
const vec2 RS = vec2(${RW}.0, ${RH}.0);

vec3 worldAt(vec2 rp, float near) {
  float z = 1.0 / (near * (1.0 / ${ZN.toFixed(2)} - 1.0 / ${ZF.toFixed(1)}) + 1.0 / ${ZF.toFixed(1)});
  return vec3((rp.x - ${CX}.0) * z / ${F}.0, (rp.y - ${CY}.0) * z / ${F}.0, z);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 suv = frag / uRes;
  vec2 uv = uOff + suv * uScale;
  float n0 = texture2D(uDat, uv).r;
  uv += uPar * (n0 - 0.35);
  vec4 dat = texture2D(uDat, uv);
  vec3 alb = pow(texture2D(uAlb, uv).rgb, vec3(2.2));
  vec3 N = texture2D(uNrm, uv).rgb * 2.0 - 1.0;
  N.z = -N.z;
  N = normalize(N);
  vec3 P = worldAt(uv * RS, dat.r);
  vec3 V = normalize(-P);

  // the lantern: a soft beam on screen, lit in 3D by the surface normal
  float sd = distance(frag, uTorch) / uRadius;
  float beam = smoothstep(1.3, 0.1, sd) + 0.07 * smoothstep(3.2, 1.0, sd);
  vec3 Lv = uLamp - P;
  float dist = length(Lv);
  vec3 L = Lv / dist;
  float ndl = max(dot(N, L), 0.0) * 0.82 + 0.18;
  float att = 1.0 / (1.0 + 0.03 * dist * dist);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 36.0) * dat.g;
  vec3 lampCol = mix(uLampCol, vec3(1.0, 0.86, 0.62), smoothstep(0.55, 0.0, sd));
  vec3 col = alb * uAmbient + (alb * ndl + spec * 0.7) * beam * att * uGain * lampCol;

  // other light sources: door cracks, a candle that flares
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec4 li = uLights[i];
    if (li.w <= 0.0) continue;
    vec3 lp = li.xyz;
    vec3 dv = lp - P;
    float d2 = dot(dv, dv);
    float k = max(dot(N, normalize(dv)), 0.0) * 0.85 + 0.15;
    col += (alb * k + spec * 0.4) * uLightCol[i] * li.w * exp(-d2 * 1.4);
  }

  // foreground silhouettes move more than the room
  vec4 fg = texture2D(uFg, uOff + suv * uScale + uPar * 1.9);
  float rim = beam * 0.08;
  col = mix(col, fg.rgb * fg.rgb * (uAmbient * 2.0 + rim) , fg.a);

  col += vec3(uFlash);
  vec3 outc = pow(max(col, 0.0), vec3(1.0 / 2.2));
  float vig = smoothstep(1.15, 0.25, length((suv - 0.5) * vec2(1.25, 1.0)));
  outc *= mix(0.25, 1.0, vig);
  outc += (hash(frag + fract(uTime) * 91.7) - 0.5) * uGrain;
  gl_FragColor = vec4(outc, 1.0);
}`;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load ' + src));
      img.src = src;
    });
  }

  class RoomView {
    constructor(canvas) {
      this.canvas = canvas;
      this.cache = new Map(); // id -> {images, tex, depth}
      this.current = null;
      this.pan = { x: 0, y: 0 };
      this.zoom = 1.05;
      this.view = { scale: 1, visW: RW, visH: RH, ox: 0, oy: 0 };
      this.par = { x: 0, y: 0 };
      const opts = { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false };
      let gl = null;
      if (!/[?&]nogl=1/.test(location.search)) {
        try {
          gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
        } catch (e) {
          gl = null;
        }
      }
      this.gl = gl && this.initGL(gl) ? gl : null;
      if (!this.gl) {
        // a canvas that ever handed out a WebGL context can't give a 2D one: use a fresh canvas
        this.ctx = canvas.getContext('2d');
        if (!this.ctx) {
          const fresh = canvas.cloneNode(false);
          canvas.replaceWith(fresh);
          this.canvas = fresh;
          this.ctx = fresh.getContext('2d');
        }
      }
    }

    initGL(gl) {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn('room shader:', gl.getShaderInfoLog(s));
          return null;
        }
        return s;
      };
      const vs = sh(gl.VERTEX_SHADER, VERT);
      const fs = sh(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {};
      ['uAlb', 'uNrm', 'uDat', 'uFg', 'uRes', 'uOff', 'uScale', 'uPar', 'uTorch', 'uRadius', 'uTime', 'uAmbient', 'uGain', 'uGrain', 'uFlash', 'uLamp', 'uLampCol', 'uLights', 'uLightCol'].forEach(
        (n) => (this.u[n] = gl.getUniformLocation(prog, n))
      );
      gl.uniform1i(this.u.uAlb, 0);
      gl.uniform1i(this.u.uNrm, 1);
      gl.uniform1i(this.u.uDat, 2);
      gl.uniform1i(this.u.uFg, 3);
      this.prog = prog;
      return true;
    }

    texture(img) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      return t;
    }

    // Load (and cache) a room's maps. Resolves when it can be drawn.
    load(id) {
      if (this.cache.has(id)) return this.cache.get(id).ready;
      const base = `/rooms/${id}/`;
      const entry = {};
      entry.ready = Promise.all(['albedo.jpg', 'normal.jpg', 'data.png', 'fg.png'].map((f) => loadImage(base + f))).then(([alb, nrm, dat, fg]) => {
        entry.images = { alb, nrm, dat, fg };
        if (this.gl) entry.tex = [alb, nrm, dat, fg].map((im) => this.texture(im));
        // a small CPU copy of the depth map for item parallax and aiming the lantern
        const c = document.createElement('canvas');
        c.width = 480;
        c.height = 270;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(dat, 0, 0, 480, 270);
        entry.depth = cx.getImageData(0, 0, 480, 270).data;
        return entry;
      });
      this.cache.set(id, entry);
      return entry.ready;
    }

    use(id) {
      this.current = id;
      return this.load(id);
    }

    nearAt(u, v) {
      const e = this.cache.get(this.current);
      if (!e || !e.depth) return 0.3;
      const x = Math.max(0, Math.min(479, Math.round(u * 479)));
      const y = Math.max(0, Math.min(269, Math.round(v * 269)));
      return e.depth[(y * 480 + x) * 4] / 255;
    }

    worldAt(u, v) {
      const near = this.nearAt(u, v);
      const z = 1 / (near * (1 / ZN - 1 / ZF) + 1 / ZF);
      return [((u * RW - CX) * z) / F, ((v * RH - CY) * z) / F, z];
    }

    // Fit the room to the screen (cover) and pan toward where the torch points.
    layout(W, H, torch, dt) {
      const scale = Math.max(W / RW, H / RH) * this.zoom;
      const visW = W / scale;
      const visH = H / scale;
      const tx = torch ? (torch.x / W) * (RW - visW) : (RW - visW) / 2;
      const ty = torch ? (torch.y / H) * (RH - visH) : (RH - visH) / 2;
      const k = 1 - Math.pow(0.02, dt || 0.016);
      if (this.view.visW !== visW) {
        this.pan.x = tx;
        this.pan.y = ty;
      }
      this.pan.x += (tx - this.pan.x) * k;
      this.pan.y += (ty - this.pan.y) * k;
      this.view = { scale, visW, visH, ox: this.pan.x, oy: this.pan.y, W, H };
      // parallax follows the torch's offset from the centre
      this.par.x = torch ? ((torch.x / W) - 0.5) * -0.012 : 0;
      this.par.y = torch ? ((torch.y / H) - 0.5) * -0.008 : 0;
    }

    // room uv (0..1) -> screen px, including parallax at that point's depth
    toScreen(u, v) {
      const near = this.nearAt(u, v);
      const pu = u - this.par.x * (near - 0.35);
      const pv = v - this.par.y * (near - 0.35);
      const s = this.view;
      return { x: (pu * RW - s.ox) * s.scale, y: (pv * RH - s.oy) * s.scale };
    }
    toRoom(x, y) {
      const s = this.view;
      return { u: (x / s.scale + s.ox) / RW, v: (y / s.scale + s.oy) / RH };
    }
    unitPx() {
      return this.view.scale * (RW / 1920);
    }

    // p = {torch:{x,y}, radius, time, flicker, lights:[{u,v,z?,intensity,color:[r,g,b]}], flash}
    render(p, dpr) {
      const e = this.cache.get(this.current);
      const W = this.view.W;
      const H = this.view.H;
      if (!e || !e.images) {
        if (this.gl) {
          this.gl.clearColor(0.04, 0.035, 0.03, 1);
          this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        } else if (this.ctx) {
          this.ctx.fillStyle = '#0A0908';
          this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        return;
      }
      if (!this.gl) return this.render2d(e, p, dpr);
      const gl = this.gl;
      const s = this.view;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      e.tex.forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
      });
      const u = this.u;
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform2f(u.uOff, s.ox / RW, s.oy / RH);
      gl.uniform2f(u.uScale, s.visW / RW, s.visH / RH);
      gl.uniform2f(u.uPar, this.par.x, this.par.y);
      gl.uniform2f(u.uTorch, p.torch.x * dpr, p.torch.y * dpr);
      gl.uniform1f(u.uRadius, Math.max(1, p.radius * dpr));
      gl.uniform1f(u.uTime, p.time);
      gl.uniform1f(u.uAmbient, p.ambient != null ? p.ambient : 0.0035);
      gl.uniform1f(u.uGain, (p.gain != null ? p.gain : 3.2) * (p.flicker || 1));
      gl.uniform1f(u.uGrain, p.grain != null ? p.grain : 0.05);
      gl.uniform1f(u.uFlash, p.flash || 0);
      // the lantern hangs below and to the side of the eye, aimed where the torch points
      const r = this.toRoom(p.torch.x, p.torch.y);
      const aim = this.worldAt(r.u, r.v);
      gl.uniform3f(u.uLamp, aim[0] * 0.35 + 0.25, 0.4 + aim[1] * 0.25, 0.25);
      gl.uniform3f(u.uLampCol, 1.0, 0.58, 0.24);
      const L = new Float32Array(MAX_LIGHTS * 4);
      const C = new Float32Array(MAX_LIGHTS * 3);
      (p.lights || []).slice(0, MAX_LIGHTS).forEach((l, i) => {
        const w = this.worldAt(l.u, l.v);
        L.set([w[0], w[1], (l.z != null ? l.z : w[2]) - 0.25, l.intensity], i * 4);
        C.set(l.color || [1, 0.5, 0.15], i * 3);
      });
      gl.uniform4fv(u.uLights, L);
      gl.uniform3fv(u.uLightCol, C);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    render2d(e, p, dpr) {
      const c = this.ctx;
      const s = this.view;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = '#0A0908';
      c.fillRect(0, 0, s.W, s.H);
      c.save();
      c.beginPath();
      c.arc(p.torch.x, p.torch.y, p.radius * 1.3, 0, Math.PI * 2);
      c.clip();
      c.drawImage(e.images.alb, s.ox, s.oy, s.visW, s.visH, 0, 0, s.W, s.H);
      const g = c.createRadialGradient(p.torch.x, p.torch.y, p.radius * 0.1, p.torch.x, p.torch.y, p.radius * 1.3);
      g.addColorStop(0, 'rgba(255,170,90,0.12)');
      g.addColorStop(0.6, 'rgba(10,9,8,0.55)');
      g.addColorStop(1, 'rgba(10,9,8,1)');
      c.fillStyle = g;
      c.fillRect(0, 0, s.W, s.H);
      c.restore();
    }
  }

  PS.RoomView = RoomView;
  PS.ROOM_SIZE = { w: RW, h: RH };
})();
