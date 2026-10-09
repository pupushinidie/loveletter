"""情书「烛光夜宴」的代码部分：牌框、点数金币、张数小点、牌背、小牌、牌堆、移出区、桌布纹理。

从开工样张 ~/projects/pipeline/games/loveletter/assets/work/cardframe.py 的 candle 方向搬过来（数字、心形点阵一样），
只留烛光夜宴一套，另外加了小牌（mini）、牌堆、空槽、移出的那张、桌布。数字和张数都由这里画，不交给模型。

坐标约定（和 art/spec.md 一致）：
- 整张牌 72×100，插画窗口 64×88 在 (4, 4)；左上角点数金币圆心 (10, 11)、半径 8，占住牌面 x 1–19、y 2–20；
  底边 y 94–97 一排金色小方块 = 这种角色在牌堆里有几张。
- 小牌 32×44，插画窗口 28×40 在 (2, 2)；左上角点数金币圆心 (8, 8)、半径 7，占住 x 0–16、y 0–16。
- 牌堆 / 空槽 / 移出区 画布都是 80×112，牌摆在 (0, 0)，右下方是牌的厚度。
"""
from __future__ import annotations

from PIL import Image, ImageDraw

W, H = 72, 100
ART_X, ART_Y, ART_W, ART_H = 4, 4, 64, 88
MW, MH = 32, 44
MART_X, MART_Y, MART_W, MART_H = 2, 2, 28, 40
STACK_W, STACK_H = 80, 112

ROLES = ["spy", "guard", "priest", "baron", "handmaid", "prince", "chancellor", "king", "countess", "princess"]
VALUE = {r: i for i, r in enumerate(ROLES)}
COPIES = {"spy": 2, "guard": 6, "priest": 2, "baron": 2, "handmaid": 2, "prince": 2, "chancellor": 2,
          "king": 1, "countess": 1, "princess": 1}
NAME = {"spy": "间谍", "guard": "卫兵", "priest": "牧师", "baron": "男爵", "handmaid": "侍女", "prince": "王子",
        "chancellor": "大臣", "king": "国王", "countess": "女伯爵", "princess": "公主"}

# 烛光夜宴调色板（spec.md「调色板」一节的代码版）
P = {
    "ink": "#1c0609",        # 最外圈描边、最深的影子
    "velvet": "#6e1420",     # 天鹅绒牌框
    "velvet2": "#4c0c15",    # 天鹅绒暗纹
    "velvet3": "#3e0910",    # 牌背中心圆底
    "back1": "#5e101b",      # 牌背底色
    "back2": "#7c1a26",      # 牌背菱格线
    "gold": "#e3b54f",       # 金线
    "gold2": "#9c6f22",      # 暗金
    "coin": "#f0c75a",       # 金币面
    "coin2": "#a8761f",      # 金币边
    "shine": "#fff1b8",      # 金色高光
    "digit": "#4a0b12",      # 金币上的数字
    "edge": "#e8d9b0",       # 纸牌侧边（牌堆厚度）
    "edge2": "#b89a60",
    "wax": "#b0182c",        # 火漆
    "wax2": "#6a0c18",
    "cream": "#efe3c8",      # 白天版桌布
    "cream2": "#e3d2ad",
    "cream3": "#c9a55a",
}

DIGITS = {
    "0": [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
    "1": ["..##..", ".###..", "####..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
    "2": [".####.", "##..##", "....##", "....##", "...##.", "..##..", ".##...", "##....", "##....", "######"],
    "3": [".####.", "##..##", "....##", "....##", "..###.", "....##", "....##", "....##", "##..##", ".####."],
    "4": ["##..##", "##..##", "##..##", "##..##", "######", "....##", "....##", "....##", "....##", "....##"],
    "5": ["######", "##....", "##....", "#####.", "....##", "....##", "....##", "....##", "##..##", ".####."],
    "6": [".####.", "##..##", "##....", "##....", "#####.", "##..##", "##..##", "##..##", "##..##", ".####."],
    "7": ["######", "....##", "....##", "...##.", "...##.", "..##..", "..##..", "..##..", "..##..", "..##.."],
    "8": [".####.", "##..##", "##..##", "##..##", ".####.", "##..##", "##..##", "##..##", "##..##", ".####."],
    "9": [".####.", "##..##", "##..##", "##..##", ".#####", "....##", "....##", "....##", "##..##", ".####."],
}
HEART = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."]


def rgb(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def C(name: str) -> tuple[int, int, int, int]:
    return rgb(P[name])


def digits(img: Image.Image, text: str, cx: int, top: int, fill) -> None:
    """在 (cx 居中, top) 画 6×10 像素数字。"""
    width = len(text) * 7 - 1
    x0 = cx - width // 2
    for i, ch in enumerate(text):
        for r, row in enumerate(DIGITS[ch]):
            for c, v in enumerate(row):
                if v == "#":
                    img.putpixel((x0 + i * 7 + c, top + r), fill)


def heart(img: Image.Image, x: int, y: int, fill, scale: int = 1) -> None:
    for r, row in enumerate(HEART):
        for c, v in enumerate(row):
            if v == "#":
                for dy in range(scale):
                    for dx in range(scale):
                        img.putpixel((x + c * scale + dx, y + r * scale + dy), fill)


def round_corners(img: Image.Image, r: int = 1) -> None:
    w, h = img.size
    for cx, cy, sx, sy in [(r, r, -1, -1), (w - 1 - r, r, 1, -1), (r, h - 1 - r, -1, 1), (w - 1 - r, h - 1 - r, 1, 1)]:
        for dy in range(r + 1):
            for dx in range(r + 1):
                if (dx - 0.5) ** 2 + (dy - 0.5) ** 2 > (r + 0.3) ** 2:
                    img.putpixel((cx + sx * dx, cy + sy * dy), (0, 0, 0, 0))


def coin(img: Image.Image, cx: int, cy: int, r: int, value: int) -> None:
    """点数金币：深色外圈 + 暗金边 + 金面 + 数字。"""
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1], fill=C("ink"))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=C("coin2"))
    d.ellipse([cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 2], fill=C("coin"))
    digits(img, str(value), cx + 1, cy - 5, C("digit"))


def velvet(img: Image.Image) -> None:
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if (x + (y // 3)) % 4 == 0:
                img.putpixel((x, y), C("velvet2"))


def face(role: str, art: Image.Image) -> Image.Image:
    """整张牌 72×100：天鹅绒框 + 64×88 插画 + 金线 + 金钉角 + 底边张数小点 + 点数金币。"""
    assert art.size == (ART_W, ART_H), art.size
    img = Image.new("RGBA", (W, H), C("velvet"))
    d = ImageDraw.Draw(img)
    velvet(img)
    d.rectangle([0, 0, W - 1, H - 1], outline=C("ink"))
    d.rectangle([2, 2, W - 3, H - 3], outline=C("gold2"))
    img.paste(art.convert("RGBA"), (ART_X, ART_Y))
    d.rectangle([ART_X - 1, ART_Y - 1, ART_X + ART_W, ART_Y + ART_H], outline=C("gold"))
    for x, y in [(2, 2), (W - 3, 2), (2, H - 3), (W - 3, H - 3)]:  # 金钉角
        d.rectangle([x - 1, y - 1, x + 1, y + 1], fill=C("gold"))
        img.putpixel((x, y), C("shine"))
    round_corners(img, 1)
    copies = COPIES[role]
    x0 = W // 2 - (copies * 6 - 2) // 2
    for i in range(copies):
        d.rectangle([x0 + i * 6, H - 6, x0 + i * 6 + 3, H - 3], fill=C("coin"))
        img.putpixel((x0 + i * 6, H - 6), C("shine"))
    coin(img, 10, 11, 8, VALUE[role])
    return img


def back() -> Image.Image:
    """牌背 72×100：深红菱格纹 + 双金框 + 中间金心。"""
    img = Image.new("RGBA", (W, H), C("back1"))
    d = ImageDraw.Draw(img)
    for y in range(H):
        for x in range(W):
            if (x + y) % 8 == 0 or (x - y) % 8 == 0:
                img.putpixel((x, y), C("back2"))
    d.rectangle([3, 3, W - 4, H - 4], outline=C("gold"))
    d.rectangle([5, 5, W - 6, H - 6], outline=C("gold2"))
    d.ellipse([W // 2 - 14, H // 2 - 14, W // 2 + 13, H // 2 + 13], fill=C("velvet3"), outline=C("gold"))
    heart(img, W // 2 - 10, H // 2 - 6, C("gold"), scale=3)
    d.rectangle([0, 0, W - 1, H - 1], outline=C("ink"))
    round_corners(img, 1)
    return img


def mini(role: str | None, art: Image.Image) -> Image.Image:
    """小牌 32×44：28×40 的插画裁切（头肩）+ 金线 + 左上角点数金币。role=None 时是小牌背（art 传牌背裁切）。"""
    assert art.size == (MART_W, MART_H), art.size
    img = Image.new("RGBA", (MW, MH), C("velvet"))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, MW - 1, MH - 1], outline=C("ink"))
    img.paste(art.convert("RGBA"), (MART_X, MART_Y))
    d.rectangle([MART_X - 1, MART_Y - 1, MART_X + MART_W, MART_Y + MART_H], outline=C("gold"))
    round_corners(img, 1)
    if role is not None:
        coin(img, 8, 8, 7, VALUE[role])
    return img


def mini_back() -> Image.Image:
    """小牌背：菱格纹 + 金框 + 小金心（不是大牌背缩小，单独按 32×44 画）。"""
    img = Image.new("RGBA", (MW, MH), C("back1"))
    d = ImageDraw.Draw(img)
    for y in range(MH):
        for x in range(MW):
            if (x + y) % 6 == 0 or (x - y) % 6 == 0:
                img.putpixel((x, y), C("back2"))
    d.rectangle([2, 2, MW - 3, MH - 3], outline=C("gold"))
    d.ellipse([MW // 2 - 7, MH // 2 - 7, MW // 2 + 6, MH // 2 + 6], fill=C("velvet3"), outline=C("gold"))
    heart(img, MW // 2 - 4, MH // 2 - 3, C("gold"))
    d.rectangle([0, 0, MW - 1, MH - 1], outline=C("ink"))
    round_corners(img, 1)
    return img


def stack(layers: int) -> Image.Image:
    """牌堆 80×112：顶上一张牌背在 (0, 0)，下面 layers 层纸边往右下错开（每层右 1、下 2），再加一层影子。"""
    img = Image.new("RGBA", (STACK_W, STACK_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if layers:
        sx, sy = layers + 2, 2 * layers + 3  # 影子
        d.rectangle([sx, sy, sx + W - 1, sy + H - 1], fill=(10, 2, 4, 110))
    for i in range(layers, 0, -1):
        d.rectangle([i, 2 * i, i + W - 1, 2 * i + H - 1], fill=C("edge" if i % 2 else "edge2"), outline=C("ink"))
    img.alpha_composite(back(), (0, 0))
    return img


def slot() -> Image.Image:
    """空槽 80×112：牌那么大的金色虚线框，中间一颗暗金小心（牌堆抽空、移出区空着时用）。"""
    img = Image.new("RGBA", (STACK_W, STACK_H), (0, 0, 0, 0))
    for x in range(W):
        for y in (0, H - 1):
            if (x // 3) % 2 == 0:
                img.putpixel((x, y), C("gold2"))
    for y in range(H):
        for x in (0, W - 1):
            if (y // 3) % 2 == 0:
                img.putpixel((x, y), C("gold2"))
    inner = Image.new("RGBA", (W - 2, H - 2), rgb(P["ink"], 70))
    img.alpha_composite(inner, (1, 1))
    heart(img, W // 2 - 7, H // 2 - 5, C("gold2"), scale=2)
    return img


def aside() -> Image.Image:
    """开局移出的那张（面朝下）：一张牌背 + 一层厚度，竖着系一条金缎带，中间压红色火漆心。"""
    img = stack(1)
    d = ImageDraw.Draw(img)
    cx = W // 2
    d.rectangle([cx - 3, 1, cx + 2, H - 2], fill=C("gold"))
    d.line([cx - 3, 1, cx - 3, H - 2], fill=C("shine"))
    d.line([cx + 2, 1, cx + 2, H - 2], fill=C("gold2"))
    cy = H // 2
    d.ellipse([cx - 11, cy - 11, cx + 10, cy + 10], fill=C("wax2"))
    d.ellipse([cx - 10, cy - 10, cx + 9, cy + 8], fill=C("wax"))
    heart(img, cx - 7, cy - 5, C("wax2"), scale=2)
    img.putpixel((cx - 6, cy - 7), (255, 160, 170, 255))
    img.putpixel((cx - 5, cy - 8), (255, 160, 170, 255))
    return img


def cloth(day: bool) -> Image.Image:
    """桌布纹理 32×32（可平铺）：夜间是深红天鹅绒菱格，白天是奶油色锦缎菱格；交点一颗金点。"""
    base, line, dot = (("cream", "cream2", "cream3") if day else ("velvet2", "back1", "gold2"))
    img = Image.new("RGBA", (32, 32), C(base))
    for y in range(32):
        for x in range(32):
            if (x + y) % 16 == 0 or (x - y) % 16 == 0:
                img.putpixel((x, y), C(line))
    for x, y in [(0, 0), (8, 8), (16, 0), (0, 16), (16, 16), (24, 8), (8, 24), (24, 24)]:
        img.putpixel((x, y), C(dot))
    return img
