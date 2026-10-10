"""正式美术画廊：把 art/picks.json 里的候选做成放大预览图，写成不阻塞的拍板 JSON。

art/picks.json：
{
  "<素材>": {"question": "公主（9）牌面插画", "kind": "portrait|icon|seal|scene|deco|cover|anim", "role": "princess",
             "help": "评审意见（Markdown，可选）",
             "options": [{"value": "s3-kick", "label": "s3（样张）", "file": "out/r1/portraits/princess-s3-kick.png",
                          "description": "……", "recommended": true}]}
}
预览图放 art/out/gallery/（在 ~/projects 下，面板能显示），拍板 JSON 写到
~/projects/pipeline/games/loveletter/assets/gallery-decision.json（blocking: false，由制作人发布）。

用法：~/miniconda3/envs/quant/bin/python art/gallery.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cardframe as cf  # noqa: E402

ART = Path(__file__).resolve().parent
OUT = ART / "out" / "gallery"
DECISION = Path.home() / "projects" / "pipeline" / "games" / "loveletter" / "assets" / "gallery-decision.json"
NIGHT, DAY = (70, 18, 26, 255), (239, 227, 200, 255)
ANIM = {"candle": (16, 6, True), "snuff": (16, 8, False), "shield": (32, 8, False), "duel": (32, 6, False), "favor": (32, 8, False)}  # 单帧宽、帧数、是否循环


def split_bg(img: Image.Image, scale: int) -> Image.Image:
    """左半深红、右半奶油底，放大 scale 倍。"""
    big = img.convert("RGBA").resize((img.width * scale, img.height * scale), Image.NEAREST)
    pad = 8
    canvas = Image.new("RGBA", (big.width * 2 + pad * 3, big.height + pad * 2), (44, 30, 34, 255))
    d = ImageDraw.Draw(canvas)
    d.rectangle([pad, pad, pad + big.width - 1, pad + big.height - 1], fill=NIGHT)
    d.rectangle([pad * 2 + big.width, pad, pad * 2 + big.width * 2 - 1, pad + big.height - 1], fill=DAY)
    canvas.alpha_composite(big, (pad, pad))
    canvas.alpha_composite(big, (pad * 2 + big.width, pad))
    return canvas


def preview(item: dict, opt: dict, key: str) -> Path:
    src = ART / opt["file"]
    kind = item["kind"]
    if kind == "portrait":
        from export import apply_fixes
        art = apply_fixes(Image.open(src), opt.get("fixes", []))
        card = cf.face(item["role"], art)
        mini = cf.mini(item["role"], art.crop((*opt.get("miniCrop", [18, 2]), opt.get("miniCrop", [18, 2])[0] + 28,
                                                opt.get("miniCrop", [18, 2])[1] + 40)))
        big = card.resize((216, 300), Image.NEAREST)
        canvas = Image.new("RGBA", (216 + 72 + 64 + 40, 316), (44, 30, 34, 255))
        canvas.alpha_composite(big, (8, 8))
        canvas.alpha_composite(card, (232, 8))
        canvas.alpha_composite(mini.resize((64, 88), Image.NEAREST), (232, 120))
        canvas.alpha_composite(mini, (312, 120))
        img = canvas
    elif kind in ("icon", "seal"):
        im = Image.open(src)
        img = split_bg(im, 6 if im.width <= 16 else 4)
    elif kind == "deco":
        im = Image.open(src)
        img = split_bg(im, 3 if im.width <= 64 else 2)
    elif kind == "anim":  # 横排精灵图 → 左深底右白天底的 GIF（播一次的末尾停一会儿）
        w, n, loop = ANIM[item["anim"]]
        strip = Image.open(src).convert("RGBA")
        frames = [split_bg(strip.crop((i * w, 0, (i + 1) * w, strip.height)), 6 if w <= 16 else 4).convert("RGB")
                  for i in range(n)]
        ms = {"candle": 120, "snuff": 100, "shield": 80, "duel": 80, "favor": 90}[item["anim"]]
        durations = [ms] * n if loop else [ms] * (n - 1) + [900]
        OUT.mkdir(parents=True, exist_ok=True)
        path = OUT / f"{key}-{opt['value']}.gif"
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=1)
        return path
    else:  # scene / cover：原图 2 倍（封面 1 倍）
        im = Image.open(src).convert("RGBA")
        s = 2 if kind == "scene" else 1
        img = im.resize((im.width * s, im.height * s), Image.NEAREST)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{key}-{opt['value']}.png"
    img.save(path)
    return path


def main() -> None:
    picks = json.loads((ART / "picks.json").read_text("utf-8"))
    questions = []
    for key, item in picks.items():
        options = []
        for opt in item["options"]:
            o = {"value": opt["value"], "label": opt["label"], "images": [str(preview(item, opt, key))]}
            if opt.get("description"):
                o["description"] = opt["description"]
            if opt.get("recommended"):
                o["recommended"] = True
            options.append(o)
        q = {"id": key, "type": "choice", "question": item["question"], "options": options, "required": False}
        if item.get("help"):
            q["help"] = item["help"]
        questions.append(q)
    decision = {
        "id": "art-gallery",
        "title": "情书：正式美术画廊",
        "stage": "art",
        "blocking": False,
        "intro": ("情书正式美术的候选，每样一题。标「推荐」的是美术自查后挑定、已经导出到 art/out/final 的那张，不选就按推荐上线。"
                  "想换哪张随时来换；都不满意可以选「其他」写备注，美术重画。\n\n"
                  "牌面预览：左边 3 倍（手牌大小附近），右边是 1 倍整张牌和小牌（打出区大小）。图标、动画左半深底、右半白天底。"),
        "questions": questions,
    }
    DECISION.parent.mkdir(parents=True, exist_ok=True)
    DECISION.write_text(json.dumps(decision, ensure_ascii=False, indent=2), "utf-8")
    print("写了", len(questions), "题 →", DECISION)


if __name__ == "__main__":
    main()
