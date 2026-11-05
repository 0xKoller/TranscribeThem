#!/usr/bin/env python3
"""Generate simple PNG icons without third-party deps."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "icons"
ROOT.mkdir(exist_ok=True)

BG = (11, 20, 26)
GREEN = (0, 168, 132)
WHITE = (255, 255, 255)


def png(w: int, h: int, pixels: list[tuple[int, int, int]]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r, g, b = pixels[y * w + x]
            raw.extend((r, g, b))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def rounded_rect(x: float, y: float, cx: float, cy: float, w: float, h: float, r: float) -> bool:
    dx = abs(x - cx)
    dy = abs(y - cy)
    hw, hh = w / 2, h / 2
    if dx > hw or dy > hh:
        return False
    if dx <= hw - r or dy <= hh - r:
        return True
    ox = dx - (hw - r)
    oy = dy - (hh - r)
    return ox * ox + oy * oy <= r * r


def waveform(x: float, y: float, size: int) -> bool:
    # Vertical bars in the center.
    nx = (x / size) * 2 - 1
    ny = (y / size) * 2 - 1
    if abs(ny) > 0.42:
        return False
    bars = [(-0.38, 0.18), (-0.22, 0.32), (-0.08, 0.48), (0.06, 0.36), (0.2, 0.22), (0.34, 0.12)]
    for bx, bh in bars:
        if abs(nx - bx) < 0.045 and abs(ny) < bh:
            return True
    return False


def make(size: int) -> bytes:
    pixels: list[tuple[int, int, int]] = []
    r = size * 0.22
    for y in range(size):
        for x in range(size):
            if rounded_rect(x + 0.5, y + 0.5, size / 2, size / 2, size * 0.92, size * 0.92, r):
                if waveform(x + 0.5, y + 0.5, size):
                    pixels.append(WHITE)
                else:
                    pixels.append(GREEN)
            else:
                pixels.append(BG)
    return png(size, size, pixels)


def main() -> None:
    for size in (16, 48, 128):
        path = ROOT / f"icon{size}.png"
        path.write_bytes(make(size))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
