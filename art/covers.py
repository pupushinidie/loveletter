"""大厅封面候选：从 art/out/r1/covers/ 挑出来，抹掉模型画上的签名/水印字，放进 art/out/covers/（spec 2.9）。

- cover-4b 右下角有一团像签名的浅色笔画，cover-5 右下角有一行像「ARCANA」的水印字：
  框里比周围亮的像素用同一行左边的暗色像素补上（底下都是平的暗色桌布/地板）。
- 其余原样复制。封面上不能有字（guluga-pixellab 第 4、8 节）。

用法：~/miniconda3/envs/quant/bin/python art/covers.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ART = Path(__file__).resolve().parent
SRC = ART / "out" / "r1" / "covers"
DST = ART / "out" / "covers"

# 名字: [(x0, y0, x1, y1, 往左取样的距离), ...]（包含 x1/y1）
ERASE = {
    "cover-4b": [(360, 168, 383, 191, 26)],
    "cover-5": [(350, 180, 383, 191, -14)],  # 负数 = 整块用往上 14 行的像素补（水印字带暗色描边，按亮度挑补不干净）
}
KEEP = ["cover-4", "cover-4b", "cover-1", "cover-5", "cover-6"]


def lum(p) -> float:
    return p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11


def erase(img: Image.Image, boxes) -> Image.Image:
    img = img.convert("RGB").copy()
    px = img.load()
    for x0, y0, x1, y1, dx in boxes:
        if dx < 0:
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    px[x, y] = px[x, y + dx]
            continue
        for y in range(y0, y1 + 1):
            # 这一行框外左边的暗色当基准
            ref = [px[x, y] for x in range(x0 - dx, x0)]
            base = sorted(lum(p) for p in ref)[len(ref) // 2]
            for x in range(x0, x1 + 1):
                if lum(px[x, y]) > base + 12:
                    px[x, y] = px[x - dx, y]
    return img


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for name in KEEP:
        img = Image.open(SRC / f"{name}.png").convert("RGB")
        if name in ERASE:
            img = erase(img, ERASE[name])
        img.save(DST / f"{name}.png")
        print(DST / f"{name}.png", img.size)


if __name__ == "__main__":
    main()
