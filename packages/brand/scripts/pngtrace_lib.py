#!/usr/bin/env python3
"""Decodificador PNG minimo (sin dependencias) para trazar el logo CEIBA.

Uso: pngtrace.py <archivo.png> [cols]
Imprime dimensiones, paleta aproximada y un mapa ASCII normalizado
con coordenadas utiles para reconstruir el SVG.
"""
import sys, zlib, struct


def read_png(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'no es PNG'
    pos = 8
    idat = b''
    w = h = bitd = ctype = None
    plte = None
    trns = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bitd, ctype, comp, filt, inter = struct.unpack('>IIBBBBB', body)
            assert inter == 0, 'interlaced no soportado'
        elif typ == b'PLTE':
            plte = body
        elif typ == b'tRNS':
            trns = body
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    chan = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    assert bitd == 8, 'solo 8 bits por canal (bitd=%s)' % bitd
    stride = w * chan
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(chan, stride):
                line[i] = (line[i] + line[i - chan]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                a = line[i - chan] if i >= chan else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                a = line[i - chan] if i >= chan else 0
                b = prev[i]
                c = prev[i - chan] if i >= chan else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out += line
        prev = line
    return w, h, chan, ctype, plte, bytes(out)


def px(buf, w, chan, ctype, plte, x, y):
    i = (y * w + x) * chan
    if ctype == 3:
        idx = buf[i]
        return plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2], 255
    if ctype == 0:
        v = buf[i]; return v, v, v, 255
    if ctype == 4:
        v = buf[i]; return v, v, v, buf[i + 1]
    if ctype == 2:
        return buf[i], buf[i + 1], buf[i + 2], 255
    return buf[i], buf[i + 1], buf[i + 2], buf[i + 3]




def dominant_bg(buf, w, h, chan, ctype, plte):
    hist = {}
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b, a = px(buf, w, chan, ctype, plte, x, y)
            key = (r // 16 * 16, g // 16 * 16, b // 16 * 16, a // 128)
            hist[key] = hist.get(key, 0) + 1
    return sorted(hist.items(), key=lambda kv: -kv[1])[0][0]


def is_ink(buf, w, chan, ctype, plte, x, y, bg):
    r, g, b, a = px(buf, w, chan, ctype, plte, x, y)
    if a < 128:
        return 0
    d = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
    if d < 60:
        return 0
    if g > r + 12 and g > b + 12:
        return 2
    return 1
