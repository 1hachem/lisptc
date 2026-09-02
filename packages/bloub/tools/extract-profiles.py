#!/usr/bin/env python3
"""Regenere src/bot/profiles.ts a partir des images de la video de reference.

Les silhouettes du bot ne sont pas dessinees a la main : on les releve au pixel
sur la video, par lancer de rayon sous-pixel depuis le centroide de la forme.
Toutes les formes du bot sont convexes, donc un profil radial r(theta) les
decrit exactement — et deux profils echantillonnes aux memes angles se morphent
par simple interpolation lineaire.

Prerequis :
    pip install numpy pillow
    ffmpeg -i reference.mp4 -vf fps=10 frames/h_%04d.png

Usage :
    python tools/extract-profiles.py frames/ > src/bot/profiles.ts
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# Rayon de la boule au repos dans les images source, en pixels.
BALL_R = 190.0
# Seuil de luminance separant le corps du fond.
THRESHOLD = 128.0
# Nombre d'angles echantillonnes. 64 suffit : le contour est ensuite lisse par
# des cubiques Catmull-Rom au rendu.
SAMPLES = 64

# Etat -> image de reference (index de frame a 10 images/s) et commentaire.
#
# Seules les formes reellement irregulieres sont relevees ici. La boule et le
# point sont des cercles parfaits (verifie : deviation radiale < 0.7 %) et les
# barres des deux "!" sont des enveloppes convexes de deux cercles : les unes
# et les autres sont donc construites analytiquement dans shape.ts, ce qui est
# plus juste que de figer un releve bruite.
SHAPES = [
    ('egg', 164, 'oeuf : meme hauteur que la boule, retreci en largeur'),
    ('hexagon', 174, 'hexagone pointe en haut, coins tres arrondis'),
    ('triangle', 190, 'triangle pointe en haut, coins tres arrondis'),
]


def load(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    luma = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    return luma, a.max(2) - a.min(2)


def largest_blob(mask):
    """Plus grande composante connexe, en flood-fill iteratif."""
    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    best = None
    ys, xs = np.nonzero(mask)
    for sy, sx in zip(ys, xs):
        if seen[sy, sx]:
            continue
        stack, pix = [(sy, sx)], []
        seen[sy, sx] = True
        while stack:
            y, x = stack.pop()
            pix.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if best is None or len(pix) > len(best):
            best = pix
    return np.array(best)


def bilinear(img, x, y):
    h, w = img.shape
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def profile(path):
    """r(theta) normalise par le rayon de la boule au repos."""
    luma, sat = load(path)
    # sat < 45 : on ignore les anneaux colores, seul le corps noir compte
    pix = largest_blob((luma < THRESHOLD) & (sat < 45))
    cy, cx = pix[:, 0].mean(), pix[:, 1].mean()

    angles = np.linspace(0, 2 * math.pi, SAMPLES, endpoint=False)
    steps = np.arange(0.5, 340.0, 0.25)
    radii = np.zeros(SAMPLES)
    for i, a in enumerate(angles):
        v = bilinear(luma, cx + math.cos(a) * steps, cy + math.sin(a) * steps)
        inside = v < THRESHOLD
        if not inside.any():
            continue
        k = int(np.nonzero(inside)[0].max())     # derniere traversee = bord exterieur
        r = steps[k]
        if k + 1 < len(steps) and v[k + 1] != v[k]:
            # affinage sous-pixel sur la rampe d'antialiasing
            r += 0.25 * (THRESHOLD - v[k]) / (v[k + 1] - v[k])
        radii[i] = r
    ys, xs = pix[:, 0], pix[:, 1]
    box = ((xs.max() - xs.min()) / BALL_R, (ys.max() - ys.min()) / BALL_R)
    return radii / BALL_R, box


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    frames = Path(sys.argv[1])
    out = [
        '// Profils radiaux r(theta) releves au pixel sur la video de reference.',
        '// theta = 0 pointe vers la droite et croit dans le sens horaire (y vers le bas).',
        '// Unite : rayon de la boule au repos = 1.',
        '//',
        '// Genere par tools/extract-profiles.py — ne pas editer a la main.',
        '',
        f'export const PROFILE_SAMPLES = {SAMPLES}',
        '',
        'export const PROFILES = {',
    ]
    for name, frame, note in SHAPES:
        radii, (w, h) = profile(frames / f'h_{frame:04d}.png')
        out.append(f'  // {note}')
        out.append(f'  // image {frame}, empreinte mesuree {w:.3f} x {h:.3f}')
        out.append('  ' + name + ': [' + ','.join(f'{v:.4f}' for v in radii) + '],')
    out += ['} as const', '', 'export type ProfileName = keyof typeof PROFILES', '']
    print('\n'.join(out))


if __name__ == '__main__':
    main()
