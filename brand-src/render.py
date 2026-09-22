import json, os, pathlib, subprocess, sys
from PIL import Image
HERE = pathlib.Path(__file__).parent
idx = json.load(open(HERE / 'book/project/canvas.json', encoding='utf8'))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
out = HERE / 'shots'; out.mkdir(exist_ok=True)
only = sys.argv[1:]
for name, b in idx['boards'].items():
    if only and name not in only: continue
    png = out / (name.replace('.dc.html', '') + '.png')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    f'--window-size={b["w"]},{b["h"]}', '--virtual-time-budget=8000', f'--screenshot={png}',
                    (HERE / 'book/project' / name).as_uri()], capture_output=True, timeout=90)
    im = Image.open(png); im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(out / ('s_' + png.name))
    print(name, im.size)
