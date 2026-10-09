/**
 * 情书人机强度模拟：npx tsx scripts/sim-loveletter.ts [每组局数，默认 300]
 *
 * - 自对弈：2–6 人全是人机，每种人数 N 场，查合法、不死循环、决策耗时；
 * - 1 个人机对其余座位的随机策略 / 简单基线（补充 1.7），报整场胜率（公平值 1/人数）、小局占比、平均名次。
 */
import { MAX_STEPS, POLICIES, match, playGame, timing } from "../packages/game/test/bot-harness.js";

const games = Number(process.argv[2] ?? 300);
const only = process.argv[3];
const fmt = (p: number) => `${(100 * p).toFixed(1)}%`;

if (!only || only === "self") {
  console.log(`## 自对弈（每种人数 ${games} 场，最大步数 ${MAX_STEPS}）`);
  for (let seats = 2; seats <= 6; seats += 1) {
    const ms: number[] = [];
    let problems = 0;
    let maxSteps = 0;
    let rounds = 0;
    for (let index = 0; index < games; index += 1) {
      const result = playGame(Array.from({ length: seats }, () => POLICIES.bot!), 7000 + seats * 1000 + index, { timeBot: POLICIES.bot! });
      ms.push(...result.botMs);
      problems += result.problems.length;
      if (result.problems.length) console.log("  问题：", result.problems[0]);
      maxSteps = Math.max(maxSteps, result.steps);
      rounds += result.rounds;
    }
    const t = timing(ms);
    console.log(
      `${seats} 人：问题 ${problems}，最多 ${maxSteps} 步，平均 ${(rounds / games).toFixed(1)} 小局，决策 ${ms.length} 次，平均 ${t.avg.toFixed(3)}ms，p99 ${t.p99.toFixed(2)}ms，最慢 ${t.max.toFixed(2)}ms`,
    );
  }
}

for (const base of ["random", "simple"] as const) {
  if (only && only !== base) continue;
  console.log(`\n## 1 个人机 对 其余 ${base}（每种人数 ${games} 场，人机轮流坐每个座位）`);
  for (let seats = 2; seats <= 6; seats += 1) {
    const result = match(POLICIES.bot!, POLICIES[base]!, games, seats, 20000 + seats * 1000);
    console.log(
      `${seats} 人：整场胜率 ${fmt(result.winRate)}（公平 ${fmt(result.fair)}），小局占比 ${fmt(result.roundShare)}，平均名次 ${result.avgRank.toFixed(2)}，平均标记 ${result.avgTokens.toFixed(2)}，问题 ${result.problems.length}`,
    );
  }
}

if (!only || only === "baseline") {
  console.log(`\n## 参照：1 个简单基线 对 其余随机`);
  for (const seats of [2, 4]) {
    const result = match(POLICIES.simple!, POLICIES.random!, games, seats, 40000 + seats * 1000);
    console.log(`${seats} 人：整场胜率 ${fmt(result.winRate)}（公平 ${fmt(result.fair)}），小局占比 ${fmt(result.roundShare)}`);
  }
}
