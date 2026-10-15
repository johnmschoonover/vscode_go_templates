#!/usr/bin/env python3
"""Regenerate the Marketplace icon (assets/icon.png) and its SVG source.

Usage: python3 scripts/generate-icon.py   (requires Pillow)

The icon is a rounded dark square with four light-cyan curly braces ("{{ }}").
Braces are drawn as cubic Bezier strokes so no font is required, and the same
geometry is written to assets/icon.svg for reference/editing.
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 128
SCALE = 8  # supersampling factor for smooth edges
RADIUS = 28
BG = "#0f172a"
BRACE_COLORS = ("#00ADD8", "#00ADD8", "#7FDDF2", "#7FDDF2")  # Go cyan, lighter right pair
STROKE = 7.0
TOP, HEIGHT, WIDTH = 30.0, 68.0, 17.0
XS = (19.0, 39.0, 74.0, 94.0)  # left edge of each brace: "{", "{", "}", "}"
KINDS = ("{", "{", "}", "}")

# Unit-box cubic Bezier segments for "{" (x to the right, y down).
OPEN_BRACE = [
    ((1.0, 0.0), (0.55, 0.0), (0.6, 0.2), (0.6, 0.35)),
    ((0.6, 0.35), (0.6, 0.45), (0.5, 0.5), (0.0, 0.5)),
    ((0.0, 0.5), (0.5, 0.5), (0.6, 0.55), (0.6, 0.65)),
    ((0.6, 0.65), (0.6, 0.8), (0.55, 1.0), (1.0, 1.0)),
]


def brace_segments(kind, x0):
    inset = STROKE / 2
    w, h, top = WIDTH - STROKE, HEIGHT - STROKE, TOP + inset
    segs = []
    for seg in OPEN_BRACE:
        pts = []
        for ux, uy in seg:
            if kind == "}":
                ux = 1.0 - ux
            pts.append((x0 + inset + ux * w, top + uy * h))
        segs.append(pts)
    return segs


def bezier(p, t):
    mt = 1 - t
    return tuple(
        mt**3 * p[0][i] + 3 * mt**2 * t * p[1][i] + 3 * mt * t**2 * p[2][i] + t**3 * p[3][i]
        for i in (0, 1)
    )


def main():
    root = Path(__file__).resolve().parent.parent
    out_dir = root / "assets"
    out_dir.mkdir(exist_ok=True)

    big = SIZE * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, big - 1, big - 1), RADIUS * SCALE, fill=BG)
    r = STROKE / 2 * SCALE
    for kind, x0, color in zip(KINDS, XS, BRACE_COLORS):
        for seg in brace_segments(kind, x0):
            for i in range(121):
                x, y = bezier(seg, i / 120)
                d.ellipse((x * SCALE - r, y * SCALE - r, x * SCALE + r, y * SCALE + r), fill=color)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(out_dir / "icon.png", optimize=True)

    paths = []
    for kind, x0, color in zip(KINDS, XS, BRACE_COLORS):
        segs = brace_segments(kind, x0)
        dstr = "M {:.2f} {:.2f} ".format(*segs[0][0]) + " ".join(
            "C {:.2f} {:.2f}, {:.2f} {:.2f}, {:.2f} {:.2f}".format(*s[1], *s[2], *s[3]) for s in segs
        )
        paths.append(
            f'  <path d="{dstr}" fill="none" stroke="{color}" stroke-width="{STROKE}" '
            'stroke-linecap="round" stroke-linejoin="round"/>'
        )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">\n'
        f'  <rect width="{SIZE}" height="{SIZE}" rx="{RADIUS}" fill="{BG}"/>\n' + "\n".join(paths) + "\n</svg>\n"
    )
    (out_dir / "icon.svg").write_text(svg)
    print("Wrote", out_dir / "icon.png", "and", out_dir / "icon.svg")


if __name__ == "__main__":
    main()
