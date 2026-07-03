#!/usr/bin/env python3
"""
Generate PNG icons for RV Trainer PWA.
No external dependencies — uses only Python stdlib (struct, zlib, math, os).

Design: dark navy background with a stylised eye (white outline, purple iris, dark pupil).
"""

import struct
import zlib
import os
import math


def make_chunk(name, data):
    """Create a PNG chunk with CRC."""
    chunk_data = name + data
    crc = zlib.crc32(chunk_data) & 0xFFFFFFFF
    return struct.pack('>I', len(data)) + chunk_data + struct.pack('>I', crc)


def lerp(a, b, t):
    return a + (b - a) * t


def create_eye_png(size):
    """Create a PNG with an eye icon on dark navy background."""
    # Pixel buffer: RGB, 3 bytes per pixel
    pixels = bytearray(size * size * 3)
    cx, cy = size // 2, size // 2

    def set_px(x, y, r, g, b):
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 3
            pixels[idx]     = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b

    def blend_px(x, y, r, g, b, alpha):
        """Alpha-blend onto existing pixel."""
        if 0 <= x < size and 0 <= y < size:
            idx = (y * size + x) * 3
            pixels[idx]     = int(pixels[idx]     * (1 - alpha) + r * alpha)
            pixels[idx + 1] = int(pixels[idx + 1] * (1 - alpha) + g * alpha)
            pixels[idx + 2] = int(pixels[idx + 2] * (1 - alpha) + b * alpha)

    # ── Background (#1a1a2e = 26, 26, 46) ──
    for i in range(0, len(pixels), 3):
        pixels[i]     = 26
        pixels[i + 1] = 26
        pixels[i + 2] = 46

    # ── Eyelid fill (lighter navy almond shape) ──
    rx_fill = size * 0.38
    ry_fill = size * 0.22
    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            val = (dx / rx_fill) ** 2 + (dy / ry_fill) ** 2
            if val <= 1.0:
                set_px(x, y, 32, 32, 58)  # slightly lighter navy

    # ── Iris — filled purple circle ──
    ir = size // 5
    for y in range(size):
        for x in range(size):
            dist2 = (x - cx) ** 2 + (y - cy) ** 2
            if dist2 <= ir ** 2:
                # Gradient: lighter at top-left
                dist = math.sqrt(dist2)
                t = dist / ir
                rr = int(lerp(140, 100, t))  # 140 → 100
                gg = int(lerp(130, 90, t))   # 130 → 90
                bb = int(lerp(240, 200, t))  # 240 → 200
                set_px(x, y, rr, gg, bb)

    # ── Pupil — dark circle ──
    pr = max(ir // 2, 2)
    for y in range(size):
        for x in range(size):
            dist2 = (x - cx) ** 2 + (y - cy) ** 2
            if dist2 <= pr ** 2:
                set_px(x, y, 8, 8, 18)

    # ── Iris highlight ──
    hr = max(pr // 2, 1)
    hx = cx - hr // 2
    hy = cy - hr // 2
    for y in range(size):
        for x in range(size):
            dist2 = (x - hx) ** 2 + (y - hy) ** 2
            if dist2 <= hr ** 2:
                blend_px(x, y, 220, 220, 255, 0.4)

    # ── Eye outline — white anti-aliased ellipse ──
    rx = size * 0.38
    ry = size * 0.22
    thickness = max(2.5, size / 38)

    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            val = math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2)
            dist_from_edge = abs(val - 1.0) * min(rx, ry)
            if dist_from_edge < thickness + 1.5:
                alpha = max(0.0, 1.0 - max(0, dist_from_edge - thickness + 1.0))
                alpha = min(1.0, alpha)
                blend_px(x, y, 232, 232, 240, alpha)

    # ── Corner accent dots (eyelash hint) ──
    dot_r = max(size // 50, 1)
    # Left corner
    lcx = int(cx - rx * 0.95)
    # Right corner
    rcx = int(cx + rx * 0.95)
    for dot_cx in (lcx, rcx):
        for y in range(size):
            for x in range(size):
                if (x - dot_cx) ** 2 + (y - cy) ** 2 <= dot_r ** 2:
                    blend_px(x, y, 200, 200, 230, 0.6)

    # ── Build PNG binary ──
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)

    # IDAT: one filter byte (0 = None) per row
    raw_rows = b''
    for row in range(size):
        raw_rows += b'\x00' + bytes(pixels[row * size * 3:(row + 1) * size * 3])

    compressed = zlib.compress(raw_rows, 9)

    png = (
        b'\x89PNG\r\n\x1a\n'
        + make_chunk(b'IHDR', ihdr_data)
        + make_chunk(b'IDAT', compressed)
        + make_chunk(b'IEND', b'')
    )
    return png


def main():
    # Run from repo root or scripts/ directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    icons_dir = os.path.join(repo_root, 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    sizes = [
        (192, 'icon-192'),
        (512, 'icon-512'),
        (180, 'apple-touch-icon'),
    ]

    for size, name in sizes:
        data = create_eye_png(size)
        path = os.path.join(icons_dir, f'{name}.png')
        with open(path, 'wb') as f:
            f.write(data)
        print(f'Created {path} ({len(data):,} bytes, {size}x{size}px)')

    print('Done.')


if __name__ == '__main__':
    main()
