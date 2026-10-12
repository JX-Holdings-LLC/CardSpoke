"""Build the CardSpoke logo package and the app's logo and icon files from brand/master/.

    python3 brand/build.py

Needs Vixl (https://github.com/jxburros/Vixl). Writes, replacing what is there:

  brand/wordmark/, brand/mark/   logo packages (Vixl `logo-package`): colour, black, white,
                                 on-light and on-dark variants as SVG, PDF and PNG 1x-3x,
                                 social images and a usage sheet
  brand/app-icons/               every square icon size (favicons, Apple, Android, Windows)
  CardSpoke.svg, www/CardSpoke.svg            the header wordmark
  www/favicon.svg, www/favicon.ico            browser tab icon
  www/apple-touch-icon.png                    iOS home screen
  www/icon-192.png, www/icon-512.png          installable web app (manifest, maskable)
  desktop/build/icon.svg                      desktop app icon; then run `npm run icon` in desktop/
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from vixl import Project

BRAND = Path(__file__).resolve().parent
ROOT = BRAND.parent
MASTER = BRAND / "master"


def png(master, size, out):
    project = Project.load(str(MASTER / f"{master}.vixl"))
    image = project.render().resize((size, size), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, optimize=True)


def svg(master, out):
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "out.svg"
        Project.load(str(MASTER / f"{master}.vixl")).export(str(target), svg_policy="strict")
        shutil.copyfile(target, out)


def logo_package(master, output, png_sizes):
    request = {"source": f"master/{master}.vixl", "output": output, "png_sizes": png_sizes,
               "icons": False, "social": True, "proof": True, "overwrite": True}
    shutil.rmtree(BRAND / output, ignore_errors=True)
    subprocess.run(["vixl", "--json", "workflow", "logo-package", "--request", "-", "--workspace", str(BRAND)],
                   input=json.dumps(request), text=True, check=True, stdout=subprocess.DEVNULL)


logo_package("wordmark", "wordmark", [256, 512, 1024])
logo_package("mark", "mark", [64, 256, 512])

icons = BRAND / "app-icons"
shutil.rmtree(icons, ignore_errors=True)
for size in (16, 32, 48, 64):
    png("favicon", size, icons / f"favicon-{size}.png")
for size in (120, 152, 167, 180, 1024):
    png("icon-tile", size, icons / f"apple-icon-{size}.png")
for size in (48, 72, 96, 144, 192, 512):
    png("icon-tile", size, icons / f"android-{size}.png")
for size in (70, 150, 310):
    png("icon-tile", size, icons / f"windows-tile-{size}.png")
Image.open(icons / "favicon-48.png").save(icons / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
svg("icon-tile", icons / "icon-tile.svg")
svg("favicon", icons / "favicon.svg")

svg("wordmark", ROOT / "CardSpoke.svg")
shutil.copyfile(ROOT / "CardSpoke.svg", ROOT / "www" / "CardSpoke.svg")
shutil.copyfile(icons / "favicon.svg", ROOT / "www" / "favicon.svg")
shutil.copyfile(icons / "favicon.ico", ROOT / "www" / "favicon.ico")
shutil.copyfile(icons / "apple-icon-180.png", ROOT / "www" / "apple-touch-icon.png")
shutil.copyfile(icons / "android-192.png", ROOT / "www" / "icon-192.png")
shutil.copyfile(icons / "android-512.png", ROOT / "www" / "icon-512.png")
svg("desktop-icon", ROOT / "desktop" / "build" / "icon.svg")
print("Built brand/ and the app's logo files. Now run `npm run icon` in desktop/.")
