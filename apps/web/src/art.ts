import type { Role } from "@loveletter/game";

/**
 * 像素美术的地址（尺寸、倍数见 art/spec.md）。图片放在 public/art 下：美术规格阶段先放占位图，
 * 出图定稿后同名覆盖，这里不用改。所有图都只按整数倍显示，加 image-rendering: pixelated。
 */
const ROOT = `${import.meta.env.BASE_URL}art/`;

/** 大牌原图 72×100：1× 打出区 / 亮牌，2× 手牌、看牌、比牌、大臣，3× 大屏手牌。 */
export const CARD_W = 72;
export const CARD_H = 100;
/** 小牌原图 32×44：1× 手机打出区、记牌、参考卡，2× 卫兵猜牌。 */
export const MINI_W = 32;
export const MINI_H = 44;
/** 牌堆 / 移出区 / 空槽画布 80×112（牌在左上，右下是厚度）。 */
export const PILE_W = 80;
export const PILE_H = 112;

export type IconName =
  | "favor"
  | "favor-empty"
  | "shield"
  | "spy"
  | "out"
  | "eye"
  | "duel"
  | "swap"
  | "target"
  | "deck"
  | "crown"
  | "letter"
  | "book"
  | "sealed";

export const art = {
  card: (role: Role | "back") => `${ROOT}cards/${role}.png`,
  mini: (role: Role | "back") => `${ROOT}cards/mini/${role}.png`,
  icon: (name: IconName) => `${ROOT}icons/${name}.png`,
  favorBig: `${ROOT}icons/favor-big.png`,
  seal: (seat: number) => `${ROOT}seats/seal-${((seat % 6) + 6) % 6}.png`,
  deck: `${ROOT}table/deck.png`,
  deckLow: `${ROOT}table/deck-low.png`,
  slot: `${ROOT}table/slot.png`,
  aside: `${ROOT}table/aside.png`,
  cloth: (day: boolean) => `${ROOT}table/cloth-${day ? "day" : "night"}.png`,
  scene: (day: boolean, k: number) => `${ROOT}scene/${day ? "day" : "night"}-${k}.png`,
  fx: {
    candle: `${ROOT}fx/candle.png`,
    snuff: `${ROOT}fx/snuff.png`,
    shield: `${ROOT}fx/shield.png`,
    duel: `${ROOT}fx/duel.png`,
    favor: `${ROOT}fx/favor.png`,
    petal: `${ROOT}fx/petal.png`,
  },
  banner: `${ROOT}ui/banner.png`,
  letterWin: `${ROOT}ui/letter-win.png`,
  divider: `${ROOT}ui/divider.png`,
};

/** 精灵图：单帧尺寸和帧数（横排）。 */
export const SPRITES = {
  candle: { w: 16, h: 32, frames: 6, ms: 120 },
  snuff: { w: 16, h: 32, frames: 8, ms: 100 },
  shield: { w: 32, h: 32, frames: 8, ms: 80 },
  duel: { w: 32, h: 32, frames: 6, ms: 80 },
  favor: { w: 32, h: 32, frames: 8, ms: 90 },
  petal: { w: 8, h: 8, frames: 4, ms: 150 },
} as const;

/** 座位色（印章、日志、目标高亮），和 art/spec.md 1 节一致。 */
export const SEAT_HEX = ["#d23a4a", "#3d6fd6", "#3fa45b", "#e0a030", "#9a5bd0", "#2fb5ad"] as const;
export const seatHex = (seat: number) => SEAT_HEX[((seat % 6) + 6) % 6]!;

/** 场景图（512×288）按整数倍放大盖住一块区域需要的尺寸（CSS background-size）。 */
export function coverSize(width: number, height: number): string {
  const scale = Math.max(1, Math.ceil(Math.max(width / 512, height / 288)));
  return `${512 * scale}px ${288 * scale}px`;
}

/** 房间码哈希到场景编号 0 / 1（同一个房间切主题时是同一个地方换光线）。 */
export function sceneIndex(code: string): number {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 2;
}
