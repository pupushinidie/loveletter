/**
 * 规则核对：规则书 §3 开局、§5 一局结束、§6 胜负、§7 人数差异；间谍 +1；先手规则；补充文件 3.5 相关用例；开工拍板。
 * 只按规则书、补充勘误、开工拍板和对外接口写（见 helpers.ts 开头）。
 */
import { describe, expect, it } from "vitest";
import {
  FULL_DECK,
  TOKENS_TO_WIN,
  createGame,
  createScene,
  defaultConfig,
  scenePlayers,
  timeoutTurn,
  type GameState,
  type Role,
} from "../../src/index.js";
import { P1, P2, P3, P4, act, allCards, cur, eventsOf, exact, pl, playCard, sorted } from "./helpers.js";

/** 所有人点「下一局」。 */
function readyAll(state: GameState, seed = 11): GameState {
  let s = state;
  for (const p of state.players) {
    if (s.phase !== "roundEnd") break;
    s = act(s, p.id, { type: "READY" }, seed).state;
  }
  return s;
}

describe("规则书§3 开局", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`TC2 / 补13 / 补充3.1 TC2：${n} 人局发牌（移出 1 张暗牌${n === 2 ? " + 3 张明牌" : ""}、每人 1 张、先手再抽 1 张），21 张守恒`, () => {
      const s = createGame(scenePlayers(n), 42);
      expect(s.phase).toBe("playing");
      expect(s.round).toBe(1);
      expect(s.faceUp.length).toBe(n === 2 ? 3 : 0);
      expect(s.setAside).toBeTruthy();
      expect(s.setAsideTaken).toBe(false);
      // 规则书 TC2：发完牌牌堆 21 − 1 − n（2 人再 − 3）；先手回合开始抽 1 张
      const afterDeal = 21 - 1 - n - (n === 2 ? 3 : 0);
      expect(s.deckCount).toBe(afterDeal - 1);
      expect(s.players.map((p) => p.handCount)).toEqual(s.players.map((_, i) => (i === s.current ? 2 : 1)));
      expect(s.players.every((p) => p.tokens === 0 && !p.out && !p.protected && !p.spy && p.discards.length === 0)).toBe(true);
      expect(allCards(s)).toEqual(sorted([...FULL_DECK]));
      expect(s.config.tokensToWin).toBe(TOKENS_TO_WIN[n]);
    });
  }
  it("规则书§3 / 补13：2 人局的 3 张明牌两个座位都看得到（公开字段 faceUp）", () => {
    const s = createGame(scenePlayers(2), 5);
    expect(s.faceUp).toHaveLength(3);
  });
  it("规则书§3：deal 指定发牌：先手拿到自己那张 + 牌堆顶", () => {
    const deck: Role[] = ["king", "spy", "guard", "guard", "guard", "guard", "guard", "priest", "baron", "baron", "handmaid", "handmaid", "prince", "chancellor", "chancellor", "countess", "princess"];
    const s = createGame(scenePlayers(3), 1, { starter: 1, deal: { setAside: "prince", hands: ["guard", "spy", "priest"], deck } });
    expect(cur(s)).toBe(P2);
    expect(sorted(pl(s, P2).hand)).toEqual(sorted(["spy", "king"]));
    expect(pl(s, P1).hand).toEqual(["guard"]);
    expect(s.deck).toEqual(deck.slice(1));
    expect(s.setAside).toBe("prince");
  });
  it("开工拍板 #4 / 规则书§3 第 5 步：第一局先手随机（换种子每个座位都会先手）", () => {
    for (const n of [3, 6]) {
      const starters = new Set<number>();
      for (let seed = 1; seed <= 120; seed += 1) starters.add(createGame(scenePlayers(n), seed).current);
      expect(starters.size, `${n} 人`).toBe(n);
    }
  });
  it("规则书§6：各人数的目标枚数写进 config（defaultConfig）", () => {
    for (const n of [2, 3, 4, 5, 6]) expect(defaultConfig(n).tokensToWin).toBe(TOKENS_TO_WIN[n]);
  });
});

describe("规则书§5 一局结束：牌堆耗尽比牌", () => {
  it("TC14：牌堆空后亮牌比点数，甲 女伯爵(8) 比乙 男爵(3) → 甲 +1；出局的人不参加", () => {
    const s = exact({ hands: [["handmaid", "countess"], ["baron"], []], out: [2], deck: [], setAside: "guard", discards: [[], [], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(r.state.phase).toBe("roundEnd");
    expect(r.state.lastRound).toMatchObject({ reason: "showdown", winners: [P1], awards: { [P1]: 1 }, hands: { [P1]: "countess", [P2]: "baron" }, spyBonus: null });
    expect(Object.keys(r.state.lastRound?.hands ?? {})).not.toContain(P3);
    expect(pl(r.state, P1).tokens).toBe(1);
    expect(pl(r.state, P2).tokens).toBe(0);
    expect(eventsOf(r.events, "RoundEnded")).toHaveLength(1);
  });
  it("TC14 / 开工拍板 #2：并列最高的两人各 +1，第三人不得分", () => {
    const s = exact(
      { players: 4, hands: [["handmaid", "chancellor"], ["chancellor"], ["guard"], []], out: [3], deck: [], setAside: "baron", discards: [[], [], [], []] },
      3,
    );
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect([...(r.state.lastRound?.winners ?? [])].sort()).toEqual([P1, P2]);
    expect(r.state.lastRound?.awards).toEqual({ [P1]: 1, [P2]: 1 });
    expect(pl(r.state, P1).tokens).toBe(1);
    expect(pl(r.state, P2).tokens).toBe(1);
    expect(pl(r.state, P3).tokens).toBe(0);
  });
  it("规则书§5：牌堆还剩 1 张时这一回合结束不比牌，下一位抽完最后一张、打完才比", () => {
    let s = exact({ hands: [["handmaid", "countess"], ["baron"], []], out: [2], deck: ["guard"], setAside: "priest", discards: [[], [], []] }, 2);
    s = playCard(s, P1, "handmaid");
    expect(s.phase).toBe("playing");
    expect(cur(s)).toBe(P2);
    expect(s.deckCount).toBe(0);
    // 甲受侍女保护，乙的卫兵没人可选 → 白打
    s = playCard(s, P2, "guard");
    expect(s.phase).toBe("roundEnd");
    expect(s.lastRound).toMatchObject({ reason: "showdown", winners: [P1] });
  });
  it("规则书§5：牌堆空时男爵淘汰一人，剩下两人照常比牌", () => {
    const s = exact({ players: 4, hands: [["baron", "king"], ["priest"], ["prince"], []], out: [3], deck: [], setAside: "guard", discards: [[], [], [], []] }, 3);
    const r = act(s, P1, { type: "PLAY", card: "baron", target: P2 });
    expect(pl(r.state, P2).out).toBe(true);
    expect(r.state.lastRound).toMatchObject({ reason: "showdown", winners: [P1], hands: { [P1]: "king", [P3]: "prince" } });
  });
  it("开工拍板（不用问的）：一小局结束亮出开局移出的暗牌", () => {
    const s = exact({ hands: [["handmaid", "countess"], ["baron"], []], out: [2], deck: [], setAside: "prince", discards: [[], [], []] }, 2);
    expect(act(s, P1, { type: "PLAY", card: "handmaid" }).state.lastRound?.setAside).toBe("prince");
  });
});

describe("规则书§5 一局结束：只剩一人", () => {
  it("TC15：其余全出局 → 最后一人立即 +1，不亮牌", () => {
    const s = exact({ hands: [["guard", "handmaid"], ["baron"], []], out: [2], deck: ["priest", "king"], setAside: "prince", discards: [[], [], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "baron" });
    expect(r.state.phase).toBe("roundEnd");
    expect(r.state.lastRound).toMatchObject({ reason: "lastStanding", winners: [P1], awards: { [P1]: 1 }, hands: {} });
    expect(r.state.deckCount).toBe(2); // 牌堆没抽完也立即结束
  });
  it("规则书§5：自己打出公主后只剩一人 → 对方立即赢", () => {
    const s = exact({ hands: [["princess", "guard"], ["baron"], []], out: [2], deck: ["priest"], setAside: "prince", discards: [[], [], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "princess" });
    expect(r.state.lastRound).toMatchObject({ reason: "lastStanding", winners: [P2] });
  });
  it("规则书§5：牌堆空时卫兵淘汰最后一个对手 → 只剩一人获胜", () => {
    const s = exact({ hands: [["guard", "spy"], ["baron"], []], out: [2], deck: [], setAside: "prince", discards: [[], [], ["princess"]] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "baron" });
    expect(r.state.lastRound?.winners).toEqual([P1]);
  });
});

describe("规则书§4.1 间谍 +1", () => {
  it("TC13：本局结束时在局的人里只有甲打过间谍、甲又赢了 → 甲这局拿 2 枚", () => {
    const s = exact({ hands: [["handmaid", "king"], ["baron"], []], out: [2], deck: [], setAside: "guard", discards: [["spy"], [], []] }, 2);
    expect(pl(s, P1).spy).toBe(true);
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(r.state.lastRound).toMatchObject({ winners: [P1], spyBonus: P1, awards: { [P1]: 2 } });
    expect(pl(r.state, P1).tokens).toBe(2);
  });
  it("TC13：甲乙都打过间谍 → 都拿不到间谍分", () => {
    const s = exact({ hands: [["handmaid", "king"], ["baron"], []], out: [2], deck: [], setAside: "guard", discards: [["spy"], ["spy"], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(r.state.lastRound).toMatchObject({ winners: [P1], spyBonus: null, awards: { [P1]: 1 } });
  });
  it("TC13：甲打出 2 张间谍也只 +1；间谍分不算赢这一局", () => {
    const s = exact({ hands: [["handmaid", "guard"], ["king"], []], out: [2], deck: [], setAside: "baron", discards: [["spy", "spy"], [], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(r.state.lastRound).toMatchObject({ winners: [P2], spyBonus: P1, awards: { [P1]: 1, [P2]: 1 } });
  });
  it("TC13：甲打过间谍但中途出局 → 不计入", () => {
    const s = exact({ hands: [[], ["handmaid", "king"], ["baron"]], out: [0], current: 1, deck: [], setAside: "guard", discards: [["spy"], [], []] }, 0);
    const r = act(s, P2, { type: "PLAY", card: "handmaid" });
    expect(r.state.lastRound).toMatchObject({ winners: [P2], spyBonus: null, awards: { [P2]: 1 } });
  });
  it("补2 / 开工拍板：出局者打过的间谍不挡别人：甲（间谍、出局）、乙（间谍、在局）、丙最大 → 丙 +1、乙 +1、甲 0", () => {
    const s = exact({ hands: [[], ["handmaid", "guard"], ["king"]], out: [0], current: 1, deck: [], setAside: "baron", discards: [["spy"], ["spy"], []] }, 0);
    const r = act(s, P2, { type: "PLAY", card: "handmaid" });
    expect(r.state.lastRound).toMatchObject({ winners: [P3], spyBonus: P2, awards: { [P3]: 1, [P2]: 1 } });
    expect(pl(r.state, P1).tokens).toBe(0);
  });
  it("补3：被王子弃掉的间谍算「弃过」：乙拿到间谍资格，结算时 +1", () => {
    const s = exact({ hands: [["prince", "guard"], ["spy"], []], out: [2], deck: [], setAside: "king", discards: [[], [], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "prince", target: P2 });
    expect(pl(r.state, P2).spy).toBe(true);
    expect(pl(r.state, P2).discards).toEqual([{ card: "spy", how: "discarded" }]);
    // 乙拿走移出的国王，比牌赢；间谍再 +1
    expect(r.state.lastRound).toMatchObject({ winners: [P2], spyBonus: P2, awards: { [P2]: 2 } });
  });
  it("补4：大臣把间谍放回牌堆底 → 没有间谍资格，间谍不进任何打出区", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["priest"]], deck: ["spy", "prince", "king"], discards: [[], [], []] });
    s = playCard(s, P1, "chancellor");
    s = act(s, P1, { type: "CHANCELLOR", keep: "guard", bottom: ["spy", "prince"] }).state;
    expect(pl(s, P1).spy).toBe(false);
    expect(s.players.flatMap((p) => p.discards.map((d) => d.card))).not.toContain("spy");
  });
  it("补5：2 人局明牌里有间谍、两人都没打过 → 没人拿间谍分", () => {
    const s = exact(
      { players: 2, hands: [["handmaid", "princess"], ["baron"]], deck: [], setAside: "guard", faceUp: ["spy", "spy", "priest"], discards: [[], []] },
      1,
    );
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(r.state.lastRound).toMatchObject({ winners: [P1], spyBonus: null, awards: { [P1]: 1 } });
    expect(pl(r.state, P1).spy || pl(r.state, P2).spy).toBe(false);
  });
  it("规则书§4.1 间谍：最后一回合才打出的间谍也算", () => {
    const s = exact({ hands: [["spy", "king"], ["baron"], []], out: [2], deck: [], setAside: "guard", discards: [[], [], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "spy" });
    expect(r.state.lastRound).toMatchObject({ winners: [P1], spyBonus: P1, awards: { [P1]: 2 } });
  });
  it("规则书§4.1 间谍：只剩一人结束时也算间谍分（无论谁赢、怎么赢）", () => {
    const s = exact({ hands: [["guard", "handmaid"], ["baron"], []], out: [2], deck: ["priest"], setAside: "king", discards: [["spy"], [], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "baron" });
    expect(r.state.lastRound).toMatchObject({ reason: "lastStanding", winners: [P1], spyBonus: P1, awards: { [P1]: 2 } });
  });
  it("规则书§4.1 间谍：间谍资格公开（补充3.3#3）且只有在局者打出 / 弃掉才有", () => {
    const s = playCard(createScene({ hands: [["spy", "guard"], ["baron"], ["priest"]], deck: ["king", "prince"] }), P1, "spy");
    expect(pl(s, P1).spy).toBe(true);
    expect(pl(s, P2).spy).toBe(false);
  });
});

describe("规则书§6 胜负和下一局", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const target = TOKENS_TO_WIN[n] ?? 0;
    it(`TC16 / 规则书§6：${n} 人局目标 ${target} 枚：差 1 枚的人再赢一局 → 整场结束；差 2 枚 → 只是一小局结束`, () => {
      const spec = (tokens: number) =>
        createScene({
          players: n,
          hands: [["guard", "handmaid"], ["baron"], ...Array.from({ length: n - 2 }, () => [] as Role[])],
          out: Array.from({ length: n - 2 }, (_, i) => i + 2),
          discards: [[], [], ...Array.from({ length: n - 2 }, () => [{ card: "guard" as const, how: "eliminated" as const }])],
          tokens: [tokens, 0],
        });
      const end = act(spec(target - 1), P1, { type: "PLAY", card: "guard", target: P2, guess: "baron" });
      expect(end.state.config.tokensToWin).toBe(target);
      expect(end.state.phase).toBe("finished");
      expect(end.state.winners).toEqual([P1]);
      expect(pl(end.state, P1).tokens).toBe(target);
      expect(eventsOf(end.events, "GameEnded")[0]).toMatchObject({ winners: [P1] });
      const notYet = act(spec(target - 2), P1, { type: "PLAY", card: "guard", target: P2, guess: "baron" });
      expect(notYet.state.phase).toBe("roundEnd");
      expect(notYet.state.winners).toBeUndefined();
    });
  }
  it("TC16：并列赢这一局、两人同时达标 → 一起赢整场", () => {
    const s = exact(
      { players: 4, hands: [["handmaid", "chancellor"], ["chancellor"], ["guard"], []], out: [3], deck: [], setAside: "baron", tokens: [3, 3, 3, 0], discards: [[], [], [], []] },
      3,
    );
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(r.state.phase).toBe("finished");
    expect([...(r.state.winners ?? [])].sort()).toEqual([P1, P2]);
  });
  it("补12 / 补充3.3#4：4 人局甲 3 枚、乙 3 枚，乙赢这一局、甲拿间谍分 → 甲乙都 4 枚，一起赢", () => {
    const s = exact(
      {
        players: 4,
        hands: [["handmaid", "priest"], ["king"], [], []],
        out: [2, 3],
        deck: [],
        setAside: "guard",
        tokens: [3, 3, 0, 0],
        discards: [["spy"], [], [], [{ card: "baron", how: "eliminated" }]],
      },
      2,
    );
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(r.state.lastRound).toMatchObject({ winners: [P2], spyBonus: P1 });
    expect(pl(r.state, P1).tokens).toBe(4);
    expect(pl(r.state, P2).tokens).toBe(4);
    expect(r.state.phase).toBe("finished");
    expect([...(r.state.winners ?? [])].sort()).toEqual([P1, P2]);
  });
  it("开工拍板 #5：赢 +1 和间谍 +1 一起让人达标 → 整场结束（3 人局 3 枚 → 5 枚）", () => {
    const s = exact({ hands: [["handmaid", "king"], ["baron"], []], out: [2], deck: [], setAside: "guard", tokens: [3, 0, 0], discards: [["spy"], [], []] }, 2);
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(pl(r.state, P1).tokens).toBe(5);
    expect(r.state.phase).toBe("finished");
    expect(r.state.winners).toEqual([P1]);
  });
  it("规则书§6：并列赢这一局但只有一人达标 → 只有他赢整场", () => {
    const s = exact(
      { players: 4, hands: [["handmaid", "chancellor"], ["chancellor"], ["guard"], []], out: [3], deck: [], setAside: "baron", tokens: [3, 1, 3, 0], discards: [[], [], [], []] },
      3,
    );
    const r = act(s, P1, { type: "PLAY", card: "handmaid" });
    expect(r.state.phase).toBe("finished");
    expect(r.state.winners).toEqual([P1]);
    expect(pl(r.state, P2).tokens).toBe(2);
  });
  it("开工拍板：钟情标记不设 13 枚上限（6 人局把目标调到 20，标记照样往上加）", () => {
    let s = createScene({
      players: 3,
      hands: [["guard", "handmaid"], ["baron"], []],
      out: [2],
      discards: [[], [], [{ card: "guard", how: "eliminated" }]],
      tokens: [13, 0, 0],
      config: { tokensToWin: 20 },
    });
    s = playCard(s, P1, "guard", P2, "baron");
    expect(pl(s, P1).tokens).toBe(14);
  });
  it("规则书§6 / 开工拍板 #4：下一局由上一局赢家先手（赢家不是 0 号座位也一样），新一局重新洗牌、清空出局和打出区、保留标记", () => {
    let s = exact({ hands: [["baron", "guard"], ["king"], []], out: [2], deck: ["priest", "spy"], setAside: "prince", discards: [[], [], []] }, 2);
    s = playCard(s, P1, "baron", P2); // 甲留卫兵比国王 → 甲出局，乙只剩一人赢
    expect(s.lastRound).toMatchObject({ reason: "lastStanding", winners: [P2], nextStarter: P2 });
    expect(s.phase).toBe("roundEnd");
    const before = s.round;
    s = readyAll(s);
    expect(s.phase).toBe("playing");
    expect(s.round).toBe(before + 1);
    expect(cur(s)).toBe(P2);
    expect(s.players.every((p) => !p.out && !p.protected && !p.spy && p.discards.length === 0)).toBe(true);
    expect(pl(s, P2).tokens).toBe(1);
    expect(s.players.map((p) => p.handCount)).toEqual([1, 2, 1]);
    expect(s.deckCount).toBe(21 - 1 - 3 - 1);
    expect(allCards(s)).toEqual(sorted([...FULL_DECK]));
  });
  it("规则书§6：结算画面要所有人都点「下一局」才开（只点了一部分还停在结算）", () => {
    let s = exact({ hands: [["guard", "handmaid"], ["baron"], []], out: [2], deck: ["priest"], setAside: "prince", discards: [[], [], []] }, 2);
    s = playCard(s, P1, "guard", P2, "baron");
    s = act(s, P1, { type: "READY" }).state;
    expect(s.phase).toBe("roundEnd");
    expect(s.ready).toContain(P1);
    s = act(s, P2, { type: "READY" }).state;
    expect(s.phase).toBe("roundEnd");
    s = act(s, P3, { type: "READY" }).state;
    expect(s.phase).toBe("playing");
  });
  it("规则书§6：结算画面超时（timeoutTurn）直接开下一局", () => {
    let s = exact({ hands: [["guard", "handmaid"], ["baron"], []], out: [2], deck: ["priest"], setAside: "prince", discards: [[], [], []] }, 2);
    s = playCard(s, P1, "guard", P2, "baron");
    s = timeoutTurn(s);
    expect(s.phase).toBe("playing");
    expect(s.round).toBe(2);
    expect(cur(s)).toBe(P1);
  });
  it("补11 / 勘误3.2#2 / 开工拍板 #4：乙丙平局 → 下一局先手只在乙丙之间随机（100 个种子两人都出现过，甲从不先手）", () => {
    const starters = new Set<string>();
    for (let seed = 1; seed <= 100; seed += 1) {
      const s = exact(
        { players: 4, hands: [["handmaid", "guard"], ["chancellor"], ["chancellor"], []], out: [3], deck: [], setAside: "baron", discards: [[], [], [], []] },
        3,
      );
      const r = act(s, P1, { type: "PLAY", card: "handmaid" }, seed);
      expect([...(r.state.lastRound?.winners ?? [])].sort()).toEqual([P2, P3]);
      const next = r.state.lastRound?.nextStarter ?? "";
      expect([P2, P3]).toContain(next);
      starters.add(next);
      const n = readyAll(r.state, seed);
      expect(cur(n)).toBe(next);
    }
    expect(starters).toEqual(new Set([P2, P3]));
    void P4;
  });
  it("规则书§6：整场结束后不能再出牌", () => {
    const s = createScene({ hands: [["guard", "handmaid"], ["baron"], []], out: [2], discards: [[], [], [{ card: "guard", how: "eliminated" }]], tokens: [4, 0, 0] });
    const end = playCard(s, P1, "guard", P2, "baron");
    expect(end.phase).toBe("finished");
    expect(() => act(end, P1, { type: "PLAY", card: "handmaid" })).toThrow();
  });
});
