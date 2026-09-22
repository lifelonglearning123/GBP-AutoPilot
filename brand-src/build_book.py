"""GBP Autopilot brand book, Apple-like edition. Writes ./book/project/*.dc.html + canvas.json."""
import io, json, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
A = json.load(io.open(os.path.join(HERE, 'assets.json'), encoding='utf8'))
P, K = A['palette'], A['contrast']
ROOT = os.path.join(HERE, 'book', 'project')
os.makedirs(ROOT, exist_ok=True)

def closed(s):
    return re.sub(r'<(\w+)([^<>]*?)/>', r'<\1\2></\1>', s)
F = {k: closed(v) for k, v in A['frags'].items() if isinstance(v, str)}
SZ = {k: v for k, v in A['frags'].items() if isinstance(v, list)}

SANS = "'DM Sans', system-ui, sans-serif"
DISPLAY = "Sora, 'DM Sans', system-ui, sans-serif"
INK, MUTED, PAPER, NIGHT, PILOT, FOUND = P['ink'], P['slate_dark'], P['paper'], P['night'], P['pilot'], P['found']
SLATE, PILOT_L, TINT, LINE = P['slate'], P['pilot_light'], P['tint'], P['line']
WHITE = '#FFFFFF'
fmt = lambda v: (f'{v:.2f}').rstrip('0').rstrip('.')

def rgb(h):
    h = h.lstrip('#'); return ' '.join(str(int(h[i:i + 2], 16)) for i in (0, 2, 4))

# ------------------------------------------------------------------ page scaffolding
def page(title, w, h, body):
    return f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400..700&amp;family=Sora:wght@400..700&amp;display=swap">
<style>
body{{margin:0}}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
renderVals() {{
return {{}};
}}
}}
</script>
</body>
</html>
'''

def sheet(w, h, bg, inner, color=INK):
    return (f'<div style="width: {w}px; height: {h}px; box-sizing: border-box; padding: 112px 120px 120px; background: {bg}; '
            f'display: flex; flex-direction: column; align-items: center; gap: 72px; font-family: {SANS}; color: {color}; overflow: hidden;">\n{inner}\n</div>')

def header(eyebrow, title, sub, dark=False, sub_w=820):
    tc = WHITE if dark else INK
    sc = SLATE if dark else MUTED
    ec = PILOT_L if dark else PILOT
    return f'''<div style="display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center;">
<div style="font-family: {SANS}; font-size: 21px; font-weight: 600; color: {ec};">{eyebrow}</div>
<h1 style="margin: 0; font-family: {DISPLAY}; font-size: 72px; line-height: 1.04; font-weight: 600; letter-spacing: -0.04em; color: {tc};">{title}</h1>
<p style="margin: 0; max-width: {sub_w}px; font-family: {SANS}; font-size: 24px; line-height: 1.42; color: {sc};">{sub}</p>
</div>'''

def tile(inner, w=None, h=None, bg=WHITE, pad=40, radius=30, extra='', flex=None):
    size = (f'width: {w}px; ' if w else '') + (f'height: {h}px; ' if h else '') + (f'flex: {flex}; ' if flex else '')
    return (f'<div style="{size}box-sizing: border-box; background: {bg}; border-radius: {radius}px; padding: {pad}px; '
            f'display: flex; flex-direction: column; overflow: hidden; position: relative;{extra}">{inner}</div>')

def label(title, text, dark=False, on_pilot=False, maxw=460):
    tc = WHITE if (dark or on_pilot) else INK
    sc = '#E4E1FF' if on_pilot else (SLATE if dark else MUTED)
    return (f'<div style="display: flex; flex-direction: column; gap: 6px;">'
            f'<div style="font-family: {DISPLAY}; font-size: 22px; font-weight: 600; letter-spacing: -0.015em; color: {tc};">{title}</div>'
            f'<div style="font-family: {SANS}; font-size: 17px; line-height: 1.45; color: {sc}; max-width: {maxw}px;">{text}</div></div>')

def box(key, w, h, extra=''):
    return f'<div style="width: {w:.0f}px; height: {h:.0f}px; flex-shrink: 0;{extra}">{F[key]}</div>'

def lock(key, w):
    lw, lh = SZ[key + '_size']
    return box(key, w, w * lh / lw)

def centre(inner, extra=''):
    return f'<div style="flex: 1 1 0; display: flex; align-items: center; justify-content: center;{extra}">{inner}</div>'

def row(*items, gap=20, h=None):
    hh = f' height: {h}px;' if h else ''
    return f'<div style="width: 1200px; display: flex; gap: {gap}px;{hh}">{"".join(items)}</div>'

def nest(key, x, y, w, h):
    """An inline fragment as a nested <svg> placed inside a larger drawing."""
    return re.sub(r'<svg xmlns="http://www.w3.org/2000/svg" (viewBox="[^"]+") role="img" aria-label="[^"]*" style="[^"]*">',
                  lambda m: f'<svg x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" height="{fmt(h)}" {m.group(1)}>', F[key], count=1)

# ------------------------------------------------------------------ mark geometry (same as gen_assets.py)
HEAD, R, TIP, PITCH, DOT, CORE = (32.0, 25.0), 21.0, 60.0, 10.0, 2.7, 5.4
def pin_d(cx=32.0, cy=25.0, r=21.0, tip=60.0, round_=3.2):
    a = math.acos(r / (tip - cy)); tx, ty = r * math.sin(a), r * math.cos(a)
    Rt, Lt = (cx + tx, cy + ty), (cx - tx, cy + ty)
    def toward(p, k):
        vx, vy = p[0] - cx, p[1] - tip; n = math.hypot(vx, vy); return (cx + vx / n * k, tip + vy / n * k)
    pl, pr = toward(Lt, round_), toward(Rt, round_)
    return (f'M{fmt(pl[0])} {fmt(pl[1])}Q{fmt(cx)} {fmt(tip)} {fmt(pr[0])} {fmt(pr[1])}'
            f'L{fmt(Rt[0])} {fmt(Rt[1])}A{fmt(r)} {fmt(r)} 0 1 0 {fmt(Lt[0])} {fmt(Lt[1])}Z'), Rt, Lt
PIN, RT, LT = pin_d()
GRID = [(HEAD[0] + i * PITCH, HEAD[1] + j * PITCH) for j in (-1, 0, 1) for i in (-1, 0, 1) if (i, j) != (0, 0)]
NS = 'vector-effect="non-scaling-stroke"'

def svg_wrap(vb, inner, label_, w='100%', h='100%'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{label_}" '
            f'style="display: block; width: {w}; height: {h};">{inner}</svg>')

# ------------------------------------------------------------------ 1. cover: the pin in a grid that fades with distance
def mix(a, b, t):
    a, b = a.lstrip('#'), b.lstrip('#')
    return '#' + ''.join(f'{round(int(a[i:i+2], 16) * (1 - t) + int(b[i:i+2], 16) * t):02X}' for i in (0, 2, 4))

CW, CH = 1440, 940
S = 440                     # the pin box on the cover
BX, BY = (CW - S) / 2, 420  # its top-left
u = S / 64
hx, hy = BX + HEAD[0] * u, BY + HEAD[1] * u
pitch, dr = PITCH * u, DOT * u
dots = []
for j in range(-9, 7):
    for i in range(-12, 13):
        x, y = hx + i * pitch, hy + j * pitch
        if x < -dr or x > CW + dr or y < -dr or y > CH + dr: continue
        d = math.hypot(i, j)
        if d < 1.5: continue                     # inside the head: the mark draws these
        t = min(1.0, max(0.0, (d - 2) / 5.5))    # near: dim indigo, far: almost the ground
        dots.append(f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{fmt(dr)}" fill="{mix("#3B3491", "#131722", t)}"></circle>')
field = svg_wrap(f'0 0 {CW} {CH}', ''.join(dots), 'A map grid around the business', f'{CW}px', f'{CH}px')

cover = f'''<div style="width: {CW}px; height: {CH}px; position: relative; overflow: hidden; background: {NIGHT}; font-family: {SANS};">
<div style="position: absolute; left: 0; top: 0;">{field}</div>
<div style="position: absolute; left: {fmt(BX)}px; top: {fmt(BY)}px; width: {S}px; height: {S}px;">{F['A']}</div>
<div style="position: absolute; left: 0; top: 96px; width: {CW}px; display: flex; flex-direction: column; align-items: center; gap: 26px; text-align: center;">
{lock('lockup_dark', 210)}
<h1 style="margin: 0; font-family: {DISPLAY}; font-size: 92px; line-height: 1; font-weight: 600; letter-spacing: -0.045em; color: {WHITE};">Local SEO, on a schedule.</h1>
<p style="margin: 0; font-family: {SANS}; font-size: 22px; color: {SLATE};">Brand guidelines, September 2026</p>
</div>
</div>'''

# ------------------------------------------------------------------ 2. the mark: construction and anatomy
def construction():
    lines = []
    g = '#D8D4FB'
    lines.append(f'<rect x="0" y="0" width="64" height="64" fill="none" stroke="#D5D8E0" stroke-width="1" stroke-dasharray="5 5" {NS}></rect>')
    for x in (22, 32, 42):
        lines.append(f'<line x1="{x}" y1="-2" x2="{x}" y2="66" stroke="{g}" stroke-width="1" {NS}></line>')
    for y in (15, 25, 35):
        lines.append(f'<line x1="-2" y1="{y}" x2="66" y2="{y}" stroke="{g}" stroke-width="1" {NS}></line>')
    body = (f'<path d="{PIN}" fill="#EEECFE"></path>'
            + ''.join(f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{DOT}" fill="#C9C3FB"></circle>' for x, y in GRID)
            + f'<circle cx="32" cy="25" r="{CORE}" fill="{FOUND}"></circle>')
    over = [f'<circle cx="32" cy="25" r="{R}" fill="none" stroke="{PILOT}" stroke-width="1.25" {NS}></circle>']
    for p in (RT, LT):   # tangents from the tip, carried past the head
        vx, vy = p[0] - 32, p[1] - TIP; n = math.hypot(vx, vy)
        ex, ey = p[0] + vx / n * 9, p[1] + vy / n * 9
        over.append(f'<line x1="32" y1="{TIP}" x2="{fmt(ex)}" y2="{fmt(ey)}" stroke="{PILOT}" stroke-width="1.25" {NS}></line>')
    a = math.radians(-45); rx, ry = 32 + R * math.cos(a), 25 + R * math.sin(a)
    over.append(f'<line x1="32" y1="25" x2="{fmt(rx)}" y2="{fmt(ry)}" stroke="{PILOT}" stroke-width="1.25" {NS}></line>')
    over.append(f'<circle cx="32" cy="25" r="0.9" fill="{PILOT}"></circle><circle cx="32" cy="{TIP}" r="0.9" fill="{PILOT}"></circle>')
    t = f'font-family="DM Sans, sans-serif" font-size="2.5" fill="{MUTED}"'
    dims = [
        # pitch, above the square
        f'<line x1="22" y1="-4.5" x2="32" y2="-4.5" stroke="{MUTED}" stroke-width="1" {NS}></line>',
        f'<line x1="22" y1="-5.6" x2="22" y2="-3.4" stroke="{MUTED}" stroke-width="1" {NS}></line><line x1="32" y1="-5.6" x2="32" y2="-3.4" stroke="{MUTED}" stroke-width="1" {NS}></line>',
        f'<text x="27" y="-6.6" text-anchor="middle" {t}>10</text>',
        # height, right of the square
        f'<line x1="69" y1="4" x2="69" y2="60" stroke="{MUTED}" stroke-width="1" {NS}></line>',
        f'<line x1="67.9" y1="4" x2="70.1" y2="4" stroke="{MUTED}" stroke-width="1" {NS}></line><line x1="67.9" y1="60" x2="70.1" y2="60" stroke="{MUTED}" stroke-width="1" {NS}></line>',
        f'<text x="71.2" y="32.9" {t}>56</text>',
        f'<text x="{fmt(32 + 23.2 * math.cos(a))}" y="{fmt(25 + 23.2 * math.sin(a))}" {t} fill="{PILOT}">r 21</text>',
        f'<text x="1" y="67.6" {t}>64 × 64 unit square</text>',
    ]
    return svg_wrap('-6 -10 84 82', ''.join(lines) + body + ''.join(over) + ''.join(dims), 'How the mark is built')

def part_icon(kind):
    if kind == 'pin':
        inner = f'<path d="{PIN}" fill="none" stroke="{PILOT}" stroke-width="2" stroke-linejoin="round" {NS}></path>'
    elif kind == 'grid':
        inner = ''.join(f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{DOT}" fill="{TINT}"></circle>' for x, y in GRID)
    else:
        inner = f'<circle cx="32" cy="25" r="{CORE}" fill="{FOUND}"></circle>'
    vb = '8 1 48 62' if kind == 'pin' else '11 4 42 42'
    return f'<div style="width: 76px; height: 76px; flex-shrink: 0;">{svg_wrap(vb, inner, kind)}</div>'

def part(kind, title, text):
    return tile(f'<div style="display: flex; gap: 26px; align-items: center; height: 100%;">{part_icon(kind)}{label(title, text)}</div>',
                h=200, pad=32, radius=28)

mark_page = sheet(1440, 1150, PAPER, f'''
{header('The mark', 'One pin. Every search around it.', 'A map pin holding the grid of points the product searches from. The green centre is the business, found in the top three.')}
{row(tile(f'{label("Construction", "Drawn on a 64-unit square. A 21-unit head, tangents to the tip, grid points 10 units apart.")}' + centre(f'<div style="width: 474px; height: 462px;">{construction()}</div>'), w=760, h=640),
     f'<div style="flex: 1 1 0; display: flex; flex-direction: column; gap: 20px;">'
     + part('pin', 'The pin', 'Local. Every search starts from a place.')
     + part('grid', 'The grid', 'The eight points a map grid searches from.')
     + part('core', 'The centre', 'The business, in the colour of a top-three result.')
     + '</div>')}
''')

# ------------------------------------------------------------------ 3. logo versions
lock_page = sheet(1440, 1620, PAPER, f'''
{header('Logo', 'Full colour first.', 'Use it wherever the ground allows. The other versions cover dark grounds, the accent colour and one-colour print.')}
<div style="display: flex; flex-direction: column; gap: 20px;">
{row(tile(label('Full colour', 'White and light grounds.') + centre(lock('lockup', 600)), w=1200, h=380))}
{row(tile(label('Dark', 'The app and dark slides.', dark=True) + centre(lock('lockup_dark', 300)), flex='1 1 0', h=320, bg=NIGHT),
     tile(label('On the accent', 'Buttons, banners and merchandise.', on_pilot=True) + centre(lock('lockup_white', 300)), flex='1 1 0', h=320, bg=PILOT),
     tile(label('One colour', 'Print, embossing and stamps.') + centre(lock('lockup_ink', 300)), flex='1 1 0', h=320))}
{row(tile(label('Stacked', 'Square spaces and profile pictures.') + centre(lock('stacked', 250)), flex='2 1 0', h=360),
     tile(label('Mark', 'When the name is already on the page.') + centre(box('A', 140, 140)), flex='1 1 0', h=360),
     tile(label('Small mark', 'Below 32 pixels.') + centre(box('A_small', 80, 80)), flex='1 1 0', h=360))}
</div>
''')

# ------------------------------------------------------------------ 4. clear space and size
lw, lh = SZ['lockup_size']
def clear_space():
    X = 21                                   # the head's radius, in lockup units
    W, H = lw + 2 * X, lh + 2 * X
    q = []
    q.append(f'<rect x="0" y="0" width="{fmt(W)}" height="{fmt(H)}" fill="#F3F2FF" rx="2"></rect>')
    q.append(f'<rect x="{X}" y="{X}" width="{fmt(lw)}" height="{fmt(lh)}" fill="none" stroke="#D8D4FB" stroke-width="1" {NS}></rect>')
    q.append(nest('lockup', X, X, lw, lh))
    sq = f'fill="none" stroke="{PILOT}" stroke-width="1.25" stroke-dasharray="3 3" {NS}'
    t = f'font-family="DM Sans, sans-serif" font-size="9" font-style="italic" fill="{PILOT}" text-anchor="middle"'
    for (x, y) in ((0, X + lh / 2 - X / 2), (W - X, X + lh / 2 - X / 2), (X + 29 - X / 2, 0), (X + 29 - X / 2, H - X)):
        q.append(f'<rect x="{fmt(x)}" y="{fmt(y)}" width="{X}" height="{X}" {sq}></rect>')
        q.append(f'<text x="{fmt(x + X / 2)}" y="{fmt(y + X / 2 + 3)}" {t}>x</text>')
    return svg_wrap(f'-1 -1 {fmt(W + 2)} {fmt(H + 2)}', ''.join(q), 'Clear space around the logo')

def size_row(inner, title, text):
    return (f'<div style="display: flex; align-items: center; gap: 24px;"><div style="width: 140px; display: flex; justify-content: flex-start;">{inner}</div>'
            f'<div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-family: {DISPLAY}; font-size: 18px; font-weight: 600; color: {INK};">{title}</div>'
            f'<div style="font-size: 15px; color: {MUTED};">{text}</div></div></div>')

space_page = sheet(1440, 1040, PAPER, f'''
{header('Clear space and size', 'Give it room.', 'Keep a margin of x on every side, where x is the radius of the pin’s head. Never set the logo smaller than shown here.')}
{row(tile(label('Clear space', 'Nothing else sits inside the tinted area.') + centre(f'<div style="width: 620px; height: 184px;">{clear_space()}</div>'), w=760, h=520),
     tile(label('Minimum size', 'On screen and in print.') + f'<div style="flex: 1 1 0; display: flex; flex-direction: column; justify-content: center; gap: 34px;">'
          + size_row(lock('lockup', 120), 'Logo', '120 px wide, 30 mm in print')
          + size_row(box('A', 32, 32), 'Mark', '32 px')
          + size_row(box('A_small', 16, 16), 'Small mark', '16 px, favicons only')
          + '</div>', flex='1 1 0', h=520))}
''')

# ------------------------------------------------------------------ 5. app icon
def tab():
    return (f'<div style="display: flex; align-items: center; gap: 16px; width: 330px; padding: 20px 24px; border-radius: 18px 18px 0 0; background: #1B2130;">'
            f'{box("fav", 32, 32)}<span style="font-size: 22px; color: #E8ECF3;">GBP Autopilot</span></div>')

def icon_size(s, text):
    return (f'<div style="display: flex; flex-direction: column; align-items: center; gap: 14px;"><div style="height: 120px; display: flex; align-items: flex-end;">{box("icon", s, s)}</div>'
            f'<div style="font-size: 15px; color: {MUTED};">{text}</div></div>')

icon_page = sheet(1440, 1140, PAPER, f'''
{header('App icon', 'Clear at every size.', 'At 32 pixels and below, the grid drops out. The pin and its green centre carry the icon on their own.')}
{row(tile(label('App icon', 'One master at 512 pixels, masked by each platform.') + centre(box('icon', 300, 300, ' filter: drop-shadow(0 28px 40px rgba(86, 70, 232, 0.28));')), w=760, h=620),
     f'<div style="flex: 1 1 0; display: flex; flex-direction: column; gap: 20px;">'
     + tile(label('Favicon', 'The small mark on an indigo tile, at twice its size.', dark=True) + centre(tab(), ' align-items: flex-end; margin-bottom: -40px;'), h=300, bg=NIGHT)
     + tile(label('Sizes', 'Exported as PNG and SVG.') + f'<div style="flex: 1 1 0; display: flex; align-items: flex-end; justify-content: space-between;">'
            + icon_size(90, '180') + icon_size(64, '64') + icon_size(32, '32') + icon_size(16, '16') + '</div>', h=300)
     + '</div>')}
''')

# ------------------------------------------------------------------ 6. colour
def big_swatch(name, hexv, role, contrast_line, fg, sub, flex, h, border=False):
    b = f' border: 1px solid #E3E5EC;' if border else ''
    return tile(f'''<div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
<div style="display: flex; flex-direction: column; gap: 8px;">
<div style="font-family: {DISPLAY}; font-size: 34px; font-weight: 600; letter-spacing: -0.03em; color: {fg};">{name}</div>
<div style="font-size: 17px; line-height: 1.45; color: {sub}; max-width: 340px;">{role}</div>
</div>
<div style="display: flex; flex-direction: column; gap: 4px; font-size: 16px; color: {fg}; font-variant-numeric: tabular-nums;">
<div style="font-family: {DISPLAY}; font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">{hexv}</div><div style="color: {sub};">RGB {rgb(hexv)}</div><div style="color: {sub};">{contrast_line}</div>
</div>
</div>''', flex=flex, h=h, bg=hexv, extra=b)

def dot(hexv, name, note):
    return (f'<div style="display: flex; align-items: center; gap: 14px;"><div style="width: 44px; height: 44px; border-radius: 50%; background: {hexv}; flex-shrink: 0;"></div>'
            f'<div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 16px; font-weight: 600; color: {INK};">{name}</div>'
            f'<div style="font-size: 14px; color: {MUTED}; font-variant-numeric: tabular-nums;">{hexv}, {note}</div></div></div>')

colour_page = sheet(1440, 1600, PAPER, f'''
{header('Colour', 'Two colours do the work.', 'Pilot indigo carries the brand. Found green means one thing: a business in the top three.')}
<div style="display: flex; flex-direction: column; gap: 20px;">
{row(big_swatch('Pilot', PILOT, 'Primary. The pin, buttons and links.', f'White text {K["white on pilot"]}:1', WHITE, '#E4E1FF', '2 1 0', 440),
     big_swatch('Found', FOUND, 'The business, found. Top-three results.', f'Night text {K["night on found"]}:1', NIGHT, '#12402A', '1 1 0', 440))}
{row(big_swatch('Night', NIGHT, 'The app’s ground.', f'Slate text {K["slate on night"]}:1', WHITE, SLATE, '1 1 0', 260),
     big_swatch('Ink', INK, 'Text on light grounds.', f'On Paper {K["ink on paper"]}:1', WHITE, SLATE, '1 1 0', 260),
     big_swatch('Paper', PAPER, 'Reports and print.', f'Pilot text {K["pilot on paper"]}:1', INK, MUTED, '1 1 0', 260, True))}
{row(tile(label('Supporting', 'Tints of Pilot for detail, and a muted grey.') + f'<div style="display: flex; flex-direction: column; gap: 18px; margin-top: 28px;">'
          + dot(PILOT_L, 'Pilot light', 'accent on Night') + dot(TINT, 'Tint', 'grid points') + dot(SLATE, 'Slate', 'muted text on Night') + '</div>', flex='1 1 0', h=340),
     tile(label('Data colours', 'Rank positions in maps and reports. Never decoration.') + f'<div style="display: flex; flex-direction: column; gap: 18px; margin-top: 28px;">'
          + dot(FOUND, 'Top three', '1st to 3rd') + dot(P['warn'], 'First page', '4th to 10th') + dot(P['bad'], 'Second page', '11th to 20th') + '</div>', flex='1 1 0', h=340))}
</div>
''')

# ------------------------------------------------------------------ 7. type
def specimen(family, css, weight, name, text):
    return tile(f'''<div style="font-family: {css}; font-size: 190px; line-height: 1; font-weight: {weight}; letter-spacing: -0.04em; color: {INK};">Aa</div>
<div style="margin-top: auto;">{label(name, text)}</div>''', flex='1 1 0', h=420, pad=44)

def scale_row(name, spec, sample, css, size, weight, lh, track, last=False):
    border = '' if last else f' border-bottom: 1px solid #ECEDF1;'
    return (f'<div style="display: flex; align-items: baseline; gap: 40px; padding: 22px 0;{border}">'
            f'<div style="width: 250px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 16px; font-weight: 600; color: {INK};">{name}</div>'
            f'<div style="font-size: 14px; color: {MUTED};">{spec}</div></div>'
            f'<div style="font-family: {css}; font-size: {size}px; line-height: {lh}; font-weight: {weight}; letter-spacing: {track}; color: {INK};">{sample}</div></div>')

type_page = sheet(1440, 1700, PAPER, f'''
{header('Typography', 'Sora for headlines. DM Sans for everything else.', 'Both are free on Google Fonts. Set headlines tight, body text loose.')}
<div style="display: flex; flex-direction: column; gap: 20px;">
{row(specimen('Sora', DISPLAY, 600, 'Sora', 'Headlines and the wordmark. 500, 600, 700.'),
     specimen('DM Sans', SANS, 500, 'DM Sans', 'Body, the app and reports. 400, 500, 700.'))}
{row(tile(label('Type scale', 'Sizes in pixels, line height, then tracking.') + '<div style="margin-top: 18px;">'
          + scale_row('Display', 'Sora 600, 64/68, −4%', 'Found locally.', DISPLAY, 64, 600, 1.06, '-0.04em')
          + scale_row('Title', 'Sora 600, 40/46, −3%', 'Share of local search', DISPLAY, 40, 600, 1.15, '-0.03em')
          + scale_row('Headline', 'Sora 600, 24/30, −1.5%', 'Reviews waiting for a reply', DISPLAY, 24, 600, 1.25, '-0.015em')
          + scale_row('Body', 'DM Sans 400, 17/26', 'Each point on the map is a search from that spot. Distance weighs heavily, so where a customer stands changes who they see first.', SANS, 17, 400, 1.55, '0')
          + scale_row('Caption', 'DM Sans 500, 13/18', 'Checked on 21 September 2026', SANS, 13, 500, 1.4, '0', True)
          + '</div>', w=1200, pad=44))}
</div>
''')

# ------------------------------------------------------------------ 8. keep it as drawn
CROSS = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" style="display: block; width: 24px; height: 24px; flex-shrink: 0;">'
         f'<circle cx="12" cy="12" r="10" fill="none" stroke="#C2352B" stroke-width="2"></circle><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#C2352B" stroke-width="2" stroke-linecap="round"></path></svg>')
google = F['A'].replace(P['pilot'], '#4285F4').replace(P['tint'], '#FBBC05').replace(P['found'], '#EA4335')
redcore = F['A'].replace(P['found'], P['bad'])
stretched = F['A'].replace('<svg ', '<svg preserveAspectRatio="none" ', 1)

def dont(inner, text, bg=PAPER):
    stage = f'<div style="height: 236px; flex-shrink: 0; border-radius: 20px; background: {bg}; display: flex; align-items: center; justify-content: center; margin-bottom: 22px;">{inner}</div>'
    return tile(stage + f'<div style="display: flex; gap: 12px; align-items: flex-start;">{CROSS}<div style="font-size: 17px; line-height: 1.4; color: {INK};">{text}</div></div>',
                flex='1 1 0', h=360, pad=20, extra=' padding-bottom: 26px;')

usage_page = sheet(1440, 1080, PAPER, f'''
{header('Using the logo', 'Keep it as drawn.', 'Its colours and proportions only work exactly as supplied.')}
<div style="display: flex; flex-direction: column; gap: 20px;">
{row(dont(f'<div style="width: 120px; height: 120px;">{google}</div>', 'Don’t use Google’s colours.'),
     dont(f'<div style="width: 120px; height: 120px;">{redcore}</div>', 'Don’t recolour the centre.'),
     dont(f'<div style="width: 190px; height: 104px;">{stretched}</div>', 'Don’t stretch or squash it.'),
     dont(f'<div style="width: 120px; height: 120px;">{F["A"]}</div>', 'Don’t place it on a similar colour.', '#6C5FF2'))}
{row(tile(label('An independent product', 'GBP Autopilot is not affiliated with or endorsed by Google. Never place Google’s logo, its multicolour G or the Google Maps pin next to ours.', maxw=760), w=1200, pad=40))}
</div>
''')

# ------------------------------------------------------------------ 9. in the app
def navitem(text, active=False):
    st = f'background: #171C25; color: #E8ECF3;' if active else f'color: {SLATE};'
    return f'<div style="padding: 8px 12px; border-radius: 8px; font-size: 14px; {st}">{text}</div>'

def pill(text, fg, bd, bg):
    return f'<span style="display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: {fg}; border: 1px solid {bd}; background: {bg};">{text}</span>'

def locrow(text):
    return f'<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 8px; font-size: 14px; color: {SLATE};"><span>{text}</span>{pill("[score]", "#E8ECF3", LINE, "transparent")}</div>'

mini = ''.join(f'<div style="width: 14px; height: 14px; border-radius: 50%; background: {FOUND if (i, j) == (2, 2) else "#2A2F52"};"></div>' for j in range(5) for i in range(5))
window = f'''<div style="width: 1200px; height: 700px; display: flex; border-radius: 22px; overflow: hidden; background: {NIGHT}; border: 1px solid {LINE}; box-shadow: 0 50px 100px rgba(0, 0, 0, 0.55);">
<div style="width: 240px; flex-shrink: 0; box-sizing: border-box; border-right: 1px solid {LINE}; padding: 24px 14px; display: flex; flex-direction: column; gap: 24px;">
<div style="display: flex; flex-direction: column; gap: 8px; padding: 0 4px;">{lock('lockup_dark', 180)}<div style="font-size: 12px; color: {SLATE};">Local SEO, on a schedule</div></div>
<div style="display: flex; flex-direction: column; gap: 4px;">{navitem('Dashboard', True)}{navitem('Prospecting')}{navitem('Job log')}{navitem('Settings')}{navitem('Help')}</div>
<div style="display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 12px; color: {SLATE}; padding: 0 4px 6px;">Locations</div>{locrow('[Location name]')}{locrow('[Location name]')}{locrow('[Location name]')}</div>
<div style="margin-top: auto; padding: 0 4px;">{pill('Live', FOUND, '#2A5A41', '#1C3B2C')}</div>
</div>
<div style="flex: 1 1 0; box-sizing: border-box; padding: 36px 40px; display: flex; flex-direction: column; gap: 24px; font-family: {SANS}; color: #E8ECF3;">
<div style="display: flex; justify-content: space-between; align-items: center;">
<div style="font-family: {DISPLAY}; font-size: 28px; font-weight: 600; letter-spacing: -0.02em; color: {WHITE};">[Location name]</div>
<div style="display: flex; gap: 10px;">
<button type="button" style="padding: 10px 16px; border-radius: 10px; font-family: {SANS}; font-size: 14px; font-weight: 600; border: 1px solid {LINE}; background: #171C25; color: #E8ECF3;">Rebuild report</button>
<button type="button" style="padding: 10px 16px; border-radius: 10px; font-family: {SANS}; font-size: 14px; font-weight: 600; border: 1px solid {PILOT}; background: {PILOT}; color: {WHITE};">Run a map grid</button>
</div></div>
<div style="display: flex; gap: 6px;">{navitem('Overview')}{navitem('Reviews')}{navitem('Posts')}{navitem('Competitors')}{navitem('Map', True)}{navitem('Citations')}</div>
<div style="flex: 1 1 0; display: flex; gap: 20px;">
<div style="flex: 3 1 0; background: {P['panel']}; border: 1px solid {LINE}; border-radius: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px;">
<div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 22px;">{mini}</div>
<div style="font-family: {DISPLAY}; font-size: 20px; font-weight: 600; color: {WHITE};">No map yet</div>
<div style="font-size: 15px; color: {SLATE}; text-align: center; max-width: 400px; line-height: 1.5;">Run a map grid to see where customers can still find this business as they move away from it.</div>
</div>
<div style="flex: 2 1 0; background: {P['panel']}; border: 1px solid {LINE}; border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 14px; font-size: 14px;">
<div style="font-size: 13px; color: {SLATE};">Map key</div>
<div style="display: flex; gap: 10px; align-items: center;">{pill('Top 3', FOUND, '#2A5A41', '#1C3B2C')}<span style="color: {SLATE};">1st to 3rd</span></div>
<div style="display: flex; gap: 10px; align-items: center;">{pill('Page 1', P['warn'], '#5A4A1E', '#3A2F10')}<span style="color: {SLATE};">4th to 10th</span></div>
<div style="display: flex; gap: 10px; align-items: center;">{pill('Page 2', P['bad'], '#5A2A26', '#3B1C1A')}<span style="color: {SLATE};">11th to 20th</span></div>
</div></div></div></div>'''

app_page = sheet(1440, 1240, NIGHT, f'''
{header('In the app', 'At home in the app.', 'The app runs on Night. Indigo marks the main action on each screen, and everything else stays quiet.', dark=True)}
{window}
''', color=WHITE)

# ------------------------------------------------------------------ 10. explorations
def sketch(key, name, text, chosen):
    tag = (f'<div style="font-size: 15px; font-weight: 600; color: {PILOT};">Chosen</div>' if chosen else f'<div style="font-size: 15px; color: {MUTED};">Explored</div>')
    return tile(f'<div style="display: flex; justify-content: space-between; align-items: baseline;">{label(name, text)}{tag}</div>'
                + centre(box(key, 150, 150)), flex='1 1 0', h=420, extra=(f' box-shadow: inset 0 0 0 2px {PILOT};' if chosen else ''))

dir_page = sheet(1440, 940, PAPER, f'''
{header('Explorations', 'Three sketches. One mark.', 'The grid pin was chosen because it shows what the product does: it searches a grid of points around a business.')}
{row(sketch('A', 'Grid pin', 'A pin holding the search grid.', True),
     sketch('B', 'Climb', 'A pin with a rising chevron.', False),
     sketch('C', 'Orbit', 'A loop around a location.', False))}
''')

# ------------------------------------------------------------------ write
pages = [
    ('Main.dc.html', 'Cover', CW, CH, cover),
    ('Mark.dc.html', 'The mark', 1440, 1150, mark_page),
    ('Lockups.dc.html', 'Logo', 1440, 1620, lock_page),
    ('Space.dc.html', 'Clear space and size', 1440, 1040, space_page),
    ('Icons.dc.html', 'App icon', 1440, 1140, icon_page),
    ('Colour.dc.html', 'Colour', 1440, 1600, colour_page),
    ('Type.dc.html', 'Typography', 1440, 1700, type_page),
    ('Usage.dc.html', 'Using the logo', 1440, 1080, usage_page),
    ('InProduct.dc.html', 'In the app', 1440, 1240, app_page),
    ('Directions.dc.html', 'Explorations', 1440, 940, dir_page),
]
idx = {'v': 3, 'createdOnFiles': {'v': 1, 'at': '2026-09-21T20:25:00Z'}, 'title': 'GBP Autopilot brand', 'launch': {'view': 'canvas'},
       'pages': [], 'boards': {}, 'order': [p[0] for p in pages], 'notes': {}, 'designSystems': []}
y = 0
for r in range(0, len(pages), 2):
    pair = pages[r:r + 2]
    for c, (name, title, w, h, body) in enumerate(pair):
        io.open(os.path.join(ROOT, name), 'w', encoding='utf8').write(page(f'GBP Autopilot: {title.lower()}', w, h, body))
        idx['boards'][name] = {'x': c * (1440 + 80), 'y': y, 'w': w, 'h': h, 'title': title}
    y += max(p[3] for p in pair) + 120
io.open(os.path.join(ROOT, 'canvas.json'), 'w', encoding='utf8').write(json.dumps(idx, indent=1))
for name, *_ in pages: print(name, os.path.getsize(os.path.join(ROOT, name)))
