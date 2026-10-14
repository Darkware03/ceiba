#!/usr/bin/env python3
"""Vectoriza el logo por contorno (marching squares con interpolacion sub-pixel).

Reproduce la silueta exacta del PNG, incluidos los extremos redondeados, en vez de
inferir un esqueleto. Separa el disco verde del trazo claro.

Uso: logo_contour.py <png> <salida.svg> [epsilon] [--invert-bg]
"""
import sys, math, importlib.util

spec = importlib.util.spec_from_file_location('pt', '/software-factory/.toolchain/pngtrace_lib.py')
pt = importlib.util.module_from_spec(spec); spec.loader.exec_module(pt)

src, out = sys.argv[1], sys.argv[2]
EPS = float(sys.argv[3]) if len(sys.argv) > 3 else 0.45

w, h, chan, ctype, plte, buf = pt.read_png(src)
bg = pt.dominant_bg(buf, w, h, chan, ctype, plte)
print('imagen %dx%d  fondo~%s' % (w, h, bg))


def rgba(x, y):
    return pt.px(buf, w, chan, ctype, plte, x, y)


# Campo escalar continuo: 0 = fondo, 1 = tinta. Se compone con alfa para que el
# antialias del PNG se convierta en posicion sub-pixel del contorno.
def fields():
    stroke = [0.0] * (w * h)
    green = [0.0] * (w * h)
    for y in range(h):
        base = y * w
        for x in range(w):
            r, g, b, a = rgba(x, y)
            af = a / 255.0
            if af <= 0.02:
                continue
            # distancia cromatica al fondo, normalizada
            d = (abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])) / 255.0
            ink = min(1.0, d / 0.55) * af
            if ink <= 0.02:
                continue
            if g > r + 10 and g > b + 10:
                green[base + x] = ink
            else:
                stroke[base + x] = ink
    return stroke, green


stroke_f, green_f = fields()

# el disco verde esta rodeado de fondo; para que su contorno cierre bien, el campo
# del trazo no debe contener sus pixeles y viceversa (ya garantizado arriba).

# bits: 1=TL 2=TR 4=BR 8=BL. Aristas: 0=arriba 1=derecha 2=abajo 3=izquierda.
# Segmentos DIRIGIDOS con el interior siempre a la izquierda del avance, de modo
# que cada vertice tenga exactamente un sucesor y los bucles cierren solos.
EDGES = {
    1: [(3, 0)], 2: [(0, 1)], 3: [(3, 1)], 4: [(1, 2)],
    5: [(3, 2), (0, 1)], 6: [(0, 2)], 7: [(3, 2)], 8: [(2, 3)],
    9: [(2, 0)], 10: [(0, 3), (2, 1)], 11: [(2, 1)], 12: [(1, 3)],
    13: [(1, 0)], 14: [(0, 3)],
}


def march(field, iso=0.5):
    """Devuelve lista de polilineas cerradas en coordenadas sub-pixel."""
    segs = {}

    def interp(v0, v1, p0, p1):
        if abs(v1 - v0) < 1e-9:
            t = 0.5
        else:
            t = (iso - v0) / (v1 - v0)
        t = max(0.0, min(1.0, t))
        return (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)

    for y in range(h - 1):
        for x in range(w - 1):
            i = y * w + x
            v = (field[i], field[i + 1], field[i + w + 1], field[i + w])
            case = (1 if v[0] >= iso else 0) | (2 if v[1] >= iso else 0) \
                 | (4 if v[2] >= iso else 0) | (8 if v[3] >= iso else 0)
            if case == 0 or case == 15:
                continue
            c = (x, y), (x + 1, y), (x + 1, y + 1), (x, y + 1)
            # aristas: 0=arriba(TL-TR) 1=derecha(TR-BR) 2=abajo(BR-BL) 3=izquierda(BL-TL)
            pts = {
                0: interp(v[0], v[1], c[0], c[1]),
                1: interp(v[1], v[2], c[1], c[2]),
                2: interp(v[2], v[3], c[2], c[3]),
                3: interp(v[3], v[0], c[3], c[0]),
            }
            for a, b in EDGES[case]:
                pa, pb = pts[a], pts[b]
                ka = (round(pa[0] * 64), round(pa[1] * 64))
                kb = (round(pb[0] * 64), round(pb[1] * 64))
                if ka == kb:
                    continue
                segs.setdefault(ka, []).append(kb)

    # encadenar: cada clave se consume al usarse, el bucle cierra al volver al inicio
    loops = []
    while segs:
        start = next(iter(segs))
        loop = [start]
        cur = start
        guard = 0
        while True:
            guard += 1
            if guard > 4 * w * h:
                break
            nxts = segs.get(cur)
            if not nxts:
                break
            nxt = nxts.pop()
            if not nxts:
                segs.pop(cur, None)
            if nxt == start:
                break
            loop.append(nxt)
            cur = nxt
        if len(loop) >= 8:
            loops.append([(a / 64.0, b / 64.0) for a, b in loop])
    return loops


def rdp_closed(pts, eps):
    if len(pts) < 4:
        return pts
    # anclar en el punto mas lejano del centroide para una particion estable
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    k = max(range(len(pts)), key=lambda i: (pts[i][0] - cx) ** 2 + (pts[i][1] - cy) ** 2)
    pts = pts[k:] + pts[:k]
    chain = pts + [pts[0]]
    outp = _rdp(chain, eps)
    return outp[:-1]


def _rdp(pts, eps):
    stack = [(0, len(pts) - 1)]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        x0, y0 = pts[a]; x1, y1 = pts[b]
        dx, dy = x1 - x0, y1 - y0
        n = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for k in range(a + 1, b):
            px, py = pts[k]
            if n < 1e-9:
                d = math.hypot(px - x0, py - y0)
            else:
                d = abs(dy * px - dx * py + x1 * y0 - y1 * x0) / n
            if d > best:
                best, bi = d, k
        if best > eps:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, kp in zip(pts, keep) if kp]


def area(poly):
    s = 0.0
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        s += x0 * y1 - x1 * y0
    return s / 2.0


stroke_loops = [l for l in march(stroke_f) if abs(area(l)) > 12]
green_loops = [l for l in march(green_f) if abs(area(l)) > 12]
print('contornos trazo=%d verde=%d' % (len(stroke_loops), len(green_loops)))

simp_s = [rdp_closed(l, EPS) for l in stroke_loops]
simp_g = [rdp_closed(l, EPS) for l in green_loops]
print('puntos trazo %d -> %d' % (sum(len(l) for l in stroke_loops), sum(len(l) for l in simp_s)))

allp = [p for l in simp_s + simp_g for p in l]
minx = min(p[0] for p in allp); maxx = max(p[0] for p in allp)
miny = min(p[1] for p in allp); maxy = max(p[1] for p in allp)
print('bbox %.1f,%.1f -> %.1f,%.1f  (%.1f x %.1f)' % (minx, miny, maxx, maxy, maxx - minx, maxy - miny))

# normalizar a un lienzo cuadrado 256x256 centrado, con 8 de margen
SZ, MARGIN = 256.0, 6.0
scale = (SZ - 2 * MARGIN) / max(maxx - minx, maxy - miny)
offx = (SZ - (maxx - minx) * scale) / 2 - minx * scale
offy = (SZ - (maxy - miny) * scale) / 2 - miny * scale


def emit(poly):
    d = []
    for k, (x, y) in enumerate(poly):
        X = x * scale + offx
        Y = y * scale + offy
        d.append('%s%.2f %.2f' % ('M' if k == 0 else 'L', X, Y))
    d.append('Z')
    return ' '.join(d)


with open(out, 'w') as fh:
    fh.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
             'role="img" aria-label="CEIBA">\n')
    fh.write('  <path class="ceiba-mark__tree" fill="currentColor" fill-rule="evenodd" d="%s"/>\n'
             % ' '.join(emit(l) for l in simp_s))
    if simp_g:
        fh.write('  <path class="ceiba-mark__seed" fill="#9DBE8C" d="%s"/>\n'
                 % ' '.join(emit(l) for l in simp_g))
    fh.write('</svg>\n')

import os
print('escrito %s (%d bytes)' % (out, os.path.getsize(out)))
