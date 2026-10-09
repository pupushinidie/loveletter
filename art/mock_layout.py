"""给美术规格估尺寸用的牌桌草图：用 public/art 里的图（占位或正式）按 spec.md 第 3 节的倍数摆出 6 人局，
四种可视区域各一张，存到 art/out/mock-<宽>x<高>.png。只是估算，真正的排版归界面。

用法：~/miniconda3/envs/quant/bin/python art/mock_layout.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

import simple as ph  # 复用字体和 text()

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "apps" / "web" / "public" / "art"
OUT = ROOT / "art" / "out"

PLAYS = [["guard", "priest", "handmaid", "guard"], ["spy", "guard", "baron"], ["guard", "prince", "guard", "chancellor", "guard"],
         ["handmaid", "guard"], ["priest", "baron", "spy"]]


def load(rel: str, scale: int = 1, frame: int | None = None, frames: int = 1) -> Image.Image:
    im = Image.open(ART / rel).convert("RGBA")
    if frame is not None:
        fw = im.width // frames
        im = im.crop((frame * fw, 0, frame * fw + fw, im.height))
    return im.resize((im.width * scale, im.height * scale), Image.NEAREST)


def cover(img: Image.Image, w: int, h: int) -> int:
    k = 1
    while 512 * k < w or 288 * k < h:
        k += 1
    bg = load("scene/night-0.png", k)
    img.paste(bg.crop(((bg.width - w) // 2, (bg.height - h) // 2, (bg.width - w) // 2 + w, (bg.height - h) // 2 + h)), (0, 0))
    shade = Image.new("RGBA", (w, h), (12, 2, 5, 120))
    img.alpha_composite(shade)
    return k


def panel(img: Image.Image, box, title: str = "") -> None:
    d = ImageDraw.Draw(img)
    d.rectangle(box, fill=(30, 8, 12, 200), outline=(156, 111, 34, 255))
    if title:
        ph.text(img, title, (box[0] + box[2]) // 2, box[1] + 10)


def opponent(img, x, y, w, idx, plays, card_scale, mini: bool, step: int, row_h: int, name_scale: int = 1):
    """对手框：名牌（印章 + 名字 + 蜡烛 + 标记）+ 打出区扇形 + 手里那张背面。"""
    h = 28 + row_h + 8
    panel(img, (x, y, x + w - 1, y + h - 1))
    img.alpha_composite(load(f"seats/seal-{idx}.png"), (x + 4, y + 2))
    ph.text(img, f"玩家{idx}", x + 56, y + 14)
    for i in range(3):
        img.alpha_composite(load("icons/favor.png" if i < 1 else "icons/favor-empty.png"), (x + 88 + i * 17, y + 6))
    img.alpha_composite(load("fx/candle.png", 1, frame=idx % 6, frames=6), (x + w - 20, y + 2))
    if idx == 2:
        img.alpha_composite(load("icons/shield.png"), (x + w - 40, y + 6))
    if idx == 4:
        img.alpha_composite(load("icons/spy.png"), (x + w - 40, y + 6))
    cx = x + 6
    back = load("cards/mini/back.png", 2 if not mini else 1) if mini or card_scale == 1 else load("cards/back.png", card_scale)
    img.alpha_composite(back, (cx, y + 30))
    cx += back.width + 8
    for j, role in enumerate(plays):
        card = load(f"cards/mini/{role}.png", 1 if mini else 1) if mini else load(f"cards/{role}.png", card_scale)
        img.alpha_composite(card, (cx + j * step, y + 30))
    return h


def desktop(w: int, h: int, side: int, hand_scale: int, opp_w: int, step: int) -> Image.Image:
    img = Image.new("RGBA", (w, h))
    k = cover(img, w, h)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, w, 43), fill=(20, 5, 8, 255))
    ph.text(img, f"顶栏 · {w}×{h} · 背景 {k}×", 160, 22)
    if side:
        panel(img, (w - side, 44, w - 1, h - 1), "日志 / 聊天 / 参考卡")
    tw = w - side
    oy = 56
    row_h = 100
    bh = 28 + row_h + 8
    xs = [(tw - 3 * opp_w - 24) // 2 + i * (opp_w + 12) for i in range(3)]
    for i, x in enumerate(xs):
        opponent(img, x, oy, opp_w, i + 1, PLAYS[i], 1, False, step, row_h)
    y2 = oy + bh + 12
    opponent(img, 12, y2, opp_w, 4, PLAYS[3], 1, False, step, row_h)
    opponent(img, tw - opp_w - 12, y2, opp_w, 5, PLAYS[4], 1, False, step, row_h)
    # 牌堆 + 移出区
    mid = tw // 2
    img.alpha_composite(load("table/deck.png"), (mid - 90, y2 + 8))
    ph.text(img, "牌堆 9", mid - 50, y2 + 128)
    img.alpha_composite(load("table/aside.png"), (mid + 10, y2 + 8))
    ph.text(img, "移出", mid + 50, y2 + 128)
    # 自己
    hand = [load("cards/countess.png", hand_scale), load("cards/king.png", hand_scale)]
    hy = h - hand[0].height - 12
    hx = 24
    panel(img, (12, hy - 34, tw - 12, h - 6))
    img.alpha_composite(load("seats/seal-0.png", 1), (20, hy - 30))
    ph.text(img, "我 · 轮到你", 110, hy - 18)
    for c in hand:
        img.alpha_composite(c, (hx, hy))
        hx += c.width + 12
    for j, role in enumerate(["guard", "handmaid", "priest"]):
        img.alpha_composite(load(f"cards/{role}.png"), (hx + 24 + j * step, hy + hand[0].height - 100))
    bottom_used = h - (hy - 34)
    print(f"{w}×{h}：对手两排到 y={y2 + bh}，自己区从 y={hy - 34} 开始，空出 {hy - 34 - (y2 + bh)}px")
    if hy - 34 < y2 + bh:
        print("  !! 重叠")
    return img


def phone(w: int = 390, h: int = 664) -> Image.Image:
    img = Image.new("RGBA", (w, h))
    k = cover(img, w, h)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, w, 39), fill=(20, 5, 8, 255))
    ph.text(img, f"顶栏 · 390×664 · 背景 {k}×", 120, 20)
    y = 44
    for i in range(5):
        x = 6
        panel(img, (x, y, w - 7, y + 47))
        img.alpha_composite(load(f"seats/seal-{i + 1}.png"), (x + 3, y + 3))
        ph.text(img, f"玩家{i + 1}", x + 52, y + 14)
        img.alpha_composite(load("fx/candle.png", 1, frame=i, frames=6), (w - 7 - 20, y + 8))
        for t in range(3):
            img.alpha_composite(load("icons/favor.png" if t < 1 else "icons/favor-empty.png"), (x + 30 + t * 17, y + 28))
        img.alpha_composite(load("cards/mini/back.png"), (x + 92, y + 2))
        for j, role in enumerate(PLAYS[i]):
            img.alpha_composite(load(f"cards/mini/{role}.png"), (x + 132 + j * 16, y + 2))
        y += 52
    # 牌堆行
    panel(img, (6, y, w - 7, y + 47))
    img.alpha_composite(load("icons/deck.png", 2), (14, y + 8))
    ph.text(img, "牌堆 9", 72, y + 24)
    img.alpha_composite(load("cards/mini/back.png"), (120, y + 2))
    img.alpha_composite(load("icons/sealed.png"), (128, y + 16))
    ph.text(img, "移出 1", 186, y + 24)
    y += 52
    # 自己的打出区
    panel(img, (6, y, w - 7, y + 47))
    img.alpha_composite(load("seats/seal-0.png"), (9, y + 3))
    for j, role in enumerate(["guard", "handmaid", "priest"]):
        img.alpha_composite(load(f"cards/mini/{role}.png"), (60 + j * 16, y + 2))
    y += 52
    hand = [load("cards/countess.png", 2), load("cards/king.png", 2)]
    hx = (w - 2 * hand[0].width - 8) // 2
    for c in hand:
        img.alpha_composite(c, (hx, y))
        hx += c.width + 8
    y += 200 + 6
    panel(img, (6, y, w - 7, y + 39), "打出 / 按钮")
    y += 40
    print(f"390×664：内容到 y={y}，剩 {h - y}px")
    return img


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    desktop(1440, 790, 280, 2, 240, 22).save(OUT / "mock-1440x790.png")
    desktop(1920, 960, 320, 3, 300, 22).save(OUT / "mock-1920x960.png")
    desktop(1024, 690, 0, 2, 220, 18).save(OUT / "mock-1024x690.png")
    phone().save(OUT / "mock-390x664.png")
