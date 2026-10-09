import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（情书：夜间是烛光夜宴的深红，白天是奶油白底 + 浅玫瑰色面板）。
 * 深色底、面板、按钮 → 白底浅色；深色像素描边保留成深棕红；浅色字 → 深色字。
 * 牌、印章、图标这些图片本身不换；牌桌换成白天的场景和桌布（GameBoard 按主题挑图）。
 * 压在牌面、牌堆上的小深色牌子（张数、记牌角标、悬浮提示、「弃 / 亮」）保持夜间的样子，见 keep。
 */
export const palette: DayPalette = {
  files: ["app-pixel.css", "ll.css"],
  colors: {
    "#14080a": "#ffffff", // 底色、输入框、牌桌遮罩
    "#1a0b0e": "#fcf8f4", // 底色的棋盘纹、出局座位
    "#261015": "#fdf7f0", // 面板、座位
    "#33161c": "#f5e9df", // 面板 2、名字按钮
    "#45202a": "#efdfd2", // 普通按钮、分隔线
    "#2a1218": "#fbf0e0", // 管理员区
    "#3a2c10": "#fcefc6", // 金色字的底（选中项、状态牌、选中的座位）
    "#0a0304": "#3b1d20", // 像素描边
    "#7a3540": "#ffffff", // 面板亮边
    "#0e0406": "#dcc3b4", // 面板暗边
    "#a0505c": "#ffffff", // 按钮亮边
    "#1a080b": "#c9a593", // 按钮暗边
    "#4c0c15": "#e8d5b8", // 中央桌布的底色、描边暗金
    "#9c6f22": "#c9a55a", // 中央桌布的金边
  },
  text: {
    "#f7ead8": "#2e1a18",
    "#c9a894": "#7a5a4c",
    "#8a6a62": "#b9a093", // 输入框占位字
  },
  values: {
    // 不能点的按钮：夜间是压暗，白底上压暗成了泥色，改成褪成浅灰
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
  },
  textShadows: {
    // 大标题的投影：夜间是黑色，白底上换成浅金色
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #f0d890",
  },
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#d1303f",
  },
  // 压在牌和牌堆上的深色小牌子、悬浮提示、结算缎带上的字：保持夜间的样子
  keep: [".ll-pile-count", ".ll-faceup", ".ll-strip-head", ".ll-strip-cells", ".ll-tip", ".ll-how", ".ll-banner", ".ll-card-note", ".ll-blocked-tag", ".ll-pick-tag", ".ll-hand-card"],
};
