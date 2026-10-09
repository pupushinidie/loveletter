import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 人机（占位）：从合法行动里随机挑一个。人机阶段会换成正式策略（补充文件第一节）。
 *
 * 输入必须是 redactGameForViewer(game, playerId) 裁剪后的状态——人机只看得到自己座位能看到的东西。
 * 轮不到它（或者已经点过「下一局」）时返回 null。
 * random 可以传进来（测试时固定）；默认 Math.random（人机在服务器上跑）。
 */
export function botCommand(state: GameState, playerId: string, random: () => number = Math.random): GameCommand | null {
  const actions = legalActions(state, playerId);
  if (actions.length === 0) return null;
  return actions[Math.floor(random() * actions.length)] ?? actions[0]!;
}
