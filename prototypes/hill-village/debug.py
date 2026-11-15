# python debug.py [moment ...] : the two lighting checks of _refs/lighting.md for each moment,
# from out/hill-village-<moment>.png (render.mjs) and out/debug/<moment>-light.json (build.mjs):
#   out/debug/<moment>-values.png  the picture as luminance only, for the value groups;
#   out/debug/<moment>-light.png   the picture with the key light circled and, for six named
#                                  buildings, a dot on the base under the highest point and an
#                                  arrow to where that point's shadow lands on the ground.
# It prints, per building, whether the arrow runs away from the light and how much of the
# ground along it (past the building) the build found in shadow.
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
moments = sys.argv[1:] or ['sunrise', 'day', 'night']
GREEN = (0, 255, 120)
for m in moments:
    im = Image.open(HERE / 'out' / f'hill-village-{m}.png').convert('RGB')
    W, H = im.size
    # the bottom-pinned viewport: 320 x 200 cells, scaled to cover, aligned to the bottom
    s = max(W / 320, H / 200)
    ox = (W - 320 * s) / 2
    oy = H - 200 * s
    cell = lambda x, y: (ox + (x + 0.5) * s, oy + (y + 0.5) * s)
    im.convert('L').save(HERE / 'out' / 'debug' / f'{m}-values.png')
    light = json.loads((HERE / 'out' / 'debug' / f'{m}-light.json').read_text())
    out = im.copy()
    d = ImageDraw.Draw(out)
    lx, ly = cell(*light['at'])
    d.ellipse([lx - 14, ly - 14, lx + 14, ly + 14], outline=GREEN, width=3)
    sx, sy = light['shadow']
    print(m, 'shadow per unit of height (cells):', round(sx, 2), round(sy, 2))
    for mk in light['marks']:
        x0, y0 = cell(*mk['base'])
        x1, y1 = cell(*mk['end'])
        n = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 or 1
        ux, uy = (x1 - x0) / n, (y1 - y0) / n
        d.line([x0, y0, x1, y1], fill=GREEN, width=3)
        for a, b in ((-uy, ux), (uy, -ux)):
            d.line([x1, y1, x1 - ux * 12 + a * 7, y1 - uy * 12 + b * 7], fill=GREEN, width=3)
        d.ellipse([x0 - 6, y0 - 6, x0 + 6, y0 + 6], fill=GREEN, outline=(0, 0, 0))
        d.text((x0 + 8, y0 - 18), mk['name'], fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
        print('  %-14s base %-12s shadow end %-14s away from the light: %-5s ground in shadow: %d%%' % (
            mk['name'], tuple(mk['base']), tuple(mk['end']), mk['away'], round(mk['shadowed'] * 100)))
    out.save(HERE / 'out' / 'debug' / f'{m}-light.png')
