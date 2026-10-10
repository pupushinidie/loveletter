# 美术

情书的像素美术（PixelLab）放这里，归美术 agent 管：生成脚本、`selection.json`（选了哪张）、`ledger.jsonl`（记账）。
规格见 `spec.md`（文件名、尺寸、帧数、显示倍数、播放方式）。

## 定稿（2026-10-10）

- 定稿全部在 `art/out/final/`（目录结构和 `apps/web/public/art/` 一样，62 项），由开发 agent 同名覆盖到 `apps/web/public/art/`。
  `art/out/` 被 gitignore，但 `art/out/final/` 用 `git add -f` 提交了，换个机器也能直接用。
- 重新导出：`~/miniconda3/envs/quant/bin/python art/export.py`（读 `selection.json`，动画读 `out/anim/<名字>/strip.png`）。
- 核对：`python art/simple.py --check --final`（spec 和定稿一一对应、尺寸对）；动画：`python art/anim.py report`。
- 画廊：`python art/gallery.py` 读 `picks.json`，写 `~/projects/pipeline/games/loveletter/assets/gallery-decision.json`（不阻塞）。
- 候选：插画、场景、图标在 `out/r1/`，对比图在 `out/r2/`、`out/review-1/`，动画候选在 `out/anim/<名字>/s*/`，封面在 `out/covers/`。
