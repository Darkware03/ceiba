#!/usr/bin/env python3
"""Rasteriza el SVG generado y lo compara pixel a pixel con el PNG original (IoU).

Uso: logo_verify.py <png_original> <svg>
"""
import sys, re, math, importlib.util

spec = importlib.util.spec_from_file_location('pt', '/software-factory/.toolchain/pngtrace_lib.py')
pt = importlib.util.module_from_spec(spec); spec.loader.exec_module(pt)

png, svg = sys.argv[1], sys.argv[2]
w, h, chan, ctype, plte, buf = pt.read_png(png)
bg = pt.dominant_bg(buf, w, h, chan, ctype, plte)

ref = bytearray(w * h)
for y in range(h):
    for x in range(w):
        if pt.is_ink(buf, w, chan, ctype, plte, x, y, bg):
            ref[y * w + x] = 1

txt = open(svg).read()
vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', txt).group(1).split()]
paths = re.findall(r'<path[^>]*\sd="([^"]+)"', txt)

polys = []
for d in paths:
    for sub in d.split('M')[1:]:
        sub = sub.strip().rstrip('Z').strip()
        nums = [float(n) for n in re.findall(r'-?\d+\.?\d*', sub.replace('L', ' '))]
        pts = list(zip(nums[0::2], nums[1::2]))
        if len(pts) >= 3:
            polys.append(pts)

# bbox del SVG -> bbox de la tinta original, para comparar en el mismo marco
minx = min(p[0] for q in polys for p in q); maxx = max(p[0] for q in polys for p in q)
miny = min(p[1] for q in polys for p in q); maxy = max(p[1] for q in polys for p in q)
rminx, rminy, rmaxx, rmaxy = w, h, -1, -1
for y in range(h):
    for x in range(w):
        if ref[y * w + x]:
            rminx = min(rminx, x); rmaxx = max(rmaxx, x)
            rminy = min(rminy, y); rmaxy = max(rmaxy, y)
sx = (rmaxx - rminx) / (maxx - minx)
sy = (rmaxy - rminy) / (maxy - miny)
print('escala svg->png  sx=%.4f sy=%.4f' % (sx, sy))

test = bytearray(w * h)
# relleno por scanline con regla par-impar sobre todos los poligonos juntos
edges = []
for q in polys:
    P = [((px - minx) * sx + rminx, (py - miny) * sy + rminy) for px, py in q]
    for a, b in zip(P, P[1:] + P[:1]):
        if a[1] != b[1]:
            edges.append((a, b))

for y in range(h):
    yc = y + 0.5
    xs = []
    for (x0, y0), (x1, y1) in edges:
        if (y0 <= yc < y1) or (y1 <= yc < y0):
            xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
    xs.sort()
    for i in range(0, len(xs) - 1, 2):
        a = max(0, int(math.ceil(xs[i] - 0.5)))
        b = min(w - 1, int(math.floor(xs[i + 1] - 0.5)))
        base = y * w
        for x in range(a, b + 1):
            test[base + x] = 1

inter = sum(1 for i in range(w * h) if ref[i] and test[i])
uni = sum(1 for i in range(w * h) if ref[i] or test[i])
ra = sum(ref); ta = sum(test)
print('area original=%d  area svg=%d  (%.2f%%)' % (ra, ta, 100.0 * ta / ra))
print('IoU = %.4f   pixeles solo-original=%d  solo-svg=%d' % (inter / uni, ra - inter, ta - inter))
