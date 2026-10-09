"""定稿导出：按 art/selection.json 把选中的候选按 art/spec.md 的文件名、尺寸、帧数写进 art/out/final/（目录结构同 public/art）。

selection.json 结构（路径相对 art/）：
{
  "portraits": {"<角色>": {"file": "out/r1/portraits/guard-s2.png", "miniCrop": [18, 2], "fix": "说明（可选）"}},
  "scenes":    {"night-0": "out/r1/scenes/night-0-s12.png", ...},
  "icons":     {"<名字>": {"file": "out/r1/icons/favor/favor-12.png"}},   # 也放动画首帧 candle、shield-big、duel-big
  "seals":     {"0": {"file": "...", "hue": "#d23a4a"}, ...},
  "deco":      {"banner": "...", "letter-win": "..."},
  "covers":    {"recommended": "out/r1/covers/cover-1.png", "candidates": [...]}
}
动画（fx/*.png）从 art/out/anim/<名字>/strip.png 来（art/anim.py 生成）。

用法：~/miniconda3/envs/quant/bin/python art/export.py
"""
from __future__ import annotations

import colorsys
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cardframe as cf  # noqa: E402

ART = Path(__file__).resolve().parent
PUBLIC = ART / "out" / "final"  # 先导出到这里；换图验收开始时制作人通知，再按 spec 覆盖 apps/web/public/art
FX = {"candle": (16, 32, 6), "snuff": (16, 32, 8), "shield": (32, 32, 8), "duel": (32, 32, 6), "favor": (32, 32, 8), "petal": (8, 8, 4)}


def save(img: Image.Image, rel: str, size: tuple[int, int]) -> None:
    assert img.size == size, (rel, img.size, size)
    target = PUBLIC / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    img.save(target, optimize=True)  # 不带 placeholder 标记


def clean_alpha(img: Image.Image, cut: int = 128) -> Image.Image:
    """v2 透明图的半透明边：低于 cut 的去掉，其余设成不透明（像素图不要半透明毛边）。"""
    img = img.convert("RGBA")
    a = img.getchannel("A").point(lambda v: 255 if v >= cut else 0)
    img.putalpha(a)
    return img


def drop_specks(img: Image.Image) -> Image.Image:
    """去掉孤立的单个像素（四邻都透明）。"""
    img = img.copy()
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if px[x, y][3] and all(not (0 <= x + dx < w and 0 <= y + dy < h) or px[x + dx, y + dy][3] == 0
                                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[x, y] = (0, 0, 0, 0)
    return img


def fit(img: Image.Image, w: int, h: int) -> Image.Image:
    """裁掉四周空白后居中放回 w×h 画布（内容比画布大就报错，不缩放）。"""
    box = img.getbbox()
    if box is None:
        raise ValueError("空图")
    img = img.crop(box)
    if img.width > w or img.height > h:
        raise ValueError(f"内容 {img.size} 比画布 {w}×{h} 大")
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((w - img.width) // 2, (h - img.height) // 2))
    return canvas


def recolor(img: Image.Image, target_hex: str) -> Image.Image:
    """火漆换色：红色系（色相 330–30°、饱和度 > 0.35）的像素换成目标色相，明度按原来的比例。"""
    tr, tg, tb, _ = cf.rgb(target_hex)
    th, ts, tv = colorsys.rgb_to_hsv(tr / 255, tg / 255, tb / 255)
    img = img.copy()
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s > 0.35 and (h > 0.9 or h < 0.085):
                nr, ng, nb = colorsys.hsv_to_rgb(th, min(1, s * ts / 0.75), min(1, v * tv / 0.8))
                px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return img


def favor_empty(favor: Image.Image) -> Image.Image:
    """还没拿到的标记：去饱和、压暗、70% 不透明。"""
    img = favor.copy()
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a:
                grey = int((r * 0.3 + g * 0.59 + b * 0.11) * 0.55)
                px[x, y] = (grey + 8, grey, grey + 4, int(a * 0.7))
    return img


def divider() -> Image.Image:
    """96×8 金色卷草分隔条：中间一颗金心，两边渐细的金线和小卷。"""
    img = Image.new("RGBA", (96, 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    gold, dark, shine = cf.C("gold"), cf.C("gold2"), cf.C("shine")
    d.line([4, 4, 40, 4], fill=gold)
    d.line([55, 4, 91, 4], fill=gold)
    d.line([12, 5, 38, 5], fill=dark)
    d.line([57, 5, 83, 5], fill=dark)
    for x in (4, 91):
        d.point([(x, 3), (x, 5)], fill=gold)
    for x, s in ((40, -1), (55, 1)):
        d.point([(x + s, 3), (x + s, 5), (x + 2 * s, 2), (x + 2 * s, 6)], fill=gold)
    cf.heart(img, 44, 1, cf.C("ink"))
    cf.heart(img, 44, 1, gold)
    img.putpixel((45, 2), shine)
    return img


def main() -> None:
    s = json.loads((ART / "selection.json").read_text("utf-8"))
    n = 0
    for role, item in s.get("portraits", {}).items():
        art = Image.open(ART / item["file"]).convert("RGBA")
        save(cf.face(role, art), f"cards/{role}.png", (72, 100))
        x, y = item.get("miniCrop", [18, 2])
        save(cf.mini(role, art.crop((x, y, x + 28, y + 40))), f"cards/mini/{role}.png", (32, 44))
        n += 2
    for key, file in s.get("scenes", {}).items():
        save(Image.open(ART / file).convert("RGBA"), f"scene/{key}.png", (512, 288))
        n += 1
    icons = s.get("icons", {})
    for key, item in icons.items():
        if key in ("candle", "shield-big", "duel-big"):
            continue  # 动画首帧，不直接导出
        size = (32, 32) if key == "favor-big" else (16, 16)
        img = fit(drop_specks(clean_alpha(Image.open(ART / item["file"]))), *size)
        save(img, f"icons/{key}.png", size)
        n += 1
        if key == "favor":
            save(favor_empty(img), "icons/favor-empty.png", size)
            n += 1
    for idx, item in s.get("seals", {}).items():
        img = fit(drop_specks(clean_alpha(Image.open(ART / item["file"]))), 24, 24)
        save(recolor(img, item["hue"]), f"seats/seal-{idx}.png", (24, 24))
        n += 1
    deco = s.get("deco", {})
    if "banner" in deco:
        save(fit(drop_specks(clean_alpha(Image.open(ART / deco["banner"]))), 160, 32), "ui/banner.png", (160, 32))
        n += 1
    if "letter-win" in deco:
        save(fit(drop_specks(clean_alpha(Image.open(ART / deco["letter-win"]))), 64, 48), "ui/letter-win.png", (64, 48))
        n += 1
    save(divider(), "ui/divider.png", (96, 8))
    n += 1
    for key, (w, h, frames) in FX.items():
        strip = ART / "out" / "anim" / key / "strip.png"
        if strip.exists():
            save(Image.open(strip).convert("RGBA"), f"fx/{key}.png", (w * frames, h))
            n += 1
    print("导出", n, "个文件 →", PUBLIC)


if __name__ == "__main__":
    main()
