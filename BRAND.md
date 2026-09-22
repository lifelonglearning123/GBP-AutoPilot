# GBP Autopilot brand

The full brand board (directions, lockups, icons, colour, type, usage, the app) is a private canvas:
https://claude.ai/artifact/Eq6BgDxCUqGEtbTac9V7jP

## The mark

A map pin holding the search grid: eight grid points around the business at the centre. The centre is
Found green, the colour the product gives a top-three position. Below 32 px use `mark-small.svg`
(the pin with only its green centre).

## Files (`public/brand/`)

| File | Use |
|---|---|
| `lockup.svg` | Primary, light grounds |
| `lockup-dark.svg` | Dark grounds, the app sidebar |
| `lockup-white.svg` | On the Pilot accent |
| `lockup-ink.svg` | One colour, print |
| `lockup-stacked.svg`, `lockup-stacked-dark.svg` | Square spaces |
| `mark.svg`, `mark-ink.svg`, `mark-white.svg`, `mark-small.svg` | Mark only |
| `app-icon.svg`, `app-icon-512/192/180.png` | App icon |
| `favicon.svg`, `favicon.ico`, `favicon-48/32/16.png` | Favicon |

The app uses `src/app/icon.svg` (favicon) and `src/app/apple-icon.png`, which Next.js picks up by name.
The wordmark is outlined, so the SVGs need no font installed.

## Colour

| Name | Hex | Role |
|---|---|---|
| Pilot | `#5646E8` | Primary: the pin, buttons. White text 6.1:1 |
| Pilot light | `#9A90FF` | Accent as text or line on Night. 7.2:1 |
| Tint | `#B3AAFF` | Grid points in the mark |
| Found | `#35D07F` | The business, found; top-three colour |
| Night | `#0B0E14` | Dark ground, the app |
| Ink | `#10131C` | Text on light grounds |
| Paper | `#F6F6F9` | Light ground, reports |
| Slate | `#8892A4` | Muted text on Night |

Rank colours (`#35D07F`, `#FFB02E`, `#FF5A4E`) carry data only. In the app the accent is `--accent`;
use `--accent-text` for accent-coloured text on the dark ground.

## Type

Sora (wordmark and headings, 500 to 700) and DM Sans (body, interface, reports). Both are on Google Fonts.

## Rules

- Clear space: the radius of the pin's head on every side.
- Minimum size: lockup 120 px wide on screen, 30 mm in print; mark 32 px, then the small mark.
- Never use Google's colours, logo, multicolour G or Maps pin. Add "not affiliated with or endorsed by Google" on sales material.
- Never recolour the green centre, stretch the mark, or put it on a ground close to Pilot.

## Name risk

"AutoPilot GBP" (autopilotgbp.com) sells Google Business Profile management under the same words.
Check the name with a trade mark adviser before selling or white-labelling this product. A rename only
changes the wordmark: edit the two words in `brand-src/gen_assets.py`, then run
`py -3.12 brand-src/gen_assets.py` and `py -3.12 brand-src/icons.py` (needs `pip install fonttools uharfbuzz`).
The brand book pages are built by `brand-src/build_book.py` (run after `gen_assets.py`; output in `brand-src/book/project`, previews via `render.py`).
Sora is under the SIL Open Font Licence.
