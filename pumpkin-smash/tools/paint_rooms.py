#!/usr/bin/env python3
"""
Paints the five Pumpkin Smash rooms in code (no third-party art).

Each room is a fixed-camera, one-point-perspective set: a ray-cast room box plus furniture built
from 3D boxes, cylinders and flats, textured with procedural materials. For every room it writes
into public/rooms/<id>/:

  albedo.jpg  1920x1080 unlit painting: desaturated, Victorian gothic
  normal.jpg  view-space normals (x right, y down, z toward the viewer), rgb = n * 0.5 + 0.5
  data.png    R = nearness (1/z, 255 = closest), G = gloss
  fg.png      960x540 RGBA foreground silhouettes for the parallax layer

and public/rooms/rooms.json with each room's item surfaces, doors and candles (all normalised 0..1).

Requires Python 3 with numpy and Pillow.
  python3 tools/paint_rooms.py                 # all rooms
  python3 tools/paint_rooms.py hall crypt      # some rooms (rooms.json keeps the others)
  python3 tools/paint_rooms.py --preview DIR   # also write torch-lit previews for checking
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
F = 1280.0  # focal length in px
CX, CY = W / 2, 500.0  # principal point (horizon sits a little above centre)
ZN, ZF = 0.8, 16.0  # depth encoding range in metres
EYE = 1.6  # floor is 1.6 m below the eye; y points down
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'rooms'))
f32 = np.float32


# ---------------------------------------------------------------- helpers
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def h1(a):
    return (np.sin(a * 12.9898 + 4.1414) * 43758.5453) % 1.0


def h2(a, b):
    return (np.sin(a * 12.9898 + b * 78.233 + 1.7) * 43758.5453) % 1.0


def norm3(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)


def proj(x, y, d):
    return (CX + F * x / d, CY + F * y / d)


class Noise:
    def __init__(self, seed):
        self.t = np.random.RandomState(seed).rand(512, 512).astype(f32)

    def __call__(self, x, y):
        xi = np.floor(x)
        yi = np.floor(y)
        xf = (x - xi).astype(f32)
        yf = (y - yi).astype(f32)
        xi = xi.astype(np.int64) & 511
        yi = yi.astype(np.int64) & 511
        x1 = (xi + 1) & 511
        y1 = (yi + 1) & 511
        t = self.t
        u = xf * xf * (3 - 2 * xf)
        v = yf * yf * (3 - 2 * yf)
        top = t[yi, xi] + (t[yi, x1] - t[yi, xi]) * u
        bot = t[y1, xi] + (t[y1, x1] - t[y1, xi]) * u
        return top + (bot - top) * v

    def fbm(self, x, y, octaves=4, gain=0.5):
        s = 0.0
        amp = 1.0
        tot = 0.0
        for i in range(octaves):
            s = s + amp * self(x * (2 ** i) + i * 17.31, y * (2 ** i) + i * 31.73)
            tot += amp
            amp *= gain
        return s / tot


NZ = Noise(11)


def rgb(*c):
    return np.array(c, f32)


def tint(base, k):
    return base[None, None, :] * k[..., None] if np.ndim(k) else base * k


# ---------------------------------------------------------------- materials
# Each material maps plane coordinates (u, v in metres) to (albedo HxWx3, height HxW in metres, gloss).
def planks(base=rgb(0.34, 0.25, 0.18), board=0.16, length=2.4, gloss=0.25, seed=0, grain=1.0, worn=0.0):
    def m(u, v):
        row = np.floor(v / board)
        off = h1(row + seed) * length
        col = np.floor((u + off) / length)
        rid = h2(row + seed, col)
        fv = v / board - row
        fu = (u + off) / length - col
        g = NZ.fbm(u * 1.2 + rid * 9, v * 34 + rid * 21, 4)
        streak = NZ.fbm(u * 0.25, v * 60 + seed, 2)
        k = (0.72 + 0.38 * rid) * (0.7 + 0.55 * g * grain + 0.25 * (1 - grain)) * (0.85 + 0.3 * streak)
        if worn:
            k = k * (1 - worn * smooth(0.4, 0.8, NZ.fbm(u * 0.6, v * 0.6, 3)))
        alb = tint(base, k)
        edge = np.minimum(fv, 1 - fv) * board
        endd = np.minimum(fu, 1 - fu) * length
        hgt = 0.0025 * g + 0.002 * smooth(0.0, 0.012, edge) + 0.001 * smooth(0, 0.01, endd)
        gap = (edge < 0.004) | (endd < 0.003)
        knot = smooth(0.92, 1.0, NZ(u * 3 + rid * 50, v * 3)) * 0.5
        alb = alb * (1 - knot[..., None]) * np.where(gap, 0.25, 1.0)[..., None]
        hgt = np.where(gap, -0.003, hgt)
        return alb, hgt, gloss
    return m


def wood(base=rgb(0.25, 0.17, 0.12), gloss=0.35, seed=0, vertical=False):
    """Fine-grained solid wood for furniture, casings and frames (no board gaps)."""
    def m(u, v):
        a, b = (v, u) if vertical else (u, v)
        g = NZ.fbm(a * 0.8 + seed, b * 26 + seed * 3, 4)
        fig = NZ.fbm(a * 3 + seed, b * 3, 3)
        alb = tint(base, (0.75 + 0.45 * g) * (0.85 + 0.25 * fig))
        return alb, 0.0012 * g, gloss
    return m


def swap(mat):
    return lambda u, v: mat(v, u)


def blocks(base=rgb(0.42, 0.40, 0.37), bw=0.55, bh=0.30, mortar=0.018, gloss=0.12, bulge=0.012, seed=0, var=0.3):
    def m(u, v):
        row = np.floor(v / bh)
        off = (row % 2) * 0.5 * bw + h1(row + seed) * 0.15
        col = np.floor((u + off) / bw)
        fu = (u + off) / bw - col
        fv = v / bh - row
        bid = h2(row + seed * 7, col)
        d = np.minimum(np.minimum(fu, 1 - fu) * bw, np.minimum(fv, 1 - fv) * bh)
        pit = NZ.fbm(u * 9 + bid * 30, v * 9, 4)
        stain = NZ.fbm(u * 0.5, v * 0.5, 3)
        damp = smooth(0.5, 0.8, NZ.fbm(u * 0.7 + seed, v * 0.25, 4))
        k = (1 - var / 2 + var * bid) * (0.8 + 0.35 * pit) * (0.7 + 0.5 * stain) * (1 - 0.35 * damp)
        alb = tint(base, k)
        hgt = bulge * smooth(0, 0.06, d) * (0.7 + 0.6 * bid) + 0.006 * pit
        mm = d < mortar
        alb = np.where(mm[..., None], alb * 0.62, alb)
        hgt = np.where(mm, 0.0, hgt)
        return alb, hgt, gloss
    return m


def plaster(base=rgb(0.48, 0.45, 0.40), gloss=0.05, stains=0.5, cracks=True):
    def m(u, v):
        n1 = NZ.fbm(u * 2.0, v * 2.0, 5)
        st = NZ.fbm(u * 0.35 + 3, v * 0.6, 4)
        drip = NZ.fbm(u * 6, v * 0.4, 3)
        k = (0.8 + 0.3 * n1) * (1 - stains * smooth(0.45, 0.8, st)) * (1 - 0.25 * smooth(0.55, 0.8, drip))
        alb = tint(base, k)
        hgt = 0.003 * n1
        if cracks:
            c = np.abs(NZ.fbm(u * 1.1 + 5, v * 1.1, 4) - 0.5)
            cm = (c < 0.006) & (NZ.fbm(u * 0.5 + 2, v * 0.5, 2) > 0.55)
            alb = np.where(cm[..., None], alb * 0.62, alb)
            hgt = np.where(cm, hgt - 0.003, hgt)
        return alb, hgt, gloss
    return m


def damask(a=rgb(0.31, 0.28, 0.26), b=rgb(0.25, 0.22, 0.21), tw=0.26, th=0.36):
    def m(u, v):
        x = (u / tw) % 1.0 - 0.5
        y = (v / th) % 1.0 - 0.5
        row = np.floor(v / th)
        x = np.where(row % 2 == 0, x, ((u / tw + 0.5) % 1.0) - 0.5)
        r = np.sqrt((x * 1.5) ** 2 + y ** 2)
        ang = np.arctan2(y, x)
        petal = 0.28 + 0.08 * np.cos(ang * 6)
        motif = smooth(petal + 0.02, petal - 0.02, r) * (1 - smooth(0.06, 0.04, r))
        stem = smooth(0.03, 0.01, np.abs(x)) * smooth(0.5, 0.3, np.abs(y))
        f = np.clip(motif + stem * 0.6, 0, 1)
        n1 = NZ.fbm(u * 3, v * 3, 4)
        age = NZ.fbm(u * 0.4, v * 0.5, 3)
        alb = a[None, None] * (1 - f[..., None]) + b[None, None] * f[..., None]
        alb = alb * (0.8 + 0.3 * n1)[..., None] * (1 - 0.35 * smooth(0.5, 0.85, age))[..., None]
        return alb, 0.0012 * f + 0.0015 * n1, 0.1
    return m


def panels(base=rgb(0.30, 0.21, 0.15), pw=0.62, ph=0.7, border=0.07, gloss=0.3):
    wood = planks(base, board=0.09, length=9.0, gloss=gloss, seed=3)

    def m(u, v):
        alb, hgt, g = wood(v, u)  # vertical grain
        fu = (u / pw) % 1.0
        fv = (v / ph) % 1.0
        d = np.minimum(np.minimum(fu, 1 - fu) * pw, np.minimum(fv, 1 - fv) * ph)
        frame = smooth(0.0, 0.035, d) * 0.004
        field = -smooth(border, border + 0.05, d) * 0.003
        shade = 0.88 + 0.12 * smooth(border, border + 0.05, d) - 0.1 * (1 - smooth(0.0, 0.02, d))
        return alb * shade[..., None], hgt + frame + field, g
    return m


def fabric(base=rgb(0.30, 0.16, 0.13), accent=rgb(0.42, 0.33, 0.22), scale=0.08, border=None, gloss=0.03):
    def m(u, v):
        weave = (np.sin(u / 0.004) * np.sin(v / 0.004)) * 0.5 + 0.5
        n1 = NZ.fbm(u * 4, v * 4, 3)
        x = (u / scale) % 1.0 - 0.5
        y = (v / scale) % 1.0 - 0.5
        diamond = smooth(0.32, 0.28, np.abs(x) + np.abs(y)) * (1 - smooth(0.18, 0.14, np.abs(x) + np.abs(y)))
        alb = base[None, None] * (1 - diamond[..., None]) + accent[None, None] * diamond[..., None]
        if border is not None:
            bu, bv = border
            dd = np.minimum(np.minimum(u - bu[0], bu[1] - u), np.minimum(v - bv[0], bv[1] - v))
            band = (dd > 0.08) & (dd < 0.2)
            alb = np.where(band[..., None], accent[None, None] * 0.9, alb)
        wear = NZ.fbm(u * 0.8, v * 0.8, 3)
        alb = alb * (0.75 + 0.2 * weave + 0.2 * n1)[..., None] * (1 - 0.4 * smooth(0.55, 0.85, wear))[..., None]
        return alb, 0.0008 * weave + 0.001 * n1, gloss
    return m


def cloth(base=rgb(0.62, 0.59, 0.53), folds=7.0, depth=0.03, gloss=0.04):
    def m(u, v):
        w = NZ.fbm(u * 1.5, v * 0.3, 3)
        f = np.sin(u * folds + w * 6.0)
        n1 = NZ.fbm(u * 6, v * 6, 3)
        alb = tint(base, (0.78 + 0.18 * f + 0.1 * n1) * (1 - 0.3 * smooth(0.5, 0.9, NZ.fbm(u * 0.7, v * 0.7, 3))))
        return alb, depth * (0.5 + 0.5 * f), gloss
    return m


def iron(base=rgb(0.16, 0.15, 0.15), gloss=0.45):
    def m(u, v):
        n1 = NZ.fbm(u * 10, v * 10, 4)
        rust = smooth(0.6, 0.8, NZ.fbm(u * 2, v * 2, 3))
        alb = tint(base, 0.8 + 0.4 * n1)
        alb = alb * (1 - rust[..., None]) + rgb(0.26, 0.16, 0.1)[None, None] * rust[..., None]
        return alb, 0.0015 * n1, gloss
    return m


def bark(base=rgb(0.21, 0.19, 0.17)):
    def m(u, v):
        g = NZ.fbm(u * 18, v * 1.6, 5)
        alb = tint(base, 0.55 + 0.7 * g)
        return alb, 0.025 * g, 0.05
    return m


def mud(base=rgb(0.20, 0.19, 0.15)):
    def m(u, v):
        n1 = NZ.fbm(u * 1.5, v * 1.5, 5)
        n2 = NZ.fbm(u * 12, v * 12, 3)
        moss = smooth(0.5, 0.7, NZ.fbm(u * 0.8 + 9, v * 0.8, 4))
        alb = tint(base, 0.7 + 0.5 * n1) * (1 - moss[..., None]) + rgb(0.17, 0.20, 0.13)[None, None] * moss[..., None]
        return alb, 0.02 * n1 + 0.004 * n2, 0.15
    return m


def water(base=rgb(0.05, 0.055, 0.05)):
    def m(u, v):
        r = np.zeros_like(u)
        for i in range(6):
            cx, cz = h1(i + 3) * 6 - 3, 3 + h1(i + 9) * 9
            dd = np.sqrt((u - cx) ** 2 + (v - cz) ** 2)
            r = r + np.sin(dd * 26 - i) * np.exp(-dd * 0.9) * 0.6
        n1 = NZ.fbm(u * 3, v * 3, 4)
        scum = smooth(0.62, 0.75, NZ.fbm(u * 0.9, v * 0.9, 4))
        alb = tint(base, 0.8 + 0.4 * n1) * (1 - scum[..., None]) + rgb(0.13, 0.15, 0.10)[None, None] * scum[..., None]
        gloss = 0.95 - 0.8 * scum
        return alb, 0.002 * r + 0.001 * n1, gloss
    return m


def glass(seed=0):
    tints = [rgb(0.15, 0.11, 0.10), rgb(0.10, 0.11, 0.13), rgb(0.14, 0.13, 0.10), rgb(0.11, 0.12, 0.10), rgb(0.12, 0.10, 0.12)]

    def m(u, v):
        cu = np.floor(u / 0.16 + np.floor(v / 0.22) * 0.5)
        cv = np.floor(v / 0.22)
        cid = (h2(cu + seed, cv) * len(tints)).astype(np.int64)
        alb = np.zeros(u.shape + (3,), f32)
        for i, t in enumerate(tints):
            alb = np.where((cid == i)[..., None], t[None, None], alb)
        fu = (u / 0.16 + np.floor(v / 0.22) * 0.5) % 1.0
        fv = (v / 0.22) % 1.0
        lead = (np.minimum(fu, 1 - fu) < 0.06) | (np.minimum(fv, 1 - fv) < 0.05)
        n1 = NZ.fbm(u * 8, v * 8, 3)
        alb = np.where(lead[..., None], rgb(0.06, 0.06, 0.06)[None, None], alb * (0.8 + 0.4 * n1)[..., None])
        hgt = np.where(lead, 0.004, 0.0) + 0.0008 * n1
        return alb, hgt, np.where(lead, 0.3, 0.85)
    return m


def solid(c, gloss=0.1, rough=0.002, freq=5.0):
    def m(u, v):
        n1 = NZ.fbm(u * freq, v * freq, 4)
        return tint(c, 0.8 + 0.4 * n1), rough * n1, gloss
    return m


def bone(c=rgb(0.70, 0.66, 0.57)):
    return solid(c, gloss=0.2, rough=0.002, freq=8)


# ---------------------------------------------------------------- the painter
def poly_mask(pts, ss=3):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0 = max(int(math.floor(min(xs))) - 2, 0)
    x1 = min(int(math.ceil(max(xs))) + 2, W)
    y0 = max(int(math.floor(min(ys))) - 2, 0)
    y1 = min(int(math.ceil(max(ys))) + 2, H)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    im = Image.new('L', ((x1 - x0) * ss, (y1 - y0) * ss), 0)
    ImageDraw.Draw(im).polygon([((x - x0) * ss, (y - y0) * ss) for x, y in pts], fill=255)
    im = im.resize((x1 - x0, y1 - y0), Image.BOX)
    return (y0, y1, x0, x1), np.asarray(im, f32) / 255.0


def arch(x0, x1, y_spring, y_bottom, n=28):
    """Round-arch outline in plane coordinates: straight sides from y_bottom up to y_spring, then a semicircle."""
    r = (x1 - x0) / 2
    cx = (x0 + x1) / 2
    pts = [(x0, y_bottom)]
    for i in range(n + 1):
        a = math.pi - math.pi * i / n
        pts.append((cx + r * math.cos(a), y_spring - r * math.sin(a)))
    pts.append((x1, y_bottom))
    return pts


def pointed_arch(x0, x1, y_spring, y_bottom, n=24):
    w = x1 - x0
    R = w  # equilateral arch
    pts = [(x0, y_bottom), (x0, y_spring)]
    # left arc: centre at x1, from angle 180 to 120
    for i in range(1, n + 1):
        a = math.pi - math.radians(60) * i / n
        pts.append((x1 + R * math.cos(a), y_spring - R * math.sin(a)))
    # right arc: centre at x0, from 60 down to 0
    for i in range(1, n + 1):
        a = math.radians(60) - math.radians(60) * i / n
        pts.append((x0 + R * math.cos(a), y_spring - R * math.sin(a)))
    pts.append((x1, y_bottom))
    return pts


class Room:
    def __init__(self, rid, seed=1):
        self.id = rid
        self.alb = np.zeros((H, W, 3), f32)
        self.nrm = np.zeros((H, W, 3), f32)
        self.nrm[..., 2] = -1
        self.dep = np.full((H, W), ZF, f32)
        self.gls = np.zeros((H, W), f32)
        self.P = np.zeros((H, W, 3), f32)
        self.P[..., 2] = ZF
        ys, xs = np.mgrid[0:H, 0:W].astype(f32)
        self.rx = (xs - CX) / F
        self.ry = (ys - CY) / F
        self.fg = Image.new('RGBA', (W // 2, H // 2), (0, 0, 0, 0))
        self.fgd = ImageDraw.Draw(self.fg)
        self.surfaces = []
        self.doors = []
        self.candles = []
        self.rs = np.random.RandomState(seed)

    # -- core: any planar polygon, textured by plane coordinates, composited front-to-back by call order
    def plane(self, corners, n, origin, uax, vax, mat, bevel=0.0, bevel_h=0.0, normal_fn=None, shade=1.0, mask_fn=None):
        pts = [proj(*c) for c in corners]
        r = poly_mask(pts)
        if r is None:
            return
        (y0, y1, x0, x1), m = r
        if m.max() <= 0:
            return
        n = np.array(n, f32)
        origin = np.array(origin, f32)
        uax = np.array(uax, f32)
        vax = np.array(vax, f32)
        dx = self.rx[y0:y1, x0:x1]
        dy = self.ry[y0:y1, x0:x1]
        den = n[0] * dx + n[1] * dy + n[2]
        den = np.where(np.abs(den) < 1e-5, 1e-5, den)
        t = np.clip(float(np.dot(n, origin)) / den, 0.05, ZF)
        P = np.stack([dx * t, dy * t, t], -1)
        rel = P - origin
        u = rel @ uax
        v = rel @ vax
        if mask_fn is not None:
            m = m * mask_fn(u, v)
        alb, hgt, gloss = mat(u, v)
        hgt = np.broadcast_to(np.asarray(hgt, f32), m.shape).copy()
        if bevel > 0:
            mi = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(bevel))
            mb = np.asarray(mi, f32) / 255.0
            hgt = hgt + bevel_h * smooth(0.45, 1.0, mb)
        nb = normal_fn(P, u, v) if normal_fn else np.broadcast_to(n, P.shape)
        dPx = np.gradient(P, axis=1)
        dPy = np.gradient(P, axis=0)
        lx = np.maximum(np.linalg.norm(dPx, axis=-1), 1e-6)
        ly = np.maximum(np.linalg.norm(dPy, axis=-1), 1e-6)
        gx = np.clip(np.gradient(hgt, axis=1) / lx, -4, 4)
        gy = np.clip(np.gradient(hgt, axis=0) / ly, -4, 4)
        nn = norm3(nb - gx[..., None] * (dPx / lx[..., None]) - gy[..., None] * (dPy / ly[..., None]))
        m3 = m[..., None]
        sl = (slice(y0, y1), slice(x0, x1))
        self.alb[sl] = self.alb[sl] * (1 - m3) + np.clip(alb * shade, 0, 1) * m3
        self.nrm[sl] = self.nrm[sl] * (1 - m3) + nn * m3
        self.dep[sl] = self.dep[sl] * (1 - m) + t * m
        self.gls[sl] = self.gls[sl] * (1 - m) + np.broadcast_to(np.asarray(gloss, f32), m.shape) * m
        self.P[sl] = self.P[sl] * (1 - m3) + P * m3

    # -- convenience shapes
    def flat(self, pts, d, mat, **kw):
        """Polygon (x, y) in a camera-facing plane at distance d."""
        self.plane([(x, y, d) for x, y in pts], (0, 0, -1), (0, 0, d), (1, 0, 0), (0, 1, 0), mat, **kw)

    def side(self, x, pts, mat, **kw):
        """Polygon (d, y) on the side wall plane at x (left wall when x < 0)."""
        n = (1, 0, 0) if x < 0 else (-1, 0, 0)
        self.plane([(x, y, d) for d, y in pts], n, (x, 0, 0), (0, 0, 1), (0, 1, 0), mat, **kw)

    def ground(self, pts, y, mat, **kw):
        """Polygon (x, d) on a horizontal plane at height y (seen from above when y > 0)."""
        n = (0, -1, 0) if y > 0 else (0, 1, 0)
        self.plane([(x, y, d) for x, d in pts], n, (0, y, 0), (1, 0, 0), (0, 0, 1), mat, **kw)

    def box(self, x0, x1, y0, y1, d0, d1, mat, top=None, sidemat=None, bevel=1.2, bevel_h=0.004, surface=False, shade=1.0):
        top = top or mat
        sidemat = sidemat or mat
        if x0 > 0:
            self.side(x0 + 1e-4, [(d0, y0), (d1, y0), (d1, y1), (d0, y1)], sidemat, bevel=bevel, bevel_h=bevel_h, shade=shade * 0.95)
        if x1 < 0:
            self.side(x1 - 1e-4, [(d0, y0), (d1, y0), (d1, y1), (d0, y1)], sidemat, bevel=bevel, bevel_h=bevel_h, shade=shade * 0.95)
        if y0 > 0:
            self.ground([(x0, d0), (x1, d0), (x1, d1), (x0, d1)], y0, top, bevel=bevel, bevel_h=bevel_h, shade=shade)
        if y1 < 0:
            self.ground([(x0, d0), (x1, d0), (x1, d1), (x0, d1)], y1, top, bevel=bevel, bevel_h=bevel_h, shade=shade * 0.9)
        self.flat([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], d0, mat, bevel=bevel, bevel_h=bevel_h, shade=shade)
        if surface:
            self.surface(x0 + 0.08, x1 - 0.08, y0, (d0 + d1) / 2)

    def cyl(self, xc, y0, y1, d, r, mat, shade=1.0):
        def nfn(P, u, v):
            k = np.clip((P[..., 0] - xc) / r, -0.995, 0.995)
            return np.stack([k, np.zeros_like(k), -np.sqrt(1 - k * k)], -1)
        self.plane([(xc - r, y0, d), (xc + r, y0, d), (xc + r, y1, d), (xc - r, y1, d)], (0, 0, -1), (xc, 0, d), (1, 0, 0), (0, 1, 0), mat, normal_fn=nfn, shade=shade)

    def contact(self, xc, d, rx, rd, strength=0.6):
        """Soft contact shadow / occlusion on the floor under an object."""
        P = self.P
        on = np.abs(P[..., 1] - EYE) < 0.03
        q = ((P[..., 0] - xc) / rx) ** 2 + ((P[..., 2] - d) / rd) ** 2
        k = 1 - strength * np.exp(-q * 1.6) * on
        self.alb *= k[..., None]

    # -- metadata
    def surface(self, x0, x1, y, d):
        a = proj(x0, y, d)
        b = proj(x1, y, d)
        if b[0] < 0 or a[0] > W or a[1] < 0 or a[1] > H:
            return
        xa = max(a[0], 30)
        xb = min(b[0], W - 30)
        if xb - xa < 20:
            return
        self.surfaces.append({'x1': round(xa / W, 4), 'x2': round(xb / W, 4), 'y': round(a[1] / H, 4), 's': round(min(1.6, 4.0 / d), 3)})

    def floor_rows(self, rows):
        for d, x0, x1 in rows:
            self.surface(x0, x1, EYE, d)

    def door(self, corners, kind='single'):
        pts = [proj(*c) for c in corners]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        self.doors.append({'x': round(min(xs) / W, 4), 'y': round(min(ys) / H, 4), 'w': round((max(xs) - min(xs)) / W, 4),
                           'h': round((max(ys) - min(ys)) / H, 4), 'kind': kind})

    def candle(self, x, y, d, h=0.18, r=0.025):
        self.cyl(x, y - h, y, d, r, solid(rgb(0.72, 0.68, 0.58), gloss=0.3))
        px, py = proj(x, y - h - 0.03, d)
        self.candles.append({'x': round(px / W, 4), 'y': round(py / H, 4), 's': round(4.0 / d, 3)})

    # -- room shell
    def shell(self, hw, D, ceil, floor_m, wall_m, back_m, ceil_m, near=0.9, ao=0.6):
        self.hw, self.D, self.ceil = hw, D, ceil
        self.plane([(-hw, -ceil, near), (hw, -ceil, near), (hw, -ceil, D), (-hw, -ceil, D)], (0, 1, 0), (0, -ceil, 0), (1, 0, 0), (0, 0, 1), ceil_m)
        self.plane([(-hw, EYE, near), (hw, EYE, near), (hw, EYE, D), (-hw, EYE, D)], (0, -1, 0), (0, EYE, 0), (1, 0, 0), (0, 0, 1), floor_m)
        self.plane([(-hw, -ceil, near), (-hw, -ceil, D), (-hw, EYE, D), (-hw, EYE, near)], (1, 0, 0), (-hw, 0, 0), (0, 0, 1), (0, 1, 0), wall_m)
        self.plane([(hw, -ceil, near), (hw, -ceil, D), (hw, EYE, D), (hw, EYE, near)], (-1, 0, 0), (hw, 0, 0), (0, 0, 1), (0, 1, 0), wall_m)
        self.plane([(-hw, -ceil, D), (hw, -ceil, D), (hw, EYE, D), (-hw, EYE, D)], (0, 0, -1), (0, 0, D), (1, 0, 0), (0, 1, 0), back_m)
        # ambient occlusion where planes meet
        P = self.P
        ds = np.stack([EYE - P[..., 1], P[..., 1] + ceil, P[..., 0] + hw, hw - P[..., 0], D - P[..., 2]], -1)
        ds = np.sort(np.abs(ds), axis=-1)
        k = 1 - ao * np.exp(-ds[..., 1] / 0.35)
        self.alb *= k[..., None]

    def web(self, cx, cy, r, a0, a1, spokes=7, rings=6, alpha=150):
        """Cobweb in the foreground layer (half-res coordinates)."""
        col = (34, 31, 27, alpha)
        for i in range(spokes):
            a = math.radians(a0 + (a1 - a0) * i / (spokes - 1))
            self.fgd.line([(cx, cy), (cx + r * math.cos(a), cy + r * math.sin(a))], fill=col, width=1)
        for j in range(1, rings + 1):
            rr = r * j / (rings + 0.5)
            pts = []
            for i in range(spokes):
                a = math.radians(a0 + (a1 - a0) * i / (spokes - 1))
                sag = 1 - 0.08 * (i % 2)
                pts.append((cx + rr * sag * math.cos(a), cy + rr * sag * math.sin(a)))
            self.fgd.line(pts, fill=col, width=1)

    # -- output
    def finish(self):
        ys, xs = np.mgrid[0:H, 0:W].astype(f32)
        b1 = NZ.fbm(xs / 70 + ys / 260, ys / 14 + xs / 400, 3)
        b2 = NZ.fbm(xs / 22, ys / 22, 3)
        alb = self.alb * (0.86 + 0.18 * b1 + 0.08 * b2)[..., None]
        lum = alb @ np.array([0.299, 0.587, 0.114], f32)
        alb = lum[..., None] + (alb - lum[..., None]) * 0.5
        alb = alb * np.array([1.0, 0.95, 0.87], f32)
        self.alb = np.clip(alb, 0, 1)
        self.nrm = norm3(self.nrm)

    def save(self):
        d = os.path.join(OUT, self.id)
        os.makedirs(d, exist_ok=True)
        Image.fromarray((np.clip(self.alb, 0, 1) ** (1 / 1.1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(d, 'albedo.jpg'), quality=86, subsampling=0)
        n = self.nrm * np.array([1, 1, -1], f32)  # z toward the viewer
        Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(os.path.join(d, 'normal.jpg'), quality=90, subsampling=0)
        near = (1 / np.clip(self.dep, ZN, ZF) - 1 / ZF) / (1 / ZN - 1 / ZF)
        data = np.zeros((H, W, 3), np.uint8)
        data[..., 0] = (np.clip(near, 0, 1) * 255 + 0.5).astype(np.uint8)
        data[..., 1] = (np.clip(self.gls, 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(data).save(os.path.join(d, 'data.png'), optimize=True)
        self.fg.save(os.path.join(d, 'fg.png'), optimize=True)
        return {'surfaces': self.surfaces, 'doors': self.doors, 'candles': self.candles}

    def preview(self, path, torches):
        """Torch-lit preview using the same light model as the shader (for eyeballing)."""
        P = self.P
        N = self.nrm
        out = []
        for (tx, ty) in torches:
            ti, tj = int(np.clip(ty, 0, H - 1)), int(np.clip(tx, 0, W - 1))
            aim = P[ti, tj]
            L = np.array([aim[0] * 0.15 + 0.25, 0.45, 0.2], f32)
            Lv = L - P
            dist = np.linalg.norm(Lv, axis=-1)
            Ld = Lv / dist[..., None]
            ndl = np.clip((N * Ld).sum(-1) * 0.85 + 0.15, 0, 1)
            sd = np.sqrt((xs_ := np.arange(W, dtype=f32)[None, :] - tx) ** 2 + (np.arange(H, dtype=f32)[:, None] - ty) ** 2)
            R = 260
            beam = smooth(R * 1.25, R * 0.25, sd) + 0.12 * smooth(R * 3, R, sd)
            att = 1 / (1 + 0.03 * dist * dist)
            col = np.array([1.0, 0.78, 0.5], f32)
            lit = self.alb * (0.03 + (beam * ndl * att * 2.0)[..., None] * col)
            out.append(np.clip(lit, 0, 1) ** (1 / 1.6))
        flood = self.alb * (0.25 + 0.75 * np.clip(-N[..., 2], 0, 1))[..., None]
        out.append(np.clip(flood * 1.4, 0, 1))
        top = np.concatenate(out[:2], 1)
        bot = np.concatenate(out[2:4], 1) if len(out) >= 4 else np.concatenate([out[2], out[2]], 1)
        img = np.concatenate([top, bot], 0)
        Image.fromarray((img * 255).astype(np.uint8)).resize((W, H)).save(path, quality=85)


# ================================================================= the five rooms
def hall():
    r = Room('hall', 1)
    hw, D, ceil = 3.2, 7.5, 1.9
    floor = swap(planks(rgb(0.30, 0.21, 0.15), board=0.14, gloss=0.4, seed=1, worn=0.3))
    wainscot = panels(rgb(0.27, 0.19, 0.13))
    paper = damask()
    crown = plaster(rgb(0.40, 0.37, 0.33), stains=0.3, cracks=False)

    def wall(u, v):
        a1, h1_, g1 = wainscot(u, v)
        a2, h2_, g2 = paper(u, v)
        a3, h3_, g3 = crown(u, v)
        low = v > 0.75
        rail = (v > 0.68) & (v <= 0.75)
        high = v < -1.62
        alb = np.where(low[..., None], a1, np.where(high[..., None], a3, a2))
        hg = np.where(low, h1_, np.where(high, h3_ + 0.004, h2_))
        alb = np.where(rail[..., None], a1 * 1.1, alb)
        hg = np.where(rail, 0.012 * np.sin((v - 0.68) / 0.07 * math.pi), hg)
        return alb, hg, np.where(low | rail, 0.3, 0.08)

    r.shell(hw, D, ceil, floor, wall, wall, plaster(rgb(0.32, 0.30, 0.27), stains=0.6))
    oak = wood(rgb(0.25, 0.17, 0.12), seed=4)
    gilt = solid(rgb(0.42, 0.34, 0.20), gloss=0.55, rough=0.003)
    # back wall: double door in an arched casing
    r.flat(arch(-1.0, 1.0, -0.75, 1.6), D - 0.01, oak, bevel=6, bevel_h=0.03)
    r.flat([(-0.82, -0.62), (0, -0.62), (0, 1.6), (-0.82, 1.6)], D - 0.03, panels(rgb(0.22, 0.15, 0.11), pw=0.41, ph=0.55), bevel=2, bevel_h=0.006)
    r.flat([(0, -0.62), (0.82, -0.62), (0.82, 1.6), (0, 1.6)], D - 0.03, panels(rgb(0.22, 0.15, 0.11), pw=0.41, ph=0.55), bevel=2, bevel_h=0.006)
    for x in (-0.12, 0.12):
        r.cyl(x, 0.45, 0.6, D - 0.06, 0.018, iron())
    r.door([(-0.82, -0.62, D), (0.82, 1.6, D)], 'double')
    # portraits: gilt frames, dark canvas, a pale face
    for cx in (-2.15, 2.15):
        r.flat([(cx - 0.55, -1.35), (cx + 0.55, -1.35), (cx + 0.55, 0.05), (cx - 0.55, 0.05)], D - 0.02, gilt, bevel=5, bevel_h=0.03)
        r.flat([(cx - 0.42, -1.22), (cx + 0.42, -1.22), (cx + 0.42, -0.08), (cx - 0.42, -0.08)], D - 0.05, solid(rgb(0.11, 0.10, 0.09), gloss=0.5))
        face = [(cx + 0.16 * math.cos(a), -0.78 + 0.22 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 30)]
        r.flat(face, D - 0.055, solid(rgb(0.36, 0.33, 0.29), gloss=0.4), bevel=6, bevel_h=0.01)
        r.flat([(cx - 0.36, -0.08), (cx - 0.3, -0.4), (cx, -0.5), (cx + 0.3, -0.4), (cx + 0.36, -0.08)], D - 0.055, solid(rgb(0.07, 0.06, 0.06)))
    # wall sconces with candles
    for x in (-1.3, 1.3):
        r.flat([(x - 0.05, -0.45), (x + 0.05, -0.45), (x + 0.03, -0.2), (x - 0.03, -0.2)], D - 0.03, iron(), bevel=2, bevel_h=0.01)
        r.box(x - 0.09, x + 0.09, -0.47, -0.43, D - 0.25, D - 0.02, iron())
        r.candle(x, -0.47, D - 0.13, h=0.16)
    # right wall door
    r.side(hw - 0.005, [(4.6, -0.75), (5.7, -0.75), (5.7, 1.6), (4.6, 1.6)], oak, bevel=4, bevel_h=0.02)
    r.side(hw - 0.01, [(4.72, -0.62), (5.58, -0.62), (5.58, 1.6), (4.72, 1.6)], panels(rgb(0.21, 0.15, 0.11), pw=0.43, ph=0.55), bevel=2, bevel_h=0.006)
    r.door([(hw, -0.62, 4.72), (hw, 1.6, 5.58)], 'side')
    # grandfather clock, back right
    r.contact(2.75, 6.5, 0.5, 0.5)
    r.box(2.45, 3.05, -0.85, 1.6, 6.15, 6.65, wood(rgb(0.22, 0.15, 0.10), seed=8, gloss=0.45, vertical=True))
    r.flat([(2.75 + 0.2 * math.cos(a), -0.55 + 0.2 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 32)], 6.14, bone(rgb(0.55, 0.51, 0.43)), bevel=3, bevel_h=0.01)
    r.flat([(2.6, -0.1), (2.9, -0.1), (2.9, 1.0), (2.6, 1.0)], 6.14, solid(rgb(0.06, 0.06, 0.06), gloss=0.8))
    r.cyl(2.75, -0.05, 0.75, 6.16, 0.01, gilt)
    r.flat([(2.75 + 0.07 * math.cos(a), 0.8 + 0.07 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 20)], 6.13, gilt)
    # rug
    rug = fabric(rgb(0.24, 0.12, 0.10), rgb(0.36, 0.28, 0.18), border=((-1.3, 1.3), (3.0, 6.3)))
    r.ground([(-1.3, 3.0), (1.3, 3.0), (1.3, 6.3), (-1.3, 6.3)], EYE - 0.003, rug, bevel=2, bevel_h=0.003)
    # console table against the left wall, with a candle
    r.contact(-2.5, 4.9, 0.7, 0.8)
    for x, d in ((-3.0, 4.2), (-2.05, 4.2), (-3.0, 5.6), (-2.05, 5.6)):
        r.cyl(x + 0.04, 0.85, 1.6, d, 0.035, oak)
    r.box(-3.15, -1.95, 0.78, 0.86, 4.1, 5.7, oak, surface=True, bevel_h=0.006)
    r.candle(-2.35, 0.78, 4.4, h=0.22)
    # bench, right
    r.contact(2.3, 4.0, 0.8, 0.5)
    r.box(1.65, 2.95, 1.12, 1.2, 3.65, 4.35, oak, surface=True)
    r.box(1.7, 1.8, 1.2, 1.6, 3.7, 3.8, oak)
    r.box(2.8, 2.9, 1.2, 1.6, 3.7, 3.8, oak)
    # chandelier
    r.cyl(0, -1.9, -1.25, 4.6, 0.012, iron())
    r.flat([(-0.7, -1.2), (0.7, -1.2), (0.55, -1.12), (-0.55, -1.12)], 4.6, iron(), bevel=2, bevel_h=0.01)
    for x in (-0.6, -0.3, 0.3, 0.6):
        r.candle(x, -1.2, 4.6, h=0.14, r=0.02)
    r.floor_rows([(3.9, -1.0, 1.4), (4.8, -2.3, 2.0), (5.8, -1.6, 1.8), (6.9, -2.6, 1.9)])
    # foreground: a chair back, bottom right, and a cobweb in the top-left corner
    g = r.fgd
    g.polygon([(820, 540), (840, 420), (850, 330), (868, 300), (930, 290), (960, 296), (960, 540)], fill=(16, 14, 12, 255))
    g.polygon([(880, 340), (905, 336), (912, 470), (884, 474)], fill=(0, 0, 0, 0))
    r.web(0, 0, 160, 5, 85)
    return r


def attic():
    r = Room('attic', 2)
    hw, D, ceil = 3.0, 6.6, 1.05
    floor = planks(rgb(0.30, 0.25, 0.20), board=0.2, gloss=0.15, seed=2, worn=0.5)
    walls = swap(planks(rgb(0.27, 0.23, 0.19), board=0.18, length=6, gloss=0.08, seed=5, worn=0.4))
    r.shell(hw, D, ceil, floor, walls, walls, planks(rgb(0.22, 0.19, 0.16), board=0.2, seed=6, gloss=0.05), ao=0.7)
    beam = planks(rgb(0.24, 0.18, 0.13), board=0.3, length=8, seed=9, gloss=0.1)
    # A-frame braces and king post on the back wall
    r.flat([(-hw, 0.35), (-hw, 0.1), (-0.15, -ceil), (0.15, -ceil), (hw, 0.1), (hw, 0.35), (0.12, -0.8), (-0.12, -0.8)], D - 0.02, beam, bevel=4, bevel_h=0.04)
    # round window
    rr = 0.42
    r.flat([(0.0 + (rr + 0.08) * math.cos(a), -0.35 + (rr + 0.08) * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40)], D - 0.03, beam, bevel=5, bevel_h=0.03)
    r.flat([(rr * math.cos(a), -0.35 + rr * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40)], D - 0.04, glass(3))
    r.box(-0.03, 0.03, -0.35 - rr, -0.35 + rr, D - 0.06, D - 0.04, beam)
    r.box(-rr, rr, -0.38, -0.32, D - 0.06, D - 0.04, beam)
    # low door, back left
    r.flat([(-2.5, 0.05), (-1.6, 0.05), (-1.6, 1.6), (-2.5, 1.6)], D - 0.02, beam, bevel=3, bevel_h=0.02)
    r.flat([(-2.42, 0.13), (-1.68, 0.13), (-1.68, 1.6), (-2.42, 1.6)], D - 0.03, swap(planks(rgb(0.2, 0.16, 0.12), board=0.12, length=9, seed=12)), bevel=2, bevel_h=0.005)
    r.cyl(-1.78, 0.85, 0.95, D - 0.06, 0.02, iron())
    r.door([(-2.42, 0.13, D), (-1.68, 1.6, D)], 'single')
    # right wall door
    r.side(hw - 0.01, [(4.5, -0.2), (5.3, -0.2), (5.3, 1.6), (4.5, 1.6)], swap(planks(rgb(0.19, 0.15, 0.11), board=0.12, length=9, seed=13)), bevel=3, bevel_h=0.01)
    r.door([(hw, -0.2, 4.5), (hw, 1.6, 5.3)], 'side')
    # sheet-draped armchair, back left
    r.contact(-0.9, 5.9, 0.7, 0.4)
    sheet = [(-1.62, 1.6), (-1.66, 0.95), (-1.6, 0.62), (-1.5, 0.55), (-1.42, 0.2), (-1.32, -0.02), (-1.08, -0.1), (-0.78, -0.08), (-0.6, 0.0),
             (-0.52, 0.3), (-0.46, 0.55), (-0.32, 0.6), (-0.24, 0.9), (-0.2, 1.6), (-0.42, 1.52), (-0.66, 1.6), (-0.9, 1.5), (-1.15, 1.6), (-1.4, 1.52)]
    r.flat(sheet, 5.85, cloth(rgb(0.42, 0.40, 0.36), folds=9, depth=0.05), bevel=12, bevel_h=0.07)
    # steamer trunk, left
    r.contact(-1.8, 4.35, 0.8, 0.5)
    trunk = wood(rgb(0.23, 0.17, 0.12), seed=14, gloss=0.2)
    r.box(-2.5, -1.15, 0.95, 1.6, 4.0, 4.75, trunk, surface=True, bevel_h=0.008)
    for x in (-2.15, -1.5):
        r.box(x - 0.04, x + 0.04, 0.94, 1.6, 3.99, 4.0, iron())
    r.flat([(-1.88, 1.05), (-1.78, 1.05), (-1.78, 1.18), (-1.88, 1.18)], 3.985, iron())
    # crates, right
    crate = planks(rgb(0.33, 0.27, 0.19), board=0.11, seed=15, gloss=0.08)
    r.contact(1.85, 5.0, 0.7, 0.6)
    r.box(1.35, 2.35, 0.82, 1.6, 4.55, 5.4, crate, surface=True)
    r.box(1.55, 2.2, 0.32, 0.82, 4.75, 5.3, crate, surface=True)
    r.candle(2.05, 0.32, 4.95, h=0.15)
    # rocking chair
    rock = wood(rgb(0.21, 0.15, 0.11), seed=16, gloss=0.3, vertical=True)
    r.box(-0.75, -0.05, 1.12, 1.17, 3.85, 4.35, rock, surface=True)
    for x in (-0.72, -0.08):
        r.box(x - 0.025, x + 0.025, 0.25, 1.12, 4.3, 4.34, rock)
    for i in range(6):
        x = -0.66 + i * 0.11
        r.box(x - 0.012, x + 0.012, 0.32, 1.12, 4.31, 4.33, rock)
    r.box(-0.75, -0.05, 0.25, 0.32, 4.3, 4.35, rock)
    r.flat([(-0.85 + 0.9 * i / 20, 1.58 - 0.08 * math.sin(math.pi * i / 20)) for i in range(21)] + [(0.05, 1.6), (-0.85, 1.6)], 3.84, rock)
    # dress form, back right
    r.contact(0.75, 6.1, 0.35, 0.3)
    r.cyl(0.75, 1.0, 1.6, 6.1, 0.02, iron())
    r.cyl(0.75, -0.05, 0.6, 6.1, 0.24, cloth(rgb(0.30, 0.28, 0.25), folds=3, depth=0.004))
    r.cyl(0.75, 0.6, 1.0, 6.1, 0.03, iron())
    # shelf on the right wall with jars
    r.box(2.6, 2.99, 0.12, 0.17, 4.1, 5.0, beam, surface=False)
    for i, d in enumerate((4.2, 4.45, 4.8)):
        r.cyl(2.78, 0.12 - 0.12 - 0.04 * i, 0.12, d, 0.06, solid(rgb(0.30, 0.31, 0.26), gloss=0.7))
    # rafters
    for d in (2.4, 3.5, 4.6, 5.7):
        r.box(-hw, hw, -ceil, -ceil + 0.22, d - 0.1, d + 0.1, beam, bevel=2, bevel_h=0.01)
    r.floor_rows([(4.1, -0.9, 0.9), (5.0, -1.0, 1.1), (6.0, -1.6, 1.8)])
    g = r.fgd
    r.web(0, 0, 200, 5, 85, spokes=8, rings=7)
    r.web(960, 0, 150, 95, 175)
    g.line([(700, 0), (705, 150)], fill=(20, 18, 15, 255), width=3)
    g.ellipse([(694, 148), (716, 172)], fill=(20, 18, 15, 255))
    return r


def crypt():
    r = Room('crypt', 3)
    hw, D, ceil = 3.0, 8.0, 1.35
    stone = blocks(rgb(0.40, 0.39, 0.36), bw=0.5, bh=0.28)
    flags = blocks(rgb(0.34, 0.33, 0.31), bw=0.62, bh=0.62, mortar=0.012, bulge=0.006, seed=4, gloss=0.25)
    r.shell(hw, D, ceil, flags, stone, stone, blocks(rgb(0.30, 0.29, 0.27), bw=0.6, bh=0.35, seed=8), ao=0.7)
    dark = solid(rgb(0.05, 0.05, 0.05), gloss=0.0, rough=0.004)
    # back wall: arched door between rows of burial niches
    r.flat(arch(-0.75, 0.75, -0.25, 1.6), D - 0.01, blocks(rgb(0.36, 0.35, 0.32), bw=0.3, bh=0.2, seed=5), bevel=6, bevel_h=0.04)
    r.flat(arch(-0.6, 0.6, -0.15, 1.6), D - 0.03, swap(planks(rgb(0.19, 0.14, 0.10), board=0.15, length=9, seed=21)), bevel=2, bevel_h=0.006)
    for y in (0.2, 0.9):
        r.box(-0.6, 0.6, y - 0.03, y + 0.03, D - 0.05, D - 0.03, iron())
    r.door([(-0.6, -0.75, D), (0.6, 1.6, D)], 'single')
    skull = bone()
    for cx in (-2.1, -1.35, 1.35, 2.1):
        for y0, y1 in ((-0.85, -0.35), (-0.1, 0.4), (0.65, 1.15)):
            r.flat([(cx - 0.3, y0), (cx + 0.3, y0), (cx + 0.3, y1), (cx - 0.3, y1)], D - 0.0, dark)
            r.box(cx - 0.33, cx + 0.33, y1, y1 + 0.06, D - 0.35, D - 0.0, stone, surface=y1 > 0)
            if (int(cx * 10) + int(y0 * 10)) % 3 == 0:
                sx, sy = cx + 0.05, y1 - 0.12
                r.flat([(sx + 0.1 * math.cos(a), sy - 0.04 + 0.1 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 24)], D - 0.2, skull, bevel=5, bevel_h=0.02)
                for ex in (-0.04, 0.04):
                    r.flat([(sx + ex + 0.025 * math.cos(a), sy - 0.05 + 0.03 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 12)], D - 0.21, dark)
            elif (int(cx * 10) + int(y0 * 10)) % 3 == 1 and y1 > 0:
                r.candle(cx - 0.1, y1, D - 0.2, h=0.14)
    # vault ribs and wall pillars
    rib = blocks(rgb(0.38, 0.37, 0.34), bw=0.35, bh=0.25, seed=6)
    for d in (3.4, 5.2, 7.0):
        outer = [(-hw * math.cos(t), -0.35 - (ceil - 0.35) * math.sin(t)) for t in np.linspace(0, math.pi, 30)]
        inner = [(-(hw - 0.35) * math.cos(t), -0.35 - (ceil - 0.6) * math.sin(t)) for t in np.linspace(math.pi, 0, 30)]
        r.flat(outer + inner, d, rib, bevel=5, bevel_h=0.04)
        for x0, x1 in ((-hw, -hw + 0.38), (hw - 0.38, hw)):
            r.box(x0, x1, -0.35, 1.6, d - 0.2, d + 0.2, rib, bevel=3, bevel_h=0.02)
    # sarcophagi
    for x0, x1 in ((-2.25, -0.95), (0.95, 2.25)):
        r.contact((x0 + x1) / 2, 5.3, 0.9, 1.2, 0.7)
        r.box(x0, x1, 0.82, 1.6, 4.4, 6.2, blocks(rgb(0.42, 0.41, 0.38), bw=0.9, bh=0.8, seed=7, mortar=0.004), bevel=3, bevel_h=0.02)
        r.box(x0 - 0.08, x1 + 0.08, 0.7, 0.82, 4.32, 6.28, solid(rgb(0.45, 0.44, 0.41), gloss=0.2, rough=0.004), surface=True, bevel=3, bevel_h=0.02)
        cx = (x0 + x1) / 2
        r.flat([(cx - 0.05, 0.92), (cx + 0.05, 0.92), (cx + 0.05, 1.45), (cx - 0.05, 1.45)], 4.39, solid(rgb(0.40, 0.39, 0.36)), bevel=2, bevel_h=0.012)
        r.flat([(cx - 0.2, 1.05), (cx + 0.2, 1.05), (cx + 0.2, 1.13), (cx - 0.2, 1.13)], 4.388, solid(rgb(0.40, 0.39, 0.36)), bevel=2, bevel_h=0.012)
    r.candle(-1.25, 0.7, 4.6, h=0.2)
    # iron gate on the right wall
    r.side(hw - 0.005, [(5.6, -0.4), (6.5, -0.4), (6.5, 1.6), (5.6, 1.6)], dark)
    for i in range(9):
        d = 5.62 + i * 0.105
        r.side(hw - 0.03, [(d, -0.4), (d + 0.025, -0.4), (d + 0.025, 1.6), (d, 1.6)], iron(), bevel=1, bevel_h=0.004)
    r.side(hw - 0.035, [(5.6, -0.3), (6.5, -0.3), (6.5, -0.24), (5.6, -0.24)], iron())
    r.side(hw - 0.035, [(5.6, 0.6), (6.5, 0.6), (6.5, 0.66), (5.6, 0.66)], iron())
    r.door([(hw, -0.4, 5.6), (hw, 1.6, 6.5)], 'gate')
    r.floor_rows([(3.8, -0.8, 0.8), (4.6, -0.7, 0.7), (6.6, -2.2, 2.2), (7.4, -2.5, 2.5)])
    g = r.fgd
    for i in range(14):
        y = i * 13
        g.ellipse([(60 - 5, y), (60 + 5, y + 14)], outline=(22, 20, 18, 255), width=3)
    r.web(960, 0, 180, 95, 175, spokes=8)
    return r


def swamp():
    r = Room('swamp', 4)
    D = 16.0
    # fog and the black sky beyond
    def sky(u, v):
        n1 = NZ.fbm(u * 0.15, v * 0.4, 4)
        k = 0.05 + 0.06 * n1 * smooth(-6, 1, v)
        return np.repeat(k[..., None], 3, -1) * np.array([1, 1, 0.95], f32), 0.0, 0.0
    r.plane([(-40, -30, D), (40, -30, D), (40, EYE, D), (-40, EYE, D)], (0, 0, -1), (0, 0, D), (1, 0, 0), (0, 1, 0), sky)
    r.plane([(-30, EYE, 0.9), (30, EYE, 0.9), (30, EYE, D), (-30, EYE, D)], (0, -1, 0), (0, EYE, 0), (1, 0, 0), (0, 0, 1), water())
    # far tree line silhouettes
    for i in range(14):
        x = -14 + i * 2.1 + h1(i) * 1.2
        hgt = 3 + h1(i + 30) * 3
        r.flat([(x - 0.15, EYE), (x - 0.05, EYE - hgt), (x + 0.05, EYE - hgt), (x + 0.15, EYE)], 14.5, solid(rgb(0.07, 0.07, 0.065), gloss=0, rough=0.01))
    # muddy banks
    def bank(side):
        pts = []
        for i in range(40):
            d = 2.5 + i * 0.35
            edge = side * (2.0 + 0.6 * math.sin(i * 0.7) + 0.4 * h1(i + side * 5))
            pts.append((edge, d))
        far = side * 30
        return [(far, 2.5)] + pts + [(far, 16)]
    r.ground(bank(-1), EYE - 0.04, mud(), bevel=8, bevel_h=0.05)
    r.ground(bank(1), EYE - 0.04, mud(), bevel=8, bevel_h=0.05)
    # dead trees with hanging moss
    def tree(x, d, hgt, lean, seed):
        rs = np.random.RandomState(seed)
        trunk = [(x - 0.28, EYE), (x - 0.18 + lean * 0.5, EYE - hgt * 0.5), (x - 0.08 + lean, EYE - hgt), (x + 0.08 + lean, EYE - hgt), (x + 0.2 + lean * 0.5, EYE - hgt * 0.5), (x + 0.3, EYE)]
        r.flat(trunk, d, bark(), bevel=6, bevel_h=0.08)
        for k in range(5):
            by = EYE - hgt * (0.45 + 0.1 * k)
            bx = x + lean * (0.45 + 0.1 * k)
            s = 1 if k % 2 else -1
            L = 1.0 + rs.rand() * 1.2
            tip = (bx + s * L, by - 0.5 - rs.rand() * 0.7)
            r.flat([(bx, by + 0.06), (bx, by - 0.06), (tip[0], tip[1] - 0.02), (tip[0], tip[1] + 0.02)], d - 0.05, bark(), bevel=3, bevel_h=0.02)
            for m in range(4):
                mx = bx + s * L * (0.25 + 0.2 * m)
                my = by - (tip[1] - by) * -(0.25 + 0.2 * m)
                ml = 0.5 + rs.rand() * 0.9
                seg = 10
                left = [(mx - 0.02 + 0.05 * math.sin(i * 0.9 + m), my + ml * i / seg) for i in range(seg + 1)]
                right = [(x + 0.03 * (1 - i / seg), y) for i, (x, y) in enumerate(left)][::-1]
                r.flat(left + right, d - 0.08, solid(rgb(0.13, 0.14, 0.11), rough=0.004))
    tree(-3.4, 7.5, 6.5, 0.6, 1)
    tree(3.6, 9.5, 7.0, -0.8, 2)
    tree(-1.2, 12.5, 5.0, 0.3, 3)
    # shack on the right with a door
    shack = swap(planks(rgb(0.24, 0.21, 0.17), board=0.17, length=8, seed=31, worn=0.6))
    r.contact(3.0, 6.6, 1.4, 0.5)
    r.flat([(1.9, 1.5), (1.9, -0.55), (2.95, -1.25), (4.0, -0.55), (4.0, 1.5)], 6.6, shack, bevel=3, bevel_h=0.01)
    r.flat([(1.75, -0.5), (2.95, -1.35), (4.15, -0.5), (4.15, -0.4), (2.95, -1.22), (1.75, -0.4)], 6.55, planks(rgb(0.17, 0.15, 0.13), board=0.1, seed=32), bevel=2, bevel_h=0.01)
    r.flat([(2.45, 0.0), (3.1, 0.0), (3.1, 1.5), (2.45, 1.5)], 6.58, planks(rgb(0.18, 0.15, 0.12), board=0.13, seed=33), bevel=2, bevel_h=0.008)
    r.door([(2.45, 0.0, 6.6), (3.1, 1.5, 6.6)], 'single')
    r.flat([(3.35, -0.3), (3.8, -0.3), (3.8, 0.2), (3.35, 0.2)], 6.58, glass(5), bevel=2, bevel_h=0.01)
    for x in (2.0, 3.9):
        r.cyl(x, 1.5, 1.62, 6.55, 0.06, bark())
    # boardwalk
    deck = planks(rgb(0.27, 0.23, 0.18), board=0.18, length=2.2, seed=34, worn=0.7, gloss=0.2)
    for d in np.arange(4.0, 12.0, 1.4):
        r.cyl(-0.85, 1.38, 1.62, d + 0.05, 0.06, bark())
        r.cyl(0.85, 1.38, 1.62, d + 0.05, 0.06, bark())
    r.box(-0.9, 0.9, 1.3, 1.38, 3.2, 12.0, swap(deck), surface=False, bevel_h=0.004)
    r.floor_rows([])
    for d in (4.0, 5.2, 6.8, 8.6):
        r.surface(-0.7, 0.7, 1.3, d)
    # archway at the end of the boardwalk
    r.cyl(-0.8, -0.5, 1.4, 11.8, 0.09, bark())
    r.cyl(0.8, -0.5, 1.4, 11.8, 0.09, bark())
    r.flat([(-1.05, -0.62), (1.05, -0.62), (1.05, -0.48), (-1.05, -0.48)], 11.78, bark(), bevel=2, bevel_h=0.01)
    r.door([(-0.7, -0.45, 11.8), (0.7, 1.35, 11.8)], 'gate')
    # lantern post
    r.cyl(0.75, -0.25, 1.3, 7.5, 0.04, bark())
    r.box(0.62, 0.88, -0.35, -0.2, 7.4, 7.6, iron())
    r.candle(0.75, -0.06, 7.45, h=0.12)
    # half-sunk rowboat, left, and a stump
    hull = [(-3.0 + 1.6 * i / 20, 1.45 + 0.22 * math.sin(math.pi * i / 20)) for i in range(21)]
    r.flat([(-3.05, 1.3)] + hull + [(-1.35, 1.3)], 4.9, swap(planks(rgb(0.22, 0.19, 0.15), board=0.08, length=9, seed=35, worn=0.5)), bevel=4, bevel_h=0.03)
    r.box(-2.75, -1.65, 1.26, 1.3, 4.7, 5.0, deck, surface=True)
    r.box(-2.1, -1.5, 1.2, 1.6, 6.0, 6.5, bark(), surface=True)
    g = r.fgd
    rs = np.random.RandomState(5)
    for i in range(70):
        side = -1 if i < 35 else 1
        bx = (rs.rand() * 230) if side < 0 else (960 - rs.rand() * 230)
        top = 330 + rs.rand() * 140
        lean = (rs.rand() - 0.5) * 60
        g.line([(bx, 540), (bx + lean * 0.5, (540 + top) / 2), (bx + lean, top)], fill=(14, 13, 11, 255), width=2 + int(rs.rand() * 2))
        if rs.rand() < 0.25:
            g.ellipse([(bx + lean - 4, top - 10), (bx + lean + 4, top + 16)], fill=(14, 13, 11, 255))
    g.line([(960, 30), (820, 60), (700, 40), (640, 80)], fill=(14, 13, 11, 255), width=9)
    g.line([(820, 60), (790, 120)], fill=(14, 13, 11, 255), width=5)
    return r


def chapel():
    r = Room('chapel', 5)
    hw, D, ceil = 3.4, 9.0, 2.5
    tiles = blocks(rgb(0.36, 0.34, 0.31), bw=0.5, bh=0.5, mortar=0.006, bulge=0.003, seed=2, gloss=0.35, var=0.6)
    walls = plaster(rgb(0.40, 0.38, 0.34), stains=0.6)
    r.shell(hw, D, ceil, tiles, walls, walls, planks(rgb(0.19, 0.15, 0.12), board=0.22, seed=41), ao=0.65)
    stone = blocks(rgb(0.42, 0.40, 0.37), bw=0.4, bh=0.3, seed=3)
    # great window over the altar
    r.flat(pointed_arch(-1.15, 1.15, -1.0, 0.0), D - 0.01, stone, bevel=6, bevel_h=0.05)
    r.flat(pointed_arch(-0.95, 0.95, -1.0, -0.15), D - 0.03, glass(1))
    for x in (-0.32, 0.32):
        r.box(x - 0.025, x + 0.025, -2.0, -0.15, D - 0.06, D - 0.04, stone)
    # pilasters and side windows
    for d in (4.2, 6.0, 7.8):
        r.box(-hw, -hw + 0.25, -ceil, 1.6, d - 0.18, d + 0.18, stone, bevel=3, bevel_h=0.02)
        r.box(hw - 0.25, hw, -ceil, 1.6, d - 0.18, d + 0.18, stone, bevel=3, bevel_h=0.02)
    for d0 in (6.3, 4.6):
        r.side(-hw + 0.005, pointed_arch(d0, d0 + 1.2, -0.9, 0.3), stone, bevel=4, bevel_h=0.03)
        r.side(-hw + 0.01, pointed_arch(d0 + 0.12, d0 + 1.08, -0.9, 0.2), glass(7))
        r.side(hw - 0.005, pointed_arch(d0, d0 + 1.2, -0.9, 0.3), stone, bevel=4, bevel_h=0.03)
        r.side(hw - 0.01, pointed_arch(d0 + 0.12, d0 + 1.08, -0.9, 0.2), glass(9))
    # altar on a step, with cloth and candlesticks
    r.box(-2.2, 2.2, 1.42, 1.6, 7.7, 9.0, blocks(rgb(0.38, 0.36, 0.33), bw=0.8, bh=0.2, seed=9), surface=True)
    r.contact(0, 8.3, 1.4, 0.5)
    r.box(-1.15, 1.15, 0.62, 1.42, 8.0, 8.6, stone, surface=True)
    r.flat([(-1.0, 0.64), (1.0, 0.64), (0.95, 1.25), (-0.95, 1.25)], 7.99, cloth(rgb(0.56, 0.52, 0.46), folds=14, depth=0.008), bevel=3, bevel_h=0.01)
    r.flat([(-0.18, 0.75), (0.18, 0.75), (0.18, 1.18), (-0.18, 1.18)], 7.985, fabric(rgb(0.30, 0.16, 0.13), rgb(0.42, 0.33, 0.22), scale=0.05))
    gilt = solid(rgb(0.40, 0.33, 0.20), gloss=0.6, rough=0.003)
    for x in (-0.85, 0.85):
        r.cyl(x, 0.2, 0.62, 8.2, 0.035, gilt)
        r.flat([(x - 0.1, 0.62), (x + 0.1, 0.62), (x + 0.05, 0.56), (x - 0.05, 0.56)], 8.19, gilt)
        r.candle(x, 0.2, 8.18, h=0.24, r=0.03)
    # organ pipes, back right
    for i in range(9):
        x = 2.25 + i * 0.12
        top = -2.1 + abs(i - 4) * 0.22
        r.cyl(x, top, 1.0, 8.7, 0.05, gilt)
    r.box(2.15, 3.35, 0.4, 1.6, 8.4, 8.95, wood(rgb(0.2, 0.15, 0.11), seed=42), surface=True)
    # back-left door
    r.flat(pointed_arch(-2.95, -2.05, -0.2, 1.6), D - 0.01, stone, bevel=4, bevel_h=0.03)
    r.flat(pointed_arch(-2.85, -2.15, -0.15, 1.6), D - 0.02, swap(planks(rgb(0.19, 0.14, 0.10), board=0.12, length=9, seed=43)), bevel=2, bevel_h=0.006)
    r.door([(-2.85, -0.75, D), (-2.15, 1.6, D)], 'single')
    # pews
    pew = wood(rgb(0.24, 0.17, 0.12), seed=44, gloss=0.45)
    for d in (6.9, 5.9, 4.9, 3.9):
        for x0, x1 in ((-3.1, -0.65), (0.65, 3.1)):
            r.contact((x0 + x1) / 2, d + 0.2, 1.2, 0.35, 0.5)
            r.box(x0, x1, 0.65, 1.12, d + 0.4, d + 0.47, pew, surface=True, bevel_h=0.004)
            r.box(x0, x1, 1.12, 1.2, d, d + 0.47, pew, bevel_h=0.004)
            for xe in (x0, x1 - 0.06):
                r.box(xe, xe + 0.06, 0.6, 1.6, d - 0.02, d + 0.5, pew, bevel_h=0.006)
    # pulpit, right
    r.contact(2.3, 5.5, 0.6, 0.5)
    r.box(1.95, 2.7, 0.3, 1.6, 5.2, 5.75, panels(rgb(0.23, 0.16, 0.11), pw=0.37, ph=0.42), surface=True)
    r.floor_rows([(4.55, -0.55, 0.55), (5.5, -0.5, 0.5), (7.45, -1.8, 1.8)])
    g = r.fgd
    g.polygon([(0, 540), (0, 380), (40, 360), (110, 372), (150, 400), (160, 540)], fill=(15, 13, 11, 255))
    g.ellipse([(40, 368), (110, 410)], fill=(0, 0, 0, 0))
    g.line([(880, 0), (884, 120)], fill=(18, 16, 14, 255), width=2)
    g.polygon([(866, 120), (902, 120), (896, 150), (872, 150)], fill=(18, 16, 14, 255))
    return r


ROOMS = {'hall': hall, 'attic': attic, 'crypt': crypt, 'swamp': swamp, 'chapel': chapel}
ORDER = ['hall', 'attic', 'crypt', 'swamp', 'chapel']


def main(argv):
    preview = None
    if '--preview' in argv:
        i = argv.index('--preview')
        preview = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
        os.makedirs(preview, exist_ok=True)
    names = [a for a in argv if a in ROOMS] or ORDER
    meta_path = os.path.join(OUT, 'rooms.json')
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as fh:
            meta = {r['id']: r for r in json.load(fh)['rooms']}
    for name in names:
        print(f'painting {name}…', flush=True)
        room = ROOMS[name]()
        room.finish()
        info = room.save()
        meta[name] = dict(id=name, **info)
        print(f'  {len(info["surfaces"])} surfaces, {len(info["doors"])} doors, {len(info["candles"])} candles')
        if preview:
            room.preview(os.path.join(preview, f'{name}.jpg'), [(700, 640), (1350, 520), (960, 820)])
    os.makedirs(OUT, exist_ok=True)
    with open(meta_path, 'w') as fh:
        json.dump({'width': W, 'height': H, 'rooms': [meta[n] for n in ORDER if n in meta]}, fh, indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
