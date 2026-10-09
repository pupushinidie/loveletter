import type { CSSProperties, ReactNode } from "react";
import { ROLE_COUNT, ROLE_NAME, ROLE_VALUE, type DiscardEntry, type Role } from "@loveletter/game";
import { art, CARD_H, CARD_W, MINI_H, MINI_W, SPRITES, type IconName } from "./art.js";
import { ROLE_EFFECT } from "./describe.js";
import { fanStep } from "./layout.js";

/** 大牌（72×100 原图，按整数倍显示）。 */
export function Card({ role, scale, className = "", title }: { role: Role | "back"; scale: number; className?: string; title?: string }) {
  return (
    <img
      className={`ll-card ${className}`}
      src={art.card(role)}
      width={CARD_W * scale}
      height={CARD_H * scale}
      alt={role === "back" ? "牌背" : `${ROLE_NAME[role]}（${ROLE_VALUE[role]}）`}
      title={title}
      draggable={false}
    />
  );
}

/** 小牌（32×44 原图）。 */
export function Mini({ role, scale = 1, className = "" }: { role: Role | "back"; scale?: number; className?: string }) {
  return (
    <img
      className={`ll-mini ${className}`}
      src={art.mini(role)}
      width={MINI_W * scale}
      height={MINI_H * scale}
      alt={role === "back" ? "牌背" : ROLE_NAME[role]}
      draggable={false}
    />
  );
}

export function Icon({ name, scale = 2, className = "", title }: { name: IconName; scale?: number; className?: string; title?: string }) {
  return <img className={`ll-icon ${className}`} src={art.icon(name)} width={16 * scale} height={16 * scale} alt="" title={title} draggable={false} />;
}

export function Seal({ seat, scale = 1 }: { seat: number; scale?: number }) {
  return <img className="ll-seal" src={art.seal(seat)} width={24 * scale} height={24 * scale} alt="" draggable={false} />;
}

/**
 * 精灵图（横排帧）。loop 循环播放；once 播一次停在最后一帧；still 停在最后一帧不播。
 * delay 是负数时从中间某一帧开始（错开座位上的蜡烛）。
 */
export function Sprite({ name, scale = 1, mode = "loop", delay = 0, className = "" }: {
  name: keyof typeof SPRITES;
  scale?: number;
  mode?: "loop" | "once" | "still";
  delay?: number;
  className?: string;
}) {
  const sprite = SPRITES[name];
  const style = {
    width: sprite.w * scale,
    height: sprite.h * scale,
    backgroundImage: `url(${art.fx[name]})`,
    backgroundSize: `${sprite.w * sprite.frames * scale}px ${sprite.h * scale}px`,
    "--last": `${-sprite.w * (sprite.frames - 1) * scale}px`,
    "--frames": sprite.frames,
    "--dur": `${sprite.ms * sprite.frames}ms`,
    animationDelay: delay ? `${delay}ms` : undefined,
  } as CSSProperties;
  return <span className={`ll-sprite ${mode} ${className}`} style={style} aria-hidden="true" />;
}

const HOW: Record<DiscardEntry["how"], string> = { played: "", discarded: "弃", eliminated: "亮" };
const HOW_TITLE: Record<DiscardEntry["how"], string> = { played: "打出", discarded: "被王子弃掉", eliminated: "出局时亮出" };

/**
 * 打出区：按先后从左往右错开摆，每张左上角的点数金币都露在外面。
 * maxWidth 放不下时自动收紧间距（最少 12px）。fresh 是刚打出的张数（从末尾数），播一次落下动画。
 */
export function Fan({ entries, scale, maxWidth, fresh = 0, mini = false, empty }: {
  entries: readonly DiscardEntry[];
  scale: number;
  maxWidth?: number;
  fresh?: number;
  mini?: boolean;
  empty?: ReactNode;
}) {
  const w = (mini ? MINI_W : CARD_W) * scale;
  const h = (mini ? MINI_H : CARD_H) * scale;
  const base = mini ? 16 * scale : fanStep(scale);
  const n = entries.length;
  let step = base;
  if (maxWidth !== undefined && n > 1 && w + (n - 1) * step > maxWidth) step = Math.max(12, Math.floor((maxWidth - w) / (n - 1)));
  const width = n === 0 ? w : w + (n - 1) * step;
  return (
    <div className={`ll-fan${mini ? " mini" : ""}`} style={{ width, height: h }}>
      {n === 0 && <div className="ll-fan-empty" style={{ width: w, height: h }}>{empty}</div>}
      {entries.map((entry, index) => (
        <span
          key={index}
          className={`ll-fan-card${index >= n - fresh ? " fresh" : ""}${entry.how !== "played" ? ` ${entry.how}` : ""}`}
          style={{ left: index * step, zIndex: index }}
          title={`${ROLE_NAME[entry.card]}（${ROLE_VALUE[entry.card]}）· ${HOW_TITLE[entry.how]}`}
        >
          {mini ? <Mini role={entry.card} scale={scale} /> : <Card role={entry.card} scale={scale} />}
          {HOW[entry.how] && <small className="ll-how">{HOW[entry.how]}</small>}
        </span>
      ))}
    </div>
  );
}

/** 参考卡的悬浮提示内容（记牌条、规则说明共用）。 */
export function RoleTip({ role, unseen, visible }: { role: Role; unseen?: number; visible?: number }) {
  return (
    <span className="ll-tip" role="tooltip">
      <b>{ROLE_VALUE[role]} {ROLE_NAME[role]} ×{ROLE_COUNT[role]}</b>
      <span>{ROLE_EFFECT[role]}</span>
      {unseen !== undefined && <em>已打出 {visible ?? 0} 张 · 还有 {unseen} 张没露面</em>}
    </span>
  );
}
