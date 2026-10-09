/**
 * 人机自对弈 / 对基线的对局驱动（测试和 scripts/sim-loveletter.ts 共用）。
 * 每个策略只拿到 redactGameForViewer 的视角；命令不合法时 applyCommand 会抛错，记成 illegal。
 */
import { botCommand } from "../src/bot.js";
import { randomPolicy, simplePolicy } from "../src/bot-baselines.js";
import { applyCommand, createGame, redactGameForViewer, timeoutTurn } from "../src/engine.js";
import { createRng } from "../src/rng.js";
import type { GameCommand, GameState } from "../src/types.js";

export type Policy = (view: GameState, me: string, random: () => number) => GameCommand | null;

export const POLICIES: Record<string, Policy> = {
  bot: (view, me, random) => botCommand(view, me, random),
  random: randomPolicy,
  simple: simplePolicy,
};

export interface GameResult {
  /** 整场赢家的座位下标。 */
  winners: number[];
  /** 每个座位赢了几小局。 */
  roundWins: number[];
  rounds: number;
  tokens: number[];
  steps: number;
  /** 出错（不合法命令、没有命令、超过最大步数）的描述；没问题是空数组。 */
  problems: string[];
  /** 人机（policies 里叫 bot 的座位）每一步的耗时（毫秒，含裁剪视角）。 */
  botMs: number[];
}

export const MAX_STEPS = 3000;

export function playGame(policies: readonly Policy[], seed: number, options: { timeBot?: Policy } = {}): GameResult {
  const random = createRng(seed ^ 0x5bd1e995);
  let state = createGame(
    policies.map((_, index) => ({ id: `p${index + 1}`, name: `座位${index + 1}` })),
    seed,
  );
  const roundWins = policies.map(() => 0);
  const problems: string[] = [];
  const botMs: number[] = [];
  let steps = 0;
  let rounds = 0;
  while (state.phase !== "finished") {
    steps += 1;
    if (steps > MAX_STEPS) {
      problems.push(`超过 ${MAX_STEPS} 步还没结束`);
      break;
    }
    if (state.phase === "roundEnd") {
      state = timeoutTurn(state);
      continue;
    }
    const seat = state.current;
    const actor = state.players[seat]!.id;
    const policy = policies[seat]!;
    const started = performance.now();
    const view = redactGameForViewer(state, actor);
    let command: GameCommand | null;
    try {
      command = policy(view, actor, () => random.next());
    } catch (error) {
      problems.push(`策略报错：${(error as Error).message}`);
      break;
    }
    if (policy === options.timeBot) botMs.push(performance.now() - started);
    if (!command) {
      problems.push("轮到了却没给命令");
      break;
    }
    const before = state;
    try {
      state = applyCommand(state, actor, command);
    } catch (error) {
      problems.push(`不合法：${JSON.stringify(command)} → ${(error as Error).message}`);
      break;
    }
    if (before.phase === "playing" && state.phase !== "playing") {
      rounds += 1;
      for (const id of state.lastRound?.winners ?? []) roundWins[Number(id.slice(1)) - 1]! += 1;
    }
  }
  return {
    winners: (state.winners ?? []).map((id) => Number(id.slice(1)) - 1),
    roundWins,
    rounds,
    tokens: state.players.map((player) => player.tokens),
    steps,
    problems,
    botMs,
  };
}

export interface MatchResult {
  games: number;
  /** A 的整场胜率（并列赢平分）。 */
  winRate: number;
  /** 公平值 1/人数。 */
  fair: number;
  /** A 赢下的小局占全部小局的比例（并列各算一次）。 */
  roundShare: number;
  /** A 的平均名次（按标记数，1 最好，并列取平均）。 */
  avgRank: number;
  avgTokens: number;
  problems: string[];
  botMs: number[];
}

/** 1 个 a 对 seats−1 个 b，a 轮流坐每个座位。 */
export function match(a: Policy, b: Policy, games: number, seats: number, seedBase = 1000): MatchResult {
  let wins = 0;
  let roundsA = 0;
  let roundsAll = 0;
  let rankSum = 0;
  let tokenSum = 0;
  const problems: string[] = [];
  const botMs: number[] = [];
  for (let index = 0; index < games; index += 1) {
    const seat = index % seats;
    const policies = Array.from({ length: seats }, (_, k) => (k === seat ? a : b));
    const result = playGame(policies, seedBase + index, { timeBot: a });
    problems.push(...result.problems);
    botMs.push(...result.botMs);
    if (result.winners.includes(seat)) wins += 1 / result.winners.length;
    roundsA += result.roundWins[seat]!;
    roundsAll += result.roundWins.reduce((sum, value) => sum + value, 0);
    const mine = result.tokens[seat]!;
    const better = result.tokens.filter((value) => value > mine).length;
    const same = result.tokens.filter((value) => value === mine).length;
    rankSum += better + (same + 1) / 2;
    tokenSum += mine;
  }
  return {
    games,
    winRate: wins / games,
    fair: 1 / seats,
    roundShare: roundsAll > 0 ? roundsA / roundsAll : 0,
    avgRank: rankSum / games,
    avgTokens: tokenSum / games,
    problems,
    botMs,
  };
}

export function timing(ms: readonly number[]): { avg: number; max: number; p99: number } {
  if (ms.length === 0) return { avg: 0, max: 0, p99: 0 };
  const sorted = [...ms].sort((x, y) => x - y);
  return {
    avg: ms.reduce((sum, value) => sum + value, 0) / ms.length,
    max: sorted.at(-1)!,
    p99: sorted[Math.floor(sorted.length * 0.99)]!,
  };
}
