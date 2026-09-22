import io, os, subprocess
from PIL import Image
HERE = __import__("tempfile").gettempdir()  # scratch renders go to the temp folder
OUT = r'C:\python\Google Business Profile SEO\public\brand'
APP = r'C:\python\Google Business Profile SEO\src\app'
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
big = {}
for n in ('app-icon', 'favicon'):
    s = io.open(os.path.join(OUT, n + '.svg'), encoding='utf8').read().replace('width="64" height="64"', 'width="1024" height="1024"', 1)
    page = os.path.join(HERE, f'wrap-{n}.html'); png = os.path.join(HERE, f'{n}-big.png')
    io.open(page, 'w', encoding='utf8').write('<html><body style="margin:0;background:transparent">' + s + '</body></html>')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    '--default-background-color=00000000', '--window-size=1200,1200', f'--screenshot={png}',
                    __import__('pathlib').Path(page).as_uri()], capture_output=True, timeout=60)
    big[n] = Image.open(png).convert('RGBA').crop((0, 0, 1024, 1024))
print('corner', big['app-icon'].getpixel((3, 3)), 'fill', big['app-icon'].getpixel((512, 60)))
for s in (512, 192, 180):
    big['app-icon'].resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f'app-icon-{s}.png'))
for s in (48, 32, 16):
    big['favicon'].resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f'favicon-{s}.png'))
big['app-icon'].resize((180, 180), Image.LANCZOS).save(os.path.join(APP, 'apple-icon.png'))
big['favicon'].resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
# a strip to eyeball the small sizes
strip = Image.new('RGBA', (300, 70), (221, 221, 238, 255)); x = 5
for s in (48, 32, 16):
    im = Image.open(os.path.join(OUT, f'favicon-{s}.png')); strip.alpha_composite(im, (x, 10)); x += s + 20
strip.alpha_composite(Image.open(os.path.join(OUT, 'app-icon-192.png')).resize((56, 56), Image.LANCZOS), (x, 5))
strip.resize((900, 210), Image.NEAREST).save('strip.png')
print('ok')
