"""情书的 6 条精灵动画（spec 2.7）：PixelLab /animate-with-text-v3 出帧，代码拼成横排精灵图。

首帧来自 art/selection.json 里定下的静态图（v2 候选），动画帧和条带存到 art/out/anim/<名字>/，
导出到 public 由 export.py 做（读 art/out/anim/<名字>/strip.png）。

- candle  16×32 × 6 帧循环：定稿是 PixelLab 静态蜡烛 + 代码逐帧重画火苗（anim.py code → candle/scode）；
          PixelLab 动的候选（32×32 画布居中出，再裁回 16×32）火苗会变成十字，没用。
- snuff   16×32 × 8 帧一次：同上，代码画火苗变小、熄灭、青烟；首帧 = 蜡烛首帧，末帧 = 干净的熄灭蜡烛。
- shield  32×32 × 8 帧一次：前 2 帧代码淡入（35%、70%），中间 PixelLab 光点，末帧 = 静态盾；代码补光圈（s<seed>ring）。
- duel    32×32 × 6 帧一次：交叉细剑相击迸火花（首帧 = 静态交叉剑）。
- favor   32×32 × 8 帧一次：心形宝石一闪（首末帧 = favor-big）；代码补金色火星（s<seed>spark）。
- petal    8×8 × 4 帧循环：代码画（导出用的是 simple.py 那份）。

用法：python art/anim.py [名字 ...] [--seeds 0,1,2]   代码帮手：python art/anim.py code
      挑定：python art/anim.py pick <名字> <候选文件夹>       检查：python art/anim.py report
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


def static(key: str) -> Image.Image:
    """导出用的静态图（和 icons/*.png 同一套清理），保证动画首帧和静态图像素一致。"""
    from export import clean_alpha, drop_specks
    return drop_specks(clean_alpha(base(key)))


def run(name: str, seed: int = 0) -> Path:
    """出一条候选，存到 art/out/anim/<名字>/s<seed>/strip.png；挑定后用 `anim.py pick <名字> s<seed>` 复制成 <名字>/strip.png。"""
    w, h, n, action = SPEC[name]
    if name in ("candle", "snuff"):
        candle = static("candle")
        first = pad32(candle)
        last = pad32(snuffed(candle)) if name == "snuff" else first
    else:
        first = static({"shield": "shield-big", "duel": "duel-big", "favor": "favor-big"}[name])
        last = first
    folder = OUT / name / f"s{seed}"
    folder.mkdir(parents=True, exist_ok=True)
    first.save(folder / "first.png")
    last.save(folder / "last.png")
    paths = pixellab.animate(f"{name}-s{seed}", {
        "first_frame": pixellab.b64_image(folder / "first.png"),
        "last_frame": pixellab.b64_image(folder / "last.png"),
        "action": action,
        "frame_count": n,
        "no_background": True,
        "seed": 4100 + seed,
    }, folder / "raw")
    frames = [Image.open(p).convert("RGBA") for p in paths]
    print(name, seed, "返回", len(frames), "帧", frames[0].size, flush=True)
    frames = [f if f.size == (32, 32) else f.resize((32, 32), Image.NEAREST) for f in frames]
    if len(frames) > n:  # 首末帧都给了会多一帧：循环的去掉重复的末帧；snuff 保留真正的末帧
        frames = frames[: n - 1] + [frames[-1]] if name == "snuff" else frames[:n]
    # 首帧（以及播一次停住的末帧）一律换成静态图，保证和静态图无缝衔接
    frames[0] = first
    if name in ("snuff", "favor"):
        frames[-1] = last
    if name in ("candle", "snuff"):
        frames = [unpad(f, w, h) for f in frames]
    if name == "shield":
        fades = []
        for alpha in (0.35, 0.7):
            f = first.copy()
            f.putalpha(f.getchannel("A").point(lambda v: int(v * alpha)))
            fades.append(f)
        frames = fades + frames[:5] + [first]  # 淡入 2 帧 + 光点 5 帧 + 停在静态盾
    return save_strip(f"{name}/s{seed}", frames)

# ---- 代码帮手（2026-10-10 正式美术收尾）----
# 16×32 的蜡烛让模型动，火苗常被画成十字或蘑菇形（3 个种子都有），所以 candle/snuff 改成：
# PixelLab 静态蜡烛（candle-8）不动，只用代码按它自己的火苗颜色逐帧重画火苗和青烟。
# shield/favor 用 PixelLab 的动画帧，再用代码补上 spec 写的「光圈从小到大」「四周金色火星」。

FLAME = {"o": (0xde, 0xa0, 0x4a, 255), "O": (0xec, 0xa3, 0x49, 255), "Y": (0xfb, 0xd6, 0x6c, 255),
         "W": (0xf6, 0xeb, 0xd1, 255), "E": (0xfc, 0xf2, 0xe1, 255), "R": (0xed, 0xae, 0x4a, 255),
         "e": (0xa8, 0x5a, 0x22, 255), "s": (0x9a, 0x92, 0x8c, 255), "t": (0x6e, 0x66, 0x6a, 255),
         "S": (0xbc, 0xb3, 0xa8, 255)}
# 火苗区 x 5–9、y 2–8（一行 5 个字符，对应 x5..x9）；第 0 帧就是 candle-8 原图
CANDLE_FLAMES = [
    None,
    [".....", ".....", "...o.", "..OO.", ".OYO.", ".OWO.", ".OER."],   # 拉高、火尖偏右
    [".....", "..o..", "..O..", ".OYO.", ".OYO.", ".OWO.", ".OER."],   # 最高、直
    [".....", ".....", ".o...", ".OO..", ".OYO.", ".OWO.", ".OER."],   # 拉高、火尖偏左
    [".....", ".....", ".....", ".....", "..o..", ".OYO.", ".OER."],   # 往下一缩
    [".....", ".....", ".....", "...o.", ".OYO.", ".OWO.", ".OER."],   # 回到原高、火尖偏右
]
SNUFF_FLAMES = [
    None,
    [".....", ".....", ".....", ".o...", ".OO..", ".OYO.", ".OER."],   # 一晃
    [".....", ".....", ".....", ".....", "..o..", ".OYO.", ".OYO."],   # 变小
    [".....", ".....", ".....", ".....", ".....", "..o..", ".OYO."],   # 更小
    [".....", ".....", ".....", ".....", ".....", ".....", "..o.."],   # 只剩一点
    [".....", ".....", ".....", ".....", "..s..", "..s..", "..e.."],   # 灭了，烛芯一点红，冒烟
    [".....", "...t.", "...s.", "..s..", "..t..", ".....", "....."],   # 烟往上飘
    [".t...", "..t..", "...t.", ".....", ".....", ".....", "....."],   # 烟散
]


def wick_top(candle: Image.Image) -> int:
    """烛芯最上面一行（第一行出现深色像素的行）。火苗都在它上面。"""
    px = candle.load()
    for y in range(candle.height):
        for x in range(candle.width):
            r, g, b, a = px[x, y]
            if a and (r * 0.3 + g * 0.59 + b * 0.11) < 120:
                return y
    raise ValueError("找不到烛芯")


def no_flame(candle: Image.Image) -> Image.Image:
    img = candle.copy()
    top = wick_top(img)
    ImageDraw.Draw(img).rectangle([0, 0, img.width - 1, top - 1], fill=(0, 0, 0, 0))
    return img


def draw_flame(candle: Image.Image, rows: list[str] | None) -> Image.Image:
    if rows is None:
        return candle.copy()
    img = no_flame(candle)
    px = img.load()
    y0 = wick_top(candle) - len(rows)
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch != ".":
                px[5 + dx, y0 + dy] = FLAME[ch]
    return img


def candle_code() -> Path:
    candle = static("candle")
    return save_strip("candle/scode", [draw_flame(candle, rows) for rows in CANDLE_FLAMES])


def snuff_code() -> Path:
    candle = static("candle")
    frames = [draw_flame(candle, rows) for rows in SNUFF_FLAMES]
    frames[-1] = no_flame(candle)  # 停住的末帧：干净的熄灭蜡烛
    return save_strip("snuff/scode", frames)


def ring(radius: float, color: tuple, dotted: bool = False) -> Image.Image:
    import math
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    px = img.load()
    for k in range(int(2 * math.pi * radius * 2) + 8):
        if dotted and k % 4 >= 2:
            continue
        t = k / (int(2 * math.pi * radius * 2) + 8) * 2 * math.pi
        x, y = round(15.5 + radius * math.cos(t)), round(17 + radius * math.sin(t))
        if 0 <= x < 32 and 0 <= y < 32:
            px[x, y] = color
    return img


def shield_ring(seed: int) -> Path:
    """在 PixelLab 的 shield/s<seed> 上补光圈：前 4 帧浅蓝光圈从小到大、越来越淡，盾牌盖在光圈上面。"""
    src = Image.open(OUT / "shield" / f"s{seed}" / "strip.png").convert("RGBA")
    frames = [src.crop((i * 32, 0, i * 32 + 32, 32)) for i in range(src.width // 32)]
    # 外面两圈用中蓝，白天的奶油底上也看得见
    rings = [(5, (0xdf, 0xf3, 0xff, 255), False), (9, (0x8f, 0xd0, 0xff, 255), False),
             (12.5, (0x5f, 0xa8, 0xe0, 255), False), (14.5, (0x4a, 0x90, 0xd0, 210), True)]
    for i, (r, c, dotted) in enumerate(rings):
        under = ring(r, c, dotted)
        under.alpha_composite(frames[i])
        frames[i] = under
    return save_strip(f"shield/s{seed}ring", frames)


SPARK = [(0, 0, "c"), (-1, 0, "a"), (1, 0, "a"), (0, -1, "a"), (0, 1, "a")]


def favor_spark(seed: int) -> Path:
    """在 PixelLab 的 favor/s<seed> 上补金色火星：只放在静态图透明、且离心形描边至少 1px 的地方。"""
    src = Image.open(OUT / "favor" / f"s{seed}" / "strip.png").convert("RGBA")
    n = src.width // 32
    frames = [src.crop((i * 32, 0, i * 32 + 32, 32)) for i in range(n)]
    base_a = frames[0].getchannel("A").load()

    def free(x: int, y: int) -> bool:
        return all(0 <= x + dx < 32 and 0 <= y + dy < 32 and not base_a[x + dx, y + dy]
                   for dx in (-1, 0, 1) for dy in (-1, 0, 1))
    spots = [p for p in [(4, 26), (27, 26), (16, 3), (3, 3), (28, 3), (6, 29), (25, 29), (2, 14), (29, 14)]
             if all(free(p[0] + dx, p[1] + dy) for dx, dy, _ in SPARK)]
    col = {"c": (0xff, 0xf1, 0xb8, 255), "a": (0xd9, 0x96, 0x2a, 255)}  # 十字臂用中金，白天底上也看得见
    # 每帧：(位置下标, 大小 1=一个点 2=十字)
    plan = {2: [(0, 1), (2, 2)], 3: [(0, 2), (1, 1), (2, 1)], 4: [(1, 2), (3, 1)], 5: [(1, 1), (3, 2), (4, 1)], 6: [(4, 1)]}
    for i, items in plan.items():
        px = frames[i].load()
        for k, size in items:
            if k >= len(spots):
                continue
            x, y = spots[k]
            for dx, dy, c in (SPARK if size == 2 else SPARK[:1]):
                px[x + dx, y + dy] = col[c if size == 2 else "a"]
    print("火星位置", spots[:5])
    return save_strip(f"favor/s{seed}spark", frames)



def pick(name: str, variant: str) -> None:
    import shutil
    src = OUT / name / variant  # 例：s0、scode、s0ring
    for f in ("strip.png", "preview.gif", "strip-big.png"):
        shutil.copy(src / f, OUT / name / f)
    print("定稿", name, "←", src)


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
    """逐条检查：定稿（<名字>/strip.png）和每个候选（<名字>/s*/strip.png）。返回定稿里有问题的条数。"""
    bad = 0
    for name, (w, h, n, _) in {**SPEC, "petal": (8, 8, 4, "")}.items():
        strips = sorted((OUT / name).glob("s*/strip.png")) + [OUT / name / "strip.png"]
        for strip in strips:
            if not strip.exists():
                print(name, "还没做")
                continue
            n_real = Image.open(strip).width // w
            ch = changes(strip, n_real)
            peak, med = max(ch), sorted(ch)[len(ch) // 2]
            steps = step_changes(strip, n_real)
            glitch = has_glitch(steps) and name not in ("snuff", "shield")
            px_peak = round(peak * w * h)  # 小图（16×32 蜡烛）按比例会显得太静，按变化的像素数判断
            flag = "走形?" if peak > 0.45 else "太静?" if px_peak < 5 else ""
            if glitch:
                flag += " 坏帧?"
            label = name if strip.parent.name == name else f"{name}/{strip.parent.name}"
            print(f"{label}: {n_real} 帧，相对首帧 {' '.join(f'{c:.0%}' for c in ch)}，相邻帧 {' '.join(f'{c:.0%}' for c in steps)}（最多变 {px_peak} 像素）{flag}")
            if strip.parent.name == name:
                bad += bool(flag)
    return bad


def step_changes(strip: Path, n: int) -> list[float]:
    """相邻帧的变化量（含末帧→首帧，循环接缝）。"""
    img = Image.open(strip).convert("RGBA")
    w = img.width // n
    frames = [img.crop((i * w, 0, (i + 1) * w, img.height)) for i in range(n)]
    out = []
    for i in range(n):
        a, b = frames[i], frames[(i + 1) % n]
        diff = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
        out.append(sum(1 for v in diff.getdata() if v) / (w * img.height))
    return out


def has_glitch(steps: list[float]) -> bool:
    """某一帧突变又变回：相邻两步都很大、而其余步子小（帧 i 和前后都差很多）。"""
    n = len(steps)
    med = sorted(steps)[n // 2]
    for i in range(n):
        a, b = steps[i - 1], steps[i]  # 进入帧 i、离开帧 i
        if min(a, b) >= 0.12 and min(a, b) >= 3 * max(med, 0.01):
            return True
    return False


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["report"]:
        sys.exit(1 if report() else 0)
    if args[:1] == ["code"]:  # 代码帮手：candle/snuff 代码火苗，shield/favor 在 PixelLab 候选上补光圈和火星
        print(candle_code(), snuff_code())
        for sd in (0, 1, 2):
            print(shield_ring(sd), favor_spark(sd))
        sys.exit(0)
    if args[:1] == ["pick"]:
        pick(args[1], args[2])
        sys.exit(0)
    seeds = [0]
    if "--seeds" in args:  # 例：--seeds 0,1,2；同一个进程里用线程池并发（会员下同进程并发可以，max_workers ≤ 10）
        i = args.index("--seeds")
        seeds = [int(x) for x in args[i + 1].split(",")]
        del args[i:i + 2]
    names = args or [*SPEC, "petal"]
    if "petal" in names:
        petal()
        names = [x for x in names if x != "petal"]
    from concurrent.futures import ThreadPoolExecutor
    jobs = [(name, seed) for name in names for seed in seeds]
    with ThreadPoolExecutor(max_workers=min(6, len(jobs) or 1)) as pool:
        futures = {pool.submit(run, name, seed): (name, seed) for name, seed in jobs}
        for fut, (name, seed) in futures.items():
            try:
                print("完成", name, seed, fut.result(), flush=True)
            except Exception as error:
                print(name, seed, "失败：", error, flush=True)
