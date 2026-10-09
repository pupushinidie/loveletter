"""情书「简洁版」美术：全部用代码画，能直接上线；PixelLab 正式图排到了再同名覆盖。

用法（仓库根目录）：
    ~/miniconda3/envs/quant/bin/python art/simple.py            # 画全部（已经换成正式图的不覆盖）
    ~/miniconda3/envs/quant/bin/python art/simple.py cards icons  # 只画某几个目录
    ~/miniconda3/envs/quant/bin/python art/simple.py --force    # 连正式图一起重画成简洁版（慎用）
    ~/miniconda3/envs/quant/bin/python art/simple.py --check    # 核对 spec 和文件一一对应、尺寸对，列出还是简洁版的文件

风格照 art/spec.md 的烛光夜宴：调色板同 cardframe.P，光从左上来（亮边在左上、暗边在右下），1px 深色描边 #1c0609。
- 牌面：正式牌框（cardframe.face）+ 角色色底 + 大号点数 + 代码画的角色符号 + 角色名（Fusion Pixel 12px）。
- 小牌：角色色底 + 左上 2 倍大的点数 + 小符号。
- 场景、图标、座位印章、动画、结算装饰：几何图形 + 分层光晕，全是整像素、不抗锯齿。
placeholders.py 调用这里的函数，把结果写进 apps/web/public/art/（PNG 带 tier=simple 标记）。
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import cardframe as cf

ROOT = Path(__file__).resolve().parent.parent
WOFF2 = ROOT / "apps" / "web" / "src" / "assets" / "pixel" / "fusion-pixel-12px-zh_hans.woff2"
FONT_CACHE = ROOT / "art" / "out" / "fusion12.ttf"

C = cf.C
rgb = cf.rgb
INK = C("ink")
CLEAR = (0, 0, 0, 0)

# 角色色：深一档的宝石色，和深红金调色板放在一起不跳（底 / 亮 / 暗）
ROLE_COL = {
    "spy": ("#2b2236", "#45385a", "#17121f"),
    "guard": ("#3a4558", "#566682", "#222a38"),
    "priest": ("#5a4320", "#806232", "#382810"),
    "baron": ("#5c2a1c", "#84402c", "#3a170e"),
    "handmaid": ("#24504a", "#357468", "#14332e"),
    "prince": ("#22407a", "#3460a8", "#14264c"),
    "chancellor": ("#2c4a2c", "#41693f", "#1a2e1a"),
    "king": ("#7a1424", "#a42436", "#4c0a14"),
    "countess": ("#4a1a50", "#6c2a74", "#2e0e32"),
    "princess": ("#8a2048", "#b4346a", "#56102c"),
}

PAL = {
    "k": "#1c0609", "g": "#e3b54f", "G": "#9c6f22", "y": "#fff1b8", "r": "#b0182c", "R": "#6a0c18", "p": "#ff8a9a",
    "w": "#efe3c8", "W": "#c9b48a", "s": "#d8dde6", "S": "#8a93a6", "b": "#6fb0e0", "B": "#2f5d8a", "c": "#c8ecff",
    "n": "#7a4a24", "N": "#4a2a14", "m": "#241a2a", "M": "#4a3c58", "e": "#9a929e", "o": "#ffb030", "O": "#ffd870",
    "v": "#3fa45b", "V": "#1f6a34",
}


def P(ch: str) -> tuple[int, int, int, int]:
    return rgb(PAL[ch])


# ---------------- 基础工具 ----------------

def font() -> ImageFont.FreeTypeFont:
    if not FONT_CACHE.exists():
        from fontTools.ttLib import TTFont

        FONT_CACHE.parent.mkdir(parents=True, exist_ok=True)
        f = TTFont(str(WOFF2))
        f.flavor = None
        f.save(str(FONT_CACHE))
    return ImageFont.truetype(str(FONT_CACHE), 12)


FONT = font()


def text(img: Image.Image, s: str, cx: int, cy: int, fill=(239, 227, 200, 255), ink=INK) -> None:
    d = ImageDraw.Draw(img)
    d.fontmode = "1"
    x0, y0, x1, y1 = d.textbbox((0, 0), s, font=FONT)
    x, y = cx - (x1 - x0) // 2 - x0, cy - (y1 - y0) // 2 - y0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx or dy:
                d.text((x + dx, y + dy), s, font=FONT, fill=ink)
    d.text((x, y), s, font=FONT, fill=fill)


def mix(a, b, t: float):
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3)) + (a[3] if len(a) > 3 else 255,)


def lighten(c, t=0.3):
    return mix(c, (255, 250, 230, 255), t)


def darken(c, t=0.3):
    return mix(c, (20, 4, 8, 255), t)


def ascii_img(rows: list[str]) -> Image.Image:
    img = Image.new("RGBA", (len(rows[0]), len(rows)), CLEAR)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                img.putpixel((x, y), P(ch))
    return img


def bevel(img: Image.Image, light=0.32, dark=0.32) -> Image.Image:
    """左上亮边、右下暗边（只看透明邻居），给平涂色块一点体积。"""
    src = img.copy()
    out = img.copy()
    w, h = img.size
    sp, op = src.load(), out.load()

    def empty(x, y):
        return not (0 <= x < w and 0 <= y < h) or sp[x, y][3] == 0

    for y in range(h):
        for x in range(w):
            p = sp[x, y]
            if not p[3] or p[:3] == INK[:3]:
                continue
            if empty(x - 1, y) or empty(x, y - 1):
                op[x, y] = lighten(p, light)[:3] + (p[3],)
            elif empty(x + 1, y) or empty(x, y + 1):
                op[x, y] = darken(p, dark)[:3] + (p[3],)
    return out


def outline(img: Image.Image, color=INK, diagonal: bool = False) -> Image.Image:
    out = img.copy()
    w, h = img.size
    sp, op = img.load(), out.load()
    nbr = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (-1, -1), (1, -1), (-1, 1)] if diagonal else [])
    for y in range(h):
        for x in range(w):
            if sp[x, y][3]:
                continue
            if any(0 <= x + dx < w and 0 <= y + dy < h and sp[x + dx, y + dy][3] > 0 for dx, dy in nbr):
                op[x, y] = color
    return out


def finish(img: Image.Image, light=0.32, dark=0.32) -> Image.Image:
    return outline(bevel(img, light, dark))


def poly(d: ImageDraw.ImageDraw, pts, S: int, fill=None, outline_=None):
    d.polygon([(round(x * (S - 1)), round(y * (S - 1))) for x, y in pts], fill=fill, outline=outline_)


def rect(d, x0, y0, x1, y1, S, fill):
    d.rectangle([round(x0 * (S - 1)), round(y0 * (S - 1)), round(x1 * (S - 1)), round(y1 * (S - 1))], fill=fill)


def ell(d, cx, cy, rx, ry, S, fill=None, outline_=None):
    d.ellipse([round((cx - rx) * (S - 1)), round((cy - ry) * (S - 1)), round((cx + rx) * (S - 1)), round((cy + ry) * (S - 1))],
              fill=fill, outline=outline_)


def heart_mask(size: int, scale: float, cx: float, cy: float) -> set[tuple[int, int]]:
    """经典心形曲线 (x²+y²−1)³ − x²y³ ≤ 0 的像素集合。"""
    pts = set()
    for y in range(size):
        for x in range(size):
            u = (x + 0.5 - cx) / scale
            v = -(y + 0.5 - cy) / scale
            if (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0:
                pts.add((x, y))
    return pts


def big_digits(img: Image.Image, value: int, x: int, y: int, k: int = 2) -> None:
    """k 倍大的金色点阵数字，深色描边 + 顶行高光。"""
    layer = Image.new("RGBA", img.size, CLEAR)
    for i, ch in enumerate(str(value)):
        for r, row in enumerate(cf.DIGITS[ch]):
            for c, v in enumerate(row):
                if v == "#":
                    for dy in range(k):
                        for dx in range(k):
                            px, py = x + i * 7 * k + c * k + dx, y + r * k + dy
                            if 0 <= px < img.width and 0 <= py < img.height:
                                layer.putpixel((px, py), C("coin") if r >= 1 else C("shine"))
    # 下半截暗一点
    lp = layer.load()
    for py in range(img.height):
        for px in range(img.width):
            if lp[px, py][3] and py >= y + 6 * k:
                lp[px, py] = C("gold")
    layer = outline(layer, INK, diagonal=True)
    img.alpha_composite(layer)


# ---------------- 角色符号（S×S，透明底） ----------------

def sym_spy(S):
    """白色威尼斯半脸面具：金边、黑眼洞、侧边一根金手柄、一条红缎带。"""
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    d.line([(round(0.86 * (S - 1)), round(0.5 * (S - 1))), (round(0.97 * (S - 1)), round(0.95 * (S - 1)))], fill=C("gold"),
           width=max(1, S // 14))
    shape = [(0.04, 0.36), (0.18, 0.22), (0.36, 0.22), (0.5, 0.32), (0.64, 0.22), (0.82, 0.22), (0.96, 0.36),
             (0.9, 0.58), (0.7, 0.68), (0.56, 0.66), (0.5, 0.56), (0.44, 0.66), (0.3, 0.68), (0.1, 0.58)]
    poly(d, shape, S, fill=C("gold"))
    inner = [(0.09, 0.37), (0.2, 0.27), (0.35, 0.27), (0.5, 0.37), (0.65, 0.27), (0.8, 0.27), (0.91, 0.37),
             (0.86, 0.55), (0.69, 0.63), (0.57, 0.61), (0.5, 0.51), (0.43, 0.61), (0.31, 0.63), (0.14, 0.55)]
    poly(d, inner, S, fill=P("w"))
    img = bevel(img, 0.25, 0.25)
    d = ImageDraw.Draw(img)
    for cx in (0.3, 0.7):
        ell(d, cx, 0.44, 0.11, 0.065, S, fill=INK)
    d.line([(round(0.05 * (S - 1)), round(0.38 * (S - 1))), (round(0.0 * (S - 1)), round(0.62 * (S - 1)))], fill=P("r"),
           width=max(1, S // 20))
    return outline(img)


def sym_guard(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    rect(d, 0.46, 0.18, 0.54, 0.97, S, P("n"))
    rect(d, 0.43, 0.42, 0.57, 0.46, S, C("gold"))
    poly(d, [(0.5, 0.02), (0.6, 0.14), (0.5, 0.24), (0.4, 0.14)], S, fill=P("s"))
    poly(d, [(0.54, 0.2), (0.82, 0.13), (0.9, 0.29), (0.82, 0.45), (0.54, 0.38)], S, fill=P("s"))
    poly(d, [(0.46, 0.24), (0.28, 0.3), (0.46, 0.35)], S, fill=P("S"))
    return finish(img)


def sym_priest(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    for a in range(0, 360, 45):
        r0, r1 = 0.36, 0.47
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        d.line([(round((0.5 + r0 * ca) * (S - 1)), round((0.5 + r0 * sa * 0.85) * (S - 1))),
                (round((0.5 + r1 * ca) * (S - 1)), round((0.5 + r1 * sa * 0.85) * (S - 1)))], fill=C("gold"), width=max(1, S // 20))
    top = [(0.14 + 0.72 * t, 0.5 - 0.2 * math.sin(math.pi * t)) for t in [i / 16 for i in range(17)]]
    bot = [(0.86 - 0.72 * t, 0.5 + 0.2 * math.sin(math.pi * t)) for t in [i / 16 for i in range(17)]]
    poly(d, top + bot, S, fill=P("w"))
    ell(d, 0.5, 0.5, 0.14, 0.14, S, fill=P("B"))
    ell(d, 0.5, 0.5, 0.11, 0.11, S, fill=P("b"))
    ell(d, 0.5, 0.5, 0.055, 0.055, S, fill=P("k"))
    img = finish(img, 0.2, 0.2)
    gx, gy = round(0.45 * (S - 1)), round(0.45 * (S - 1))
    img.putpixel((gx, gy), (255, 255, 255, 255))
    return img


def sym_baron(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    g = C("gold")
    rect(d, 0.47, 0.14, 0.53, 0.86, S, g)
    poly(d, [(0.3, 0.95), (0.36, 0.86), (0.64, 0.86), (0.7, 0.95)], S, fill=g)
    rect(d, 0.1, 0.2, 0.9, 0.25, S, g)
    ell(d, 0.5, 0.12, 0.06, 0.06, S, fill=g)
    for side in (0.17, 0.83):
        for dx in (-0.12, 0.12):
            d.line([(round(side * (S - 1)), round(0.25 * (S - 1))), (round((side + dx) * (S - 1)), round(0.56 * (S - 1)))], fill=C("gold2"))
        d.pieslice([round((side - 0.15) * (S - 1)), round(0.46 * (S - 1)), round((side + 0.15) * (S - 1)), round(0.7 * (S - 1))], 0, 180, fill=g)
    return finish(img)


def sym_handmaid(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    shape = [(0.14, 0.1), (0.86, 0.1), (0.86, 0.48), (0.78, 0.68), (0.5, 0.94), (0.22, 0.68), (0.14, 0.48)]
    poly(d, shape, S, fill=C("gold"))
    inner = [(0.22, 0.17), (0.78, 0.17), (0.78, 0.47), (0.71, 0.64), (0.5, 0.85), (0.29, 0.64), (0.22, 0.47)]
    poly(d, inner, S, fill=P("b"))
    img = bevel(img)
    hm = heart_mask(S, S * 0.15, S * 0.5, S * 0.45)
    for p in hm:
        img.putpixel(p, P("w"))
    return outline(img)


def sym_prince(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    poly(d, [(0.43, 0.64), (0.43, 0.12), (0.5, 0.02), (0.57, 0.12), (0.57, 0.64)], S, fill=P("s"))
    poly(d, [(0.2, 0.62), (0.8, 0.62), (0.76, 0.7), (0.24, 0.7)], S, fill=C("gold"))
    rect(d, 0.45, 0.7, 0.55, 0.86, S, P("R"))
    ell(d, 0.5, 0.91, 0.07, 0.07, S, fill=C("gold"))
    img = bevel(img)
    if S >= 24:
        d = ImageDraw.Draw(img)
        d.line([(round(0.5 * (S - 1)), round(0.14 * (S - 1))), (round(0.5 * (S - 1)), round(0.6 * (S - 1)))], fill=P("S"))
    return outline(img)


def sym_chancellor(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    rect(d, 0.2, 0.2, 0.8, 0.8, S, P("w"))
    rect(d, 0.12, 0.12, 0.88, 0.24, S, P("W"))
    rect(d, 0.12, 0.76, 0.88, 0.88, S, P("W"))
    img = bevel(img, 0.2, 0.25)
    d = ImageDraw.Draw(img)
    if S >= 24:
        for i, yy in enumerate((0.32, 0.4, 0.48, 0.56)):
            x1 = 0.7 if i % 2 == 0 else 0.6
            d.line([(round(0.28 * (S - 1)), round(yy * (S - 1))), (round(x1 * (S - 1)), round(yy * (S - 1)))], fill=P("W"))
    ell(d, 0.62, 0.68, 0.08, 0.08, S, fill=P("r"))
    d.line([(round(0.58 * (S - 1)), round(0.75 * (S - 1))), (round(0.55 * (S - 1)), round(0.9 * (S - 1)))], fill=P("r"))
    d.line([(round(0.66 * (S - 1)), round(0.75 * (S - 1))), (round(0.69 * (S - 1)), round(0.9 * (S - 1)))], fill=P("r"))
    return outline(img)


def crown(d, S, x0, x1, y_band, y_top, gem="r"):
    g = C("gold")
    w = x1 - x0
    pts = [(x0, y_band), (x0, y_top + 0.06), (x0 + w * 0.25, y_band - 0.08), (x0 + w * 0.5, y_top), (x0 + w * 0.75, y_band - 0.08),
           (x1, y_top + 0.06), (x1, y_band)]
    poly(d, pts, S, fill=g)
    rect(d, x0, y_band, x1, y_band + 0.12, S, g)
    for t in (0.2, 0.5, 0.8):
        ell(d, x0 + w * t, y_band + 0.06, 0.035, 0.035, S, fill=P(gem))
    for x, y in ((x0, y_top + 0.06), (x0 + w * 0.5, y_top), (x1, y_top + 0.06)):
        ell(d, x, y - 0.02, 0.03, 0.03, S, fill=P("y"))


def sym_king(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    d.line([(round(0.22 * (S - 1)), round(0.96 * (S - 1))), (round(0.84 * (S - 1)), round(0.34 * (S - 1)))], fill=C("gold2"),
           width=max(2, S // 12))
    ell(d, 0.86, 0.3, 0.08, 0.08, S, fill=P("r"))
    crown(d, S, 0.08, 0.72, 0.5, 0.2)
    return finish(img)


def sym_countess(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    box = [round(-0.1 * (S - 1)), round(0.2 * (S - 1)), round(1.1 * (S - 1)), round(1.4 * (S - 1))]
    d.pieslice(box, 200, 340, fill=P("r"))
    inner = [round(0.02 * (S - 1)), round(0.32 * (S - 1)), round(0.98 * (S - 1)), round(1.28 * (S - 1))]
    d.pieslice(inner, 200, 340, fill=P("w"))
    img = bevel(img, 0.2, 0.25)
    d = ImageDraw.Draw(img)
    cx, cy = 0.5 * (S - 1), 0.8 * (S - 1)
    for a in range(205, 340, 15 if S >= 24 else 30):
        r = 0.58 * (S - 1)
        d.line([(round(cx), round(cy)), (round(cx + r * math.cos(math.radians(a))), round(cy + r * math.sin(math.radians(a))))], fill=P("W"))
    ell(d, 0.5, 0.8, 0.06, 0.06, S, fill=C("gold"))
    return outline(img)


def sym_princess(S):
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)
    g = C("gold")
    poly(d, [(0.14, 0.7), (0.2, 0.5), (0.34, 0.58), (0.5, 0.26), (0.66, 0.58), (0.8, 0.5), (0.86, 0.7)], S, fill=g)
    rect(d, 0.14, 0.68, 0.86, 0.78, S, g)
    for x, y in ((0.2, 0.47), (0.8, 0.47)):
        ell(d, x, y, 0.04, 0.04, S, fill=P("w"))
    img = bevel(img)
    hm = heart_mask(S, S * 0.11, S * 0.5, S * 0.52)
    for p in hm:
        img.putpixel(p, P("p") if p[1] < S * 0.5 and p[0] < S * 0.5 else P("r"))
    for t in (0.26, 0.5, 0.74):
        img.putpixel((round(t * (S - 1)), round(0.73 * (S - 1))), P("w"))
    return outline(img)


SYMBOLS = {"spy": sym_spy, "guard": sym_guard, "priest": sym_priest, "baron": sym_baron, "handmaid": sym_handmaid,
           "prince": sym_prince, "chancellor": sym_chancellor, "king": sym_king, "countess": sym_countess, "princess": sym_princess}


# ---------------- 牌面、小牌 ----------------

def role_bg(role: str, w: int, h: int, glow=(14, 22), lattice: int = 8) -> Image.Image:
    base, light, dark = (rgb(c) for c in ROLE_COL[role])
    img = Image.new("RGBA", (w, h), base)
    px = img.load()
    gx, gy = glow
    for y in range(h):
        for x in range(w):
            dist = math.hypot(x - gx, (y - gy) * 0.8)
            c = base
            if dist < w * 0.45:
                c = mix(base, light, 0.55)
            elif dist < w * 0.75:
                c = mix(base, light, 0.25)
            elif dist > w * 1.25:
                c = mix(base, dark, 0.5)
            if lattice and ((x + y) % lattice == 0 or (x - y) % lattice == 0):
                c = mix(c, dark, 0.35)
            px[x, y] = c
    return img


def card_art(role: str) -> Image.Image:
    img = role_bg(role, 64, 88, glow=(18, 30))
    sym = SYMBOLS[role](40)
    img.alpha_composite(sym, (12, 22))
    big_digits(img, cf.VALUE[role], 47, 3, 2)
    d = ImageDraw.Draw(img)
    _, _, dark = (rgb(c) for c in ROLE_COL[role])
    d.rectangle([0, 69, 63, 87], fill=mix(dark, INK, 0.4))
    d.line([0, 69, 63, 69], fill=C("gold2"))
    text(img, cf.NAME[role], 32, 78)
    return img


def card(role: str) -> Image.Image:
    return cf.face(role, card_art(role))


def mini_card(role: str) -> Image.Image:
    art = role_bg(role, 28, 40, glow=(6, 8), lattice=6)
    sym = SYMBOLS[role](20)
    art.alpha_composite(sym, (8, 19))
    big_digits(art, cf.VALUE[role], 1, 1, 2)
    return cf.mini(None, art)


# ---------------- 场景 512×288 ----------------

def _vignette(img: Image.Image, strength: float) -> None:
    w, h = img.size
    px = img.load()
    for y in range(h):
        for x in range(w):
            dx, dy = (x - w / 2) / (w / 2), (y - h * 0.45) / (h * 0.7)
            r = math.hypot(dx, dy)
            band = 0.0 if r < 0.75 else 0.12 if r < 0.95 else 0.24 if r < 1.15 else 0.36
            if band:
                px[x, y] = darken(px[x, y], band * strength)


def _glow(img: Image.Image, cx: int, cy: int, color, rings=((14, 0.30), (26, 0.18), (42, 0.10), (62, 0.05))) -> None:
    w, h = img.size
    px = img.load()
    for y in range(max(0, cy - 64), min(h, cy + 64)):
        for x in range(max(0, cx - 64), min(w, cx + 64)):
            dist = math.hypot(x - cx, (y - cy) * 1.1)
            for r, a in rings:
                if dist <= r:
                    px[x, y] = mix(px[x, y], color, a)
                    break


def _stone_wall(img, y0, y1, shades, mortar, seed):
    rng = random.Random(seed)
    d = ImageDraw.Draw(img)
    row = 0
    for y in range(y0, y1, 10):
        off = 0 if row % 2 == 0 else 12
        for x in range(-off, 512, 24):
            d.rectangle([x, y, x + 23, y + 9], fill=rgb(rng.choice(shades)))
            d.line([x, y, x + 22, y], fill=lighten(rgb(shades[0]), 0.08))
        d.line([0, y + 9, 511, y + 9], fill=rgb(mortar))
        for x in range(-off, 512, 24):
            d.line([x + 23, y, x + 23, y + 9], fill=rgb(mortar))
        row += 1


def _arch_window(img, cx, top, w, bottom, day: bool, round_top=False, moon=False):
    d = ImageDraw.Draw(img)
    r = w // 2
    frame = C("gold2") if not day else rgb("#8a7650")
    stone = rgb("#1e0c10") if not day else rgb("#a8916a")
    # 石框
    d.rectangle([cx - r - 4, top + r, cx + r + 4, bottom + 4], fill=stone)
    d.ellipse([cx - r - 4, top - 4, cx + r + 4, top + 2 * r + 4], fill=stone)
    glass_top, glass_bot = (rgb("#16204a"), rgb("#2a3a78")) if not day else (rgb("#fff8e0"), rgb("#f2dfa8"))
    mask = Image.new("L", img.size, 0)
    md = ImageDraw.Draw(mask)
    md.rectangle([cx - r, top + r, cx + r, bottom], fill=255)
    md.ellipse([cx - r, top, cx + r, top + 2 * r], fill=255)
    grad = Image.new("RGBA", img.size, CLEAR)
    gp = grad.load()
    for y in range(top, bottom + 1):
        t = (y - top) / max(1, bottom - top)
        band = round(t * 4) / 4
        c = mix(glass_top, glass_bot, band)
        for x in range(cx - r, cx + r + 1):
            gp[x, y] = c
    img.paste(grad, (0, 0), mask)
    px = img.load()
    if not day:
        rng = random.Random(cx)
        for _ in range(w // 3):
            x, y = rng.randint(cx - r + 2, cx + r - 2), rng.randint(top + 4, bottom - 20)
            if mask.getpixel((x, y)):
                px[x, y] = rgb("#e8ecff") if rng.random() < 0.5 else rgb("#9aa6d8")
        if moon:
            mx, my = cx + r // 3, top + r // 2 + 8
            for y in range(my - 9, my + 10):
                for x in range(mx - 9, mx + 10):
                    if math.hypot(x - mx, y - my) <= 8.5 and math.hypot(x - mx - 4, y - my + 2) > 7 and mask.getpixel((x, y)):
                        px[x, y] = rgb("#f4f0d8")
    # 铅条
    lead = rgb("#0c0a18") if not day else rgb("#9c8a60")
    for x in range(cx - r + 8, cx + r, 10):
        for y in range(top, bottom + 1):
            if mask.getpixel((x, y)):
                px[x, y] = lead
    for y in range(top + r, bottom, 14):
        for x in range(cx - r, cx + r + 1):
            if mask.getpixel((x, y)):
                px[x, y] = lead
    d.rectangle([cx - r - 6, bottom + 2, cx + r + 6, bottom + 6], fill=frame)


def _drape(img, x0, x1, top, bottom, day: bool, side: str):
    d = ImageDraw.Draw(img)
    cols = [rgb("#8a1a28"), rgb("#6e1420"), rgb("#4c0c15"), rgb("#6e1420")] if not day else \
        [rgb("#b02a3c"), rgb("#8a1a28"), rgb("#6e1420"), rgb("#8a1a28")]
    for x in range(x0, x1):
        c = cols[((x - x0) // 6) % 4]
        d.line([x, top, x, bottom], fill=c)
    d.rectangle([x0, top, x1 - 1, top + 6], fill=C("gold2"))
    d.line([x0, top + 7, x1 - 1, top + 7], fill=C("gold"))
    ty = top + (bottom - top) * 2 // 3
    d.rectangle([x0, ty, x1 - 1, ty + 3], fill=C("gold"))
    edge = x1 - 1 if side == "left" else x0
    d.line([edge, top, edge, bottom], fill=INK)


def _banner(img, cx, top, h, day):
    d = ImageDraw.Draw(img)
    w = 30
    red = rgb("#8a1a28") if not day else rgb("#a8283a")
    d.rectangle([cx - w // 2 - 3, top - 3, cx + w // 2 + 3, top], fill=C("gold2"))
    d.polygon([(cx - w // 2, top), (cx + w // 2, top), (cx + w // 2, top + h), (cx, top + h - 10), (cx - w // 2, top + h)], fill=red)
    d.line([cx - w // 2 + 2, top + 2, cx - w // 2 + 2, top + h - 3], fill=C("gold"))
    d.line([cx + w // 2 - 2, top + 2, cx + w // 2 - 2, top + h - 3], fill=C("gold"))
    dy = top + h // 2 - 8
    d.polygon([(cx, dy - 10), (cx + 8, dy), (cx, dy + 10), (cx - 8, dy)], fill=C("gold"))
    d.polygon([(cx, dy - 5), (cx + 4, dy), (cx, dy + 5), (cx - 4, dy)], fill=red)


def _candles(img, cx, cy, n, lit: bool):
    d = ImageDraw.Draw(img)
    g, g2 = C("gold"), C("gold2")
    d.rectangle([cx - 1, cy, cx + 1, cy + 22], fill=g2)
    d.rectangle([cx - 6, cy + 20, cx + 6, cy + 23], fill=g)
    span = (n - 1) * 8
    d.line([cx - span // 2, cy, cx + span // 2, cy], fill=g)
    for i in range(n):
        x = cx - span // 2 + i * 8
        d.rectangle([x - 2, cy - 2, x + 2, cy], fill=g)
        d.rectangle([x - 1, cy - 12, x + 1, cy - 3], fill=rgb("#efe3c8"))
        d.point([(x - 1, cy - 12)], fill=rgb("#fff8e8"))
        if lit:
            d.rectangle([x - 1, cy - 16, x + 1, cy - 14], fill=rgb("#ffb030"))
            d.point([(x, cy - 17), (x, cy - 15)], fill=rgb("#fff1b8"))


def _table(img, y0, day: bool, study: bool):
    d = ImageDraw.Draw(img)
    w, h = img.size
    if study:
        wood, wood2 = (rgb("#4a2a18"), rgb("#3a1e10")) if not day else (rgb("#8a5a34"), rgb("#74482a"))
        d.rectangle([0, y0, w, h], fill=wood)
        for y in range(y0 + 4, h, 7):
            d.line([0, y, w, y], fill=wood2)
        d.rectangle([110, y0 + 10, 402, h], fill=rgb("#5e101b") if not day else rgb("#7c1a26"))
        d.rectangle([110, y0 + 10, 402, y0 + 12], fill=C("gold2"))
    else:
        cloth, cloth2 = (rgb("#5e101b"), rgb("#4c0c15")) if not day else (rgb("#8a1a28"), rgb("#7c1a26"))
        d.rectangle([0, y0, w, h], fill=cloth)
        px = img.load()
        for y in range(y0 + 6, h):
            for x in range(w):
                if (x + y) % 16 == 0 or (x - y) % 16 == 0:
                    px[x, y] = cloth2
        d.rectangle([0, y0, w, y0 + 3], fill=C("gold"))
        d.line([0, y0 + 4, w, y0 + 4], fill=C("gold2"))
    d.line([0, y0 - 1, w, y0 - 1], fill=INK)


def scene(kind: str, day: bool) -> Image.Image:
    img = Image.new("RGBA", (512, 288), CLEAR)
    if day:
        shades, mortar = ["#d8c6a2", "#cfbb94", "#e0d0ae"], "#b09a74"
    else:
        shades, mortar = ["#33181c", "#2c1418", "#3a1c20"], "#1c0b0e"
    _stone_wall(img, 0, 228, shades, mortar, seed=7 if kind == "hall" else 9)
    if kind == "hall":
        for cx in (128, 256, 384):
            _arch_window(img, cx, 36, 52, 172, day, moon=(cx == 384))
        for cx in (192, 320):
            _banner(img, cx, 24, 96, day)
        _drape(img, 0, 60, 0, 228, day, "left")
        _drape(img, 452, 512, 0, 228, day, "right")
        candle_spots = [(84, 150, 3), (428, 150, 3), (192, 168, 3), (320, 168, 3)]
    else:
        # 书架
        d = ImageDraw.Draw(img)
        wood, wood2 = (rgb("#3a1e10"), rgb("#2a140a")) if not day else (rgb("#74482a"), rgb("#5a361e"))
        d.rectangle([28, 30, 210, 228], fill=wood2)
        rng = random.Random(3)
        book_cols = ["#7c1a26", "#2c4a2c", "#22407a", "#9c6f22", "#5c2a1c", "#4a1a50", "#efe3c8"]
        for sy in range(36, 220, 46):
            x = 34
            while x < 204:
                bw = rng.randint(4, 8)
                bh = rng.randint(28, 40)
                c = rgb(rng.choice(book_cols))
                if not day:
                    c = darken(c, 0.25)
                d.rectangle([x, sy + 40 - bh, min(x + bw - 1, 204), sy + 39], fill=c)
                d.line([x, sy + 40 - bh, x, sy + 39], fill=lighten(c, 0.2))
                d.line([x + 1, sy + 44 - bh, min(x + bw - 2, 203), sy + 44 - bh], fill=C("gold2"))
                x += bw + (1 if rng.random() < 0.8 else 4)
            d.rectangle([28, sy + 40, 210, sy + 45], fill=wood)
        d.rectangle([28, 30, 33, 228], fill=wood)
        d.rectangle([205, 30, 210, 228], fill=wood)
        _arch_window(img, 360, 30, 96, 180, day, moon=True)
        _drape(img, 296, 316, 14, 214, day, "left")
        _drape(img, 404, 424, 14, 214, day, "right")
        d = ImageDraw.Draw(img)
        d.rectangle([290, 10, 430, 15], fill=C("gold2"))
        candle_spots = [(250, 150, 1), (470, 150, 3)]
    if not day:
        for cx, cy, n in candle_spots:
            _glow(img, cx, cy - 14, rgb("#ffb030"))
    for cx, cy, n in candle_spots:
        _candles(img, cx, cy, n, lit=not day)
    if day:
        # 斜射的光束
        beam = Image.new("RGBA", img.size, CLEAR)
        bd = ImageDraw.Draw(beam)
        xs = (128, 256, 384) if kind == "hall" else (360,)
        for cx in xs:
            bd.polygon([(cx - 20, 60), (cx + 24, 60), (cx + 120, 288), (cx + 40, 288)], fill=(255, 246, 210, 46))
        img.alpha_composite(beam)
    _table(img, 228, day, kind == "study")
    if kind == "study":
        d = ImageDraw.Draw(img)
        # 左下几封信、右下墨水瓶和羽毛笔（留出中间）
        for i, (x, y) in enumerate(((22, 244), (40, 252), (30, 262))):
            d.rectangle([x, y, x + 34, y + 20], fill=rgb("#efe3c8"), outline=INK)
            d.line([x, y, x + 17, y + 10, x + 34, y], fill=rgb("#c9b48a"))
            d.ellipse([x + 14, y + 7, x + 20, y + 13], fill=rgb("#b0182c"))
        d.ellipse([452, 250, 476, 274], fill=rgb("#1a1620"), outline=INK)
        d.rectangle([458, 244, 470, 252], fill=rgb("#2a2430"), outline=INK)
        d.line([466, 246, 492, 206], fill=rgb("#efe3c8"), width=3)
        d.line([468, 246, 494, 208], fill=rgb("#c9b48a"))
    _vignette(img, 1.0 if not day else 0.45)
    return img


# ---------------- 图标 16×16 ----------------

def heart_gem(S: int) -> Image.Image:
    """钟情标记：金托 + 深红心形宝石（左上高光、右下暗面）。"""
    img = Image.new("RGBA", (S, S), CLEAR)
    outer = heart_mask(S, S * 0.36, S / 2, S * 0.43)
    inner = heart_mask(S, S * 0.36 - (2 if S >= 24 else 1.4), S / 2, S * 0.43)
    for p in outer:
        img.putpixel(p, C("gold"))
    for x, y in inner:
        img.putpixel((x, y), P("r"))
    # 宝石切面：左上亮、右下暗
    for x, y in inner:
        u, v = x - S / 2, y - S * 0.43
        if u + v < -S * 0.18:
            img.putpixel((x, y), rgb("#e0405a"))
        elif u + v > S * 0.12:
            img.putpixel((x, y), P("R"))
    img = bevel(img, 0.35, 0.3)
    # 高光
    hx, hy = round(S * 0.33), round(S * 0.3)
    img.putpixel((hx, hy), P("y"))
    if S >= 24:
        img.putpixel((hx + 1, hy), (255, 210, 220, 255))
        img.putpixel((hx, hy + 1), (255, 210, 220, 255))
    return outline(img)


def icon_shield(S=16):
    return sym_handmaid(S)


def icon_spy(S=16):
    rows = [
        "................",
        "................",
        "................",
        "...ggg....ggg...",
        "..gwwwg..gwwwg..",
        ".gwwwwwggwwwwwg.",
        ".gwkkkwwwwkkkwg.",
        ".gwkkkwwwwkkkwg.",
        ".gwwwwwggwwwwwg.",
        "..gwwwg..gwwwg..",
        "...gWg....gWg...",
        "....g......g....",
        "................",
        "................",
        "................",
        "................",
    ]
    return outline(bevel(ascii_img(rows), 0.2, 0.2))


def _icon_spy_old(S=16):
    rows = [
        "................",
        "................",
        "................",
        "..gg........gg..",
        ".gmmmg....gmmmg.",
        "gmMMMmggggmMMMmg",
        "gm..Mmmmmmm..Mmg",
        "gm..mmmmmmm..mmg",
        ".gmmmmg..gmmmmg.",
        "..gmmg....gmmg..",
        "...gg......gg...",
        "................",
        "................",
        "................",
        "................",
        "................",
    ]
    img = ascii_img(rows)
    return outline(img)


def icon_out(S=16):
    rows = [
        ".....e.........",
        "......e........",
        ".....e.........",
        "......e........",
        ".......k.......",
        "......wwW......",
        "......wwW......",
        "......wwW......",
        "......wwW......",
        "......wwW......",
        "......wwW......",
        "....gggggGG....",
        "...GgggggggG...",
        "....GGGGGGG....",
        "...............",
    ]
    rows = [r.ljust(16, ".") for r in rows] + ["." * 16]
    img = ascii_img(rows)
    return outline(img)


def icon_eye(S=16):
    rows = [
        "................",
        "................",
        "................",
        "................",
        ".....wwwwww.....",
        "...wwwBBBBwww...",
        "..wwwBbbkbBwww..",
        ".wwwwBbkkbBwwww.",
        "..wwwBbbbbBwww..",
        "...wwwBBBBwww...",
        ".....wwwwww.....",
        "................",
        "................",
        "................",
        "................",
        "................",
    ]
    img = ascii_img(rows)
    img.putpixel((7, 6), (255, 255, 255, 255))
    return outline(img)


def icon_duel(S=16):
    rows = [
        "s..............s",
        ".s............s.",
        "..s..........s..",
        "...s........s...",
        "....s......s....",
        ".....s....s.....",
        "......s..s......",
        ".......ss.......",
        ".......ss.......",
        "......s..s......",
        "...g.s....s.g...",
        "....g......g....",
        "...grg....grg...",
        "..g..r....r..g..",
        "......g..g......",
        "................",
    ]
    img = ascii_img(rows)
    return outline(img)


def icon_swap(S=16):
    rows = [
        "................",
        "......gggg.g....",
        "....gg....ggg...",
        "...g.....gggg...",
        "..g.............",
        "..g.............",
        "..g.............",
        "................",
        "................",
        ".............g..",
        ".............g..",
        ".............g..",
        "...gggg.....g...",
        "...ggg....gg....",
        "....g.gggg......",
        "................",
    ]
    img = ascii_img(rows)
    return outline(bevel(img, 0.3, 0.2))


def icon_target(S=16):
    rows = [
        "........s.......",
        ".......sss......",
        ".......sss......",
        "........s..sss..",
        "......Snnssssss.",
        ".....SSnnssssss.",
        "......Snnssssss.",
        "........nn.sss..",
        "........nn......",
        ".......gnng.....",
        "........nn......",
        "........nn......",
        "........nn......",
        "........nn......",
        "........nn......",
        "................",
    ]
    return finish(ascii_img(rows), 0.3, 0.25)


def icon_deck(S=16):
    img = Image.new("RGBA", (16, 16), CLEAR)
    d = ImageDraw.Draw(img)
    for i, (x, y) in enumerate(((5, 5), (3, 3), (1, 1))):
        d.rectangle([x, y, x + 9, y + 12], fill=C("back1"), outline=INK)
        d.rectangle([x + 1, y + 1, x + 8, y + 11], outline=C("gold2") if i < 2 else C("gold"))
    cf.heart(img, 4, 5, C("gold"))
    return img


def icon_crown(S=16):
    rows = [
        "................",
        "................",
        "................",
        ".y.....y.....y..",
        ".g.....g.....g..",
        ".gg...ggg...gg..",
        ".ggg.ggggg.ggg..",
        ".gggggggggggggg.",
        ".ggrggggrggggrg.",
        ".gggggggggggggg.",
        ".GGGGGGGGGGGGGG.",
        "................",
        "................",
        "................",
        "................",
        "................",
    ]
    return outline(bevel(ascii_img(rows), 0.25, 0.1))


def icon_letter(S=16):
    rows = [
        "................",
        "................",
        "................",
        ".wwwwwwwwwwwwww.",
        ".wWwwwwwwwwwwWw.",
        ".wwWwwwwwwwwWww.",
        ".wwwWwwwwwwWwww.",
        ".wwwwWwrrwWwwww.",
        ".wwwwwrrrrwwwww.",
        ".wwwwwwrrwwwwww.",
        ".wwwwwwwwwwwwww.",
        ".WWWWWWWWWWWWWW.",
        "................",
        "................",
        "................",
        "................",
    ]
    return outline(ascii_img(rows))


def icon_book(S=16):
    rows = [
        "................",
        "................",
        "..RRRRRRRRRRw...",
        "..RrrrrrrrrRww..",
        "..RrgggggggRww..",
        "..RrgrrrrrgRww..",
        "..RrgrrrrrgRwgg.",
        "..RrgrrrrrgRwgg.",
        "..RrgggggggRww..",
        "..RrrrrrrrrRww..",
        "..RrrrrrrrrRww..",
        "..RrrrrrrrrRww..",
        "..RRRRRRRRRRw...",
        "................",
        "................",
        "................",
    ]
    return outline(ascii_img(rows))


def icon_sealed(S=16):
    img = Image.new("RGBA", (16, 16), CLEAR)
    d = ImageDraw.Draw(img)
    d.ellipse([1, 1, 14, 14], fill=P("R"))
    d.ellipse([2, 2, 13, 12], fill=P("r"))
    d.ellipse([4, 4, 11, 11], outline=P("R"))
    hm = heart_mask(16, 2.6, 7.6, 7.6)
    for p in hm:
        img.putpixel(p, P("R"))
    img.putpixel((4, 3), P("p"))
    img.putpixel((3, 4), P("p"))
    return outline(img)


ICONS16 = {
    "favor": lambda: heart_gem(16), "shield": icon_shield, "spy": icon_spy, "out": icon_out, "eye": icon_eye,
    "duel": icon_duel, "swap": icon_swap, "target": icon_target, "deck": icon_deck, "crown": icon_crown,
    "letter": icon_letter, "book": icon_book, "sealed": icon_sealed,
}


def favor_empty() -> Image.Image:
    """还没拿到的标记：同样的金托，里面是空的深色心形凹槽（金托压暗一档）。"""
    S = 16
    img = Image.new("RGBA", (S, S), CLEAR)
    outer = heart_mask(S, S * 0.36, S / 2, S * 0.43)
    inner = heart_mask(S, S * 0.36 - 1.4, S / 2, S * 0.43)
    for p in outer:
        img.putpixel(p, C("gold2"))
    for p in inner:
        img.putpixel(p, C("velvet3"))
    for x, y in inner:
        if (x + 1, y + 1) not in inner or (x + 1, y) not in inner:
            img.putpixel((x, y), C("velvet"))
    return outline(img)


# ---------------- 座位印章 24×24 ----------------

EMBLEMS = {
    0: [  # 玫瑰
        "..XXXXX..",
        ".XX...XX.",
        "XX.XXX.XX",
        "X.XX.XX.X",
        "X.X.X.X.X",
        "XX.XXX.XX",
        ".XX...XX.",
        "..XXXXX..",
        "....X....",
    ],
    1: [  # 百合（三瓣花）
        "....X....",
        "...XXX...",
        ".X.XXX.X.",
        "XX.XXX.XX",
        "XXX.X.XXX",
        ".XXXXXXX.",
        "XXXXXXXXX",
        "...XXX...",
        "..X...X..",
    ],
    2: [  # 星
        "....X....",
        "....X....",
        "...XXX...",
        "XXXXXXXXX",
        ".XXXXXXX.",
        "..XXXXX..",
        "..XX.XX..",
        ".XX...XX.",
        ".X.....X.",
    ],
    3: [  # 太阳
        "X...X...X",
        ".X.....X.",
        "...XXX...",
        "..XXXXX..",
        "XXXXXXXXX",
        "..XXXXX..",
        "...XXX...",
        ".X.....X.",
        "X...X...X",
    ],
    4: [  # 新月
        "...XXX...",
        "..XX.....",
        ".XX......",
        ".XX......",
        ".XX......",
        ".XX......",
        ".XXX.....",
        "..XXX..X.",
        "...XXXX..",
    ],
    5: [  # 羽毛
        "......XX.",
        ".....XXX.",
        "....XXXX.",
        "...XXXX..",
        "..XXXX...",
        ".XXXX....",
        ".XXX.....",
        "X........",
        "X........",
    ],
}
SEAT_HEX = ["#d23a4a", "#3d6fd6", "#3fa45b", "#e0a030", "#9a5bd0", "#2fb5ad"]


def seal(idx: int) -> Image.Image:
    base = rgb(SEAT_HEX[idx])
    img = Image.new("RGBA", (24, 24), CLEAR)
    px = img.load()
    rng = random.Random(idx + 5)
    lumps = [10.2 + rng.choice((0, 0.6, 1.0)) for _ in range(16)]
    for y in range(24):
        for x in range(24):
            dx, dy = x - 11.5, y - 11.5
            ang = (math.atan2(dy, dx) + math.pi) / (2 * math.pi) * 16
            r = lumps[int(ang) % 16]
            dist = math.hypot(dx, dy)
            if dist <= r:
                c = base
                if dist > r - 1.6:
                    c = darken(base, 0.35) if dx + dy > -2 else lighten(base, 0.15)
                elif 6.8 <= dist <= 7.8:
                    c = darken(base, 0.3)
                elif dist < 6.8 and dx + dy < -3:
                    c = lighten(base, 0.12)
                px[x, y] = c
    em = EMBLEMS[idx]
    for r_, row in enumerate(em):
        for c_, ch in enumerate(row):
            if ch == "X":
                x, y = 8 + c_, 8 + r_
                px[x, y] = darken(base, 0.45)
                if x - 1 >= 0 and px[x - 1, y - 1][:3] == base[:3] or True:
                    pass
    # 浮雕高光：图案左上方一格提亮
    for r_, row in enumerate(em):
        for c_, ch in enumerate(row):
            if ch == "X":
                x, y = 8 + c_ - 1, 8 + r_ - 1
                if 0 <= x and 0 <= y and (r_ == 0 or c_ == 0 or em[r_ - 1][c_ - 1] != "X"):
                    if px[x, y][:3] != darken(base, 0.45)[:3]:
                        px[x, y] = lighten(base, 0.3)
    px[6, 5] = lighten(base, 0.6)
    px[5, 6] = lighten(base, 0.45)
    return outline(img)


# ---------------- 动画 ----------------

def candle_frame(flame_h: int, sway: int, smoke: list[tuple[int, int, int]] | None = None, ember: bool = False) -> Image.Image:
    """16×32 的蜡烛一帧。flame_h=0 是熄灭；smoke 是 (x, y, 浓度0-2) 的烟点。"""
    img = Image.new("RGBA", (16, 32), CLEAR)
    d = ImageDraw.Draw(img)
    # 烛台
    d.rectangle([3, 28, 12, 29], fill=C("gold"))
    d.rectangle([5, 30, 10, 30], fill=C("gold2"))
    d.rectangle([4, 26, 11, 27], fill=C("gold2"))
    # 蜡身
    d.rectangle([6, 14, 9, 25], fill=P("w"))
    d.line([6, 14, 6, 25], fill=(255, 250, 238, 255))
    d.line([9, 15, 9, 25], fill=P("W"))
    d.point([(9, 14), (10, 16), (10, 17)], fill=P("w"))  # 蜡泪
    img = outline(img)
    px = img.load()
    # 烛芯
    px[8, 12] = INK
    px[8, 13] = INK
    if ember:
        px[8, 12] = rgb("#ff6030")
    if flame_h > 0:
        cx = 8 + sway
        top = 12 - flame_h
        for y in range(top, 13):
            t = (y - top) / max(1, flame_h)
            half = 0 if t < 0.25 else 1 if t < 0.85 else 1
            if flame_h >= 6 and 0.45 <= t < 0.9:
                half = 2
            sx = cx if t > 0.6 else cx + (0 if t > 0.3 else 0)
            for x in range(sx - half, sx + half + 1):
                if 0 <= x < 16:
                    px[x, y] = rgb("#ffb030")
        # 火芯
        for y in range(top + max(1, flame_h // 3), 12):
            px[cx, y] = rgb("#fff1b8")
            if flame_h >= 6 and y > top + flame_h // 2:
                px[cx - 1 if cx > 0 else cx, y] = rgb("#ffd870")
        px[cx, 12] = rgb("#ffd870")
        # 外焰描一圈暗橙（不是黑边）
        layer = Image.new("RGBA", (16, 32), CLEAR)
        lp = layer.load()
        for y in range(0, 13):
            for x in range(16):
                if px[x, y][3] and px[x, y][:3] in (rgb("#ffb030")[:3],):
                    for dx, dy in ((1, 0), (-1, 0), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < 16 and 0 <= ny < 32 and not px[nx, ny][3]:
                            lp[nx, ny] = rgb("#c8501c")
        img.alpha_composite(layer)
    for sx, sy, k in smoke or []:
        if 0 <= sx < 16 and 0 <= sy < 32:
            col = (214, 206, 216, 255) if k >= 2 else (178, 170, 184, 230) if k == 1 else (140, 134, 148, 180)
            px = img.load()
            px[sx, sy] = col
    return img


def fx_candle() -> list[Image.Image]:
    seq = [(7, 0), (8, 0), (7, 1), (6, 1), (7, 0), (8, -1)]
    return [candle_frame(h, s) for h, s in seq]


def fx_snuff() -> list[Image.Image]:
    frames = [candle_frame(7, 0), candle_frame(6, 1), candle_frame(4, 0), candle_frame(2, 0)]
    frames.append(candle_frame(0, 0, smoke=[(8, 11, 2), (8, 10, 2), (9, 9, 2)], ember=True))
    frames.append(candle_frame(0, 0, smoke=[(8, 11, 1), (8, 10, 2), (9, 9, 2), (9, 8, 2), (8, 7, 1), (8, 6, 1)]))
    frames.append(candle_frame(0, 0, smoke=[(9, 8, 1), (8, 7, 1), (8, 6, 2), (7, 5, 1), (7, 4, 1), (8, 3, 0), (9, 2, 0)]))
    frames.append(candle_frame(0, 0))
    return frames


def shield32() -> Image.Image:
    img = Image.new("RGBA", (32, 32), CLEAR)
    img.alpha_composite(sym_handmaid(24), (4, 4))
    return img


def fx_shield() -> list[Image.Image]:
    static = shield32()
    frames = []
    rings = [4, 8, 11, 14, 15, 15, 15, 0]
    alphas = [0.0, 0.3, 0.6, 1.0, 1.0, 1.0, 1.0, 1.0]
    sparks = {3: [(5, 6), (26, 8)], 4: [(4, 12), (27, 5), (16, 1)], 5: [(3, 18), (28, 14)], 6: [(28, 22)]}
    for i in range(8):
        f = Image.new("RGBA", (32, 32), CLEAR)
        r = rings[i]
        if r:
            ring = Image.new("RGBA", (32, 32), CLEAR)
            rd = ImageDraw.Draw(ring)
            a = 255 if i < 4 else 170 if i < 6 else 90
            rd.ellipse([16 - r, 16 - r, 15 + r, 15 + r], outline=(160, 220, 255, a))
            if r > 3:
                rd.ellipse([16 - r + 1, 16 - r + 1, 15 + r - 1, 15 + r - 1], outline=(110, 176, 224, a // 2))
            f.alpha_composite(ring)
        s = static.copy()
        if alphas[i] < 1:
            s.putalpha(s.getchannel("A").point(lambda v, k=alphas[i]: int(v * k)))
        f.alpha_composite(s)
        for x, y in sparks.get(i, []):
            for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                c = (255, 255, 255, 255) if (dx, dy) == (0, 0) else (200, 236, 255, 220)
                if 0 <= x + dx < 32 and 0 <= y + dy < 32:
                    f.putpixel((x + dx, y + dy), c)
        frames.append(f)
    frames[-1] = static
    return frames


def rapier(img: Image.Image, hx: float, hy: float, angle: float, length: int = 22) -> None:
    """细剑：从护手 (hx, hy) 朝 angle 方向伸出剑身；剑柄朝反方向。"""
    d = ImageDraw.Draw(img)
    ca, sa = math.cos(angle), math.sin(angle)
    tip = (hx + ca * length, hy + sa * length)
    d.line([(round(hx), round(hy)), (round(tip[0]), round(tip[1]))], fill=P("s"))
    pommel = (hx - ca * 5, hy - sa * 5)
    d.line([(round(hx), round(hy)), (round(pommel[0]), round(pommel[1]))], fill=P("R"), width=2)
    px_, py_ = -sa, ca
    d.line([(round(hx - px_ * 3), round(hy - py_ * 3)), (round(hx + px_ * 3), round(hy + py_ * 3))], fill=C("gold"), width=1)
    d.point([(round(pommel[0]), round(pommel[1]))], fill=C("gold"))


def fx_duel() -> list[Image.Image]:
    """两把细剑从竖直挥到交叉，交叉点迸火花；播一次。"""
    frames = []
    left = [-96, -82, -66, -50, -50, -50]
    right = [-84, -98, -114, -130, -130, -130]
    spark = [0, 0, 1, 3, 2, 1]
    for i in range(6):
        f = Image.new("RGBA", (32, 32), CLEAR)
        rapier(f, 7, 25, math.radians(left[i]), 24)
        rapier(f, 24, 25, math.radians(right[i]), 24)
        f = outline(f)
        k = spark[i]
        if k:
            cx, cy = (15, 15) if i >= 3 else (15, 5)
            fd = ImageDraw.Draw(f)
            for ang in range(0, 360, 45):
                L = k + (1 if ang % 90 == 0 else 0)
                ex, ey = cx + math.cos(math.radians(ang)) * L * 2, cy + math.sin(math.radians(ang)) * L * 2
                fd.line([(cx, cy), (round(ex), round(ey))], fill=P("O") if k > 1 else P("y"))
            f.putpixel((cx, cy), (255, 255, 255, 255))
        frames.append(f)
    return frames


def fx_favor() -> list[Image.Image]:
    gem = heart_gem(32)
    frames = []
    spots = [(5, 3), (27, 4), (3, 18), (29, 17), (16, 29)]
    for i in range(8):
        f = gem.copy()
        if 1 <= i <= 6:
            for j, (x, y) in enumerate(spots):
                size = [0, 1, 2, 3, 2, 1, 0, 0][(i + j) % 8] if (i + j) % 8 < 7 else 0
                if size:
                    for t in range(-size, size + 1):
                        for (px_, py_) in ((x + t, y), (x, y + t)):
                            if 0 <= px_ < 32 and 0 <= py_ < 32:
                                f.putpixel((px_, py_), (255, 255, 255, 255) if t == 0 else P("y") if abs(t) < size else P("g"))
        frames.append(f)
    frames[0] = gem
    frames[-1] = gem
    return frames


def fx_petal() -> list[Image.Image]:
    frames = []
    for i in range(4):
        f = Image.new("RGBA", (8, 8), CLEAR)
        d = ImageDraw.Draw(f)
        w = [6, 4, 2, 4][i]
        x0 = 4 - w // 2
        d.ellipse([x0, 1, x0 + w - 1, 6], fill=(176, 24, 44, 255), outline=(106, 12, 24, 255))
        if w >= 4:
            f.putpixel((x0 + 1, 2), (230, 90, 110, 255))
        frames.append(f)
    return frames


def strip(frames: list[Image.Image]) -> Image.Image:
    w, h = frames[0].size
    img = Image.new("RGBA", (w * len(frames), h), CLEAR)
    for i, f in enumerate(frames):
        img.alpha_composite(f, (i * w, 0))
    return img


# ---------------- 结算装饰 ----------------

def banner() -> Image.Image:
    img = Image.new("RGBA", (160, 32), CLEAR)
    d = ImageDraw.Draw(img)
    back, mid, front = rgb("#4c0c15"), rgb("#6e1420"), rgb("#8a1a28")
    # 两头燕尾（后层）
    d.polygon([(1, 9), (24, 9), (24, 28), (1, 28), (8, 18)], fill=back)
    d.polygon([(158, 9), (135, 9), (135, 28), (158, 28), (151, 18)], fill=back)
    # 折角
    d.polygon([(16, 24), (24, 24), (24, 28)], fill=INK)
    d.polygon([(143, 24), (135, 24), (135, 28)], fill=INK)
    # 正面缎带
    d.rectangle([16, 4, 143, 24], fill=front)
    d.rectangle([16, 4, 143, 5], fill=C("gold"))
    d.rectangle([16, 23, 143, 24], fill=C("gold2"))
    d.line([16, 7, 143, 7], fill=mid)
    d.line([16, 21, 143, 21], fill=mid)
    for x in (17, 142):
        d.line([x, 4, x, 24], fill=mid)
    img = outline(img)
    px = img.load()
    for x in range(18, 142, 6):
        px[x, 6] = C("shine")
    return img


def letter_win() -> Image.Image:
    img = Image.new("RGBA", (64, 48), CLEAR)
    d = ImageDraw.Draw(img)
    # 信封
    d.rectangle([12, 8, 59, 39], fill=P("w"))
    d.line([12, 8, 35, 26, 59, 8], fill=P("W"))
    d.line([12, 39, 30, 24], fill=P("W"))
    d.line([59, 39, 41, 24], fill=P("W"))
    # 金缎带
    d.rectangle([33, 8, 37, 39], fill=C("gold"))
    d.line([33, 8, 33, 39], fill=C("shine"))
    d.line([37, 8, 37, 39], fill=C("gold2"))
    img = bevel(img, 0.15, 0.2)
    d = ImageDraw.Draw(img)
    # 火漆心
    d.ellipse([28, 18, 42, 31], fill=P("R"))
    d.ellipse([29, 19, 41, 29], fill=P("r"))
    for p in heart_mask(64, 3.2, 35.3, 24.4):
        img.putpixel(p, P("R"))
    img.putpixel((31, 20), P("p"))
    # 玫瑰
    d.line([10, 44, 19, 32], fill=P("V"), width=2)
    d.polygon([(12, 40), (5, 37), (9, 43)], fill=P("v"))
    d.polygon([(16, 37), (22, 40), (17, 42)], fill=P("v"))
    d.ellipse([12, 22, 27, 35], fill=P("r"))
    d.arc([15, 25, 24, 32], 180, 450, fill=P("R"))
    d.arc([17, 27, 22, 31], 0, 270, fill=P("R"))
    img.putpixel((15, 24), P("p"))
    img.putpixel((14, 25), P("p"))
    return outline(img)


def divider() -> Image.Image:
    img = Image.new("RGBA", (96, 8), CLEAR)
    d = ImageDraw.Draw(img)
    gold, dark, shine = C("gold"), C("gold2"), C("shine")
    d.line([4, 4, 40, 4], fill=gold)
    d.line([55, 4, 91, 4], fill=gold)
    d.line([12, 5, 38, 5], fill=dark)
    d.line([57, 5, 83, 5], fill=dark)
    for x in (4, 91):
        d.point([(x, 3), (x, 5)], fill=gold)
    for x, s in ((40, -1), (55, 1)):
        d.point([(x + s, 3), (x + s, 5), (x + 2 * s, 2), (x + 2 * s, 6)], fill=gold)
    cf.heart(img, 44, 1, gold)
    img.putpixel((45, 2), shine)
    return outline(img)


# ================= 清单（和 spec.md 一一对应）、生成、核对 =================
# (路径, 单帧宽, 高, 帧数, 种类, 生成函数)
#   simple = 简洁版（PNG 带 tier=simple，正式美术定稿后同名覆盖）
#   code   = 代码画的正式图（牌背、小牌背、牌堆、空槽、移出区、桌布），没有 tier 标记，正式美术阶段不用换
import re  # noqa: E402
import sys  # noqa: E402

from PIL.PngImagePlugin import PngInfo  # noqa: E402

PUBLIC = ROOT / "apps" / "web" / "public" / "art"
SPEC = ROOT / "art" / "spec.md"
MANIFEST: list[tuple[str, int, int, int, str, object]] = []


def add(path, w, h, frames, kind, fn):
    MANIFEST.append((path, w, h, frames, kind, fn))


for _role in cf.ROLES:
    add(f"cards/{_role}.png", 72, 100, 1, "simple", lambda r=_role: card(r))
    add(f"cards/mini/{_role}.png", 32, 44, 1, "simple", lambda r=_role: mini_card(r))
add("cards/back.png", 72, 100, 1, "code", cf.back)
add("cards/mini/back.png", 32, 44, 1, "code", cf.mini_back)
add("table/deck.png", 80, 112, 1, "code", lambda: cf.stack(4))
add("table/deck-low.png", 80, 112, 1, "code", lambda: cf.stack(1))
add("table/slot.png", 80, 112, 1, "code", cf.slot)
add("table/aside.png", 80, 112, 1, "code", cf.aside)
add("table/cloth-night.png", 32, 32, 1, "code", lambda: cf.cloth(False))
add("table/cloth-day.png", 32, 32, 1, "code", lambda: cf.cloth(True))
for _i, _kind in enumerate(("hall", "study")):
    add(f"scene/night-{_i}.png", 512, 288, 1, "simple", lambda k=_kind: scene(k, False))
    add(f"scene/day-{_i}.png", 512, 288, 1, "simple", lambda k=_kind: scene(k, True))
CODE_FINAL_ICONS = {"eye", "duel", "swap", "target", "deck", "book"}  # 界面小符号，代码画的就是正式版
for _name, _fn in ICONS16.items():
    add(f"icons/{_name}.png", 16, 16, 1, "code" if _name in CODE_FINAL_ICONS else "simple", _fn)
add("icons/favor-empty.png", 16, 16, 1, "simple", favor_empty)
add("icons/favor-big.png", 32, 32, 1, "simple", lambda: heart_gem(32))
for _i in range(6):
    add(f"seats/seal-{_i}.png", 24, 24, 1, "simple", lambda i=_i: seal(i))
add("fx/candle.png", 16, 32, 6, "simple", lambda: strip(fx_candle()))
add("fx/snuff.png", 16, 32, 8, "simple", lambda: strip(fx_snuff()))
add("fx/shield.png", 32, 32, 8, "simple", lambda: strip(fx_shield()))
add("fx/duel.png", 32, 32, 6, "simple", lambda: strip(fx_duel()))
add("fx/favor.png", 32, 32, 8, "simple", lambda: strip(fx_favor()))
add("fx/petal.png", 8, 8, 4, "simple", lambda: strip(fx_petal()))
add("ui/banner.png", 160, 32, 1, "simple", banner)
add("ui/letter-win.png", 64, 48, 1, "simple", letter_win)
add("ui/divider.png", 96, 8, 1, "simple", divider)


def tier(path: Path) -> str:
    """simple = 简洁版；final = 正式图或代码画的正式图（没有标记）。旧的 placeholder=1 也算 simple。"""
    try:
        with Image.open(path) as im:
            if im.info.get("tier") == "simple" or im.info.get("placeholder") == "1":
                return "simple"
    except OSError:
        return "missing"
    return "final"


def build(force: bool, only: list[str] | None = None) -> None:
    made = kept = 0
    for rel, w, h, frames, kind, fn in MANIFEST:
        if only and not any(rel.startswith(o) for o in only):
            continue
        target = PUBLIC / rel
        if kind == "simple" and target.exists() and not force and tier(target) == "final":
            kept += 1  # 正式图已经覆盖过，不冲掉
            continue
        img = fn()
        assert img.size == (w * frames, h), (rel, img.size)
        target.parent.mkdir(parents=True, exist_ok=True)
        meta = PngInfo()
        if kind == "simple":
            meta.add_text("tier", "simple")
        img.save(target, pnginfo=meta, optimize=True)
        made += 1
    print(f"画了 {made} 个文件，保留已有正式图 {kept} 个，清单共 {len(MANIFEST)} 项 → {PUBLIC}")


def check() -> int:
    bad = 0
    listed = {rel for rel, *_ in MANIFEST}
    in_spec = set(re.findall(r"`((?:cards|table|scene|icons|seats|fx|ui)/[\w./-]+\.png)`", SPEC.read_text("utf-8")))
    for rel in sorted(in_spec - listed):
        print("spec 里有、清单里没有：", rel)
        bad += 1
    for rel in sorted(listed - in_spec):
        print("清单里有、spec 里没写：", rel)
        bad += 1
    still = []
    for rel, w, h, frames, kind, _ in MANIFEST:
        target = PUBLIC / rel
        if not target.exists():
            print("缺文件：", rel)
            bad += 1
            continue
        with Image.open(target) as im:
            if im.size != (w * frames, h):
                print(f"尺寸不对：{rel} 是 {im.size}，spec 是 {w * frames}×{h}（{frames} 帧）")
                bad += 1
        if tier(target) == "simple":
            still.append(rel)
    for p in sorted(PUBLIC.rglob("*.png")):
        rel = str(p.relative_to(PUBLIC))
        if rel not in listed:
            print("public/art 里多出来、spec 没写的：", rel)
            bad += 1
    print(f"清单 {len(MANIFEST)} 项，问题 {bad} 个；还是简洁版的 {len(still)} 个" + (f"：{', '.join(still)}" if still else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--check" in args:
        sys.exit(check())
    build("--force" in args, [a for a in args if not a.startswith("--")] or None)
