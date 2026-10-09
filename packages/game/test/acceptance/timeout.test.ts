/**
 * 规则核对：超时（开工拍板 #6「每回合限时 30 秒，超时由人机替你走完这一回合，只算 1 次超时」；
 * 补充文件第四节、补17、补18；开工拍板「超时代打不替你打出公主」），以及随机整场的规则不变量。
 */
import { describe, expect, it } from "vitest";
import {
  FULL_DECK,
  createGame,
  createRng,
  createScene,
  legalActions,
  scenePlayers,
  timeoutTurn,
  timerKey,
  type GameCommand,
  type GameState,
  type Role,
} from "../../src/index.js";
import { P1, P2, P3, act, allCards, cur, eventsOf, pl, playCard, sorted } from "./helpers.js";

/** 超时后 history 里新增的事件。 */
function added(before: GameState, after: GameState) {
  if (after.round !== before.round) return after.history;
  return after.history.slice(before.history.length);
}

function timedOutCount(before: GameState, after: GameState): number {
  return added(before, after).filter((e) => e.type === "TurnTimedOut").length;
}

describe("开工拍板 #6 / 补充第四节：超时替人走完整个回合", () => {
  it("补17：手里公主 + 卫兵超时 → 打卫兵，不打公主；整个回合只有 1 条 TurnTimedOut，排在最前", () => {
    const s = createScene({ hands: [["princess", "guard"], ["baron"], ["priest"]], deck: ["spy", "king"] });
    const t = timeoutTurn(s);
    expect(pl(t, P1).out).toBe(false);
    expect(pl(t, P1).hand).toEqual(["princess"]);
    const ev = added(s, t);
    expect(ev[0]?.type).toBe("TurnTimedOut");
    expect(timedOutCount(s, t)).toBe(1);
    expect(eventsOf(ev, "Played")[0]).toMatchObject({ player: P1, card: "guard" });
    expect(eventsOf(ev, "Guessed")).toHaveLength(1); // 选人和猜牌一起走完
    expect(cur(t)).toBe(P2);
  });
  it("补18：女伯爵 + 王子超时 → 打女伯爵", () => {
    const t = timeoutTurn(createScene({ hands: [["countess", "prince"], ["baron"], ["priest"]], deck: ["spy", "king"] }));
    expect(pl(t, P1).hand).toEqual(["prince"]);
  });
  it("补充第四节#2：女伯爵 + 公主超时 → 打女伯爵，留公主", () => {
    const t = timeoutTurn(createScene({ hands: [["countess", "princess"], ["baron"], ["priest"]], deck: ["spy", "king"] }));
    expect(pl(t, P1).out).toBe(false);
    expect(pl(t, P1).hand).toEqual(["princess"]);
  });
  it("补充第四节#4：公主 + 王子超时、有对手可选 → 不出局（王子不选自己）", () => {
    const s = createScene({ hands: [["princess", "prince"], ["baron"], ["priest"]], deck: ["spy", "king", "guard"] });
    const t = timeoutTurn(s);
    expect(pl(t, P1).out).toBe(false);
    expect(pl(t, P1).hand).toEqual(["princess"]);
    const played = eventsOf(added(s, t), "Played")[0];
    expect(played).toMatchObject({ card: "prince" });
    expect(played?.target).not.toBe(P1);
  });
  it("开工拍板：公主配任何一张牌超时都不会替人打出公主（死局补9 除外）", () => {
    for (const other of ["spy", "guard", "priest", "baron", "handmaid", "prince", "chancellor", "king", "countess"] as Role[]) {
      const s = createScene({ hands: [["princess", other], ["baron"], ["priest"]], deck: ["guard", "spy", "handmaid"] });
      const t = timeoutTurn(s);
      expect(eventsOf(added(s, t), "Played").some((e) => e.player === P1 && e.card === "princess"), other).toBe(false);
      expect(eventsOf(added(s, t), "Eliminated").some((e) => e.player === P1 && (e.reason === "princess" || e.reason === "prince")), other).toBe(false);
    }
  });
  it("开工拍板 #6：打出大臣的回合超时，留牌也一起替他做完，只计 1 次", () => {
    const s = createScene({ hands: [["chancellor", "princess"], ["baron"], ["priest"]], deck: ["guard", "spy", "king", "handmaid"] });
    const t = timeoutTurn(s);
    expect(t.stage).toBe("play");
    expect(cur(t)).toBe(P2);
    expect(timedOutCount(s, t)).toBe(1);
    expect(pl(t, P1).hand.length).toBe(1);
    expect(pl(t, P1).out).toBe(false);
    expect(eventsOf(added(s, t), "ChancellorReturned")).toHaveLength(1);
    expect(allCards(t)).toEqual(sorted([...FULL_DECK]));
  });
  it("README 超时：打出大臣后的留牌步骤超时 → 替他留牌、放回，只计 1 次", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["priest"]], deck: ["countess", "spy", "king", "handmaid"] });
    s = playCard(s, P1, "chancellor");
    expect(s.stage).toBe("chancellor");
    const t = timeoutTurn(s);
    expect(cur(t)).toBe(P2);
    expect(timedOutCount(s, t)).toBe(1);
    expect(pl(t, P1).hand.length).toBe(1);
    expect(t.deckCount).toBe(s.deckCount + 2 - 1);
  });
  it("补10 + 超时：其余全被保护时超时的卫兵白打，回合照常结束", () => {
    const s = createScene({ hands: [["guard", "princess"], ["priest"], ["king"]], protected: [1, 2], discards: [[], ["handmaid"], ["handmaid"]], deck: ["spy", "baron"] });
    const t = timeoutTurn(s);
    expect(cur(t)).toBe(P2);
    expect(eventsOf(added(s, t), "NoEffect")).toHaveLength(1);
    expect(pl(t, P1).hand).toEqual(["princess"]);
  });
  it("开工拍板 #6 / guluga-bots 第 6 条：替人决定的函数只拿到这个座位裁剪后的视角", () => {
    const s = createScene({ hands: [["guard", "handmaid"], ["baron"], ["priest"]], deck: ["spy", "king"] });
    const seen: GameState[] = [];
    const t = timeoutTurn(s, (view, playerId) => {
      seen.push(view);
      expect(playerId).toBe(P1);
      return { type: "PLAY", card: "guard", target: P3, guess: "priest" };
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const v of seen) {
      expect(v.deck).toBeUndefined();
      expect(v.setAside).toBeUndefined();
      expect(v.seed).toBeUndefined();
      expect(pl(v, P2).hand).toEqual([]);
      expect(pl(v, P3).hand).toEqual([]);
      expect(sorted(pl(v, P1).hand)).toEqual(sorted(["guard", "handmaid"]));
    }
    expect(pl(t, P3).out).toBe(true); // 用了它给的命令
  });
  it("README timeoutTurn：替人决定的函数给了不合法的命令 → 退回固定动作，回合照样走完", () => {
    const s = createScene({ hands: [["princess", "guard"], ["baron"], ["priest"]], deck: ["spy", "king"] });
    const bad: GameCommand = { type: "PLAY", card: "guard", target: P2, guess: "guard" };
    const t = timeoutTurn(s, () => bad);
    expect(cur(t)).toBe(P2);
    expect(pl(t, P1).out).toBe(false);
    expect(timedOutCount(s, t)).toBe(1);
  });
  it("README 超时：计时 key 只在换人、换步骤时变", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["priest"]], deck: ["countess", "spy", "king", "handmaid"] });
    const k1 = timerKey(s);
    s = playCard(s, P1, "chancellor");
    const k2 = timerKey(s);
    expect(k2).not.toBe(k1);
    s = act(s, P1, { type: "CHANCELLOR", keep: "guard", bottom: ["countess", "spy"] }).state;
    const k3 = timerKey(s);
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });
});

describe("随机整场：规则不变量（2–6 人各 60 场，随机合法走法 + 随机超时）", () => {
  it("21 张守恒、出局的人被跳过、只在牌堆空或只剩一人时结束、标记照规则发、超时从不替人打公主", () => {
    const problems: string[] = [];
    const note = (x: string) => {
      if (problems.length < 20) problems.push(x);
    };
    for (const n of [2, 3, 4, 5, 6]) {
      for (let g = 0; g < 60; g += 1) {
        const pick = createRng(77 * n + g);
        let s = createGame(scenePlayers(n), 31 * n + g);
        for (let step = 0; step < 3000 && s.phase !== "finished"; step += 1) {
          const tag = `${n} 人 第 ${g} 场 第 ${step} 步`;
          const before = s;
          if (s.phase === "roundEnd") {
            s = timeoutTurn(s);
            if (s.phase === "playing" && s.round !== before.round + 1) note(`${tag}：开新一局后 round 不对`);
            if (s.phase === "playing" && before.lastRound && cur(s) !== before.lastRound.nextStarter) note(`${tag}：新一局先手不是上一局定的 nextStarter`);
            continue;
          }
          const actor = cur(s);
          if (pl(s, actor).out) note(`${tag}：轮到了出局的 ${actor}`);
          const viaTimeout = pick.int(4) === 0;
          if (viaTimeout) {
            const hadPrincess = pl(s, actor).hand.includes("princess");
            const others = s.players.filter((p) => p.id !== actor && !p.out && !p.protected).length;
            s = timeoutTurn(s);
            const ev = added(before, s);
            if (ev.filter((e) => e.type === "TurnTimedOut").length !== 1) note(`${tag}：一次超时记了 ${ev.filter((e) => e.type === "TurnTimedOut").length} 条 TurnTimedOut`);
            if (eventsOf(ev, "Played").some((e) => e.player === actor && e.card === "princess")) note(`${tag}：超时替 ${actor} 打出了公主`);
            const deadEnd = hadPrincess && others === 0 && pl(before, actor).hand.includes("prince");
            if (!deadEnd && eventsOf(ev, "Eliminated").some((e) => e.player === actor && e.by === actor && e.reason === "prince")) note(`${tag}：超时用王子选自己弃掉了公主`);
            if (s.phase === "playing" && actorOrNull(s) === actor && s.stage === "chancellor") note(`${tag}：超时后还停在 ${actor} 的大臣留牌`);
          } else {
            const moves = legalActions(s, actor);
            const move = moves[pick.int(moves.length)];
            if (!move) {
              note(`${tag}：${actor} 没有合法行动`);
              break;
            }
            s = act(s, actor, move, pick.int(1 << 30)).state;
          }
          if (s.round === before.round && allCardsOk(s) === false) note(`${tag}：牌数不守恒`);
          if (s.phase !== "playing") {
            const res = s.lastRound;
            if (!res) {
              note(`${tag}：结束了却没有 lastRound`);
              continue;
            }
            const aliveNow = s.players.filter((p) => !p.out);
            if (res.reason === "lastStanding" && aliveNow.length !== 1) note(`${tag}：只剩一人结束，但在局 ${aliveNow.length} 人`);
            if (res.reason === "showdown") {
              if (s.deckCount !== 0) note(`${tag}：牌堆还有 ${s.deckCount} 张就比牌了`);
              const best = Math.max(...aliveNow.map((p) => value(p.hand[0])));
              const expected = aliveNow.filter((p) => value(p.hand[0]) === best).map((p) => p.id).sort();
              if (JSON.stringify([...res.winners].sort()) !== JSON.stringify(expected)) note(`${tag}：比牌赢家 ${res.winners} 应为 ${expected}`);
            }
            const spies = s.players.filter((p) => !p.out && p.discards.some((d) => d.card === "spy" && d.how !== "eliminated"));
            const expectedSpy = spies.length === 1 ? (spies[0]?.id ?? null) : null;
            if (res.spyBonus !== expectedSpy) note(`${tag}：间谍分给了 ${res.spyBonus}，应为 ${expectedSpy}`);
            for (const p of s.players) {
              const want = (res.winners.includes(p.id) ? 1 : 0) + (res.spyBonus === p.id ? 1 : 0);
              const got = p.tokens - pl(before, p.id).tokens;
              if (got !== want) note(`${tag}：${p.id} 这局拿了 ${got} 枚，应为 ${want}`);
            }
            const target = s.config.tokensToWin;
            const reached = s.players.filter((p) => p.tokens >= target).map((p) => p.id).sort();
            if (reached.length > 0 && s.phase !== "finished") note(`${tag}：有人达标但没结束`);
            if (s.phase === "finished" && JSON.stringify([...(s.winners ?? [])].sort()) !== JSON.stringify(reached)) note(`${tag}：整场赢家 ${s.winners} 应为 ${reached}`);
          } else if (s.round === before.round) {
            if (s.deckCount === 0 && s.stage === "play" && cur(s) !== actor) {
              // 牌堆空了还轮到下一个人：只有刚抽走最后一张的人在出牌才合理
              if (pl(s, cur(s)).hand.length !== 2) note(`${tag}：牌堆空却没结束`);
            }
          }
        }
        if (s.phase !== "finished") note(`${n} 人 第 ${g} 场没打完`);
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);
});

function value(role: Role | undefined): number {
  const order: Role[] = ["spy", "guard", "priest", "baron", "handmaid", "prince", "chancellor", "king", "countess", "princess"];
  return role ? order.indexOf(role) : -1;
}

function actorOrNull(s: GameState): string | null {
  return s.phase === "playing" ? cur(s) : null;
}

function allCardsOk(s: GameState): boolean {
  return JSON.stringify(allCards(s)) === JSON.stringify(sorted([...FULL_DECK]));
}
