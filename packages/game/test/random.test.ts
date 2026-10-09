/**
 * 随机对局：2–6 人每种人数 300 整场，随机走合法行动（偶尔超时、偶尔用人机占位）直到有人攒够标记。
 * 每一步用普通代码查不变量，最后一次性 expect（每步都 expect 太慢）。
 */
import { describe, expect, it } from "vitest";
import { ROLE_VALUE } from "../src/cards.js";
import { botCommand } from "../src/bot.js";
import { applyCommand, createGame, legalActions, redactGameForViewer, timeoutTurn } from "../src/engine.js";
import { createRng } from "../src/rng.js";
import { scenePlayers } from "../src/scenes.js";
import type { GameEvent, GameState } from "../src/types.js";
import { conservationProblem } from "./helpers.js";

const GAMES_PER_COUNT = 300;
const MAX_STEPS = 4000;
const SERVER_ONLY = ["deck", "setAside", "seed", "rngState", "actions"] as const;

/** 某个视角能看到的私密字段对不对；不对返回问题。 */
function eventLeak(event: GameEvent, viewer: string, seeAll: boolean): string | null {
  const has = (key: string) => key in event;
  switch (event.type) {
    case "Drew":
    case "Peeked":
      if (has("card") && event.player !== viewer && !seeAll) return `${event.type} 的牌发给了 ${viewer || "观战"}`;
      return null;
    case "ChancellorDrew":
      if (has("cards") && event.player !== viewer && !seeAll) return `大臣抽的牌发给了 ${viewer || "观战"}`;
      return null;
    case "ChancellorReturned":
      if (has("cards") && event.player !== viewer) return `放回牌堆底的牌发给了 ${viewer || "观战"}`;
      return null;
    case "Compared":
      if ((has("playerCard") || has("targetCard")) && event.player !== viewer && event.target !== viewer && !seeAll) {
        return `男爵比牌的牌面发给了 ${viewer || "观战"}`;
      }
      return null;
    case "Swapped":
      if ((has("playerGot") || has("targetGot")) && event.player !== viewer && event.target !== viewer && !seeAll) {
        return `国王换牌的牌面发给了 ${viewer || "观战"}`;
      }
      return null;
    default:
      return null;
  }
}

/** 裁剪后的视角里有没有不该看到的东西。 */
function redactionProblem(state: GameState, viewer: string, seeAll: boolean): string | null {
  const view = redactGameForViewer(state, viewer, seeAll ? { seeAllHands: true } : {});
  for (const key of SERVER_ONLY) if (key in view) return `${viewer || "观战"} 拿到了 ${key}`;
  for (const player of view.players) {
    if (player.id !== viewer && !seeAll && player.hand.length > 0) return `${viewer || "观战"} 看到了 ${player.id} 的手牌`;
    if ((player.id === viewer || seeAll) && JSON.stringify(player.hand) !== JSON.stringify(state.players[player.seat]!.hand)) return "自己的手牌不对";
    if (player.handCount !== state.players[player.seat]!.hand.length) return "手牌张数不对";
  }
  for (const event of [...view.history, ...view.events]) {
    const leak = eventLeak(event, viewer, seeAll);
    if (leak) return leak;
  }
  return null;
}

/** 普通代码查一步之后的不变量。 */
function stateProblem(state: GameState): string | null {
  const conservation = conservationProblem(state);
  if (conservation) return `牌不守恒：${conservation}`;
  if (state.deckCount !== state.deck!.length) return "deckCount 不对";
  if (state.setAsideTaken !== (state.setAside === null)) return "setAsideTaken 不对";
  if (state.faceUp.length !== (state.players.length === 2 ? 3 : 0)) return "明牌张数不对";
  for (const player of state.players) {
    if (player.handCount !== player.hand.length) return "handCount 不对";
    if (player.spy !== player.discards.some((entry) => entry.card === "spy")) return "间谍资格和打出区对不上";
    if (player.tokens < 0) return "标记是负数";
    if (state.phase === "playing") {
      if (player.out) {
        if (player.hand.length !== 0) return "出局的人还有手牌";
        if (player.discards.length === 0) return "出局的人打出区是空的";
        if (player.protected) return "出局的人还受保护";
      } else {
        if (player.discards.some((entry) => entry.card === "princess")) return "在局的人弃过公主";
        const expected = player.seat === state.current ? (state.stage === "chancellor" ? [2, 3] : [2]) : [1];
        if (!expected.includes(player.hand.length)) return `${player.id} 手里 ${player.hand.length} 张`;
      }
    }
  }
  if (state.phase === "playing") {
    const actor = state.players[state.current]!;
    if (actor.out) return "轮到的人已经出局";
    if (actor.protected) return "轮到的人还受保护";
    if (state.players.filter((player) => !player.out).length < 2) return "只剩一人还没结算";
    if (legalActions(state, actor.id).length === 0) return "轮到的人没有合法行动（卡死）";
    const viewActions = legalActions(redactGameForViewer(state, actor.id), actor.id);
    if (JSON.stringify(viewActions) !== JSON.stringify(legalActions(state, actor.id))) return "裁剪视角算出的合法行动不一样";
  }
  if (state.phase === "roundEnd") {
    if (state.players.some((player) => !state.ready.includes(player.id) && legalActions(state, player.id).length === 0)) return "结算画面有人点不了下一局";
  }
  return null;
}

/** 一小局刚结算完：赢家、间谍、标记都按规则。 */
function roundEndProblem(before: GameState, after: GameState): string | null {
  const result = after.lastRound!;
  const alive = after.players.filter((player) => !player.out);
  if (result.reason === "lastStanding") {
    if (alive.length !== 1 || result.winners.join() !== alive[0]!.id) return "只剩一人的赢家不对";
    if (Object.keys(result.hands).length !== 0) return "只剩一人时不该亮牌";
  } else {
    if (after.deckCount !== 0) return "牌堆没空就亮牌";
    if (alive.length < 2) return "亮牌时只有一个人";
    const best = Math.max(...alive.map((player) => ROLE_VALUE[player.hand[0]!]));
    const winners = alive.filter((player) => ROLE_VALUE[player.hand[0]!] === best).map((player) => player.id);
    if (winners.join() !== result.winners.join()) return "亮牌赢家不对";
    for (const player of alive) if (result.hands[player.id] !== player.hand[0]) return "亮出的牌不对";
  }
  const spies = alive.filter((player) => player.spy).map((player) => player.id);
  if ((spies.length === 1 ? spies[0] : null) !== result.spyBonus) return "间谍 +1 不对";
  for (const player of after.players) {
    const gained = player.tokens - before.players[player.seat]!.tokens;
    const expected = (result.winners.includes(player.id) ? 1 : 0) + (result.spyBonus === player.id ? 1 : 0);
    if (gained !== expected || (result.awards[player.id] ?? 0) !== expected) return `${player.id} 拿到的标记不对`;
  }
  const champions = after.players.filter((player) => player.tokens >= after.config.tokensToWin).map((player) => player.id);
  if (champions.length > 0) {
    if (after.phase !== "finished" || after.winners?.join() !== champions.join()) return "该结束没结束";
  } else {
    if (after.phase !== "roundEnd") return "没人达标却结束了";
    const next = result.nextStarter;
    if (!next || !result.winners.includes(next)) return "下一局先手不是这局的赢家";
  }
  return null;
}

interface Summary {
  games: number;
  rounds: number;
  steps: number;
  timeouts: number;
  showdowns: number;
  ties: number;
  spyBonuses: number;
  coWinners: number;
  problems: string[];
}

function runGames(count: number): Summary {
  const summary: Summary = { games: 0, rounds: 0, steps: 0, timeouts: 0, showdowns: 0, ties: 0, spyBonuses: 0, coWinners: 0, problems: [] };
  for (let game = 0; game < GAMES_PER_COUNT; game += 1) {
    const seed = count * 100_000 + game;
    const policy = createRng(seed ^ 0x5bd1e995);
    let state = createGame(scenePlayers(count), seed);
    const problem = (text: string) => summary.problems.push(`${count} 人 种子 ${seed} 第 ${state.version} 步：${text}`);
    const initial = stateProblem(state);
    if (initial) problem(initial);
    let steps = 0;
    while (state.phase !== "finished") {
      steps += 1;
      if (steps > MAX_STEPS) {
        problem("步数超限（死循环？）");
        break;
      }
      const before = state;
      const snapshot = steps % 37 === 0 ? JSON.stringify(before) : null;
      try {
        if (state.phase === "roundEnd") {
          if (policy.next() < 0.2) {
            state = timeoutTurn(state);
          } else {
            for (const player of policy.shuffle(state.players)) state = applyCommand(state, player.id, { type: "READY" });
          }
        } else {
          const actor = state.players[state.current]!.id;
          const roll = policy.next();
          if (roll < 0.06) {
            state = timeoutTurn(state);
            summary.timeouts += 1;
            if (state.events[0]?.type !== "TurnTimedOut") problem("超时没有 TurnTimedOut");
          } else {
            const command = roll < 0.2
              ? botCommand(redactGameForViewer(state, actor), actor, () => policy.next())!
              : policy.pick(legalActions(state, actor));
            state = applyCommand(state, actor, command);
          }
        }
      } catch (error) {
        problem(`合法行动报错：${(error as Error).message}`);
        break;
      }
      if (snapshot !== null && JSON.stringify(before) !== snapshot) problem("apply 改了输入");
      if (state.version <= before.version) problem("version 没有前进");
      const issue = stateProblem(state);
      if (issue) {
        problem(issue);
        break;
      }
      if (before.phase === "playing" && state.phase !== "playing") {
        summary.rounds += 1;
        if (state.lastRound.reason === "showdown") summary.showdowns += 1;
        if (state.lastRound.winners.length > 1) summary.ties += 1;
        if (state.lastRound.spyBonus) summary.spyBonuses += 1;
        const roundIssue = roundEndProblem(before, state);
        if (roundIssue) {
          problem(roundIssue);
          break;
        }
      }
      // 随机挑一个视角查隐藏信息
      const viewers = ["", ...state.players.map((player) => player.id)];
      const viewer = policy.pick(viewers);
      const leak = redactionProblem(state, viewer, viewer === "" && policy.next() < 0.5);
      if (leak) {
        problem(`隐藏信息：${leak}`);
        break;
      }
    }
    summary.steps += steps;
    summary.games += 1;
    if (state.phase === "finished") {
      const champions = state.winners ?? [];
      if (champions.length === 0) problem("结束了没有赢家");
      if (champions.length > 1) summary.coWinners += 1;
      for (const player of state.players) {
        if (champions.includes(player.id) !== player.tokens >= state.config.tokensToWin) problem("赢家和标记数对不上");
      }
      const awarded = state.players.reduce((total, player) => total + player.tokens, 0);
      if (awarded < state.round) problem("每小局至少发 1 枚标记");
    }
  }
  return summary;
}

describe("随机对局：每种人数 300 整场", () => {
  for (const count of [2, 3, 4, 5, 6]) {
    it(`${count} 人局：配件守恒、分数按规则、回合正常推进、终局能判定、不卡死、隐藏信息不外泄`, () => {
      const summary = runGames(count);
      expect(summary.problems.slice(0, 5)).toEqual([]);
      expect(summary.games).toBe(GAMES_PER_COUNT);
      // 各种结局都真的出现过
      expect(summary.showdowns).toBeGreaterThan(0);
      expect(summary.rounds - summary.showdowns).toBeGreaterThan(0);
      expect(summary.ties).toBeGreaterThan(0);
      expect(summary.spyBonuses).toBeGreaterThan(0);
      expect(summary.timeouts).toBeGreaterThan(0);
      console.log(`${count} 人：${summary.games} 场、${summary.rounds} 小局、${summary.steps} 步；亮牌 ${summary.showdowns}、平局 ${summary.ties}、间谍 +1 ${summary.spyBonuses}、超时 ${summary.timeouts}、整场并列 ${summary.coWinners}`);
    }, 120_000);
  }
});
