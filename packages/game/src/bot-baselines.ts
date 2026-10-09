/**
 * 测人机强度用的两个基线（补充文件 1.7）。不从 index 导出，只给测试和模拟脚本用。
 * 都只吃裁剪后的视角。
 */
import { GUARD_GUESSES, ROLE_VALUE, type Role } from "./cards.js";
import { legalActions, mustPlayCountess, targetChoices, unseenCounts } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

type Random = () => number;
const pickOne = <T>(items: readonly T[], random: Random): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;

/** 随机：先均匀挑一张能打的牌（满足女伯爵限制，允许打公主），再随机挑目标、猜的角色；大臣随机留、随机顺序。 */
export function randomPolicy(view: GameState, me: string, random: Random = Math.random): GameCommand | null {
  const actions = legalActions(view, me);
  if (actions.length === 0) return null;
  if (view.phase !== "playing") return actions[0]!;
  if (view.stage === "chancellor") return pickOne(actions, random);
  const cards = [...new Set(actions.map((command) => (command as { card: Role }).card))];
  const card = pickOne(cards, random);
  const targets = [...new Set(actions.filter((command) => (command as { card: Role }).card === card).map((command) => (command as { target?: string }).target))];
  const target = pickOne(targets, random);
  const options = actions.filter((command) => (command as { card: Role }).card === card && (command as { target?: string }).target === target);
  return pickOne(options, random);
}

/**
 * 简单基线「保守打低」：不打公主；女伯爵被迫就打；打两张里点数低的；
 * 卫兵猜「没露面最多」的非卫兵角色、目标随机；其他指向牌目标随机（王子不选自己，除非被迫）；
 * 大臣留点数最高的，另外两张按点数从高到低往下放（最低的在最底下）。
 */
export function simplePolicy(view: GameState, me: string, random: Random = Math.random): GameCommand | null {
  const actions = legalActions(view, me);
  if (actions.length === 0) return null;
  if (view.phase !== "playing") return actions[0]!;
  const player = view.players.find((candidate) => candidate.id === me)!;
  const byValue = (a: Role, b: Role) => ROLE_VALUE[b] - ROLE_VALUE[a];
  if (view.stage === "chancellor") {
    const sorted = [...player.hand].sort(byValue);
    return { type: "CHANCELLOR", keep: sorted[0]!, bottom: sorted.slice(1) };
  }
  let card: Role;
  if (mustPlayCountess(player.hand)) card = "countess";
  else {
    const options = player.hand.filter((entry) => entry !== "princess");
    card = [...(options.length > 0 ? options : player.hand)].sort(byValue).at(-1)!;
  }
  let choices = targetChoices(view, me, card);
  if (choices.length === 0) return { type: "PLAY", card };
  if (card === "prince" && choices.length > 1) choices = choices.filter((id) => id !== me);
  const target = pickOne(choices, random);
  if (card !== "guard") return { type: "PLAY", card, target };
  const unseen = unseenCounts(view, me);
  const best = Math.max(...GUARD_GUESSES.map((role) => unseen[role]));
  const guess = pickOne(GUARD_GUESSES.filter((role) => unseen[role] === best), random);
  return { type: "PLAY", card, target, guess };
}
