/**
 * 人机自对弈和强度（交付标准：每种人数至少 300 场，每一步合法，不死循环，决策耗时；对随机 2 人 ≥ 90%，对简单基线明显高于平均）。
 * 详细数字用 scripts/sim-loveletter.ts 跑。
 */
import { describe, expect, it } from "vitest";
import { MAX_STEPS, POLICIES, match, playGame, timing } from "./bot-harness.js";

const GAMES = 300;

describe("人机自对弈", () => {
  for (const seats of [2, 3, 4, 5, 6]) {
    it(`${seats} 人局全是人机 ${GAMES} 场：每一步合法、${MAX_STEPS} 步内结束、每步平均 < 50ms、最慢 < 300ms`, () => {
      const problems: string[] = [];
      const ms: number[] = [];
      let longest = 0;
      for (let index = 0; index < GAMES; index += 1) {
        const result = playGame(Array.from({ length: seats }, () => POLICIES.bot!), 100_000 + seats * 1000 + index, { timeBot: POLICIES.bot! });
        problems.push(...result.problems);
        ms.push(...result.botMs);
        longest = Math.max(longest, result.steps);
        if (result.winners.length === 0 && result.problems.length === 0) problems.push(`第 ${index} 场没有赢家`);
      }
      const t = timing(ms);
      expect(problems).toEqual([]);
      expect(longest).toBeLessThan(MAX_STEPS);
      expect(t.avg).toBeLessThan(50);
      expect(t.max).toBeLessThan(300);
    }, 120_000);
  }
});

describe("人机强度", () => {
  it(`2 人局对随机：胜率 ≥ 90%（${GAMES} 场）`, () => {
    const result = match(POLICIES.bot!, POLICIES.random!, GAMES, 2, 200_000);
    expect(result.problems).toEqual([]);
    expect(result.winRate).toBeGreaterThanOrEqual(0.9);
  }, 120_000);

  it(`3、4 人局：1 个人机对其余简单基线，胜率明显高于公平值（${GAMES} 场）`, () => {
    const three = match(POLICIES.bot!, POLICIES.simple!, GAMES, 3, 210_000);
    const four = match(POLICIES.bot!, POLICIES.simple!, GAMES, 4, 220_000);
    expect(three.problems).toEqual([]);
    expect(four.problems).toEqual([]);
    // 实测约 60% / 44%（公平 33% / 25%），这里留余量防随机波动
    expect(three.winRate).toBeGreaterThan(0.45);
    expect(four.winRate).toBeGreaterThan(0.33);
  }, 120_000);
});
