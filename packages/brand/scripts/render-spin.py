#!/usr/bin/env python3
"""Renderiza fotogramas del logo giratorio a un PNG, sin dependencias externas.

Existe porque en este entorno la automatizacion de navegador esta bloqueada por
politica: es la unica forma de MIRAR el resultado del giro. Rasteriza el SVG
maestro aplicando la escala de giro y la rotacion, con supermuestreo 3x3.

Uso: render-spin.py <salida.png> [angulos separados por coma] [--no-guia]
"""
import sys, re, zlib, struct, math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / 'assets' / 'ceiba-mark.svg'

CARBON = (0x0E, 0x10, 0x0F)
BONE = (0xF3, 0xF1, 0xE7)
SAGE = (0x9D, 0xBE, 0x8C)
GUIDE = (0x2B, 0x31, 0x2E)

TILE = 176          # px por fotograma en la salida
SS = 3              # supermuestreo
GAP = 10
PAD = 14
VB = 256.0

out_path = sys.argv[1]
angles = [float(a) for a in (sys.argv[2].split(',') if len(sys.argv) > 2 else
                             ['0', '45', '90', '135', '180', '270'])]
guide = '--no-guia' not in sys.argv

svg = SVG.read_text()


def paths_for(cls):
    m = re.search(r'<path[^>]*class="%s"[^>]*\sd="([^"]+)"' % cls, svg)
    polys = []
    for sub in m.group(1).split('M')[1:]:
        nums = [float(n) for n in re.findall(r'-?\d+\.?\d*', sub.replace('L', ' '))]
        pts = list(zip(nums[0::2], nums[1::2]))
        if len(pts) >= 3:
            polys.append(pts)
    return polys


tree = paths_for('ceiba-mark__tree')
seed = paths_for('ceiba-mark__seed')

# escala de giro: misma formula que build-brand.mjs
C = VB / 2
allpts = [p for q in tree + seed for p in q]
maxR = max(math.hypot(x - C, y - C) for x, y in allpts)
SPIN = math.floor((C / maxR) * 1000) / 1000


def transform(polys, deg):
    a = math.radians(deg)
    cs, sn = math.cos(a), math.sin(a)
    out = []
    for q in polys:
        r = []
        for x, y in q:
            dx, dy = (x - C) * SPIN, (y - C) * SPIN
            r.append((C + dx * cs - dy * sn, C + dx * sn + dy * cs))
        out.append(r)
    return out


def fill(buf, W, polys, colour, ox, oy, scale):
    """Relleno par-impar por scanline sobre el lienzo supermuestreado."""
    edges = []
    for q in polys:
        P = [(x * scale + ox, y * scale + oy) for x, y in q]
        for p0, p1 in zip(P, P[1:] + P[:1]):
            if p0[1] != p1[1]:
                edges.append((p0, p1))
    if not edges:
        return
    ymin = max(0, int(min(min(e[0][1], e[1][1]) for e in edges)))
    ymax = min(len(buf) // W - 1, int(max(max(e[0][1], e[1][1]) for e in edges)) + 1)
    for y in range(ymin, ymax + 1):
        yc = y + 0.5
        xs = []
        for (x0, y0), (x1, y1) in edges:
            if (y0 <= yc < y1) or (y1 <= yc < y0):
                xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
        if not xs:
            continue
        xs.sort()
        row = y * W
        for i in range(0, len(xs) - 1, 2):
            a = max(0, int(math.ceil(xs[i] - 0.5)))
            b = min(W - 1, int(math.floor(xs[i + 1] - 0.5)))
            for x in range(a, b + 1):
                buf[row + x] = colour


n = len(angles)
W = PAD * 2 + n * TILE + (n - 1) * GAP
H = PAD * 2 + TILE
SW, SH = W * SS, H * SS

canvas = [0] * (SW * SH)        # 0 = fondo
for i, deg in enumerate(angles):
    ox = (PAD + i * (TILE + GAP)) * SS
    oy = PAD * SS
    scale = (TILE * SS) / VB
    if guide:
        # circulo inscrito: si algo lo cruza, el spinner se recortaria
        cx, cy = ox + TILE * SS / 2, oy + TILE * SS / 2
        rr = TILE * SS / 2
        for t in range(0, 2000):
            a = t * math.pi / 1000
            px_, py_ = int(cx + rr * math.cos(a)), int(cy + rr * math.sin(a))
            if 0 <= px_ < SW and 0 <= py_ < SH:
                canvas[py_ * SW + px_] = 3
    fill(canvas, SW, transform(tree, deg), 1, ox, oy, scale)
    fill(canvas, SW, transform(seed, deg), 2, ox, oy, scale)

# reduccion con promediado (antialias)
PAL = {0: CARBON, 1: BONE, 2: SAGE, 3: GUIDE}
rows = []
for y in range(H):
    row = bytearray([0])
    for x in range(W):
        r = g = b = 0
        for dy in range(SS):
            base = (y * SS + dy) * SW + x * SS
            for dx in range(SS):
                c = PAL[canvas[base + dx]]
                r += c[0]; g += c[1]; b += c[2]
        k = SS * SS
        row += bytes((r // k, g // k, b // k))
    rows.append(bytes(row))

raw = b''.join(rows)


def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))


png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw, 9))
       + chunk(b'IEND', b''))
Path(out_path).write_bytes(png)
print('escala de giro %.3f  angulos %s' % (SPIN, ','.join(str(int(a)) for a in angles)))
print('escrito %s  (%dx%d, %d bytes)' % (out_path, W, H, len(png)))
