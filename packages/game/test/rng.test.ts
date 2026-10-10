/**
 * 随机数（首发验收 I8）：128 位状态、crypto 种子、每个命令可以注入新的随机数；
 * 不注入时同一种子、同一串操作结果一样（测试、教程、预览靠它）。
 */
import { describe, expect, it } from "vitest";
import { FULL_DECK } from "../src/cards.js";
import { applyCommand, createGame, redactGameForViewer } from "../src/engine.js";
import { createRng, randomSeed, restoreRng } from "../src/rng.js";
import { scene, scenePlayers, TUTORIAL_DEAL, TUTORIAL_PLAYERS, tutorialEndgame } from "../src/scenes.js";
import type { GameState } from "../src/types.js";
import { ready } from "./helpers.js";

const draws = (seed: number[] | number, count = 8) => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.next());
};

/** 一局的发牌顺序：移出的、明牌、每人起手、牌堆（洗牌后的整副）。 */
function dealOf(game: GameState): string[] {
  // 发牌顺序：移出的、明牌、按座位每人 1 张，然后是牌堆（先手已经抽走了牌堆顶，那张是他手里的第 2 张）
  const starter = game.players[game.current]!;
  return [game.setAside!, ...game.faceUp, ...game.players.map((player) => player.hand[0]!), starter.hand[1]!, ...game.deck!];
}

describe("随机数发生器", () => {
  it("状态是 4 个 32 位整数（128 位），4 个种子整数每一个都影响结果", () => {
    const rng = createRng([1, 2, 3, 4]);
    expect(rng.state).toHaveLength(4);
    expect(rng.seed).toEqual([1, 2, 3, 4]);
    const base = draws([0x12345678, 0x9abcdef0, 0x0badcafe, 0xdeadbeef]);
    for (let word = 0; word < 4; word += 1) {
      for (const bit of [0, 13, 31]) {
        const seed = [0x12345678, 0x9abcdef0, 0x0badcafe, 0xdeadbeef];
        seed[word] = (seed[word]! ^ (1 << bit)) >>> 0;
        expect(draws(seed), `第 ${word} 个整数第 ${bit} 位`).not.toEqual(base);
      }
    }
  });

  it("同一种子同一串数；restoreRng 从 state 接着取", () => {
    expect(draws(42)).toEqual(draws(42));
    expect(draws([5, 6, 7, 8])).toEqual(draws([5, 6, 7, 8]));
    expect(draws(42)).not.toEqual(draws(43));
    const rng = createRng([9, 9, 9, 9]);
    rng.next();
    rng.next();
    const resumed = restoreRng(rng.state);
    expect(Array.from({ length: 5 }, () => resumed.next())).toEqual(Array.from({ length: 5 }, () => rng.next()));
    expect(rng.draws).toBe(7);
  });

  it("数字种子的高位也算（不是只取低 32 位）", () => {
    expect(draws(2 ** 32 + 5)).not.toEqual(draws(5));
  });

  it("next 在 [0,1)，int 均匀（1 万次掷 21 面，每面 300–650 次）", () => {
    const rng = createRng(randomSeed());
    const counts = new Array<number>(21).fill(0);
    for (let index = 0; index < 10_000; index += 1) {
      const value = rng.next();
      expect(value >= 0 && value < 1).toBe(true);
      counts[rng.int(21)]! += 1;
    }
    for (const count of counts) expect(count > 300 && count < 650).toBe(true);
  });

  it("randomSeed：4 个 32 位整数，每次都不一样", () => {
    const seeds = Array.from({ length: 50 }, () => randomSeed());
    for (const seed of seeds) {
      expect(seed).toHaveLength(4);
      for (const word of seed) expect(Number.isInteger(word) && word >= 0 && word < 2 ** 32).toBe(true);
    }
    expect(new Set(seeds.map((seed) => seed.join(","))).size).toBe(50);
  });
});

describe("对局里的随机数（I8）", () => {
  it("不传种子时用 crypto 生成 128 位种子；种子和状态只在服务器上", () => {
    const game = createGame(scenePlayers(3));
    expect(game.seed).toHaveLength(4);
    expect(game.rngState).toHaveLength(4);
    for (const viewer of ["p1", "p2", ""]) {
      const view = redactGameForViewer(game, viewer);
      expect("seed" in view || "rngState" in view).toBe(false);
    }
    expect(createGame(scenePlayers(3)).seed).not.toEqual(game.seed);
  });

  it("新一小局用注入的随机数洗牌：两个不同的注入结果不同；拿上一局的种子和状态（比玩家知道的还多）也算不出新一局的牌", () => {
    const ended = scene("round-end-showdown");
    const allReady = (rng: ReturnType<typeof createRng>) =>
      ended.players.reduce((state, player) => applyCommand(state, player.id, { type: "READY" }, rng), ended);
    const a = allReady(createRng(randomSeed()));
    const b = allReady(createRng(randomSeed()));
    expect(a.round).toBe(2);
    expect(dealOf(a)).not.toEqual(dealOf(b));
    // 假设攻击者知道上一局的全部（种子、随机数状态）：照着接着洗，和真的新一局不一样
    const guess = restoreRng(ended.rngState!).shuffle(FULL_DECK);
    expect(dealOf(a)).not.toEqual(guess);
    // 用到注入随机数的那一步记下了它的种子，能重放
    const entry = a.actions!.at(-1)!;
    expect(entry.seed).toHaveLength(4);
    expect(dealOf(a)).toEqual(createRng(entry.seed!).shuffle(FULL_DECK));
  });

  it("并列赢家里抽先手也用注入的随机数：注入不同的随机数，两个并列赢家都可能先手；同一个注入结果一样", () => {
    const starters = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      const rng = createRng(randomSeed());
      const ended = applyCommand(tutorialEndgame(), "p1", { type: "PLAY", card: "handmaid" }, rng);
      expect(ended.lastRound?.winners).toEqual(["p1", "p2"]);
      starters.add(ended.lastRound!.nextStarter!);
      const entry = ended.actions!.at(-1)!;
      expect(entry.seed).toEqual(rng.seed);
      const replay = applyCommand(tutorialEndgame(), "p1", { type: "PLAY", card: "handmaid" }, createRng(entry.seed!));
      expect(replay.lastRound?.nextStarter).toBe(ended.lastRound?.nextStarter);
    }
    expect([...starters].sort()).toEqual(["p1", "p2"]);
  });

  it("不注入时可复现：同一种子同一串命令，整场一模一样（教程、预览、测试靠这个）", () => {
    const play = () => {
      let game = createGame(TUTORIAL_PLAYERS, 20261009, { starter: 0, deal: TUTORIAL_DEAL });
      game = applyCommand(game, "p1", { type: "PLAY", card: "guard", target: "p2", guess: "baron" });
      return game;
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
    const first = createGame(scenePlayers(4), 99);
    const again = createGame(scenePlayers(4), 99);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    const ended = scene("round-end-showdown");
    const next = (state: GameState) => state.players.reduce((current, player) => ready(current, player.id), state);
    expect(JSON.stringify(next(ended))).toBe(JSON.stringify(next(scene("round-end-showdown"))));
  });
});
