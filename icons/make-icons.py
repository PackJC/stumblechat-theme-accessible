"""Generate the extension icons (blue rounded square with a half-filled 'contrast' circle)."""
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BLUE = (11, 94, 215, 255)
WHITE = (255, 255, 255, 255)

def make(size):
    scale = 8
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = s * 0.22
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=BLUE)
    cx = cy = s / 2
    cr = s * 0.30
    ring = max(s * 0.06, 1)
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], outline=WHITE, width=int(ring))
    inner = cr - ring * 0.5
    d.pieslice([cx - inner, cy - inner, cx + inner, cy + inner], 90, 270, fill=WHITE)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(HERE, f"icon{size}.png"))

for n in (16, 32, 48, 128):
    make(n)
print("icons written")
