"""情书的占位图：按 art/spec.md 的正式文件名、尺寸、帧数画进 apps/web/public/art/。

用法（仓库根目录）：
    ~/miniconda3/envs/quant/bin/python art/placeholders.py          # 画全部（已有正式图的不覆盖，见下）
    ~/miniconda3/envs/quant/bin/python art/placeholders.py --force  # 连正式图一起重画成占位图（慎用）
    ~/miniconda3/envs/quant/bin/python art/placeholders.py --check  # 核对：spec 里每个文件都在、尺寸对；列出还是占位图的文件

两类文件：
- 占位（kind="ph"）：纯色底 + 中文缩写，PNG 里带 tEXt「placeholder=1」。出图阶段定稿后按同名覆盖，
  --check 会一直把它们列为「还是占位图」，直到被换掉。
- 代码画的正式图（kind="code"）：牌背、小牌背、牌堆、空槽、移出区、桌布。规格阶段就是正式版，出图阶段可以微调，
  它们没有 placeholder 标记。牌面（cards/<角色>.png）是「正式牌框 + 占位插画」，算占位。

已经不是占位图的文件（没有 placeholder 标记、尺寸也对）默认不覆盖，免得出图后再跑一遍把定稿冲掉。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cardframe as cf  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps" / "web" / "public" / "art"
SPEC = ROOT / "art" / "spec.md"
WOFF2 = ROOT / "apps" / "web" / "src" / "assets" / "pixel" / "fusion-pixel-12px-zh_hans.woff2"
FONT_CACHE = ROOT / "art" / "out" / "fusion12.ttf"

# 占位用的角色识别色（只给占位图用；正式插画按 spec 的调色板出）
ROLE_COLOR = {
    "spy": "#3a3346", "guard": "#5f6878", "priest": "#7a6236", "baron": "#7b3f2a", "handmaid": "#a8857e",
    "prince": "#3f62a8", "chancellor": "#2f5d50", "king": "#a87a22", "countess": "#5b2a6e", "princess": "#b3304e",
}
# 座位色（正式的，和 spec「座位」一节一致）
SEATS = [("#d23a4a", "玫"), ("#3d6fd6", "百"), ("#3fa45b", "星"), ("#e0a030", "日"), ("#9a5bd0", "月"), ("#2fb5ad", "羽")]


def font() -> ImageFont.FreeTypeFont:
    if not FONT_CACHE.exists():
        from fontTools.ttLib import TTFont

        FONT_CACHE.parent.mkdir(parents=True, exist_ok=True)
        f = TTFont(str(WOFF2))
        f.flavor = None
        f.save(str(FONT_CACHE))
    return ImageFont.truetype(str(FONT_CACHE), 12)


FONT = font()


def text(img: Image.Image, s: str, cx: int, cy: int, fill=(255, 255, 255, 255), ink=(20, 6, 9, 255)) -> None:
    """像素字（不抗锯齿）居中，带一圈深色描边。"""
    d = ImageDraw.Draw(img)
    d.fontmode = "1"
    x0, y0, x1, y1 = d.textbbox((0, 0), s, font=FONT)
    x, y = cx - (x1 - x0) // 2 - x0, cy - (y1 - y0) // 2 - y0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx or dy:
                d.text((x + dx, y + dy), s, font=FONT, fill=ink)
    d.text((x, y), s, font=FONT, fill=fill)


def block(w: int, h: int, color: str, label: str = "", transparent: bool = True, radius: int = 0) -> Image.Image:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0) if transparent else cf.rgb(color))
    d = ImageDraw.Draw(img)
    if transparent:
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=cf.rgb(color), outline=(20, 6, 9, 255))
    if label:
        text(img, label, w // 2, h // 2)
    return img


def portrait_ph(role: str) -> Image.Image:
    """64×88 插画占位：角色色底 + 斜纹 + 中文名 + 「占位」。"""
    img = Image.new("RGBA", (cf.ART_W, cf.ART_H), cf.rgb(ROLE_COLOR[role]))
    for y in range(cf.ART_H):
        for x in range(cf.ART_W):
            if (x + y) % 12 < 2:
                r, g, b, _ = img.getpixel((x, y))
                img.putpixel((x, y), (min(255, r + 22), min(255, g + 22), min(255, b + 22), 255))
    text(img, cf.NAME[role], cf.ART_W // 2, 50)
    text(img, "占位", cf.ART_W // 2, 72, fill=(255, 230, 160, 255))
    return img


def mini_ph(role: str) -> Image.Image:
    art = Image.new("RGBA", (cf.MART_W, cf.MART_H), cf.rgb(ROLE_COLOR[role]))
    name = cf.NAME[role]
    text(art, name[0] if len(name) < 3 else name[1], cf.MART_W // 2 + 2, 28)
    return cf.mini(role, art)


def strip(w: int, h: int, n: int, draw) -> Image.Image:
    """横排精灵图：第 i 帧调用 draw(frame_img, i)。"""
    img = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
    for i in range(n):
        f = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw(f, i)
        img.alpha_composite(f, (i * w, 0))
    return img


# ---------- 动画占位：几帧在动的色块 ----------

def candle_frame(f: Image.Image, i: int, lit: bool = True, flame: float = 1.0, smoke: int = -1) -> None:
    d = ImageDraw.Draw(f)
    d.rectangle([6, 16, 9, 29], fill=cf.rgb("#efe3c8"), outline=cf.rgb("#1c0609"))  # 蜡烛
    d.rectangle([3, 29, 12, 31], fill=cf.rgb("#e3b54f"))  # 烛台
    d.line([8, 13, 8, 15], fill=cf.rgb("#1c0609"))  # 烛芯
    if lit and flame > 0:
        sway = [0, 1, 0, -1, 0, 1][i % 6]
        hgt = max(1, round(8 * flame))
        d.ellipse([6 + sway, 15 - hgt, 10 + sway, 15], fill=cf.rgb("#ffb030"))
        d.ellipse([7 + sway, 15 - hgt // 2, 9 + sway, 15], fill=cf.rgb("#fff1b8"))
    if smoke >= 0:
        y = 11 - smoke * 2
        d.rectangle([7 + (smoke % 2), y, 9 + (smoke % 2), y + 2], fill=(160, 150, 160, 200))


def fx_candle(f, i):
    candle_frame(f, i)


def fx_snuff(f, i):
    # 0–2 火苗晃、3–4 变小、5 熄灭、6–7 青烟上升；最后一帧 = 熄灭的蜡烛（静止保留）
    flame = [1, 1, 0.8, 0.5, 0.25, 0, 0, 0][i]
    candle_frame(f, i, lit=flame > 0, flame=flame, smoke=i - 5 if i >= 5 else -1)


def fx_shield(f, i):
    d = ImageDraw.Draw(f)
    r = [3, 6, 9, 12, 14, 15, 14, 14][i]
    d.ellipse([16 - r, 16 - r, 15 + r, 15 + r], outline=cf.rgb("#9fd8ff"), width=2)
    if i >= 3:
        d.polygon([(10, 9), (21, 9), (21, 17), (15, 23), (10, 17)], fill=cf.rgb("#e3b54f"), outline=cf.rgb("#1c0609"))


def fx_duel(f, i):
    d = ImageDraw.Draw(f)
    off = [10, 7, 4, 1, 0, 0][i]
    d.line([2 + off, 28, 18 + off, 4], fill=cf.rgb("#d8dde6"), width=2)
    d.line([29 - off, 28, 13 - off, 4], fill=cf.rgb("#d8dde6"), width=2)
    if i >= 3:
        s = [0, 0, 0, 3, 6, 4][i]
        d.ellipse([16 - s, 10 - s, 16 + s, 10 + s], fill=cf.rgb("#fff1b8"))


def fx_favor(f, i):
    d = ImageDraw.Draw(f)
    s = [10, 11, 13, 14, 13, 12, 11, 10][i]
    d.ellipse([16 - s, 16 - s, 15 + s, 15 + s], fill=cf.rgb("#e3b54f"), outline=cf.rgb("#1c0609"))
    cf.heart(f, 13, 13, cf.rgb("#b0182c"))
    if 2 <= i <= 6:
        for a, b in [(3, 3), (27, 4), (4, 27), (27, 26)]:
            k = (i - 2)
            d.point([(a + (1 if a < 16 else -1) * k, b + (1 if b < 16 else -1) * k)], fill=cf.rgb("#fff1b8"))


def fx_petal(f, i):
    d = ImageDraw.Draw(f)
    w = [6, 4, 2, 4][i]
    d.ellipse([4 - w // 2, 1, 4 + w // 2 - 1, 6], fill=cf.rgb("#c8324a"))


# ---------- 清单（和 spec.md 一一对应） ----------
# (路径, 宽, 高, 帧数, 种类 ph/code, 生成函数)
MANIFEST: list[tuple[str, int, int, int, str, object]] = []


def add(path, w, h, frames, kind, fn):
    MANIFEST.append((path, w, h, frames, kind, fn))


for role in cf.ROLES:
    add(f"cards/{role}.png", 72, 100, 1, "ph", lambda r=role: cf.face(r, portrait_ph(r)))
    add(f"cards/mini/{role}.png", 32, 44, 1, "ph", lambda r=role: mini_ph(r))
add("cards/back.png", 72, 100, 1, "code", cf.back)
add("cards/mini/back.png", 32, 44, 1, "code", cf.mini_back)

add("table/deck.png", 80, 112, 1, "code", lambda: cf.stack(4))
add("table/deck-low.png", 80, 112, 1, "code", lambda: cf.stack(1))
add("table/slot.png", 80, 112, 1, "code", cf.slot)
add("table/aside.png", 80, 112, 1, "code", cf.aside)
add("table/cloth-night.png", 32, 32, 1, "code", lambda: cf.cloth(False))
add("table/cloth-day.png", 32, 32, 1, "code", lambda: cf.cloth(True))


def scene_ph(day: bool, idx: int):
    def make():
        base = "#e9dcc0" if day else "#24080d"
        img = Image.new("RGBA", (512, 288), cf.rgb(base))
        d = ImageDraw.Draw(img)
        # 每 32px 一条细网格，方便量整数倍缩放
        grid = cf.rgb("#d6c49e" if day else "#3a0e16")
        for x in range(0, 512, 32):
            d.line([x, 0, x, 287], fill=grid)
        for y in range(0, 288, 32):
            d.line([0, y, 511, y], fill=grid)
        d.rectangle([0, 200, 511, 287], fill=cf.rgb("#8a2030" if day else "#4c0c15"))  # 桌面
        d.rectangle([96, 40, 416, 150], outline=cf.rgb("#c9a55a" if day else "#9c6f22"))  # 中间留空区
        names = ["宴会厅", "书房"]
        text(img, f"{'白天' if day else '夜间'} {names[idx]} 占位", 256, 95)
        text(img, f"scene/{'day' if day else 'night'}-{idx}.png 512×288", 256, 115, fill=(255, 230, 160, 255))
        return img
    return make


for idx in (0, 1):
    add(f"scene/night-{idx}.png", 512, 288, 1, "ph", scene_ph(False, idx))
    add(f"scene/day-{idx}.png", 512, 288, 1, "ph", scene_ph(True, idx))

ICONS = [
    ("favor", "#c8324a", "心"), ("favor-empty", "#4a2a30", "空"), ("shield", "#4f8fc0", "盾"), ("spy", "#3a3346", "谍"),
    ("out", "#555058", "灭"), ("eye", "#7a6236", "看"), ("duel", "#7b3f2a", "比"), ("swap", "#a87a22", "换"),
    ("target", "#5f6878", "指"), ("deck", "#5e101b", "堆"), ("crown", "#c99a2a", "冠"), ("letter", "#d9c8a0", "信"),
    ("book", "#6e4a2a", "册"), ("sealed", "#b0182c", "封"),
]
for name, color, ch in ICONS:
    add(f"icons/{name}.png", 16, 16, 1, "ph", lambda c=color, t=ch: block(16, 16, c, t, radius=3))
add("icons/favor-big.png", 32, 32, 1, "ph", lambda: block(32, 32, "#c8324a", "心", radius=8))

for i, (color, ch) in enumerate(SEATS):
    add(f"seats/seal-{i}.png", 24, 24, 1, "ph", lambda c=color, t=ch: block(24, 24, c, t, radius=11))

add("fx/candle.png", 16, 32, 6, "ph", lambda: strip(16, 32, 6, fx_candle))
add("fx/snuff.png", 16, 32, 8, "ph", lambda: strip(16, 32, 8, fx_snuff))
add("fx/shield.png", 32, 32, 8, "ph", lambda: strip(32, 32, 8, fx_shield))
add("fx/duel.png", 32, 32, 6, "ph", lambda: strip(32, 32, 6, fx_duel))
add("fx/favor.png", 32, 32, 8, "ph", lambda: strip(32, 32, 8, fx_favor))
add("fx/petal.png", 8, 8, 4, "ph", lambda: strip(8, 8, 4, fx_petal))


def banner():
    img = Image.new("RGBA", (160, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(0, 8), (14, 8), (8, 16), (14, 24), (0, 24)], fill=cf.rgb("#4c0c15"))
    d.polygon([(159, 8), (145, 8), (151, 16), (145, 24), (159, 24)], fill=cf.rgb("#4c0c15"))
    d.rectangle([12, 4, 147, 27], fill=cf.rgb("#8a1a28"), outline=cf.rgb("#e3b54f"))
    text(img, "横幅 占位", 80, 16)
    return img


def letter_win():
    img = Image.new("RGBA", (64, 48), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([6, 10, 57, 43], fill=cf.rgb("#efe3c8"), outline=cf.rgb("#1c0609"))
    d.line([6, 10, 32, 28, 57, 10], fill=cf.rgb("#b89a60"))
    d.ellipse([26, 22, 38, 34], fill=cf.rgb("#b0182c"))
    text(img, "信", 14, 36, fill=(80, 20, 30, 255), ink=(239, 227, 200, 255))
    return img


add("ui/banner.png", 160, 32, 1, "ph", banner)
add("ui/letter-win.png", 64, 48, 1, "ph", letter_win)
add("ui/divider.png", 96, 8, 1, "ph", lambda: block(96, 8, "#9c6f22", "", radius=2))


# ---------- 运行 ----------

def is_placeholder(path: Path) -> bool:
    try:
        with Image.open(path) as im:
            return im.info.get("placeholder") == "1"
    except OSError:
        return False


def build(force: bool) -> None:
    made = kept = 0
    for rel, w, h, frames, kind, fn in MANIFEST:
        target = PUBLIC / rel
        if target.exists() and not force and not is_placeholder(target) and kind == "ph":
            with Image.open(target) as im:
                if im.size == (w * frames, h):
                    kept += 1
                    continue
        img = fn()
        assert img.size == (w * frames, h), (rel, img.size)
        target.parent.mkdir(parents=True, exist_ok=True)
        meta = PngInfo()
        if kind == "ph":
            meta.add_text("placeholder", "1")
        img.save(target, pnginfo=meta, optimize=True)
        made += 1
    print(f"画了 {made} 个文件，保留已有正式图 {kept} 个，清单共 {len(MANIFEST)} 项 → {PUBLIC}")


def spec_paths() -> set[str]:
    """spec.md 表格里写的 public/art 路径（反引号里、以 .png 结尾、不在 art/out 下）。"""
    found = set(re.findall(r"`((?:cards|table|scene|icons|seats|fx|ui)/[\w./-]+\.png)`", SPEC.read_text("utf-8")))
    return found


def check() -> int:
    bad = 0
    listed = {rel for rel, *_ in MANIFEST}
    in_spec = spec_paths()
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
        if is_placeholder(target):
            still.append(rel)
    extra = sorted(str(p.relative_to(PUBLIC)) for p in PUBLIC.rglob("*.png") if str(p.relative_to(PUBLIC)) not in listed)
    for rel in extra:
        print("public/art 里多出来、spec 没写的：", rel)
        bad += 1
    print(f"清单 {len(MANIFEST)} 项，问题 {bad} 个；还是占位图的 {len(still)} 个" + (f"：{', '.join(still)}" if still else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check())
    build("--force" in sys.argv)
