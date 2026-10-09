/**
 * 牌桌尺寸：按牌桌实际的宽高，在几种摆法里挑放得下的最大的一种（像素图只按整数倍放大）。
 *
 * 牌桌是一圈座位：自己在最下面，对手 1–3 个时都在上排，4–5 个时左中、右中各一个、其余在上排（ring）。
 * 中央是牌堆、移出区（2 人局加 3 张明牌）和记牌条。
 * 可调的倍数：自己的手牌（大牌 2× / 3×）、打出区（大牌 1× / 2×）、记牌条（小牌 1× / 2×），
 * 按「手牌大 > 打出区大 > 记牌条大」的顺序挑第一个放得下的。
 * 手机（窄于 700）单独一套：上下排，第一屏是顶栏 + 自己的手牌和按钮，其余往下放。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { CARD_H, CARD_W, MINI_H, MINI_W, PILE_H, PILE_W } from "./art.js";

export interface Layout {
  readonly mobile: boolean;
  /** 右边放状态、记录、聊天栏（否则收进抽屉）。 */
  readonly side: boolean;
  /** 4–5 个对手：左中、右中各一个座位。 */
  readonly ring: boolean;
  /** 自己手牌的倍数（大牌 72×100）。 */
  readonly hand: 2 | 3;
  /** 打出区大牌的倍数。 */
  readonly disc: 1 | 2;
  /** 记牌条小牌（32×44）的倍数。 */
  readonly strip: 1 | 2;
  /** 自己打出区大牌的倍数（手牌 3× 时自己这一排够高，打出区跟着放大）。 */
  readonly myDisc: 1 | 2;
  /** 对手座位宽度（px）。 */
  readonly seatW: number;
}

/** 和 ll.css 对应的固定尺寸。 */
export const SIDE_W = 300;
export const MAIN_GAP = 12;
export const TABLE_PAD = 12;
export const ROW_GAP = 8;
export const SEAT_PAD_X = 10;
export const SEAT_PAD_Y = 6;
export const SEAT_HEAD = 32;
export const SEAT_INNER_GAP = 6;
/** 对手座位里手牌背（小牌背 1×，两张时错开 8px）占的宽度。 */
export const SEAT_BACKS = 40;
export const SEAT_MIN_W = 264;
export const STRIP_GAP = 4;
export const STRIP_HEAD = 18;
export const CENTER_GAP = 8;
export const ME_PAD = 8;
export const HAND_GAP = 12;
export const HAND_LIFT = 8;
export const ACTION_MIN_W = 300;
export const ACTION_MIN_H = 200;
export const ME_INFO_MIN_W = 240;

/** 打出区错开距离：大牌 1× 20px（金币刚好露出）。 */
export const fanStep = (scale: number) => 20 * scale;
export const fanWidth = (count: number, scale: number) => (count <= 0 ? CARD_W * scale : CARD_W * scale + (count - 1) * fanStep(scale));

const seatHeight = (disc: number) => SEAT_PAD_Y * 2 + SEAT_HEAD + SEAT_INNER_GAP + CARD_H * disc;
const seatWidth = (disc: number, discards: number) => Math.max(SEAT_MIN_W, SEAT_PAD_X * 2 + SEAT_BACKS + 8 + fanWidth(Math.max(5, discards), disc));
const stripWidth = (strip: number) => 10 * MINI_W * strip + 9 * STRIP_GAP;
/** 记牌条 1× 时数字写在小牌下面（盖在 32×44 上会把牌挡住），2× 时压在右下角。 */
const centerHeight = (strip: number) => PILE_H + CENTER_GAP + STRIP_HEAD + (strip === 1 ? MINI_H + 26 : MINI_H * strip);
const centerWidth = (strip: number, faceUp: boolean) => Math.max(stripWidth(strip), PILE_W * 2 + 12 + (faceUp ? 3 * CARD_W + 16 : 0));
const meHeight = (hand: number, disc: number) => ME_PAD * 2 + Math.max(SEAT_HEAD + SEAT_INNER_GAP + CARD_H * disc, CARD_H * hand + HAND_LIFT, ACTION_MIN_H);
/** 自己的打出区放不下时 Fan 会收紧间距，这里只按 5 张估。 */
const meWidth = (hand: number, disc: number) =>
  ME_PAD * 2 + Math.max(ME_INFO_MIN_W, fanWidth(5, disc) + 22) + (2 * CARD_W * hand + HAND_GAP) + ACTION_MIN_W + 2 * 16;
const myDiscFor = (hand: number, disc: number): 1 | 2 => (hand === 3 || disc === 2 ? 2 : 1);

export interface LayoutInput {
  readonly width: number;
  readonly height: number;
  readonly opponents: number;
  /** 对手里打出区最长的张数。 */
  readonly oppDiscards: number;
  readonly myDiscards: number;
  readonly twoPlayer: boolean;
}

export function pickLayout(input: LayoutInput): Layout {
  const { width, height, opponents } = input;
  if (width < 700) return { mobile: true, side: false, ring: false, hand: 2, disc: 1, strip: 1, myDisc: 1, seatW: 0 };
  const side = width >= 1280;
  const innerW = width - (side ? SIDE_W + MAIN_GAP : 0) - TABLE_PAD * 2;
  const innerH = height - TABLE_PAD * 2;
  const ring = opponents >= 4;
  const top = ring ? opponents - 2 : opponents;
  // 记牌条放大最优先（算牌靠它），其次手牌，再次打出区
  for (const strip of [2, 1] as const) {
    for (const hand of [3, 2] as const) {
      for (const disc of [2, 1] as const) {
        const myDisc = myDiscFor(hand, disc);
        const seatW = Math.min(seatWidth(disc, input.oppDiscards), Math.floor((innerW - (top - 1) * ROW_GAP) / Math.max(1, top)));
        const layout: Layout = { mobile: false, side, ring, hand, disc, strip, myDisc, seatW };
        const sh = seatHeight(disc);
        const ch = centerHeight(strip);
        const rows = ring ? sh + Math.max(sh, ch) + meHeight(hand, myDisc) + 2 * ROW_GAP : sh + ch + meHeight(hand, myDisc) + 2 * ROW_GAP;
        if (rows > innerH) continue;
        const need = seatWidth(disc, input.oppDiscards);
        if (top * need + (top - 1) * ROW_GAP > innerW) continue;
        if (ring && 2 * need + 2 * ROW_GAP + centerWidth(strip, input.twoPlayer) > innerW) continue;
        if (!ring && centerWidth(strip, input.twoPlayer) > innerW) continue;
        if (meWidth(hand, myDisc) > innerW) continue;
        return { ...layout, seatW: need };
      }
    }
  }
  // 都放不下（很矮的窗口）：用最小的一套，牌桌内部不滚动、由内容自己收紧
  return { mobile: false, side, ring, hand: 2, disc: 1, strip: 1, myDisc: 1, seatW: Math.min(seatWidth(1, input.oppDiscards), Math.floor((innerW - (top - 1) * ROW_GAP) / Math.max(1, top))) };
}

/** 量牌桌主区域的尺寸，挑摆法。 */
export function useLayout(input: Omit<LayoutInput, "width" | "height">) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: typeof window === "undefined" ? 1440 : window.innerWidth, height: 700 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = window.innerWidth < 700 ? window.innerWidth : Math.round(rect.width);
      setBox((old) => (old.width === width && old.height === Math.round(rect.height) ? old : { width, height: Math.round(rect.height) }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, pickLayout({ ...input, ...box }), box] as const;
}
