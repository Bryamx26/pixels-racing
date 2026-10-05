"""
Découpe la planche de voitures (tools/sprites/voitures-sheet.png, grille 4×4 vue du dessus)
en sprites pixel art à l'échelle du jeu, puis génère :
  - src/client/assets/voitures.png  (atlas 4×4, voitures tournées vers la droite)
  - src/shared/cars/carAtlas.ts     (taille des cases, couleur dominante de chaque voiture)

Le fond uni de la planche est retiré par remplissage depuis les bords (les vitres sombres
à l'intérieur restent opaques), puis chaque voiture est réduite avec le même facteur pour
que la largeur d'une berline corresponde à CAR_WIDTH (1/3 de la chaussée).

Usage : python3 tools/sprites/extract.py   (nécessite pillow et numpy)
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'tools/sprites/voitures-sheet.png')
OUT_IMG = os.path.join(ROOT, 'src/client/assets/voitures.png')
OUT_TS = os.path.join(ROOT, 'src/shared/cars/carAtlas.ts')

# Bandes (début, fin) des lignes et colonnes de la grille, relevées sur la planche.
ROWS = [(97, 266), (316, 486), (545, 708), (756, 956)]
COLS = [(37, 347), (396, 724), (779, 1125), (1171, 1499)]
REF_WIDTH = 170   # largeur (px planche) d'une berline, roues comprises
CAR_WIDTH = 28    # doit valoir CAR_WIDTH de src/shared/constants.ts
CELL_W, CELL_H = 64, 40

NAMES = [
    'Rubis', 'Brasier', 'Magenta', 'Givre',
    'Vipère', 'Azur', 'Fusion', 'Comète',
    'Lagon', 'Venin', 'Cobalt', 'Lilas',
    'Titan', 'Rôdeur', 'Saphir', 'Spectre',
]

im = np.array(Image.open(SRC).convert('RGB')).astype(int)
bg = im[5, 5]
scale = CAR_WIDTH / REF_WIDTH


def outside_mask(cell):
    """Pixels du fond reliés au bord de la case (remplissage itératif)."""
    near_bg = np.abs(cell - bg).sum(2) < 45
    out = np.zeros_like(near_bg)
    out[0, :] = near_bg[0, :]
    out[-1, :] = near_bg[-1, :]
    out[:, 0] = near_bg[:, 0]
    out[:, -1] = near_bg[:, -1]
    while True:
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        grown &= near_bg
        if (grown == out).all():
            return out
        out = grown


atlas = Image.new('RGBA', (CELL_W * 4, CELL_H * 4), (0, 0, 0, 0))
colors = []
for r, (y0, y1) in enumerate(ROWS):
    for c, (x0, x1) in enumerate(COLS):
        cell = im[y0 - 6:y1 + 7, x0 - 6:x1 + 7]
        alpha = (~outside_mask(cell)).astype(np.uint8) * 255
        rgba = np.dstack([cell.astype(np.uint8), alpha])
        img = Image.fromarray(rgba, 'RGBA').crop(Image.fromarray(alpha).getbbox())
        # Les voitures de la planche regardent vers la gauche : on les tourne vers +x.
        img = img.rotate(180)
        w = max(1, round(img.width * scale))
        h = max(1, round(img.height * scale))
        # Réduction par moyenne (prémultipliée) puis alpha binaire : rendu pixel net.
        arr = np.array(img).astype(float)
        arr[..., :3] *= arr[..., 3:4] / 255
        small = np.array(Image.fromarray(arr.astype(np.uint8), 'RGBA').resize((w, h), Image.BOX)).astype(float)
        a = small[..., 3]
        rgb = np.where(a[..., None] > 0, small[..., :3] * 255 / np.maximum(a[..., None], 1), 0)
        out = np.dstack([np.clip(rgb, 0, 255), np.where(a > 110, 255, 0)]).astype(np.uint8)
        sprite = Image.fromarray(out, 'RGBA')
        atlas.paste(sprite, (c * CELL_W + (CELL_W - w) // 2, r * CELL_H + (CELL_H - h) // 2))
        # Couleur dominante (pixels opaques saturés) pour la minicarte et l'interface.
        px = out[out[..., 3] > 0][:, :3].astype(int)
        sat = px.max(1) - px.min(1)
        pick = px[sat >= np.percentile(sat, 60)]
        colors.append('#%02x%02x%02x' % tuple(np.median(pick, axis=0).astype(int)))

os.makedirs(os.path.dirname(OUT_IMG), exist_ok=True)
os.makedirs(os.path.dirname(OUT_TS), exist_ok=True)
atlas.save(OUT_IMG, optimize=True)

lines = [
    '// Fichier généré par tools/sprites/extract.py : ne pas modifier à la main.',
    '',
    f'export const CAR_CELL_W = {CELL_W};',
    f'export const CAR_CELL_H = {CELL_H};',
    '',
    '/** Voitures de l\'atlas src/client/assets/voitures.png (4 par ligne). */',
    'export const CARS: readonly { id: number; name: string; color: string }[] = [',
]
for i, (n, col) in enumerate(zip(NAMES, colors)):
    lines.append(f"  {{ id: {i}, name: '{n}', color: '{col}' }},")
lines += ['];', '']
with open(OUT_TS, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('atlas', atlas.size, 'scale', round(scale, 3))
