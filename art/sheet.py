"""候选总览图（给自己自查和评审看）。

    python art/sheet.py portraits   # 每个角色一行：候选插画合成成整张牌（2×），下面一排 1× 原大
    python art/sheet.py scenes      # 场景按 1× 排
    python art/sheet.py icons       # 每批 v2 的 64 个候选按 3× 排成 8×8，左上角标编号
    python art/sheet.py deco        # 结算装饰 + 封面
输出到 art/out/r1/sheets/。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cardframe as cf  # noqa: E402
import simple as ph  # noqa: E402

R1 = Path(__file__).resolve().parent / "out" / "r1"
SHEETS = R1 / "sheets"
BG = (44, 30, 34, 255)


def label(img, s, x, y):
    ph.text(img, s, x, y)


def portraits() -> None:
    folder = R1 / "portraits"
    for role in cf.ROLES:
        files = sorted(folder.glob(f"{role}-s*.png"))
        if not files:
            continue
        cw, chh = 144 + 12, 200 + 140
        img = Image.new("RGBA", (len(files) * cw + 12, chh + 10), BG)
        for i, f in enumerate(files):
            art = Image.open(f).convert("RGBA")
            card = cf.face(role, art).resize((144, 200), Image.NEAREST)
            x = 12 + i * cw
            img.alpha_composite(card, (x, 24))
            label(img, f.stem.replace(role + "-", ""), x + 72, 12)
            img.alpha_composite(cf.face(role, art), (x, 232))
            img.alpha_composite(cf.mini(role, art.crop((18, 2, 46, 42))), (x + 80, 232))  # 小牌：默认裁切框
        SHEETS.mkdir(parents=True, exist_ok=True)
        img.save(SHEETS / f"portraits-{role}.png")
    print("ok portraits")


def scenes() -> None:
    files = sorted((R1 / "scenes").glob("*.png"))
    img = Image.new("RGBA", (3 * 520 + 8, ((len(files) + 2) // 3) * 310 + 8), BG)
    for i, f in enumerate(files):
        x, y = 8 + (i % 3) * 520, 8 + (i // 3) * 310
        img.alpha_composite(Image.open(f).convert("RGBA"), (x, y + 18))
        label(img, f.stem, x + 256, y + 8)
    SHEETS.mkdir(parents=True, exist_ok=True)
    img.save(SHEETS / "scenes.png")
    print("ok scenes")


def icons() -> None:
    for folder in sorted((R1 / "icons").glob("*")):
        def num(p):
            tail = p.stem[len(folder.name):].lstrip("-")
            return int(tail) if tail.isdigit() else 0
        files = sorted(folder.glob("*.png"), key=num)
        if not files:
            continue
        w, h = Image.open(files[0]).size
        s = 4 if w <= 16 else 3
        cw, chh = w * s + 10, h * s + 22
        img = Image.new("RGBA", (8 * cw + 10, ((len(files) + 7) // 8) * chh + 10), BG)
        for i, f in enumerate(files):
            x, y = 10 + (i % 8) * cw, 10 + (i // 8) * chh
            idx = str(num(f))
            # 半边深色、半边浅色底，看描边在两种底上都清楚
            d = ImageDraw.Draw(img)
            d.rectangle([x - 2, y + 12, x + w * s + 1, y + 12 + h * s + 1], fill=(70, 18, 26, 255))
            d.rectangle([x + (w * s) // 2, y + 12, x + w * s + 1, y + 12 + h * s + 1], fill=(239, 227, 200, 255))
            img.alpha_composite(Image.open(f).convert("RGBA").resize((w * s, h * s), Image.NEAREST), (x, y + 12))
            label(img, idx, x + 10, y + 5)
        SHEETS.mkdir(parents=True, exist_ok=True)
        img.save(SHEETS / f"icons-{folder.name}.png")
    print("ok icons")


def deco() -> None:
    files = sorted((R1 / "deco").glob("*.png")) + sorted((R1 / "covers").glob("*.png"))
    rows = []
    for f in files:
        im = Image.open(f).convert("RGBA")
        s = 1 if im.width >= 300 else 3 if im.width <= 64 else 2
        rows.append((f.stem, im.resize((im.width * s, im.height * s), Image.NEAREST)))
    width = max(r[1].width for r in rows) * 2 + 40
    y, placed, x = 10, [], 10
    rowh = 0
    for name, im in rows:
        if x + im.width > width:
            x, y = 10, y + rowh + 30
            rowh = 0
        placed.append((name, im, x, y))
        x += im.width + 20
        rowh = max(rowh, im.height)
    img = Image.new("RGBA", (width, y + rowh + 40), BG)
    for name, im, x, yy in placed:
        d = ImageDraw.Draw(img)
        d.rectangle([x, yy + 18, x + im.width // 2, yy + 18 + im.height], fill=(70, 18, 26, 255))
        d.rectangle([x + im.width // 2, yy + 18, x + im.width, yy + 18 + im.height], fill=(239, 227, 200, 255))
        img.alpha_composite(im, (x, yy + 18))
        label(img, name, x + im.width // 2, yy + 8)
    SHEETS.mkdir(parents=True, exist_ok=True)
    img.save(SHEETS / "deco.png")
    print("ok deco")


if __name__ == "__main__":
    for what in sys.argv[1:] or ["portraits", "scenes", "icons", "deco"]:
        globals()[what]()
