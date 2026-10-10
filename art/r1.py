"""情书出图第 1 轮：照 art/spec.md 出候选，全部存到 art/out/r1/（被 gitignore）。

- 角色插画 64×88（/create-image-pixflux）：每个角色 4 个种子。种子 1、2 用调色板（样张公主 s3 + 卫兵 s1 的颜色）强制统一，
  种子 3、4 不强制，给评审对比。公主、卫兵另有开工样张的 4 个候选（*-kick.png）。
- 场景 512×288（/create-image-pixen）：宴会厅、书房，夜间 / 白天，各 3 个种子。
- 图标、印章、动画首帧（/generate-image-v2，一次 64 个）。
- 结算缎带、胜利信（pixflux 透明底，3 个种子）。
- 大厅封面 384×192（pixflux，3 个构思）。
PixelLab 同一时间只跑一个任务，按顺序来；标准客户端会在全站排队。

用法：~/miniconda3/envs/quant/bin/python art/r1.py [组 ...]   组：portraits scenes icons deco covers（不写就全跑；出过的跳过）
"""
from __future__ import annotations

import sys

from PIL import Image

import pixellab

pixellab.RETRY_DELAY = 5
pixellab.RETRY_ATTEMPTS = 40

OUT = pixellab.ART / "out" / "r1"
SAMPLES = pixellab.ART.parent.parent / "pipeline" / "games" / "loveletter" / "assets" / "raw" / "portraits"

# ---------- 角色插画 ----------
STYLE = ("medieval court portrait, rich oil-painting-like pixel art, warm candlelight from the left side, "
         "deep crimson and gold palette, dark red velvet curtain background with soft candle glow, "
         "upper body, head in the upper middle of the picture, plain dark background in the top left corner, "
         "no text, no letters, no frame, no border")

ROLE = {
    "spy": "upper body portrait of a mysterious court spy wearing a black and gold venetian half mask over the eyes, "
           "a dark hooded cloak with the hood down, short dark hair, sly smile, hiding a small folded note between two fingers, half in shadow",
    "guard": "upper body portrait of a stern medieval castle guard with a short beard, steel kettle helmet, "
             "chainmail and a plain crimson tabard with gold trim, holding a tall halberd",
    "priest": "upper body portrait of a kindly old court priest with grey hair and a gentle face, "
              "wearing plain deep red and black robes, holding a lit candle in one hand and a small closed book in the other",
    "baron": "upper body portrait of a proud middle-aged baron with a curled moustache and a short pointed beard, "
             "fur trimmed dark red doublet, gold chain, one hand resting on a sword hilt, arrogant look",
    "handmaid": "upper body portrait of a gentle young handmaid wearing a white linen head veil, "
                "a simple dark red dress with a white apron, holding a brass candlestick with a lit candle in both hands, calm and modest",
    "prince": "upper body portrait of a young medieval prince with short chestnut brown hair and a thin gold circlet, "
              "dark crimson doublet with a short velvet cape, holding a pair of leather gloves, confident look",
    "chancellor": "upper body portrait of an old royal chancellor with a long grey beard, black velvet robe "
                  "with a heavy gold chain of office, holding a rolled parchment scroll and a quill pen",
    "king": "upper body portrait of an old medieval king with a grey beard and a gold crown with red gems, "
            "deep crimson cloak with white ermine fur collar, holding a gold sceptre, stern and wise",
    "countess": "upper body portrait of an elegant mature countess with dark hair in an elaborate updo, "
                "black and crimson gown with a pearl necklace, holding a half open lace fan below her chin, mysterious look",
    "princess": "upper body portrait of a young medieval princess with long wavy dark brown hair and a thin gold circlet, "
                "wearing a deep crimson gown with gold embroidery, holding a folded letter sealed with red wax to her chest",
}


def palette_image():
    """样张公主 s3 + 卫兵 s1 拼成一张，当 color_image 强制调色板。"""
    a = Image.open(SAMPLES / "candle-princess-64x88-s3.png").convert("RGB")
    b = Image.open(SAMPLES / "candle-guard-64x88-s1.png").convert("RGB")
    img = Image.new("RGB", (128, 88))
    img.paste(a, (0, 0))
    img.paste(b, (64, 0))
    path = OUT / "palette.png"
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(path)
    return pixellab.b64_image(path)


def portraits(roles=None) -> None:
    pal = palette_image()
    folder = OUT / "portraits"
    for role in roles or ROLE:
        seeds = (5, 6) if role in ("princess", "guard") else (1, 2, 3, 4)
        for seed in seeds:
            name = f"{role}-s{seed}"
            if (folder / f"{name}.png").exists():
                continue
            body = {
                "description": ROLE[role] + ", " + STYLE,
                "image_size": {"width": 64, "height": 88},
                "text_guidance_scale": 8,
                "outline": "selective outline",
                "shading": "detailed shading",
                "detail": "highly detailed",
                "seed": seed,
            }
            if seed in (1, 2, 5, 6):
                body["color_image"] = pal
            try:
                pixellab.generate_image(name, body, folder)
                print(name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
            except Exception as error:
                print(name, "失败：", error, flush=True)


# ---------- 场景 ----------
TAIL = (", no people, no characters, no text, no letters, no signs, no writing, wide view, "
        "calm empty table area in the lower center")
HALL = ("interior of a medieval castle great hall, a long empty wooden banquet table with a deep crimson tablecloth in the foreground, "
        "tall golden candelabras, stone arches and pillars, a big fireplace, hanging red and gold tapestries with simple diamond patterns")
STUDY = ("a cozy medieval castle study, a wooden writing desk in the foreground with a quill, an inkwell and a few sealed letters, "
         "golden candlesticks, a tall arched window, bookshelves with old books, a red velvet armchair")
SCENES = {
    "night-0": (HALL + ", at night, many lit candles, warm flickering candlelight, roaring fire, deep shadows, warm crimson and gold palette" + TAIL, (11, 12, 13)),
    "day-0": (HALL + ", in the afternoon, warm golden sunlight streaming through tall arched leaded windows, light beams with floating dust, "
              "unlit candles, warm cream stone, crimson and gold palette" + TAIL, (21, 22, 23)),
    "night-1": (STUDY + ", at night, lit candles, cool moonlight through the window, warm candle glow on the desk, deep crimson and gold palette" + TAIL, (31, 32, 33)),
    "day-1": (STUDY + ", in the morning, soft sunlight through the window, unlit candles, warm cream walls, crimson and gold palette" + TAIL, (41, 42, 43)),
}


def scenes(names=None) -> None:
    folder = OUT / "scenes"
    for key in names or SCENES:
        prompt, seeds = SCENES[key]
        for seed in seeds:
            name = f"{key}-s{seed}"
            if (folder / f"{name}.png").exists():
                continue
            try:
                pixellab.generate_image(name, {
                    "description": prompt,
                    "image_size": {"width": 512, "height": 288},
                    "detail": "highly detailed",
                    "seed": seed,
                }, folder, endpoint="/create-image-pixen")
                print(name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
            except Exception as error:
                print(name, "失败：", error, flush=True)


# ---------- 图标、印章、动画首帧（v2，一次 64 个） ----------
ICON_STYLE = ", pixel art game icon, warm gold and deep crimson colors, dark outline, lit from the upper left, centered, transparent background"
ICONS: dict[str, tuple[str, int, int]] = {
    "favor": ("a small heart shaped deep red ruby gem set in a gold bezel", 16, 16),
    "favor-big": ("a heart shaped deep red ruby gem set in an ornate gold bezel, shiny", 32, 32),
    "shield": ("a small heater shield with a gold rim and pale blue face", 16, 16),
    "shield-big": ("a heater shield with a gold rim and a pale blue face, surrounded by a soft pale blue magic glow", 32, 32),
    "spy": ("a black and gold venetian masquerade half mask", 16, 16),
    "out": ("an extinguished short white candle in a gold holder with a thin wisp of grey smoke", 16, 16),
    "eye": ("a single open eye symbol", 16, 16),
    "duel": ("two crossed thin rapier swords with gold hilts", 16, 16),
    "duel-big": ("two crossed thin steel rapier swords with gold hilts", 32, 32),
    "swap": ("two curved golden arrows chasing each other in a circle, swap symbol", 16, 16),
    "target": ("a steel halberd head pointing diagonally up", 16, 16),
    "deck": ("a small stack of playing cards with dark red backs", 16, 16),
    "crown": ("a small gold crown with red gems", 16, 16),
    "letter": ("a cream envelope sealed with a red wax heart seal", 16, 16),
    "book": ("a small closed book with a dark red leather cover and a gold clasp", 16, 16),
    "sealed": ("a round red wax seal with a heart imprint", 16, 16),
    "seal-flower": ("a round wax seal stamp seen from the top, embossed flower emblem, red wax", 24, 24),
    "seal-sky": ("a round wax seal stamp seen from the top, embossed star or moon or sun emblem, red wax", 24, 24),
    "candle": ("a single lit white wax candle with a small warm flame in a small gold candlestick holder", 16, 32),
}


# 这几样是界面上的小符号（看牌、比牌、换牌、指认、牌堆、参考卡），代码画的就是正式版（见 spec 2.5），不出 v2，省下排队时间
CODE_ICONS = {"eye", "duel", "swap", "target", "deck", "book"}


def icons(names=None) -> None:
    for key in names or [k for k in ICONS if k not in CODE_ICONS]:
        prompt, w, h = ICONS[key]
        folder = OUT / "icons" / key
        if folder.exists() and any(folder.glob("*.png")):
            continue
        try:
            paths = pixellab.generate_async(key, {
                "description": prompt + ICON_STYLE,
                "image_size": {"width": w, "height": h},
                "no_background": True,
                "seed": 1301,
            }, folder, endpoint="/generate-image-v2")
            print(key, len(paths), "张; spent", round(pixellab.spent_usd(), 4), flush=True)
        except Exception as error:
            print(key, "失败：", error, flush=True)


# ---------- 结算装饰（pixflux 透明底） ----------
DECO = {
    "banner": ("a horizontal deep crimson silk ribbon banner with gold edges and swallowtail ends, blank empty middle, "
               "pixel art game ui element, no text, no letters", 160, 32, (71, 72, 73)),
    "letter-win": ("a cream love letter envelope tied with a gold ribbon and sealed with a red wax heart seal, a single red rose beside it, "
                   "warm candlelight from the left, pixel art, no text, no letters", 64, 48, (81, 82, 83)),
}


def deco(names=None) -> None:
    folder = OUT / "deco"
    for key in names or DECO:
        prompt, w, h, seeds = DECO[key]
        for seed in seeds:
            name = f"{key}-s{seed}"
            if (folder / f"{name}.png").exists():
                continue
            try:
                pixellab.generate_image(name, {
                    "description": prompt,
                    "image_size": {"width": w, "height": h},
                    "no_background": True,
                    "outline": "selective outline",
                    "detail": "highly detailed",
                    "seed": seed,
                }, folder)
                print(name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
            except Exception as error:
                print(name, "失败：", error, flush=True)


# ---------- 大厅封面 ----------
COVER_STYLE = "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, no text, no letters, no logo, no numbers, no people"
COVERS = {
    "cover-1": ("a love letter sealed with a red wax heart on a deep crimson velvet table, a golden candelabra with lit candles, "
                "a few face down playing cards with dark red diamond pattern backs fanned out, scattered rose petals, dark castle hall behind", 811),
    "cover-2": ("a stone castle tower window sill at night, moonlight and warm candlelight, a love letter tied with a gold ribbon and a single red rose "
                "lying on the sill, a lit candle, distant castle towers under a starry sky", 812),
    "cover-3": ("top down view of a crimson velvet card table, a small gold crown, a sealed love letter, a heart shaped ruby gem, "
                "face down cards with dark red backs, scattered rose petals, warm candlelight", 813),
}
# 第 2 批（续做）：前 3 张偏空、cover-2 偏冷蓝，照大厅其他封面的饱满度补 3 个构思 × 2 个种子
_C4 = ("close up still life filling the whole picture: a cream love letter sealed with a red wax heart, a white quill in a brass inkwell, "
       "a small gold crown with red gems, a red rose and a golden candlestick with a lit candle, on a deep crimson velvet tablecloth with gold embroidery, "
       "dark red curtains and warm bokeh candle lights behind")
_C5 = ("a medieval castle banquet hall at night seen from above the table, a long table with a crimson cloth, many golden candelabras with lit candles, "
       "silver plates, goblets, a sealed love letter and a fan of face down playing cards with dark red diamond backs in the middle, "
       "red and gold tapestries on stone walls, warm glowing light")
_C6 = ("a fairy tale castle at dusk with many warm glowing windows and crimson banners on the towers, a rose garden in front, "
       "in the foreground a stone balcony ledge with a lit candle lantern, a red rose and a love letter sealed with red wax, warm sunset sky in pink and gold")
COVERS.update({"cover-4": (_C4, 821), "cover-4b": (_C4, 822), "cover-5": (_C5, 831), "cover-5b": (_C5, 832),
               "cover-6": (_C6, 841), "cover-6b": (_C6, 842)})


def covers(names=None) -> None:
    folder = OUT / "covers"
    for key in names or COVERS:
        prompt, seed = COVERS[key]
        if (folder / f"{key}.png").exists():
            continue
        try:
            pixellab.generate_image(key, {
                "description": prompt + ", " + COVER_STYLE,
                "image_size": {"width": 384, "height": 192},
                "detail": "highly detailed",
                "seed": seed,
            }, folder)
            print(key, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
        except Exception as error:
            print(key, "失败：", error, flush=True)


# 补充：王子 4 张都没戴金冠、卫兵罩袍上常有十字 → 改提示词各补 3 张（都用调色板）
EXTRA = {
    "prince": ("upper body portrait of a young medieval prince wearing a clearly visible thin gold crown circlet on his head, "
               "short chestnut brown hair, dark crimson doublet with a short velvet cape, holding a pair of leather gloves, confident look", (7, 8, 9)),
    "guard": ("upper body portrait of a stern medieval castle guard with a short beard, steel kettle helmet, chainmail, "
              "a plain solid crimson tabard with a thin gold border and no emblem, no symbol, holding a tall halberd", (7,)),  # 评审已定 guard-s3-kick，不再补
}


def extra() -> None:
    pal = palette_image()
    folder = OUT / "portraits"
    for role, (prompt, seeds) in EXTRA.items():
        for seed in seeds:
            name = f"{role}-s{seed}"
            if (folder / f"{name}.png").exists():
                continue
            try:
                pixellab.generate_image(name, {
                    "description": prompt + ", " + STYLE,
                    "image_size": {"width": 64, "height": 88},
                    "text_guidance_scale": 8,
                    "outline": "selective outline",
                    "shading": "detailed shading",
                    "detail": "highly detailed",
                    "seed": seed,
                    "color_image": pal,
                }, folder)
                print(name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
            except Exception as error:
                print(name, "失败：", error, flush=True)


# ---------- 评审第 1 轮的返工 ----------
PRINCE_EDIT = ("add a thin gold circlet crown with one small red gem on his head, resting on his forehead and clearly visible, "
               "keep the face, hair, clothes, pose, lighting and background exactly the same, pixel art, no text")


def fix() -> None:
    """王子加冠（edit-image，每张底图一次调用）；favor-big 照 favor-8 出（v2 + style_image）。"""
    folder = OUT / "portraits"
    for base, seed in (("prince-s3", 5301), ("prince-s8", 5302), ("prince-s8", 5303)):
        name = f"{base}-crown-{seed}"
        if (folder / f"{name}.png").exists():
            continue
        try:
            pixellab.generate_async(name, {
                "image": pixellab.b64_image(folder / f"{base}.png"),
                "description": PRINCE_EDIT,
                "image_size": {"width": 64, "height": 88},
                "width": 64,
                "height": 88,
                "no_background": False,
                "text_guidance_scale": 8,
                "seed": seed,
            }, folder, endpoint="/edit-image")
            print(name, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
        except Exception as error:
            print(name, "失败：", error, flush=True)
    target = OUT / "icons" / "favor-big"
    if not (target.exists() and any(target.glob("*.png"))):
        ref = OUT / "favor8-x2.png"
        Image.open(OUT / "icons" / "favor" / "favor-8.png").convert("RGBA").resize((32, 32), Image.NEAREST).save(ref)
        try:
            paths = pixellab.generate_async("favor-big", {
                "description": ICONS["favor-big"][0] + ", the same design as the reference: a heart shaped gold setting holding a red heart gem" + ICON_STYLE,
                "image_size": {"width": 32, "height": 32},
                "no_background": True,
                "style_image": {"image": pixellab.b64_image(ref), "size": {"width": 32, "height": 32}},
                "seed": 1302,
            }, target, endpoint="/generate-image-v2")
            print("favor-big", len(paths), "张; spent", round(pixellab.spent_usd(), 4), flush=True)
        except Exception as error:
            print("favor-big 失败：", error, flush=True)


GROUPS = {"fix": fix, "extra": extra, "portraits": portraits, "scenes": scenes, "icons": icons, "deco": deco, "covers": covers}

if __name__ == "__main__":
    for group in sys.argv[1:] or list(GROUPS):
        GROUPS[group]()
    print("DONE", round(pixellab.spent_usd(), 4), flush=True)
