#!/usr/bin/env python3
"""Turn the team's room paintings and character images into the files the game loads.

usage: python3 tools/build_rooms.py RAW_DIR

RAW_DIR holds room-<name>.png (2560x1440, one-point perspective, evenly lit) and the
char-*.png / zombie-*.png sprites (transparent). For each room this writes, under public/rooms/<id>/:
  albedo.jpg  the painting (2560x1440)
  normal.jpg  view-space normals (1920x1080): the room's box from its back wall, bent by the
              painting's brightness so plaster, wood and carving catch the lantern
  data.png    R = nearness (from the box), G = gloss (gilt catches light)
  fg.png      an empty foreground layer
and public/rooms/rooms.json with every room's doors, hiding places, floor, candles and the
spots where its resident stands. Sprites go to public/sprites/ as WebP.

All coordinates below are fractions of the painting (u right, v down).
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFile, ImageFilter

ImageFile.LOAD_TRUNCATED_IMAGES = True

W, H = 1920, 1080  # the lighting maps
AW, AH = 2560, 1440  # the painting itself, kept sharp for laptop screens
F, CX, CY, ZN, ZF, EYE = 1280.0, 960.0, 500.0, 0.8, 16.0, 1.6  # must match public/room.js
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'public', 'rooms')
SPRITES = os.path.join(ROOT, 'public', 'sprites')


def C(name, x1, y1, x2, y2):
    """A hiding place: something you can open."""
    return {'name': name, 'x': x1, 'y': y1, 'w': round(x2 - x1, 4), 'h': round(y2 - y1, 4)}


def D(x1, y1, x2, y2, kind):
    return {'x': x1, 'y': y1, 'w': round(x2 - x1, 4), 'h': round(y2 - y1, 4), 'kind': kind}


# The standard room: back wall from 18% to 82% across, ceiling at 13%, floor line at 66%.
STD = (0.18, 0.13, 0.82, 0.665)
# Where souls rest and things walk: lines across the floor (v, x from, x to).
FLOOR = [(0.72, 0.1, 0.9), (0.8, 0.06, 0.94), (0.88, 0.05, 0.95)]

ROOMS = [
    dict(id='hall', wall=STD, door=D(0.905, 0.2, 0.99, 0.73, 'side'),
         hide=[C('the chest', 0.7, 0.53, 0.81, 0.65), C('the clock', 0.12, 0.22, 0.18, 0.64),
               C('the side table', 0.2, 0.53, 0.29, 0.65), C('the sofa', 0.0, 0.52, 0.16, 0.72),
               C('the stairs', 0.4, 0.4, 0.6, 0.66)],
         spots={'phone': [0.845, 0.5, 0.04, 0.065]}),
    dict(id='drawing', wall=STD, door=D(0.11, 0.21, 0.175, 0.68, 'left'),
         hide=[C('the bookcase', 0.2, 0.2, 0.35, 0.66), C('the fireplace', 0.4, 0.43, 0.6, 0.66),
               C('the sofa', 0.63, 0.5, 0.83, 0.65), C('the china cabinet', 0.915, 0.2, 1.0, 0.75),
               C('the armchair', 0.17, 0.5, 0.27, 0.69), C('the console table', 0.0, 0.55, 0.12, 0.75)]),
    dict(id='parlour', wall=STD, door=D(0.01, 0.12, 0.1, 0.73, 'left'),
         hide=[C('the sideboard', 0.16, 0.5, 0.3, 0.67), C('the cabinet', 0.42, 0.545, 0.575, 0.67),
               C('the bookcase', 0.785, 0.23, 0.905, 0.69), C('the armchair', 0.31, 0.49, 0.41, 0.69),
               C('the other armchair', 0.585, 0.49, 0.685, 0.69), C('the side table', 0.885, 0.55, 0.985, 0.75)],
         spots={'tv': [0.455, 0.44, 0.09, 0.105]}),
    dict(id='kitchen', wall=STD, door=D(0.885, 0.17, 0.975, 0.72, 'side'),
         hide=[C('the pantry', 0.02, 0.2, 0.165, 0.73), C("the butcher's block", 0.21, 0.51, 0.345, 0.67),
               C('the oven', 0.42, 0.51, 0.59, 0.67), C('the sink', 0.655, 0.47, 0.81, 0.67)],
         spots={'home': [0.7, 0.7]}),
    dict(id='chapel', wall=(0.18, 0.13, 0.82, 0.66), door=D(0.905, 0.19, 0.985, 0.73, 'side'),
         hide=[C('the confessional', 0.18, 0.2, 0.335, 0.66), C('the altar', 0.4, 0.49, 0.6, 0.66),
               C('the pews', 0.0, 0.53, 0.25, 0.78), C('the other pews', 0.66, 0.54, 0.91, 0.77),
               C('the statue', 0.7, 0.22, 0.77, 0.5)],
         candles=[(0.425, 0.445), (0.443, 0.445), (0.463, 0.445), (0.532, 0.445), (0.553, 0.445), (0.57, 0.445)],
         spots={'frame': [0.44, 0.15, 0.115, 0.25], 'home': [0.5, 0.72]}),
    dict(id='nursery', wall=STD, door=D(0.905, 0.17, 0.99, 0.74, 'side'),
         hide=[C('the toy chest', 0.0, 0.58, 0.13, 0.73), C('the doll shelf', 0.0, 0.16, 0.11, 0.57),
               C('the cot', 0.14, 0.45, 0.35, 0.68), C('the wardrobe', 0.665, 0.3, 0.765, 0.66),
               C('the fireplace', 0.4, 0.43, 0.6, 0.66)],
         spots={'doll': [[0.83, 0.64], [0.25, 0.64], [0.645, 0.7], [0.5, 0.76], [0.5, 0.86]]}),
    dict(id='bedroom', wall=STD, door=D(0.02, 0.12, 0.12, 0.73, 'left'),
         hide=[C('the dressing table', 0.2, 0.36, 0.34, 0.66), C('the bed', 0.38, 0.4, 0.62, 0.57),
               C('the blanket chest', 0.42, 0.57, 0.58, 0.69), C('the wardrobe', 0.68, 0.24, 0.82, 0.65)]),
    dict(id='cellar', wall=(0.18, 0.13, 0.82, 0.655), door=D(0.01, 0.13, 0.13, 0.73, 'left'),
         hide=[C('the wine rack', 0.19, 0.2, 0.29, 0.65), C('the barrels', 0.72, 0.41, 0.85, 0.66),
               C('the wine niche', 0.42, 0.39, 0.57, 0.64), C('the bottle crate', 0.12, 0.51, 0.2, 0.67),
               C('the tall rack', 0.85, 0.2, 0.92, 0.68), C('the crate', 0.28, 0.51, 0.34, 0.65)],
         spots={'drain': [0.485, 0.83], 'home': [0.62, 0.74]}),
    dict(id='attic', wall=(0.25, 0.25, 0.75, 0.635), door=D(0.9, 0.29, 0.975, 0.7, 'side'),
         hide=[C('the trunks', 0.08, 0.5, 0.22, 0.7), C('the covered chair', 0.0, 0.42, 0.13, 0.75),
               C('the trunk', 0.41, 0.5, 0.53, 0.64), C('the dust sheet', 0.53, 0.5, 0.61, 0.64),
               C('the crates', 0.655, 0.42, 0.75, 0.65), C('the mannequin', 0.27, 0.4, 0.32, 0.63)]),
    dict(id='boiler', wall=(0.18, 0.13, 0.82, 0.67), door=D(0.905, 0.2, 0.99, 0.75, 'side'),
         hide=[C('the lockers', 0.165, 0.35, 0.33, 0.67), C('the furnace', 0.4, 0.4, 0.6, 0.67),
               C('the toolbox', 0.7, 0.36, 0.82, 0.67), C('the workbench', 0.0, 0.54, 0.17, 0.8)],
         spots={'home': [0.5, 0.72]}),
    dict(id='crypt', wall=(0.2, 0.12, 0.8, 0.655), door=D(0.04, 0.13, 0.13, 0.74, 'gate'),
         hide=[C('the small tomb', 0.17, 0.52, 0.275, 0.69), C('the sarcophagus', 0.385, 0.46, 0.62, 0.66),
               C('the big tomb', 0.75, 0.47, 0.99, 0.76), C('the urn', 0.28, 0.33, 0.35, 0.52),
               C('the other urn', 0.66, 0.33, 0.73, 0.52)]),
    dict(id='lake', wall=(0.24, -2.0, 1.5, 0.47), outdoor=True, door=D(0.05, 0.08, 0.15, 0.77, 'left'),
         hide=[C('the barrel', 0.21, 0.53, 0.27, 0.69), C('the boat', 0.66, 0.58, 0.87, 0.82),
               C('the fishing net', 0.17, 0.24, 0.21, 0.65), C('the reeds', 0.23, 0.36, 0.38, 0.68),
               C('the far reeds', 0.87, 0.36, 1.0, 0.8)],
         floor=[(0.66, 0.42, 0.62), (0.76, 0.37, 0.68), (0.86, 0.32, 0.72), (0.76, 0.03, 0.3)],
         spots={'rise': [0.52, 0.62]}),
]


def scale_at(v):
    """How big something standing at height v looks, relative to v = 0.85."""
    return round(max(0.25, (v * H - CY) / (0.85 * H - CY)), 3)


def build_room(r, raw):
    src = os.path.join(raw, 'room-%s.png' % ('drawing-room' if r['id'] == 'drawing' else r['id']))
    im = Image.open(src).convert('RGB')
    albedo = im.resize((AW, AH), Image.LANCZOS)
    im = im.resize((W, H), Image.LANCZOS)
    x0, y0, x1, y1 = r['wall']
    x0, x1, y0, y1 = x0 * W, x1 * W, y0 * H, y1 * H

    # depth from the box: the first plane a ray through the vanishing point meets
    xs, ys = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    Zb = F * EYE / (y1 - CY)
    big = 1e9
    with np.errstate(divide='ignore', invalid='ignore'):
        cand = np.stack([
            np.ones_like(xs),
            np.where(xs > CX, (x1 - CX) / (xs - CX), big),  # right wall
            np.where(xs < CX, (CX - x0) / (CX - xs), big),  # left wall
            np.where(ys > CY, (y1 - CY) / (ys - CY), big),  # floor
            np.where(ys < CY, (CY - y0) / (CY - ys), big),  # ceiling
        ])
    which = cand.argmin(0)
    Z = np.clip(cand.min(0) * Zb, ZN, ZF)
    if r.get('outdoor'):
        Z = np.where(which == 0, ZF, Z)  # the far shore and the sky are just far away

    # normals: the plane each pixel sits on, bent by the painting's brightness as height
    plane_n = np.array([[0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0]], np.float32)
    tx = np.array([[1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [1, 0, 0]], np.float32)[which]
    ty = np.array([[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]], np.float32)[which]
    lum = im.convert('L').filter(ImageFilter.GaussianBlur(1.6))
    h = np.asarray(lum, np.float32) / 255
    gy, gx = np.gradient(h)
    k = 13.0
    n = plane_n[which] - (gx * k)[..., None] * tx - (gy * k)[..., None] * ty
    n /= np.linalg.norm(n, axis=-1, keepdims=True)

    hsv = np.asarray(im.convert('HSV'), np.float32) / 255
    gilt = (hsv[..., 0] > 0.08) & (hsv[..., 0] < 0.18)
    gloss = np.clip(0.08 + 0.7 * hsv[..., 1] * np.clip((hsv[..., 2] - 0.35) * 2, 0, 1) * gilt, 0, 1)
    near = (1 / Z - 1 / ZF) / (1 / ZN - 1 / ZF)
    data = np.zeros((H, W, 4), np.uint8)
    data[..., 0] = (np.clip(near, 0, 1) * 255 + 0.5).astype(np.uint8)
    data[..., 1] = (gloss * 255).astype(np.uint8)
    data[..., 3] = 255

    d = os.path.join(OUT, r['id'])
    os.makedirs(d, exist_ok=True)
    albedo.save(os.path.join(d, 'albedo.jpg'), quality=84, subsampling=0, optimize=True, progressive=True)
    Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(os.path.join(d, 'normal.jpg'), quality=86, optimize=True)
    Image.fromarray(data, 'RGBA').save(os.path.join(d, 'data.png'), optimize=True)
    Image.new('RGBA', (480, 270), (0, 0, 0, 0)).save(os.path.join(d, 'fg.png'))

    floor = r.get('floor', FLOOR)
    return {
        'id': r['id'],
        'doors': [r['door']],
        'containers': r['hide'],
        'surfaces': [{'x1': a, 'x2': b, 'y': v, 's': scale_at(v)} for v, a, b in floor],
        'candles': [{'x': x, 'y': y, 's': 0.5} for x, y in r.get('candles', [])],
        'spots': r.get('spots', {}),
    }


def build_sprites(raw):
    os.makedirs(SPRITES, exist_ok=True)
    for f in sorted(os.listdir(raw)):
        if not f.endswith('.png') or f.startswith('room-'):
            continue
        im = Image.open(os.path.join(raw, f)).convert('RGBA')
        im.load()
        bbox = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
        if bbox:
            pad = 8
            im = im.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad)))
        name = f[:-4].replace('char-', '')
        # close-ups fill the screen; full figures are drawn at most a few hundred px tall
        target = 1100 if name.endswith('-scare') else 900
        if im.height > target:
            im = im.resize((round(im.width * target / im.height), target), Image.LANCZOS)
        im.save(os.path.join(SPRITES, name + '.webp'), quality=82, method=6)
        print('sprite', name, im.size)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    raw = sys.argv[1]
    meta = {'width': W, 'height': H, 'rooms': []}
    for r in ROOMS:
        meta['rooms'].append(build_room(r, raw))
        print('room', r['id'])
    with open(os.path.join(OUT, 'rooms.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    build_sprites(raw)


if __name__ == '__main__':
    main()
