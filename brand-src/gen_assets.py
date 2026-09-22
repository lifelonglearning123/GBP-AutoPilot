"""GBP Autopilot brand: logo geometry, outlined wordmark and export files.

Writes public/brand/*.svg into the app and assets.json (SVG strings) for the brand canvas.
"""
import io, json, math, os
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))  # assets.json and Sora.ttf live beside this script
APP = r'C:\python\Google Business Profile SEO'
OUT = os.path.join(APP, 'public', 'brand')
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- palette
C = dict(
    pilot='#5646E8',        # primary: the pin, primary buttons
    pilot_light='#9A90FF',  # pilot as text or line on the dark ground
    tint='#B3AAFF',         # grid dots on a pilot pin
    tint_white='#C9C3FB',   # grid dots on a white pin
    found='#35D07F',        # the business, found: also the app's top-three colour
    night='#0B0E14',        # dark ground
    panel='#12161D',
    line='#232A35',
    ink='#10131C',          # text on light grounds
    paper='#F6F6F9',        # light ground
    slate='#8892A4',        # muted text on dark
    slate_dark='#5B6272',   # muted text on light
    warn='#FFB02E', bad='#FF5A4E',
)

def lum(h):
    h = h.lstrip('#'); r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def contrast(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True); return round((x + 0.05) / (y + 0.05), 2)

CONTRAST = {
    'white on pilot': contrast('#FFFFFF', C['pilot']),
    'pilot on paper': contrast(C['pilot'], C['paper']),
    'pilot_light on night': contrast(C['pilot_light'], C['night']),
    'ink on paper': contrast(C['ink'], C['paper']),
    'slate on night': contrast(C['slate'], C['night']),
    'slate_dark on paper': contrast(C['slate_dark'], C['paper']),
    'found on pilot': contrast(C['found'], C['pilot']),
    'found on night': contrast(C['found'], C['night']),
    'pilot on night': contrast(C['pilot'], C['night']),
    'night on found': contrast(C['night'], C['found']),
}

fmt = lambda v: (f'{v:.2f}').rstrip('0').rstrip('.')

# ---------------------------------------------------------------- mark A: grid pin
def circle_d(cx, cy, r):
    return f'M{fmt(cx - r)} {fmt(cy)}a{fmt(r)} {fmt(r)} 0 1 0 {fmt(2 * r)} 0a{fmt(r)} {fmt(r)} 0 1 0 {fmt(-2 * r)} 0Z'

def pin_d(cx=32.0, cy=25.0, r=21.0, tip=60.0, round_=3.2):
    d = tip - cy
    a = math.acos(r / d)
    tx, ty = r * math.sin(a), r * math.cos(a)
    R, L = (cx + tx, cy + ty), (cx - tx, cy + ty)
    # soften the tip: start and end a little way up each side, curve through the point
    def toward(p, k):
        vx, vy = p[0] - cx, p[1] - tip; n = math.hypot(vx, vy); return (cx + vx / n * k, tip + vy / n * k)
    pl, pr = toward(L, round_), toward(R, round_)
    return (f'M{fmt(pl[0])} {fmt(pl[1])}Q{fmt(cx)} {fmt(tip)} {fmt(pr[0])} {fmt(pr[1])}'
            f'L{fmt(R[0])} {fmt(R[1])}A{fmt(r)} {fmt(r)} 0 1 0 {fmt(L[0])} {fmt(L[1])}Z')

HEAD = (32.0, 25.0)
PITCH, DOT, CORE = 10.0, 2.7, 5.4
def grid_dots():
    cx, cy = HEAD
    return [(cx + i * PITCH, cy + j * PITCH) for j in (-1, 0, 1) for i in (-1, 0, 1) if (i, j) != (0, 0)]

def mark_a(pin, dots, core):
    """Colour mark: pin, eight grid points, the business at the centre."""
    parts = [f'<path d="{pin_d()}" fill="{pin}"/>']
    parts += [f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{fmt(DOT)}" fill="{dots}"/>' for x, y in grid_dots()]
    parts.append(f'<circle cx="{fmt(HEAD[0])}" cy="{fmt(HEAD[1])}" r="{fmt(CORE)}" fill="{core}"/>')
    return ''.join(parts)

def mark_a_mono(fill):
    """One colour: the grid is cut out of the pin."""
    d = pin_d() + ''.join(circle_d(x, y, DOT) for x, y in grid_dots()) + circle_d(*HEAD, CORE)
    return f'<path fill-rule="evenodd" d="{d}" fill="{fill}"/>'

def mark_a_small(pin, core):
    """Favicon sizes: the grid drops out, the business stays."""
    return f'<path d="{pin_d()}" fill="{pin}"/><circle cx="32" cy="25" r="8.2" fill="{core}"/>'

# ---------------------------------------------------------------- mark B: climb (exploration)
def mark_b():
    pin = pin_d(32, 27, 14.5, 52, 2.4)
    return (f'<rect x="4" y="4" width="56" height="56" rx="15" fill="{C["pilot"]}"/>'
            f'<path d="{pin}" fill="none" stroke="#fff" stroke-width="4.2" stroke-linejoin="round"/>'
            f'<path d="M25.5 30.5 32 24l6.5 6.5" fill="none" stroke="{C["found"]}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>')

# ---------------------------------------------------------------- mark C: orbit (exploration)
def mark_c():
    cx = cy = 32.0; r = 21.0
    a0, sweep = math.radians(-58), math.radians(292)
    a1 = a0 + sweep
    p0 = (cx + r * math.cos(a0), cy + r * math.sin(a0)); p1 = (cx + r * math.cos(a1), cy + r * math.sin(a1))
    arc = f'M{fmt(p0[0])} {fmt(p0[1])}A{fmt(r)} {fmt(r)} 0 1 1 {fmt(p1[0])} {fmt(p1[1])}'
    # arrow head at p1, pointing along the clockwise tangent
    tx, ty = -math.sin(a1), math.cos(a1); nx, ny = math.cos(a1), math.sin(a1)
    s = 7.5
    tipp = (p1[0] + tx * s * 0.9, p1[1] + ty * s * 0.9)
    b1 = (p1[0] + nx * s * 0.75, p1[1] + ny * s * 0.75); b2 = (p1[0] - nx * s * 0.75, p1[1] - ny * s * 0.75)
    head = f'M{fmt(b1[0])} {fmt(b1[1])}L{fmt(tipp[0])} {fmt(tipp[1])}L{fmt(b2[0])} {fmt(b2[1])}Z'
    return (f'<path d="{arc}" fill="none" stroke="{C["pilot"]}" stroke-width="6" stroke-linecap="round"/>'
            f'<path d="{head}" fill="{C["pilot"]}" stroke="{C["pilot"]}" stroke-width="2" stroke-linejoin="round"/>'
            f'<circle cx="32" cy="32" r="8" fill="{C["found"]}"/>')

# ---------------------------------------------------------------- wordmark (Sora, outlined)
FACE = hb.Face(hb.Blob.from_file_path(os.path.join(HERE, 'Sora.ttf')))
def text_d(text, wght, size, x, y, track=0.0):
    font = hb.Font(FACE); font.set_variations({'wght': wght})
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {'kern': True, 'liga': True})
    s = size / FACE.upem
    pen = SVGPathPen(None, ntos=fmt)
    cx = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        font.draw_glyph_with_pen(info.codepoint, TransformPen(pen, (s, 0, 0, -s, x + (cx + pos.x_offset) * s, y - pos.y_offset * s)))
        cx += pos.x_advance + track * FACE.upem
    return pen.getCommands(), cx * s - track * size

CAP = 0.73
def wordmark(x, baseline, size, c_gbp, c_auto):
    """'GBP' heavier and in the accent, 'Autopilot' in the text colour. Returns (svg, width)."""
    d1, w1 = text_d('GBP', 700, size, x, baseline, -0.01)
    space = size * 0.26
    d2, w2 = text_d('Autopilot', 600, size, x + w1 + space, baseline, -0.015)
    return f'<path d="{d1}" fill="{c_gbp}"/><path d="{d2}" fill="{c_auto}"/>', w1 + space + w2

# ---------------------------------------------------------------- lockups
PIN_BOX = (11.0, 4.0, 53.0, 60.0)   # the pin's bounds inside the 64 box

def lockup_h(mark, c_gbp, c_auto, pad=8):
    """Mark left, name right. Pin 56 tall; name cap height ~26, centred on the pin head."""
    size = 36.0
    mark_x = pad - PIN_BOX[0]          # shift so the pin starts at pad
    text_x = pad + (PIN_BOX[2] - PIN_BOX[0]) + 15
    baseline = 25 + CAP * size / 2 + 3.5  # cap middle just below the head centre
    wm, w = wordmark(text_x, baseline, size, c_gbp, c_auto)
    W = text_x + w + pad; H = 64
    return f'<g transform="translate({fmt(mark_x)} 0)">{mark}</g>{wm}', W, H

def lockup_v(mark, c_gbp, c_auto, pad=8):
    size = 30.0
    probe, w = wordmark(0, 0, size, c_gbp, c_auto)
    W = max(w, 64) + 2 * pad
    mark_s = 1.5
    mx = (W - 64 * mark_s) / 2
    base = 64 * mark_s + 18 + CAP * size
    wm, _ = wordmark((W - w) / 2, base, size, c_gbp, c_auto)
    H = base + pad + 4
    return f'<g transform="translate({fmt(mx)} 0) scale({mark_s})">{mark}</g>{wm}', W, H

def svg(inner, w, h, title='GBP Autopilot', bg=None):
    rect = f'<rect width="100%" height="100%" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(w)} {fmt(h)}" width="{fmt(w)}" height="{fmt(h)}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{rect}{inner}</svg>')

def tile(inner_small=False, rx=15):
    mark = mark_a_small('#FFFFFF', C['found']) if inner_small else mark_a('#FFFFFF', C['tint_white'], C['found'])
    # the pin sits a touch high in a tile; nudge it down and shrink so it breathes
    return f'<rect width="64" height="64" rx="{rx}" fill="{C["pilot"]}"/><g transform="translate(32 33) scale(0.78) translate(-32 -32)">{mark}</g>'

A_COLOR = mark_a(C['pilot'], C['tint'], C['found'])
A_DARK = mark_a(C['pilot'], C['tint'], C['found'])          # same mark on the night ground
A_REV = mark_a('#FFFFFF', C['tint_white'], C['found'])      # on a pilot ground
A_INK = mark_a_mono(C['ink'])
A_WHITE = mark_a_mono('#FFFFFF')

files = {}
files['mark.svg'] = svg(A_COLOR, 64, 64)
files['mark-ink.svg'] = svg(A_INK, 64, 64)
files['mark-white.svg'] = svg(A_WHITE, 64, 64)
files['mark-small.svg'] = svg(mark_a_small(C['pilot'], C['found']), 64, 64)
g, w, h = lockup_h(A_COLOR, C['pilot'], C['ink']); files['lockup.svg'] = svg(g, w, h); LH = (w, h)
g, w, h = lockup_h(A_DARK, C['pilot_light'], '#FFFFFF'); files['lockup-dark.svg'] = svg(g, w, h)
g, w, h = lockup_h(A_REV, '#FFFFFF', '#FFFFFF'); files['lockup-white.svg'] = svg(g, w, h)
g, w, h = lockup_h(A_INK, C['ink'], C['ink']); files['lockup-ink.svg'] = svg(g, w, h)
g, w, h = lockup_v(A_COLOR, C['pilot'], C['ink']); files['lockup-stacked.svg'] = svg(g, w, h); LV = (w, h)
g, w, h = lockup_v(A_DARK, C['pilot_light'], '#FFFFFF'); files['lockup-stacked-dark.svg'] = svg(g, w, h)
files['app-icon.svg'] = svg(tile(False), 64, 64)
files['favicon.svg'] = svg(tile(True, rx=14), 64, 64)

for name, s in files.items():
    io.open(os.path.join(OUT, name), 'w', encoding='utf8').write(s)

# inner SVG fragments for the canvas (inline <svg> with a viewBox, sized by the artboard)
def frag(inner, w, h, label='GBP Autopilot'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(w)} {fmt(h)}" role="img" aria-label="{label}" style="display: block; width: 100%; height: 100%;">{inner}</svg>'

frags = {
    'A': frag(A_COLOR, 64, 64, 'Grid pin mark'), 'A_ink': frag(A_INK, 64, 64, 'Grid pin mark, one colour'),
    'A_white': frag(A_WHITE, 64, 64, 'Grid pin mark, white'), 'A_rev': frag(A_REV, 64, 64, 'Grid pin mark on the accent'),
    'A_small': frag(mark_a_small(C['pilot'], C['found']), 64, 64, 'Small-size mark'),
    'B': frag(mark_b(), 64, 64, 'Climb mark'), 'C': frag(mark_c(), 64, 64, 'Orbit mark'),
    'icon': frag(tile(False), 64, 64, 'App icon'), 'fav': frag(tile(True, 14), 64, 64, 'Favicon'),
}
for key, (m, a, b) in {'lockup': (A_COLOR, C['pilot'], C['ink']), 'lockup_dark': (A_DARK, C['pilot_light'], '#FFFFFF'),
                       'lockup_white': (A_REV, '#FFFFFF', '#FFFFFF'), 'lockup_ink': (A_INK, C['ink'], C['ink'])}.items():
    g, w, h = lockup_h(m, a, b); frags[key] = frag(g, w, h); frags[key + '_size'] = [w, h]
for key, (m, a, b) in {'stacked': (A_COLOR, C['pilot'], C['ink']), 'stacked_dark': (A_DARK, C['pilot_light'], '#FFFFFF')}.items():
    g, w, h = lockup_v(m, a, b); frags[key] = frag(g, w, h); frags[key + '_size'] = [w, h]

json.dump({'palette': C, 'contrast': CONTRAST, 'frags': frags}, io.open(os.path.join(HERE, 'assets.json'), 'w', encoding='utf8'))
print('files:', ', '.join(sorted(files)))
print('lockup', [round(v, 1) for v in LH], 'stacked', [round(v, 1) for v in LV])
for k, v in CONTRAST.items(): print(f'  {k}: {v}')
