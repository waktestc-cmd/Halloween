#!/usr/bin/env python3
"""Turn the team's room paintings and character images into the files the game loads.

usage: python3 tools/build_rooms.py RAW_DIR      (everything)
       python3 tools/build_rooms.py --meta       (only rooms.json, after editing ROOMS below)
       python3 tools/build_rooms.py --sprites DIR (only sprites: char-*, zombie-*, player-*)

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


def C(do, where, x1, y1, x2, y2):
    """A hiding place. do: what the lantern offers ("Look under the stairs"); where: where a find
    was ("under the stairs")."""
    return {'do': do, 'where': where, 'x': x1, 'y': y1, 'w': round(x2 - x1, 4), 'h': round(y2 - y1, 4)}


def D(back, front, kind='door'):
    """A door seen in perspective. back/front: (x, top, bottom) of its two upright edges. Light leaks
    through the gap at the back edge, the latch side in every painting."""
    (xb, tb, bb), (xf, tf, bf) = back, front
    x1, x2 = min(xb, xf), max(xb, xf)
    y1, y2 = min(tb, tf), max(bb, bf)
    return {'x': x1, 'y': y1, 'w': round(x2 - x1, 4), 'h': round(y2 - y1, 4), 'kind': kind,
            'q': [[xb, tb], [xf, tf], [xf, bf], [xb, bb]]}


# The standard room: back wall from 18% to 82% across, ceiling at 13%, floor line at 66%.
STD = (0.18, 0.13, 0.82, 0.665)
# Where souls rest and things walk: lines across the floor (v, x from, x to).
FLOOR = [(0.72, 0.1, 0.9), (0.8, 0.06, 0.94), (0.88, 0.05, 0.95)]

ROOMS = [
    dict(id='hall', wall=STD, door=D((0.917, 0.285, 0.7), (0.985, 0.27, 0.735)),
         hide=[C('Open the chest', 'in the chest', 0.7, 0.53, 0.81, 0.65),
               C('Look inside the clock', 'inside the clock', 0.12, 0.22, 0.18, 0.64),
               C('Look under the side table', 'under the side table', 0.2, 0.53, 0.29, 0.65),
               C('Search the sofa', 'in the sofa', 0.0, 0.52, 0.16, 0.72),
               C('Look under the stairs', 'under the stairs', 0.4, 0.4, 0.6, 0.66)],
         # the telephone, and where Ghostface stands while it rings
         spots={'phone': [0.845, 0.5, 0.04, 0.065], 'stand': [0.3, 0.71]}),
    dict(id='drawing', wall=STD, door=D((0.165, 0.3, 0.66), (0.115, 0.27, 0.69)),
         hide=[C('Search the bookcase', 'in the bookcase', 0.2, 0.2, 0.35, 0.66),
               C('Look in the fireplace', 'in the fireplace', 0.4, 0.43, 0.6, 0.66),
               C('Search the sofa', 'in the sofa', 0.63, 0.5, 0.83, 0.65),
               C('Open the china cabinet', 'in the china cabinet', 0.915, 0.2, 1.0, 0.75),
               C('Search the armchair', 'in the armchair', 0.17, 0.5, 0.27, 0.69),
               C('Open the console drawer', 'in the console drawer', 0.0, 0.55, 0.12, 0.75)],
         # Valak lives in the painting above the fireplace
         spots={'frame': [0.44, 0.15, 0.12, 0.25], 'home': [0.5, 0.72]}),
    dict(id='parlour', wall=STD, door=D((0.085, 0.19, 0.69), (0.015, 0.15, 0.72)),
         hide=[C('Open the sideboard', 'in the sideboard', 0.16, 0.5, 0.3, 0.67),
               C('Open the cabinet', 'in the cabinet', 0.42, 0.545, 0.575, 0.67),
               C('Search the bookcase', 'in the bookcase', 0.785, 0.23, 0.905, 0.69),
               C('Search the armchair', 'in the armchair', 0.31, 0.49, 0.41, 0.69),
               C('Search the other armchair', 'in the other armchair', 0.585, 0.49, 0.685, 0.69),
               C('Look under the side table', 'under the side table', 0.885, 0.55, 0.985, 0.75)],
         spots={'tv': [0.455, 0.44, 0.09, 0.105]}),
    dict(id='kitchen', wall=STD, door=D((0.885, 0.24, 0.7), (0.965, 0.21, 0.73)),
         hide=[C('Open the pantry', 'in the pantry', 0.02, 0.2, 0.165, 0.73),
               C("Look under the butcher's block", "under the butcher's block", 0.21, 0.51, 0.345, 0.67),
               C('Open the oven', 'in the oven', 0.42, 0.51, 0.59, 0.67),
               C('Look under the sink', 'under the sink', 0.655, 0.47, 0.81, 0.67)],
         spots={'home': [0.7, 0.7]}),
    dict(id='chapel', wall=(0.18, 0.13, 0.82, 0.66), door=D((0.915, 0.28, 0.7), (0.975, 0.26, 0.73)),
         hide=[C('Open the confessional', 'in the confessional', 0.18, 0.2, 0.335, 0.66),
               C('Look under the altar', 'under the altar', 0.4, 0.49, 0.6, 0.66),
               C('Check under the pews', 'under the pews', 0.0, 0.53, 0.25, 0.78),
               C('Check under the other pews', 'under the other pews', 0.66, 0.54, 0.91, 0.77),
               C('Look behind the statue', 'behind the statue', 0.7, 0.22, 0.77, 0.5)],
         candles=[(0.425, 0.445), (0.443, 0.445), (0.463, 0.445), (0.532, 0.445), (0.553, 0.445), (0.57, 0.445)]),
    dict(id='nursery', wall=STD, door=D((0.915, 0.25, 0.71), (0.985, 0.22, 0.745)),
         hide=[C('Open the toy chest', 'in the toy chest', 0.0, 0.58, 0.13, 0.73),
               C('Search the doll shelf', 'on the doll shelf', 0.0, 0.16, 0.11, 0.57),
               C('Look in the cot', 'in the cot', 0.14, 0.45, 0.35, 0.68),
               C('Open the wardrobe', 'in the wardrobe', 0.665, 0.3, 0.765, 0.66),
               C('Look in the fireplace', 'in the fireplace', 0.4, 0.43, 0.6, 0.66)],
         spots={'doll': [[0.83, 0.64], [0.25, 0.64], [0.645, 0.7], [0.5, 0.76], [0.5, 0.86]]}),
    dict(id='bedroom', wall=STD, door=D((0.1, 0.21, 0.68), (0.02, 0.17, 0.72)),
         hide=[C('Open the dressing table', 'in the dressing table', 0.2, 0.36, 0.34, 0.66),
               C('Look under the bed', 'under the bed', 0.38, 0.4, 0.62, 0.57),
               C('Open the blanket chest', 'in the blanket chest', 0.42, 0.57, 0.58, 0.69),
               C('Open the wardrobe', 'in the wardrobe', 0.68, 0.24, 0.82, 0.65)]),
    dict(id='cellar', wall=(0.18, 0.13, 0.82, 0.655), door=D((0.11, 0.23, 0.69), (0.02, 0.19, 0.72)),
         hide=[C('Search the wine rack', 'in the wine rack', 0.19, 0.2, 0.29, 0.65),
               C('Look behind the barrels', 'behind the barrels', 0.72, 0.41, 0.85, 0.66),
               C('Search the wine niche', 'in the wine niche', 0.42, 0.39, 0.57, 0.64),
               C('Open the bottle crate', 'in the bottle crate', 0.12, 0.51, 0.2, 0.67),
               C('Search the tall rack', 'in the tall rack', 0.85, 0.2, 0.92, 0.68),
               C('Open the crate', 'in the crate', 0.28, 0.51, 0.34, 0.65)],
         spots={'drain': [0.485, 0.83], 'home': [0.62, 0.74]}),
    dict(id='attic', wall=(0.25, 0.25, 0.75, 0.635), door=D((0.905, 0.32, 0.69), (0.965, 0.3, 0.7)),
         hide=[C('Open the trunks', 'in the trunks', 0.08, 0.5, 0.22, 0.7),
               C('Lift the sheet off the chair', 'under the sheet', 0.0, 0.42, 0.13, 0.75),
               C('Open the trunk', 'in the trunk', 0.41, 0.5, 0.53, 0.64),
               C('Lift the dust sheet', 'under the dust sheet', 0.53, 0.5, 0.61, 0.64),
               C('Open the crates', 'in the crates', 0.655, 0.42, 0.75, 0.65),
               C('Look behind the mannequin', 'behind the mannequin', 0.27, 0.4, 0.32, 0.63)]),
    dict(id='boiler', wall=(0.18, 0.13, 0.82, 0.67), door=D((0.915, 0.25, 0.7), (0.98, 0.22, 0.74)),
         hide=[C('Open the lockers', 'in the lockers', 0.165, 0.35, 0.33, 0.67),
               C('Open the furnace', 'in the furnace', 0.4, 0.4, 0.6, 0.67),
               C('Open the toolbox', 'in the toolbox', 0.7, 0.36, 0.82, 0.67),
               C('Look under the workbench', 'under the workbench', 0.0, 0.54, 0.17, 0.8)],
         spots={'home': [0.5, 0.72]}),
    dict(id='crypt', wall=(0.2, 0.12, 0.8, 0.655), door=D((0.125, 0.2, 0.69), (0.045, 0.17, 0.72), 'gate'),
         hide=[C('Open the small tomb', 'in the small tomb', 0.17, 0.52, 0.275, 0.69),
               C('Open the sarcophagus', 'in the sarcophagus', 0.385, 0.46, 0.62, 0.66),
               C('Open the big tomb', 'in the big tomb', 0.75, 0.47, 0.99, 0.76),
               C('Look in the urn', 'in the urn', 0.28, 0.33, 0.35, 0.52),
               C('Look in the other urn', 'in the other urn', 0.66, 0.33, 0.73, 0.52)]),
    dict(id='lake', wall=(0.24, -2.0, 1.5, 0.47), outdoor=True, door=D((0.14, 0.14, 0.72), (0.06, 0.1, 0.76)),
         hide=[C('Look in the barrel', 'in the barrel', 0.21, 0.53, 0.27, 0.69),
               C('Search the boat', 'in the boat', 0.66, 0.58, 0.87, 0.82),
               C('Check the fishing net', 'in the fishing net', 0.17, 0.24, 0.21, 0.65),
               C('Search the reeds', 'in the reeds', 0.23, 0.36, 0.38, 0.68),
               C('Search the far reeds', 'in the far reeds', 0.87, 0.36, 1.0, 0.8)],
         floor=[(0.66, 0.42, 0.62), (0.76, 0.37, 0.68), (0.86, 0.32, 0.72), (0.76, 0.03, 0.3)],
         # where you can walk: the jetty, and the boards in front of the boathouse
         walk=[[0.43, 0.62], [0.61, 0.62], [0.78, 0.97], [0.02, 0.97], [0.02, 0.72], [0.36, 0.7]],
         spots={'rise': [0.52, 0.62]}),
]


def scale_at(v):
    """How big something standing at height v looks, relative to v = 0.85."""
    return round(max(0.25, (v * H - CY) / (0.85 * H - CY)), 3)


def room_meta(r):
    floor = r.get('floor', FLOOR)
    return {
        'id': r['id'],
        'doors': [r['door']],
        'containers': r['hide'],
        'surfaces': [{'x1': a, 'x2': b, 'y': v, 's': scale_at(v)} for v, a, b in floor],
        'candles': [{'x': x, 'y': y, 's': 0.5} for x, y in r.get('candles', [])],
        'spots': r.get('spots', {}),
        # the floor you can walk on: inside the room's box, or an explicit outline
        'wall': [round(x, 4) for x in r['wall']],
        'walk': r.get('walk'),
    }


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

    return room_meta(r)


def build_sprites(raw):
    os.makedirs(SPRITES, exist_ok=True)
    lanterns = {}
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
        if name.startswith('player-'):
            lanterns[name[7:]] = lantern_at(im)

    if lanterns:
        # where each player figure holds its lantern, as a fraction of the sprite: the light comes from there
        path = os.path.join(SPRITES, 'players.json')
        known = json.load(open(path)) if os.path.exists(path) else {}
        known.update(lanterns)
        with open(path, 'w') as fh:
            json.dump(known, fh, indent=1, sort_keys=True)


def lantern_at(im):
    """The middle of the lantern's glow: warm, bright, opaque pixels."""
    a = np.asarray(im, np.float32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    ys, xs = np.nonzero((al > 200) & (r > 200) & (g > 150) & (b < 150) & (r - b > 90))
    if not len(xs):
        return {'x': 0.85, 'y': 0.48}
    return {'x': round(float(np.median(xs)) / im.width, 3), 'y': round(float(np.median(ys)) / im.height, 3)}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    meta = {'width': W, 'height': H, 'rooms': []}
    if sys.argv[1] == '--sprites':
        # only sprites (residents, zombies, player figures) from the folder given
        return build_sprites(sys.argv[2])
    if sys.argv[1] == '--meta':
        # only rooms.json: doors, hiding places, spots (no images needed)
        meta['rooms'] = [room_meta(r) for r in ROOMS]
    else:
        raw = sys.argv[1]
        for r in ROOMS:
            meta['rooms'].append(build_room(r, raw))
            print('room', r['id'])
        build_sprites(raw)
    with open(os.path.join(OUT, 'rooms.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)


if __name__ == '__main__':
    main()
