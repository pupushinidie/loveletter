"""情书的 6 条精灵动画（spec 2.7）：PixelLab /animate-with-text-v3 出帧，代码拼成横排精灵图。

首帧来自 art/selection.json 里定下的静态图（v2 候选），动画帧和条带存到 art/out/anim/<名字>/，
导出到 public 由 export.py 做（读 art/out/anim/<名字>/strip.png）。

- candle  16×32 × 6 帧循环：点着的蜡烛，火苗摇。放进 32×32 画布居中出动画，再裁回 16×32。
- snuff   16×32 × 8 帧一次：首帧 = 蜡烛，末帧 = 代码去掉火苗的熄灭蜡烛，中间让模型画熄灭和青烟。
- shield  32×32 × 8 帧一次：前 2 帧代码淡入（35%、70%），后 6 帧是盾牌周围光点流转（首末帧 = 静态盾）。
- duel    32×32 × 6 帧一次：交叉细剑相击迸火花（首帧 = 静态交叉剑）。
- favor   32×32 × 8 帧一次：心形宝石四周金色火星（首末帧 = favor-big）。
- petal    8×8 × 4 帧循环：代码画（翻转的花瓣）。

用法：python art/anim.py [名字 ...] [--seed N]    检查：python art/anim.py report
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

import pixellab

pixellab.RETRY_DELAY = 5
pixellab.RETRY_ATTEMPTS = 40

ART = Path(__file__).resolve().parent
OUT = ART / "out" / "anim"
SEL = ART / "selection.json"

SPEC = {  # 名字: (单帧宽, 高, 帧数, 动作)
    "candle": (16, 32, 6, "the small candle flame flickers and sways gently left and right"),
    "snuff": (16, 32, 8, "the candle flame shrinks and goes out, then a thin wisp of grey smoke rises from the wick"),
    "shield": (32, 32, 6, "tiny pale blue magic sparkles drift around the shield"),
    "duel": (32, 32, 6, "the two crossed swords clash and small bright sparks burst where the blades meet"),
    "favor": (32, 32, 8, "tiny golden sparkles twinkle around the heart gem"),
}


def sel() -> dict:
    return json.loads(SEL.read_text("utf-8"))


def base(key: str) -> Image.Image:
    return Image.open(ART / sel()["icons"][key]["file"]).convert("RGBA")


def pad32(img: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((32 - img.width) // 2, (32 - img.height) // 2))
    return canvas


def unpad(img: Image.Image, w: int, h: int) -> Image.Image:
    return img.crop(((32 - w) // 2, (32 - h) // 2, (32 - w) // 2 + w, (32 - h) // 2 + h))


def snuffed(candle: Image.Image) -> Image.Image:
    """把蜡烛上的火苗去掉：烛芯以上、暖黄/橙/白的像素抠掉。"""
    img = candle.copy()
    px = img.load()
    # 蜡身最上面一行：从下往上第一行出现「蜡色」（低饱和亮色）以上都算火苗区
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a and r > 180 and g > 110 and b < 140 and y < img.height * 0.45:
                px[x, y] = (0, 0, 0, 0)
    return img


def save_strip(name: str, frames: list[Image.Image]) -> Path:
    w, h = frames[0].size
    strip = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.alpha_composite(f, (i * w, 0))
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    strip.save(folder / "strip.png")
    s = 6 if w <= 16 else 4
    big = []
    for f in frames:
        bg = Image.new("RGBA", (w * s, h * s), (60, 16, 24, 255))
        bg.alpha_composite(f.resize((w * s, h * s), Image.NEAREST))
        big.append(bg.convert("RGB"))
    big[0].save(folder / "preview.gif", save_all=True, append_images=big[1:], duration=120, loop=0)
    big_strip = Image.new("RGB", (w * s * len(frames) + 4 * len(frames), h * s), (30, 20, 24))
    for i, f in enumerate(big):
        big_strip.paste(f, (i * (w * s + 4), 0))
    big_strip.save(folder / "strip-big.png")
    return folder / "strip.png"


def run(name: str, seed: int = 0) -> None:
    w, h, n, action = SPEC[name]
    if name in ("candle", "snuff"):
        first = pad32(base("candle"))
        last = pad32(snuffed(base("candle"))) if name == "snuff" else first
    else:
        first = base({"shield": "shield-big", "duel": "duel-big", "favor": "favor-big"}[name])
        last = first
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    first.save(folder / "first.png")
    last.save(folder / "last.png")
    raw = folder / f"raw-s{seed}"
    paths = pixellab.animate(f"{name}-s{seed}", {
        "first_frame": pixellab.b64_image(folder / "first.png"),
        "last_frame": pixellab.b64_image(folder / "last.png"),
        "action": action,
        "frame_count": n,
        "no_background": True,
        "seed": 4100 + seed,
    }, raw)
    frames = [Image.open(p).convert("RGBA") for p in paths]
    print(name, "返回", len(frames), "帧", frames[0].size, "spent", round(pixellab.spent_usd(), 4), flush=True)
    if name in ("candle", "shield", "duel", "favor") and len(frames) > n:
        frames = frames[:n]  # 首末帧相同会多给一帧，循环时去掉
    elif name == "snuff" and len(frames) > n:
        frames = frames[: n - 1] + [frames[-1]]
    frames = [f if f.size == (32, 32) else f.resize((32, 32), Image.NEAREST) for f in frames]
    if name in ("candle", "snuff"):
        frames = [unpad(f, w, h) for f in frames]
        if name == "snuff":
            frames[0] = base("candle")
            frames[-1] = snuffed(base("candle"))
        else:
            frames[0] = base("candle")
    if name == "shield":
        static = frames[0]
        fades = []
        for alpha in (0.35, 0.7):
            f = static.copy()
            f.putalpha(f.getchannel("A").point(lambda v: int(v * alpha)))
            fades.append(f)
        frames = fades + frames[:6]
    save_strip(name, frames)


def petal() -> None:
    frames = []
    for i in range(4):
        f = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
        d = ImageDraw.Draw(f)
        w = [6, 4, 2, 4][i]
        x0 = 4 - w // 2
        d.ellipse([x0, 1, x0 + w - 1, 6], fill=(176, 24, 44, 255), outline=(106, 12, 24, 255))
        if w >= 4:
            f.putpixel((x0 + 1, 2), (230, 90, 110, 255))
        frames.append(f)
    save_strip("petal", frames)


def changes(strip: Path, n: int) -> list[float]:
    img = Image.open(strip).convert("RGBA")
    w = img.width // n
    frames = [img.crop((i * w, 0, (i + 1) * w, img.height)) for i in range(n)]
    out = []
    for f in frames[1:]:
        diff = ImageChops.difference(frames[0], f).convert("L").point(lambda v: 255 if v > 24 else 0)
        out.append(sum(1 for v in diff.getdata() if v) / (w * img.height))
    return out


def report() -> int:
    bad = 0
    for name, (w, h, n, _) in SPEC.items():
        strip = OUT / name / "strip.png"
        if not strip.exists():
            print(name, "还没做")
            continue
        n_real = Image.open(strip).width // w
        ch = changes(strip, n_real)
        peak, med = max(ch), sorted(ch)[len(ch) // 2]
        glitch = peak >= 0.15 and peak >= 2.5 * med and name not in ("snuff", "shield")
        flag = "走形?" if peak > 0.45 else "太静?" if peak < 0.03 else ""
        if glitch:
            flag += " 坏帧?"
        print(f"{name}: {n_real} 帧，逐帧变化 {' '.join(f'{c:.0%}' for c in ch)}，最大 {peak:.0%} {flag}")
        bad += bool(flag)
    return bad


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["report"]:
        sys.exit(1 if report() else 0)
    seed = 0
    if "--seed" in args:
        i = args.index("--seed")
        seed = int(args[i + 1])
        del args[i:i + 2]
    for name in args or [*SPEC, "petal"]:
        if name == "petal":
            petal()
            continue
        try:
            run(name, seed)
        except Exception as error:
            print(name, "失败：", error, flush=True)
