"""座位印章正式版：PixelLab v2 出的火漆底（纹理、波浪边、左上高光）+ 代码画的浅色浮雕图案，按座位色换色。

为什么合成：v2 只出得了玫瑰、星、日、月，出不了钥匙和羽毛；图案是金色，换成琥珀座位色后看不清。
评审第 1 轮要求色弱时靠图案分座位，所以图案统一用 simple.py 的 11×11 浅色浮雕（和简洁版同一套形状）。

做法：
1. 底图去掉原来的金色图案：图案像素（偏黄、偏亮）用周围蜡色反复向内填补；
2. 红色系像素换成座位色（色相换掉，明暗比例保留）；
3. 图案按底图实际圆心摆放，浅色 + 右下深色投影。

用法：
    python art/seals.py preview            # 几个底图 × 6 座位的对比图 → art/out/r2/seals-preview.png
    python art/seals.py build <底图相对 art/ 的路径>   # 6 个候选 → art/out/r2/seals/<底图名>/seal-<i>.png
"""
from __future__ import annotations

import colorsys
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import simple  # noqa: E402

ART = Path(__file__).resolve().parent
OUT = ART / "out" / "r2"


def hsv(p):
    return colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)


def is_emblem(p) -> bool:
    """金色 / 浅色图案像素：色相偏黄（> 22°）且够亮，或者很亮。"""
    if p[3] == 0:
        return False
    h, s, v = hsv(p)
    return (0.06 < h < 0.2 and v > 0.45) or v > 0.85


def clean(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    a = img.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    img.putalpha(a)
    return img


def disc_center(img: Image.Image) -> tuple[float, float, float]:
    px = img.load()
    pts = [(x, y) for y in range(img.height) for x in range(img.width) if px[x, y][3]]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    r = (len(pts) / 3.14159) ** 0.5
    return cx, cy, r


def erase_emblem(img: Image.Image) -> Image.Image:
    """把圆内的图案像素用周围的蜡色补上（只动离边缘 3px 以内的内圈，外圈的金边/高光留着）。"""
    img = img.copy()
    px = img.load()
    cx, cy, r = disc_center(img)
    holes = {(x, y) for y in range(img.height) for x in range(img.width)
             if is_emblem(px[x, y]) and (x - cx) ** 2 + (y - cy) ** 2 < (r - 2.5) ** 2}
    for _ in range(30):
        if not holes:
            break
        done = []
        for x, y in holes:
            nb = [px[x + dx, y + dy] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))
                  if 0 <= x + dx < img.width and 0 <= y + dy < img.height and (x + dx, y + dy) not in holes and px[x + dx, y + dy][3]]
            if len(nb) >= 2:
                done.append(((x, y), tuple(sum(c[i] for c in nb) // len(nb) for i in range(4))))
        for (x, y), c in done:
            px[x, y] = c[:3] + (255,)
            holes.discard((x, y))
    return img


WAX_DIM = 0.78  # 蜡压暗一档，浅色图案才跳得出来（琥珀、翠绿座位最吃亏）


def recolor(img: Image.Image, target_hex: str) -> Image.Image:
    """红色系蜡换成座位色：色相换掉，饱和度取两者较大，明度按原来的比例（座位色越亮整体越亮）。"""
    tr, tg, tb = simple.rgb(target_hex)[:3]
    th, ts, tv = colorsys.rgb_to_hsv(tr / 255, tg / 255, tb / 255)
    # 原图蜡的典型明度，用来把明暗映射到座位色上
    img = img.copy()
    px = img.load()
    vals = [hsv(px[x, y])[2] for y in range(img.height) for x in range(img.width) if px[x, y][3]]
    vmed = sorted(vals)[len(vals) // 2] or 0.5
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            h, s, v = hsv((r, g, b))
            if v < 0.16:  # 深色描边保留
                continue
            nv = max(0.0, min(1.0, WAX_DIM * tv * v / vmed))
            ns = max(0.0, min(1.0, ts * (0.75 + 0.25 * s)))
            rr, gg, bb = colorsys.hsv_to_rgb(th, ns, nv)
            px[x, y] = (int(rr * 255), int(gg * 255), int(bb * 255), a)
    return img


def emblem(img: Image.Image, idx: int) -> Image.Image:
    img = img.copy()
    px = img.load()
    cx, cy, _ = disc_center(img)
    base = simple.rgb(simple.SEAT_HEX[idx])
    em = EMBLEMS.get(idx, simple.EMBLEMS[idx])
    ox, oy = round(cx - 5.5), round(cy - 5.5)
    shadow, light = simple.darken(base, 0.62), simple.lighten(base, 0.8)
    for r_, row in enumerate(em):
        for c_, ch in enumerate(row):
            if ch == "X":
                below = em[r_ + 1][c_ + 1] if r_ + 1 < len(em) and c_ + 1 < len(row) else "."
                if below != "X":
                    px[ox + c_ + 1, oy + r_ + 1] = shadow
    for r_, row in enumerate(em):
        for c_, ch in enumerate(row):
            if ch == "X":
                px[ox + c_, oy + r_] = light
    return img


# 正式版改过的图案（其余沿用 simple.EMBLEMS）：羽毛在 24px 下读成一道斜杠，加羽枝缺口和羽轴尾巴
EMBLEMS = {
    5: [
        ".......XXXX",
        "......XXXXX",
        ".....XXX.X.",
        "....XXXXXX.",
        "...XXX.XX..",
        "...XXXXX...",
        "..XX.XX....",
        "..XXXX.....",
        ".X.........",
        "X..........",
        "X..........",
    ],
}


def make(base_path: Path, idx: int) -> Image.Image:
    base = erase_emblem(clean(Image.open(base_path)))
    out = emblem(recolor(base, simple.SEAT_HEX[idx]), idx)
    box = out.getbbox()
    out = out.crop(box)
    canvas = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    canvas.alpha_composite(out, ((24 - out.width) // 2, (24 - out.height) // 2))
    return canvas


BASES = ["out/r1/icons/seal-flower/seal-flower-19.png", "out/r1/icons/seal-flower/seal-flower-43.png",
         "out/r1/icons/seal-sky/seal-sky-20.png", "out/r1/icons/seal-sky/seal-sky-36.png",
         "out/r1/icons/seal-sky/seal-sky-8.png", "out/r1/icons/seal-sky/seal-sky-52.png"]


def preview(bases: list[str]) -> Path:
    """每行一个底图：原图、去图案后、6 座位 4× 在夜/日底上，右边 1× 一排。"""
    S = 4
    rows = []
    for b in bases:
        src = clean(Image.open(ART / b))
        seals = [make(ART / b, i) for i in range(6)]
        w = (2 + 6) * (24 * S + 6) + 2 * (24 * 7) + 40
        row = Image.new("RGBA", (w, 24 * S * 2 + 30), (44, 30, 34, 255))
        d = ImageDraw.Draw(row)
        d.text((4, 2), b.split("/")[-1], fill=(255, 255, 255, 255))
        x = 4
        for im in [src, erase_emblem(src)] + seals:
            for k, bg in enumerate(((70, 18, 26, 255), (239, 227, 200, 255))):
                y = 16 + k * (24 * S + 4)
                d.rectangle([x, y, x + 24 * S - 1, y + 24 * S - 1], fill=bg)
                row.alpha_composite(im.resize((24 * S, 24 * S), Image.NEAREST), (x, y))
            x += 24 * S + 6
        for k, bg in enumerate(((70, 18, 26, 255), (239, 227, 200, 255))):
            y = 16 + k * 40
            d.rectangle([x, y, x + 24 * 7 + 8, y + 31], fill=bg)
            for i, s in enumerate(seals):
                row.alpha_composite(s, (x + 4 + i * 28, y + 4))
        rows.append(row)
    sheet = Image.new("RGBA", (max(r.width for r in rows), sum(r.height + 6 for r in rows)), (20, 14, 16, 255))
    y = 0
    for r in rows:
        sheet.alpha_composite(r, (0, y))
        y += r.height + 6
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "seals-preview.png"
    sheet.save(path)
    return path


def build(base: str) -> list[Path]:
    folder = OUT / "seals" / Path(base).stem
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for i in range(6):
        p = folder / f"seal-{i}.png"
        make(ART / base, i).save(p)
        paths.append(p)
    return paths


if __name__ == "__main__":
    if sys.argv[1:2] == ["build"]:
        print(build(sys.argv[2]))
    else:
        print(preview(sys.argv[2:] or BASES))


def set_preview(seals: list[Image.Image], path: Path) -> Path:
    """一套 6 个：上排夜间底 4×，下排白天底 4×，右边 1×/2× 实际大小。"""
    S = 4
    w = 6 * (24 * S + 4) + 4 + 6 * 26 + 8
    img = Image.new("RGBA", (w, 2 * (24 * S + 4) + 4), (44, 30, 34, 255))
    d = ImageDraw.Draw(img)
    for k, bg in enumerate(((70, 18, 26, 255), (239, 227, 200, 255))):
        y = 4 + k * (24 * S + 4)
        d.rectangle([0, y - 2, w, y + 24 * S + 1], fill=bg)
        for i, s in enumerate(seals):
            img.alpha_composite(s.resize((24 * S, 24 * S), Image.NEAREST), (4 + i * (24 * S + 4), y))
            img.alpha_composite(s, (8 + 6 * (24 * S + 4) + i * 26, y + 8))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    return path
