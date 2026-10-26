#!/usr/bin/env python3
"""Builds assets/og-image-v1.png, the 1200x630 social share card.

Same shield, palette and typeface as the Play Store feature graphic
(scripts/feature-graphic.js), so a LinkedIn card and the app listing match.
Needs: pip install pillow fonttools brotli cairosvg
Run from the safestart/ folder:  python3 ops/og-image.py
"""
import io, re, os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFont
import cairosvg

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FOREST, CREAM, SPOT = (0x2E, 0x51, 0x3C), (0xFB, 0xF0, 0xE9), (0xD0, 0x9B, 0x6E)
W, H = 1200, 630

app = open(os.path.join(ROOT, 'src', 'app.html'), encoding='utf8').read()
shield = re.search(r"\n\s*shield:\s*'([^']+)'", app).group(1)

def font(weight, size):
    f = TTFont(os.path.join(ROOT, 'assets', 'fonts', 'atkinson-latin.woff2'))
    f = instantiateVariableFont(f, {'wght': weight})
    buf = io.BytesIO(); f.flavor = None; f.save(buf); buf.seek(0)
    return ImageFont.truetype(buf, size)

def svg_png(size, stroke, sw, opacity=1.0):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%s" '
           'stroke-width="%s" stroke-linecap="round" stroke-linejoin="round" opacity="%s">%s</svg>'
           % (stroke, sw, opacity, shield))
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size))).convert('RGBA')

img = Image.new('RGBA', (W, H), FOREST + (255,))
wash = svg_png(820, '#FBF0E9', 1.5, 0.085)
img.alpha_composite(wash, (W - 820 + 140, -120))

d = ImageDraw.Draw(img)
x, y = 96, 150
d.rounded_rectangle((x, y, x + 120, y + 120), radius=31, fill=CREAM)
img.alpha_composite(svg_png(72, '#2E513C', 2.15), (x + 24, y + 24))
d.text((x + 120 + 30, y + 60), 'SafeStart', font=font(800, 104), fill=CREAM, anchor='lm')
d.text((x, y + 190), 'Parental controls, made simple.', font=font(500, 46), fill=CREAM)
d.text((x, y + 262), 'Free step-by-step setup for the apps, games', font=font(400, 30), fill=CREAM + (225,))
d.text((x, y + 304), 'and devices your child uses.', font=font(400, 30), fill=CREAM + (225,))
d.rounded_rectangle((x, y + 372, x + 150, y + 380), radius=4, fill=SPOT)
d.text((x, H - 70), 'A free tool from TrustRaise', font=font(500, 26), fill=CREAM + (200,))

out = os.path.join(ROOT, 'assets', 'og-image-v1.png')
img.convert('RGB').save(out, optimize=True)
print(out, os.path.getsize(out), 'bytes')
