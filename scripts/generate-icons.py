#!/usr/bin/env python3
"""
Generate PNG icons for RV Trainer PWA.
No external dependencies — uses only Python stdlib (struct, zlib, math, os).

Design: dark navy background (#1a1a2e) with a stylised eye (white outline,
purple iris with gradient, dark pupil, highlight).

Outputs:
  icons/icon-192.png           192x192  purpose: any
  icons/icon-512.png           512x512  purpose: any
  icons/icon-maskable-512.png  512x512  purpose: maskable
                               (eye scaled to 80% safe-zone for Android adaptive icons)
  icons/apple-touch-icon.png   180x180  for <link rel="apple-touch-icon">
"""

import struct
import zlib
import os
import math


def make_chunk(name: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(name + data) & 0xFFFFFFFF
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', crc)


def lerp(a, b, t):
    return a + (b - a) * t


def create_eye_png(size: int, safe_zone: float = 1.0) -> bytes:
    """
    Render the eye icon.

    safe_zone: fraction of the icon that contains the eye drawing.
               1.0 = fills the full canvas (for "any" purpose icons)
               0.8 = eye fits within the central 80% (for maskable icons)
    """
    pixels = bytearray(size * size * 3)
    cx, cy = size / 2, size / 2

    def set_px(x: int, y: int, r: int, g: int, b: int):
        if 0 <= x < size and 0 <= y < size:
            i = (y * size + x) * 3
            pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b

    def blend_px(x: int, y: int, r: int, g: int, b: int, alpha: float):
        if 0 <= x < size and 0 <= y < size:
            i = (y * size + x) * 3
            pixels[i]   = int(pixels[i]   * (1 - alpha) + r * alpha)
            pixels[i+1] = int(pixels[i+1] * (1 - alpha) + g * alpha)
            pixels[i+2] = int(pixels[i+2] * (1 - alpha) + b * alpha)

    # ── Background — full bleed (required for maskable) ──────────────────
    for i in range(0, len(pixels), 3):
        pixels[i] = 26; pixels[i+1] = 26; pixels[i+2] = 46   # #1a1a2e

    # All drawing coordinates are scaled by safe_zone so the eye fits
    # within the safe area when safe_zone < 1.0.
    s = size * safe_zone          # effective drawing size
    ox = (size - s) / 2          # offset to center the safe zone
    ecx = ox + s / 2             # eye center x
    ecy = ox + s / 2             # eye center y

    # ── Eyelid fill (almond shape, slightly lighter navy) ─────────────────
    rx_fill = s * 0.38
    ry_fill = s * 0.22
    for y in range(size):
        for x in range(size):
            dx = x - ecx; dy = y - ecy
            if (dx / rx_fill)**2 + (dy / ry_fill)**2 <= 1.0:
                set_px(x, y, 32, 32, 58)

    # ── Iris — purple gradient circle ─────────────────────────────────────
    ir = s / 5
    ir2 = ir * ir
    for y in range(size):
        for x in range(size):
            dx = x - ecx; dy = y - ecy
            d2 = dx*dx + dy*dy
            if d2 <= ir2:
                t = math.sqrt(d2) / ir
                set_px(x, y,
                       int(lerp(140, 100, t)),
                       int(lerp(130,  90, t)),
                       int(lerp(240, 200, t)))

    # ── Pupil ─────────────────────────────────────────────────────────────
    pr = max(ir / 2, 2)
    pr2 = pr * pr
    for y in range(size):
        for x in range(size):
            dx = x - ecx; dy = y - ecy
            if dx*dx + dy*dy <= pr2:
                set_px(x, y, 8, 8, 18)

    # ── Iris highlight ────────────────────────────────────────────────────
    hr = max(pr / 2, 1)
    hx = ecx - hr / 2
    hy = ecy - hr / 2
    hr2 = hr * hr
    for y in range(size):
        for x in range(size):
            dx = x - hx; dy = y - hy
            if dx*dx + dy*dy <= hr2:
                blend_px(x, y, 220, 220, 255, 0.4)

    # ── Eye outline — anti-aliased white ellipse ──────────────────────────
    rx = s * 0.38
    ry = s * 0.22
    thickness = max(2.5, s / 38)
    for y in range(size):
        for x in range(size):
            dx = x - ecx; dy = y - ecy
            val = math.sqrt((dx / rx)**2 + (dy / ry)**2)
            dist_from_edge = abs(val - 1.0) * min(rx, ry)
            if dist_from_edge < thickness + 1.5:
                alpha = min(1.0, max(0.0, 1.0 - max(0, dist_from_edge - thickness + 1.0)))
                blend_px(x, y, 232, 232, 240, alpha)

    # ── Corner accent dots ────────────────────────────────────────────────
    dot_r = max(s / 50, 1)
    dot_r2 = dot_r * dot_r
    for dot_cx in (ecx - rx * 0.95, ecx + rx * 0.95):
        for y in range(size):
            for x in range(size):
                dx = x - dot_cx; dy = y - ecy
                if dx*dx + dy*dy <= dot_r2:
                    blend_px(x, y, 200, 200, 230, 0.6)

    # ── Encode PNG ────────────────────────────────────────────────────────
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes(pixels[r*size*3:(r+1)*size*3]) for r in range(size))
    return (b'\x89PNG\r\n\x1a\n'
            + make_chunk(b'IHDR', ihdr)
            + make_chunk(b'IDAT', zlib.compress(raw, 9))
            + make_chunk(b'IEND', b''))


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root  = os.path.dirname(script_dir)
    icons_dir  = os.path.join(repo_root, 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    outputs = [
        # (size, filename,           safe_zone)
        (192,  'icon-192',           1.0),   # purpose: any
        (512,  'icon-512',           1.0),   # purpose: any
        (512,  'icon-maskable-512',  0.8),   # purpose: maskable (80% safe zone)
        (180,  'apple-touch-icon',   1.0),   # <link rel="apple-touch-icon">
    ]

    for size, name, safe_zone in outputs:
        data = create_eye_png(size, safe_zone)
        path = os.path.join(icons_dir, f'{name}.png')
        with open(path, 'wb') as f:
            f.write(data)
        zone_info = f', safe_zone={safe_zone}' if safe_zone < 1.0 else ''
        print(f'Created {path}  ({len(data):,} bytes{zone_info})')

    print('Done.')


if __name__ == '__main__':
    main()
