/**
 * 规则书「测试用例」TC1–TC17（TC18 经典版不做）和补充文件的补充用例 补1–补18，逐条对应。
 * 甲乙丙丁 = 座位 p1 p2 p3 p4。局面用预览局面工厂 createScene 精确造出来。
 */
import { describe, expect, it } from "vitest";
import { FULL_DECK, ROLE_COUNT, ROLES, type Role } from "../src/cards.js";
import {
  applyCommand,
  createGame,
  legalActions,
  redactGameForViewer,
  timeoutTurn,
  unseenCounts,
} from "../src/engine.js";
import { createScene, scenePlayers } from "../src/scenes.js";
import type { GameCommand, GameState } from "../src/types.js";
import { P, conservationProblem, eventsOf, keep, play, ready } from "./helpers.js";

function lastEvent<T extends GameState["events"][number]["type"]>(state: GameState, type: T) {
  return eventsOf(state.events, type).at(-1);
}

function plays(state: GameState, player: string): GameCommand[] {
  return legalActions(state, player);
}

describe("规则书#TC1 牌数", () => {
  it("10 种角色、21 张，各角色张数和规则书一致", () => {
    expect(ROLES).toHaveLength(10);
    expect(ROLE_COUNT).toEqual({
      spy: 2, guard: 6, priest: 2, baron: 2, handmaid: 2, prince: 2, chancellor: 2, king: 1, countess: 1, princess: 1,
    });
    expect(FULL_DECK).toHaveLength(21);
  });
});

describe("规则书#TC2 开局", () => {
  it("3 人局：移出 1 张面朝下，每人 1 张，牌堆 21−1−3 = 17 张（先手接着抽 1 张）", () => {
    const game = createGame(scenePlayers(3), 11, { starter: 0 });
    expect(game.setAside).toBeTruthy();
    expect(game.faceUp).toEqual([]);
    expect(game.players.map((player) => player.handCount)).toEqual([2, 1, 1]);
    // 先手已经抽了 1 张：发牌后牌堆是 17
    expect(game.deckCount + 1).toBe(17);
    expect(conservationProblem(game)).toBeNull();
    expect(game.events.map((event) => event.type)).toEqual(["RoundStarted", "TurnStarted", "Drew"]);
  });

  it("补充勘误：其他人数发牌后的牌堆张数 2 人 15、4 人 16、5 人 15、6 人 14", () => {
    for (const [count, deck] of [[2, 15], [3, 17], [4, 16], [5, 15], [6, 14]] as const) {
      const game = createGame(scenePlayers(count), count * 7, { starter: 0 });
      expect(game.deckCount + 1).toBe(deck);
      expect(conservationProblem(game)).toBeNull();
    }
  });

  it("目标枚数：2→6、3→5、4→4、5→3、6→3", () => {
    expect([2, 3, 4, 5, 6].map((count) => createGame(scenePlayers(count), 1).config.tokensToWin)).toEqual([6, 5, 4, 3, 3]);
  });
});

describe("规则书#TC3 抽 1 打 1", () => {
  it("回合开始 1 张 → 抽成 2 张 → 打 1 张剩 1 张；打出的牌进打出区，效果照常结算", () => {
    const start = createScene({ hands: [["handmaid", "guard"], ["priest"], ["baron"]], deck: ["king"] });
    const next = play(start, "p1", "handmaid");
    expect(P(next, "p1").hand).toEqual(["guard"]);
    expect(P(next, "p1").discards).toEqual([{ card: "handmaid", how: "played" }]);
    expect(P(next, "p1").protected).toBe(true);
    // 轮到乙：他自动抽了牌堆顶的国王
    expect(next.players[next.current]!.id).toBe("p2");
    expect(P(next, "p2").hand).toEqual(["priest", "king"]);
    expect(conservationProblem(next)).toBeNull();
  });
});

describe("规则书#TC4 卫兵", () => {
  const start = () => createScene({ hands: [["guard", "priest"], ["baron"], ["king"]] });

  it("乙手里男爵，甲猜「男爵」→ 乙出局，亮出男爵", () => {
    const next = play(start(), "p1", "guard", "p2", "baron");
    expect(lastEvent(next, "Guessed")).toMatchObject({ player: "p1", target: "p2", guess: "baron", hit: true });
    expect(P(next, "p2").out).toBe(true);
    expect(lastEvent(next, "Eliminated")).toMatchObject({ player: "p2", reason: "guard", by: "p1", revealed: ["baron"] });
    expect(P(next, "p2").discards).toEqual([{ card: "baron", how: "eliminated" }]);
  });

  it("甲猜「公主」→ 什么都不发生", () => {
    const next = play(start(), "p1", "guard", "p2", "princess");
    expect(lastEvent(next, "Guessed")?.hit).toBe(false);
    expect(P(next, "p2").out).toBe(false);
    // 轮到乙，他手里还是男爵，再加刚抽的一张
    expect(P(next, "p2").hand[0]).toBe("baron");
  });

  it("甲猜「卫兵」→ 拒绝", () => {
    expect(() => play(start(), "p1", "guard", "p2", "guard")).toThrow("卫兵不能猜卫兵");
    expect(plays(start(), "p1").some((command) => command.type === "PLAY" && command.guess === "guard")).toBe(false);
  });

  it("间谍也能猜", () => {
    const next = play(createScene({ hands: [["guard", "priest"], ["spy"]] }), "p1", "guard", "p2", "spy");
    expect(P(next, "p2").out).toBe(true);
  });
});

describe("规则书#TC5 牧师", () => {
  it("甲看乙的牌：只有甲的视角里有牌面；乙、丙、观战都看不到，也不进公开日志", () => {
    const next = play(createScene({ hands: [["priest", "guard"], ["king"], ["baron"]] }), "p1", "priest", "p2");
    expect(lastEvent(next, "Peeked")).toEqual({ type: "Peeked", player: "p1", target: "p2", card: "king" });
    const mine = redactGameForViewer(next, "p1");
    expect(eventsOf(mine.history, "Peeked")[0]?.card).toBe("king");
    for (const viewer of ["p2", "p3", ""]) {
      const view = redactGameForViewer(next, viewer);
      expect(eventsOf(view.history, "Peeked")[0]).toEqual({ type: "Peeked", player: "p1", target: "p2" });
    }
    // 国王只有一张，在乙手里：丙的视角里任何地方都不该出现「king」
    expect(JSON.stringify(redactGameForViewer(next, "p3"))).not.toContain("king");
    expect(JSON.stringify(redactGameForViewer(next, ""))).not.toContain("king");
  });
});

describe("规则书#TC6 男爵比点数", () => {
  it("甲打男爵、手里剩男爵(3)，乙手里女伯爵(8) → 甲出局（比的是剩下那张）", () => {
    const next = play(createScene({ hands: [["baron", "baron"], ["countess"], ["guard"]] }), "p1", "baron", "p2");
    expect(lastEvent(next, "Compared")).toMatchObject({ player: "p1", target: "p2", loser: "p1", playerCard: "baron", targetCard: "countess" });
    expect(P(next, "p1").out).toBe(true);
    expect(P(next, "p2").out).toBe(false);
    expect(lastEvent(next, "Eliminated")).toMatchObject({ player: "p1", reason: "baron", revealed: ["baron"] });
  });

  it("赢家留着的牌对第三方保密，只公开谁输", () => {
    const next = play(createScene({ hands: [["baron", "king"], ["handmaid"], ["guard"]] }), "p1", "baron", "p2");
    expect(P(next, "p2").out).toBe(true);
    const third = eventsOf(redactGameForViewer(next, "p3").history, "Compared")[0]!;
    expect(third).toEqual({ type: "Compared", player: "p1", target: "p2", loser: "p2" });
    // 输家的牌随出局公开
    expect(eventsOf(redactGameForViewer(next, "p3").history, "Eliminated")[0]?.revealed).toEqual(["handmaid"]);
  });
});

describe("补充#补1 男爵平手（替换 TC6 后半）", () => {
  it("甲打男爵留牧师(2)，乙也是牧师 → 都不出局；甲乙互相看得到对方的牌，丙只看到平手", () => {
    const next = play(createScene({ hands: [["baron", "priest"], ["priest"], ["guard"]] }), "p1", "baron", "p2");
    expect(P(next, "p1").out || P(next, "p2").out).toBe(false);
    for (const viewer of ["p1", "p2"]) {
      expect(eventsOf(redactGameForViewer(next, viewer).history, "Compared")[0]).toMatchObject({
        loser: null, playerCard: "priest", targetCard: "priest",
      });
    }
    expect(eventsOf(redactGameForViewer(next, "p3").history, "Compared")[0]).toEqual({ type: "Compared", player: "p1", target: "p2", loser: null });
    // 两张牧师都在甲乙手里，丙的视角里不该有「priest」
    expect(JSON.stringify(redactGameForViewer(next, "p3"))).not.toContain("priest");
  });
});

describe("规则书#TC7 侍女保护", () => {
  it("甲打侍女 → 乙的卫兵、牧师、男爵、国王都不能选甲；保护持续到甲下一回合开始", () => {
    let game = createScene({ hands: [["handmaid", "guard"], ["guard"], ["priest"]], deck: ["king", "baron", "spy", "prince"] });
    game = play(game, "p1", "handmaid");
    expect(P(game, "p1").protected).toBe(true);
    // 乙手里卫兵 + 国王
    expect(P(game, "p2").hand).toEqual(["guard", "king"]);
    for (const card of ["guard", "king"] as const) {
      expect(plays(game, "p2").some((command) => command.type === "PLAY" && command.card === card && command.target === "p1")).toBe(false);
    }
    expect(() => play(game, "p2", "guard", "p1", "priest")).toThrow("受侍女保护");
    expect(() => play(game, "p2", "king", "p1")).toThrow("受侍女保护");
    game = play(game, "p2", "guard", "p3", "spy");
    // 丙手里牧师 + 男爵：也不能选甲
    expect(P(game, "p3").hand).toEqual(["priest", "baron"]);
    expect(() => play(game, "p3", "priest", "p1")).toThrow("受侍女保护");
    expect(() => play(game, "p3", "baron", "p1")).toThrow("受侍女保护");
    game = play(game, "p3", "priest", "p2");
    expect(P(game, "p1").protected).toBe(false);
    expect(lastEvent(game, "TurnStarted")).toEqual({ type: "TurnStarted", player: "p1", protectionEnded: true });
  });

  it("乙出王子时其余在局的人全被保护 → 只能选乙自己", () => {
    const game = createScene({ current: 1, hands: [["guard"], ["prince", "guard"], ["baron"]], protected: [0, 2], discards: [["handmaid"], [], ["handmaid"]] });
    const princes = plays(game, "p2").filter((command) => command.type === "PLAY" && command.card === "prince");
    expect(princes).toEqual([{ type: "PLAY", card: "prince", target: "p2" }]);
    expect(() => play(game, "p2", "prince", "p1")).toThrow("受侍女保护");
    const next = play(game, "p2", "prince", "p2");
    expect(lastEvent(next, "Discarded")).toMatchObject({ player: "p2", card: "guard", by: "p2" });
  });
});

describe("规则书#TC8 王子", () => {
  it("甲出王子选乙 → 乙弃牌（不发动效果）并重抽 1 张", () => {
    const next = play(createScene({ hands: [["prince", "guard"], ["baron"], ["king"]], deck: ["handmaid", "spy"] }), "p1", "prince", "p2");
    expect(lastEvent(next, "Discarded")).toEqual({ type: "Discarded", player: "p2", card: "baron", by: "p1" });
    expect(eventsOf(next.events, "Compared")).toEqual([]);
    expect(P(next, "p2").discards).toEqual([{ card: "baron", how: "discarded" }]);
    const redraw = eventsOf(next.events, "Drew").find((event) => event.reason === "prince")!;
    expect(redraw).toMatchObject({ player: "p2", source: "deck", card: "handmaid" });
    // 接着轮到乙，他又抽了间谍
    expect(P(next, "p2").hand).toEqual(["handmaid", "spy"]);
  });

  it("乙被弃掉的是公主 → 乙出局，不再抽牌", () => {
    const next = play(createScene({ hands: [["prince", "guard"], ["princess"], ["king"]] }), "p1", "prince", "p2");
    expect(P(next, "p2").out).toBe(true);
    expect(lastEvent(next, "Eliminated")).toMatchObject({ player: "p2", reason: "prince", by: "p1", revealed: [] });
    expect(eventsOf(next.events, "Drew").some((event) => event.player === "p2")).toBe(false);
    expect(P(next, "p2").handCount).toBe(0);
  });

  it("牌堆空时王子选丙 → 丙拿走面朝下移出的那张", () => {
    const start = createScene({
      players: 4,
      hands: [["prince", "guard"], ["baron"], ["priest"]],
      out: [3],
      deck: [],
      setAside: "king",
      leftovers: "discards",
    });
    const next = play(start, "p1", "prince", "p3");
    const redraw = eventsOf(next.events, "Drew").find((event) => event.reason === "prince")!;
    expect(redraw).toMatchObject({ player: "p3", source: "setAside", card: "king" });
    expect(next.setAsideTaken).toBe(true);
    expect(next.setAside).toBeNull();
    // 这一回合结束牌堆是空的 → 亮牌，丙的国王最大
    expect(next.phase).toBe("roundEnd");
    expect(next.lastRound).toMatchObject({ reason: "showdown", winners: ["p3"], hands: { p1: "guard", p2: "baron", p3: "king" }, setAside: null });
    expect(conservationProblem(next)).toBeNull();
  });

  it("王子可以选自己：弃掉自己另一张牌重抽", () => {
    const next = play(createScene({ hands: [["prince", "guard"], ["baron"], ["king"]], deck: ["countess"] }), "p1", "prince", "p1");
    expect(P(next, "p1").hand).toEqual(["countess"]);
    expect(P(next, "p1").discards).toEqual([{ card: "prince", how: "played" }, { card: "guard", how: "discarded" }]);
  });

  it("王子不能选出局的人", () => {
    const game = createScene({ hands: [["prince", "guard"], [], ["king"]], out: [1], discards: [[], [{ card: "baron", how: "eliminated" }]] });
    expect(() => play(game, "p1", "prince", "p2")).toThrow("出局");
  });
});

describe("规则书#TC9 大臣", () => {
  it("抽 2 张成 3 张 → 留 1 张，另外 2 张按指定顺序放到牌堆底（数组最后一个在最底下）", () => {
    let game = createScene({ hands: [["chancellor", "guard"], ["priest"], ["baron"]], deck: ["princess", "baron", "king", "spy"], leftovers: "discards" });
    game = play(game, "p1", "chancellor");
    expect(game.stage).toBe("chancellor");
    expect(game.players[game.current]!.id).toBe("p1");
    expect(P(game, "p1").hand).toEqual(["guard", "princess", "baron"]);
    expect(lastEvent(game, "ChancellorDrew")).toEqual({ type: "ChancellorDrew", player: "p1", count: 2, cards: ["princess", "baron"] });
    expect(game.deckCount).toBe(2);
    game = keep(game, "p1", "princess", ["baron", "guard"]);
    expect(P(game, "p1").hand).toEqual(["princess"]);
    expect(lastEvent(game, "ChancellorReturned")).toEqual({ type: "ChancellorReturned", player: "p1", count: 2, cards: ["baron", "guard"] });
    // 乙抽走了国王，牌堆是 间谍、男爵、卫兵（卫兵在最底下）
    expect(game.deck).toEqual(["spy", "baron", "guard"]);
  });

  it("留牌必须正好是手里的牌", () => {
    const game = play(createScene({ hands: [["chancellor", "guard"]], deck: ["princess", "baron"] }), "p1", "chancellor");
    expect(() => keep(game, "p1", "king", ["baron", "guard"])).toThrow("正好是你手里");
    expect(() => keep(game, "p1", "princess", ["baron"])).toThrow("正好是你手里");
    expect(() => keep(game, "p1", "princess", ["baron", "guard", "guard"])).toThrow("正好是你手里");
    expect(() => play(game, "p1", "guard", "p2", "baron")).toThrow("大臣");
  });

  it("牌堆剩 1 张：抽它，再放回 1 张", () => {
    let game = createScene({ hands: [["chancellor", "guard"]], deck: ["handmaid"], leftovers: "discards" });
    game = play(game, "p1", "chancellor");
    expect(P(game, "p1").hand).toEqual(["guard", "handmaid"]);
    expect(legalActions(game, "p1")).toEqual([
      { type: "CHANCELLOR", keep: "guard", bottom: ["handmaid"] },
      { type: "CHANCELLOR", keep: "handmaid", bottom: ["guard"] },
    ]);
    game = keep(game, "p1", "handmaid", ["guard"]);
    expect(game.phase).toBe("playing");
    expect(P(game, "p2").hand.at(-1)).toBe("guard");
  });

  it("牌堆空：白打", () => {
    const next = play(createScene({ hands: [["chancellor", "guard"], ["priest"]], deck: [], leftovers: "discards" }), "p1", "chancellor");
    expect(lastEvent(next, "NoEffect")).toEqual({ type: "NoEffect", player: "p1", card: "chancellor", reason: "emptyDeck" });
    expect(next.stage).toBe("play");
    expect(P(next, "p1").hand).toEqual(["guard"]);
  });

  it("大臣抽牌时手里同时有女伯爵和国王，不触发女伯爵强制，可以留国王", () => {
    let game = createScene({ hands: [["chancellor", "countess"]], deck: ["king", "guard"] });
    game = play(game, "p1", "chancellor");
    expect(P(game, "p1").hand).toEqual(["countess", "king", "guard"]);
    game = keep(game, "p1", "king", ["countess", "guard"]);
    expect(P(game, "p1").hand).toEqual(["king"]);
  });
});

describe("规则书#TC10 国王", () => {
  it("甲出国王选乙 → 双方手牌互换，两人都知道对方拿到了什么，丙不知道", () => {
    const next = play(createScene({ hands: [["king", "guard"], ["countess"], ["baron"]] }), "p1", "king", "p2");
    expect(P(next, "p1").hand).toEqual(["countess"]);
    expect(P(next, "p2").hand.slice(0, 1)).toEqual(["guard"]);
    expect(lastEvent(next, "Swapped")).toEqual({ type: "Swapped", player: "p1", target: "p2", playerGot: "countess", targetGot: "guard" });
    expect(eventsOf(redactGameForViewer(next, "p2").history, "Swapped")[0]).toMatchObject({ playerGot: "countess", targetGot: "guard" });
    expect(eventsOf(redactGameForViewer(next, "p3").history, "Swapped")[0]).toEqual({ type: "Swapped", player: "p1", target: "p2" });
  });

  it("乙受侍女保护 → 不能选乙", () => {
    const game = createScene({ hands: [["king", "guard"], ["countess"], ["baron"]], protected: [1], discards: [[], ["handmaid"]] });
    expect(() => play(game, "p1", "king", "p2")).toThrow("受侍女保护");
    expect(plays(game, "p1").filter((command) => command.type === "PLAY" && command.card === "king")).toEqual([{ type: "PLAY", card: "king", target: "p3" }]);
  });
});

describe("规则书#TC11 女伯爵", () => {
  it("女伯爵 + 国王 → 只能打女伯爵", () => {
    const game = createScene({ hands: [["countess", "king"]] });
    expect(() => play(game, "p1", "king", "p2")).toThrow("必须打出女伯爵");
    expect(plays(game, "p1")).toEqual([{ type: "PLAY", card: "countess" }]);
    const next = play(game, "p1", "countess");
    // 打女伯爵不亮另一张：公开事件里没有国王
    expect(JSON.stringify(redactGameForViewer(next, "p2"))).not.toContain("king");
  });

  it("女伯爵 + 卫兵 → 自由选择", () => {
    const game = createScene({ hands: [["countess", "guard"]] });
    const cards = new Set(plays(game, "p1").map((command) => (command.type === "PLAY" ? command.card : "")));
    expect([...cards].sort()).toEqual(["countess", "guard"]);
  });

  it("女伯爵 + 王子 → 只能打女伯爵", () => {
    const game = createScene({ hands: [["prince", "countess"]] });
    expect(() => play(game, "p1", "prince", "p2")).toThrow("必须打出女伯爵");
    expect(plays(game, "p1")).toEqual([{ type: "PLAY", card: "countess" }]);
  });
});

describe("规则书#TC12 公主", () => {
  it("甲主动打公主 → 立即出局，另一张亮出弃掉", () => {
    const next = play(createScene({ hands: [["princess", "guard"]] }), "p1", "princess");
    expect(P(next, "p1").out).toBe(true);
    expect(lastEvent(next, "Eliminated")).toMatchObject({ player: "p1", reason: "princess", by: "p1", revealed: ["guard"] });
  });

  it("甲被王子强制弃掉公主 → 出局", () => {
    const next = play(createScene({ current: 1, hands: [["princess"], ["prince", "guard"]] }), "p2", "prince", "p1");
    expect(P(next, "p1").out).toBe(true);
  });

  it("公主因出局被弃掉时不额外结算（卫兵猜中公主：只出局一次，回合照常往下走）", () => {
    const next = play(createScene({ hands: [["guard", "baron"], ["princess"], ["king"]] }), "p1", "guard", "p2", "princess");
    expect(eventsOf(next.events, "Eliminated")).toHaveLength(1);
    expect(P(next, "p2").discards).toEqual([{ card: "princess", how: "eliminated" }]);
    expect(next.players[next.current]!.id).toBe("p3");
  });
});

/** 让当前玩家打侍女结束这一回合（牌堆空 → 亮牌）。 */
function endByHandmaid(spec: Parameters<typeof createScene>[0]): GameState {
  const game = createScene({ deck: [], leftovers: "discards", ...spec });
  return play(game, game.players[game.current]!.id, "handmaid");
}

describe("规则书#TC13 间谍", () => {
  it("只有甲一个在局的人打过间谍 → 甲 +1；胜者照常 +1，胜者就是甲时共 +2", () => {
    const bonus = endByHandmaid({ hands: [["handmaid", "guard"], ["king"]], discards: [["spy"], []], out: [2] });
    expect(bonus.lastRound).toMatchObject({ winners: ["p2"], spyBonus: "p1", awards: { p1: 1, p2: 1 } });
    const both = endByHandmaid({ hands: [["handmaid", "king"], ["guard"]], discards: [["spy"], []], out: [2] });
    expect(both.lastRound).toMatchObject({ winners: ["p1"], spyBonus: "p1", awards: { p1: 2 } });
    expect(P(both, "p1").tokens).toBe(2);
  });

  it("甲乙都打过间谍（都在局）→ 都拿不到间谍 +1", () => {
    const game = endByHandmaid({ hands: [["handmaid", "guard"], ["king"]], discards: [["spy"], ["spy"]], out: [2] });
    expect(game.lastRound?.spyBonus).toBeNull();
    expect(game.lastRound?.awards).toEqual({ p2: 1 });
  });

  it("甲打出 2 张间谍 → 仍只 +1", () => {
    const game = endByHandmaid({ hands: [["handmaid", "guard"], ["king"]], discards: [["spy", "spy"], []], out: [2] });
    expect(game.lastRound?.awards).toEqual({ p1: 1, p2: 1 });
  });

  it("甲打过间谍但中途出局 → 不计入", () => {
    const game = endByHandmaid({
      current: 1,
      hands: [[], ["handmaid", "guard"], ["king"]],
      discards: [["spy", { card: "baron", how: "eliminated" }]],
      out: [0],
      setAside: "spy",
    });
    expect(game.lastRound?.spyBonus).toBeNull();
  });
});

describe("规则书#TC14 一局结束·牌堆耗尽", () => {
  it("亮牌比点数：甲 8、乙 3 → 甲 +1", () => {
    const game = endByHandmaid({ hands: [["handmaid", "countess"], ["baron"]], out: [2] });
    expect(game.lastRound).toMatchObject({ reason: "showdown", winners: ["p1"], hands: { p1: "countess", p2: "baron" } });
    expect(P(game, "p1").tokens).toBe(1);
    expect(P(game, "p2").tokens).toBe(0);
  });

  it("两人并列最高（各一张大臣 6）→ 都 +1", () => {
    const game = endByHandmaid({ hands: [["handmaid", "chancellor"], ["chancellor"]], out: [2] });
    expect(game.lastRound?.winners).toEqual(["p1", "p2"]);
    expect([P(game, "p1").tokens, P(game, "p2").tokens]).toEqual([1, 1]);
  });

  it("结算时亮出开局面朝下移出的那张", () => {
    const game = endByHandmaid({ hands: [["handmaid", "chancellor"], ["guard"]], setAside: "king", out: [2] });
    expect(game.lastRound?.setAside).toBe("king");
    expect(redactGameForViewer(game, "p2").lastRound?.setAside).toBe("king");
  });

  it("出局的人不参加亮牌", () => {
    const game = endByHandmaid({ hands: [["handmaid", "guard"], ["baron"]], out: [2], discards: [[], [], [{ card: "princess", how: "eliminated" }]] });
    expect(Object.keys(game.lastRound!.hands).sort()).toEqual(["p1", "p2"]);
    expect(game.lastRound?.winners).toEqual(["p2"]);
  });
});

describe("规则书#TC15 一局结束·只剩一人", () => {
  it("其余全出局 → 最后一人立即 +1，不亮牌（牌堆还有牌也立刻结束）", () => {
    const game = createScene({ hands: [["guard", "king"], ["baron"]], out: [2], discards: [[], [], [{ card: "priest", how: "eliminated" }]] });
    const next = play(game, "p1", "guard", "p2", "baron");
    expect(next.phase).toBe("roundEnd");
    expect(next.deckCount).toBeGreaterThan(0);
    expect(next.lastRound).toMatchObject({ reason: "lastStanding", winners: ["p1"], hands: {}, awards: { p1: 1 } });
    // 赢家的牌不公开
    expect(redactGameForViewer(next, "p2").players[0]!.hand).toEqual([]);
  });

  it("自己打公主出局、只剩一个对手 → 对手立即赢", () => {
    const next = play(createScene({ players: 2, hands: [["princess", "guard"], ["baron"]] }), "p1", "princess");
    expect(next.lastRound).toMatchObject({ reason: "lastStanding", winners: ["p2"] });
  });
});

describe("规则书#TC16 胜负", () => {
  it("3 人局甲已有 4 枚、本局再胜 → 5 枚 → 整场结束，甲胜", () => {
    const game = endByHandmaid({ hands: [["handmaid", "countess"], ["baron"]], out: [2], tokens: [4, 2, 1] });
    expect(game.phase).toBe("finished");
    expect(game.winners).toEqual(["p1"]);
    expect(lastEvent(game, "GameEnded")).toEqual({ type: "GameEnded", winners: ["p1"] });
    expect(legalActions(game, "p1")).toEqual([]);
    expect(() => ready(game, "p1")).toThrow("结束");
  });

  it("5 人局目标 3 枚", () => {
    const game = endByHandmaid({ players: 5, hands: [["handmaid", "countess"], ["baron"]], out: [2, 3, 4], tokens: [2, 2, 0, 0, 0] });
    expect(game.config.tokensToWin).toBe(3);
    expect(game.winners).toEqual(["p1"]);
  });

  it("平局双方同时达标 → 并列获胜", () => {
    const game = endByHandmaid({ hands: [["handmaid", "chancellor"], ["chancellor"]], out: [2], tokens: [4, 4, 0] });
    expect(game.phase).toBe("finished");
    expect(game.winners).toEqual(["p1", "p2"]);
  });

  it("钟情标记不按 13 枚封顶", () => {
    const game = endByHandmaid({ hands: [["handmaid", "countess"], ["baron"]], out: [2], tokens: [13, 0, 0], config: { tokensToWin: 99 } });
    expect(P(game, "p1").tokens).toBe(14);
  });
});

describe("规则书#TC17 校验", () => {
  const game = () => createScene({ hands: [["guard", "priest"], ["baron"], ["king"]], protected: [2], discards: [[], [], ["handmaid"]] });

  it("非当前玩家 play → 拒绝", () => {
    expect(() => play(game(), "p2", "baron", "p1")).toThrow("还没轮到你");
  });
  it("打不在手里的牌 → 拒绝", () => {
    expect(() => play(game(), "p1", "king", "p2")).toThrow("你手里没有这张牌");
  });
  it("卫兵猜「卫兵」→ 拒绝", () => {
    expect(() => play(game(), "p1", "guard", "p2", "guard")).toThrow("卫兵不能猜卫兵");
  });
  it("选受侍女保护的玩家为目标 → 拒绝", () => {
    expect(() => play(game(), "p1", "guard", "p3", "king")).toThrow("受侍女保护");
  });
  it("出局玩家发任何命令 → 拒绝", () => {
    const out = createScene({ current: 1, hands: [[], ["guard", "priest"], ["king"]], out: [0], discards: [[{ card: "baron", how: "eliminated" }]] });
    expect(() => play(out, "p1", "guard", "p2", "king")).toThrow();
    expect(() => keep(out, "p1", "guard", [])).toThrow();
    expect(() => ready(out, "p1")).toThrow();
    expect(legalActions(out, "p1")).toEqual([]);
    // 也不能被选
    expect(() => play(out, "p2", "guard", "p1", "king")).toThrow("出局");
  });
  it("其他不合法的命令：缺目标、多余的目标和猜牌、选自己、未知命令、不在局里的人", () => {
    expect(() => play(game(), "p1", "guard")).toThrow("要选一名玩家");
    expect(() => play(game(), "p1", "guard", "p2")).toThrow("卫兵要猜一个角色");
    expect(() => play(game(), "p1", "priest", "p2", "king")).toThrow("只有卫兵要猜");
    expect(() => play(game(), "p1", "guard", "p1", "king")).toThrow("不能选自己");
    expect(() => applyCommand(game(), "p1", { type: "ROLL" } as unknown as GameCommand)).toThrow("未知的行动");
    expect(() => play(game(), "p9", "guard", "p2", "king")).toThrow("你不在这局里");
    const handmaid = createScene({ hands: [["handmaid", "guard"]] });
    expect(() => play(handmaid, "p1", "handmaid", "p2")).toThrow("不用选人");
    expect(() => ready(game(), "p1")).toThrow("还没结束");
  });
  it("裁剪过的状态不能推进", () => {
    expect(() => play(redactGameForViewer(game(), "p1"), "p1", "guard", "p2", "king")).toThrow("裁剪");
  });
});

describe("补充#补2 间谍：出局者的间谍不挡别人", () => {
  it("甲打过间谍后出局，乙打过间谍在局，丙最大 → 丙 +1（赢），乙 +1（间谍），甲 0", () => {
    const game = endByHandmaid({
      current: 2,
      hands: [[], ["guard"], ["handmaid", "king"]],
      discards: [["spy", { card: "baron", how: "eliminated" }], ["spy"], []],
      out: [0],
    });
    expect(game.lastRound).toMatchObject({ winners: ["p3"], spyBonus: "p2", awards: { p3: 1, p2: 1 } });
    expect(P(game, "p1").tokens).toBe(0);
  });
});

describe("补充#补3 被王子弃掉的间谍算「弃过」", () => {
  it("乙手里间谍，甲打王子选乙 → 乙弃间谍（公开）重抽，有间谍资格；结算时乙 +1", () => {
    const game = createScene({ hands: [["prince", "guard"], ["spy"]], out: [2], deck: ["handmaid"], leftovers: "discards", setAside: "spy" });
    const next = play(game, "p1", "prince", "p2");
    expect(P(next, "p2").spy).toBe(true);
    expect(P(next, "p2").discards.at(-1)).toEqual({ card: "spy", how: "discarded" });
    // 王子让乙抽走最后一张，回合结束牌堆空 → 亮牌
    expect(next.lastRound).toMatchObject({ winners: ["p2"], spyBonus: "p2", awards: { p2: 2 } });
  });
});

describe("补充#补4 大臣放回牌堆底的间谍不算", () => {
  it("甲打大臣，留卫兵，把间谍、王子放底 → 甲没有间谍资格，间谍不进任何人的打出区", () => {
    let game = createScene({ hands: [["chancellor", "guard"]], deck: ["spy", "prince"] });
    game = keep(play(game, "p1", "chancellor"), "p1", "guard", ["spy", "prince"]);
    expect(P(game, "p1").spy).toBe(false);
    expect(game.players.some((player) => player.discards.some((entry) => entry.card === "spy"))).toBe(false);
  });
});

describe("补充#补5 2 人局明牌里的间谍不算任何人的", () => {
  it("面朝上的 3 张里有间谍，两人都没打过间谍 → 没人拿间谍分", () => {
    const game = endByHandmaid({ players: 2, hands: [["handmaid", "king"], ["princess"]], faceUp: ["spy", "baron", "guard"], setAside: "spy" });
    expect(game.players.every((player) => !player.spy)).toBe(true);
    expect(game.lastRound).toMatchObject({ winners: ["p2"], spyBonus: null });
  });
});

describe("补充#补6 大臣在牌堆剩 1 张", () => {
  it("甲打大臣抽到公主、留卫兵、公主放回 → 甲不出局，牌堆仍 1 张，不比牌，下一位抽到公主", () => {
    let game = createScene({ hands: [["chancellor", "guard"]], deck: ["princess"], leftovers: "discards", setAside: "spy" });
    game = play(game, "p1", "chancellor");
    game = keep(game, "p1", "guard", ["princess"]);
    expect(P(game, "p1").out).toBe(false);
    expect(eventsOf(game.events, "RoundEnded")).toEqual([]);
    expect(game.phase).toBe("playing");
    expect(P(game, "p2").hand.at(-1)).toBe("princess");
    expect(game.deckCount).toBe(0);
  });
});

describe("补充#补7 大臣在牌堆 0 张", () => {
  it("甲抽走最后一张后打大臣 → 白打，不进留牌，这一回合结束马上比牌", () => {
    const next = play(createScene({ hands: [["chancellor", "priest"], ["guard"]], deck: [], leftovers: "discards", out: [2] }), "p1", "chancellor");
    expect(eventsOf(next.events, "NoEffect")).toHaveLength(1);
    expect(next.phase).toBe("roundEnd");
    expect(next.lastRound).toMatchObject({ reason: "showdown", winners: ["p1"] });
  });
});

function twoPlayerPrinceAtEmptyDeck(): GameState {
  return createScene({
    players: 2,
    hands: [["prince", "handmaid"], ["priest"]],
    faceUp: ["princess", "baron", "guard"],
    setAside: "king",
    deck: [],
    leftovers: "discards",
  });
}

describe("补充#补8 牌堆空时王子抽面朝下的牌，不抽明牌", () => {
  it("2 人局：乙弃牧师，抽到移出的国王；明牌 3 张不动；比牌乙国王(7) 赢甲侍女(4)", () => {
    const next = play(twoPlayerPrinceAtEmptyDeck(), "p1", "prince", "p2");
    expect(next.faceUp).toEqual(["princess", "baron", "guard"]);
    expect(eventsOf(next.events, "Drew").find((event) => event.reason === "prince")).toMatchObject({ player: "p2", source: "setAside", card: "king" });
    expect(next.lastRound).toMatchObject({ reason: "showdown", winners: ["p2"], hands: { p1: "handmaid", p2: "king" } });
    expect(conservationProblem(next)).toBeNull();
  });
});

describe("补充#补16（勘误 3.2 #3）王子在牌堆空时让人拿走的牌只给他自己看", () => {
  it("甲的视角、观战视角都看不到移出那张的身份，只看到「乙拿走了移出的牌」；乙自己看得到", () => {
    const next = play(twoPlayerPrinceAtEmptyDeck(), "p1", "prince", "p2");
    const redraw = (view: GameState) => eventsOf(view.history, "Drew").find((event) => event.reason === "prince");
    expect(redraw(redactGameForViewer(next, "p1"))).toEqual({ type: "Drew", player: "p2", reason: "prince", source: "setAside" });
    expect(redraw(redactGameForViewer(next, ""))).toEqual({ type: "Drew", player: "p2", reason: "prince", source: "setAside" });
    expect(redraw(redactGameForViewer(next, "p2"))?.card).toBe("king");
    // 拿走之前，谁的视角里都没有移出的那张
    for (const viewer of ["p1", "p2", ""]) {
      const before = redactGameForViewer(twoPlayerPrinceAtEmptyDeck(), viewer);
      expect("setAside" in before).toBe(false);
      expect(JSON.stringify(before)).not.toContain("king");
    }
  });
});

describe("补充#补9 王子 + 公主、其他人全被保护的死局", () => {
  const trap = () => createScene({ hands: [["prince", "princess"]], protected: [1, 2], discards: [[], ["handmaid"], ["handmaid"]] });
  it("打王子只能选自己，弃掉公主出局", () => {
    expect(plays(trap(), "p1")).toEqual([
      { type: "PLAY", card: "prince", target: "p1" },
      { type: "PLAY", card: "princess" },
    ]);
    const next = play(trap(), "p1", "prince", "p1");
    expect(P(next, "p1").out).toBe(true);
    expect(lastEvent(next, "Eliminated")).toMatchObject({ player: "p1", reason: "prince", by: "p1" });
  });
  it("另一个分支：打公主，也出局", () => {
    expect(P(play(trap(), "p1", "princess"), "p1").out).toBe(true);
  });
});

describe("补充#补10 其他人全被保护时卫兵白打", () => {
  it("不进猜牌，卫兵进打出区，轮到下一位；这时带目标或猜牌都拒绝", () => {
    const game = createScene({ hands: [["guard", "baron"]], protected: [1, 2], discards: [[], ["handmaid"], ["handmaid"]] });
    expect(plays(game, "p1")).toEqual([{ type: "PLAY", card: "guard" }, { type: "PLAY", card: "baron" }]);
    expect(() => play(game, "p1", "guard", "p2", "king")).toThrow("白打");
    expect(() => play(game, "p1", "guard", undefined, "king")).toThrow("不用猜");
    const next = play(game, "p1", "guard");
    expect(lastEvent(next, "NoEffect")).toEqual({ type: "NoEffect", player: "p1", card: "guard", reason: "noTarget" });
    expect(P(next, "p1").discards).toEqual([{ card: "guard", how: "played" }]);
    expect(next.players[next.current]!.id).toBe("p2");
  });
  it("牧师、男爵、国王一样白打", () => {
    for (const card of ["priest", "baron", "king"] as const) {
      const game = createScene({ hands: [[card, "guard"]], protected: [1, 2], discards: [[], ["handmaid"], ["handmaid"]] });
      expect(lastEvent(play(game, "p1", card), "NoEffect")).toMatchObject({ card, reason: "noTarget" });
    }
  });
});

describe("补充#补11（勘误 3.2 #2）平局时在并列赢家之间随机先手", () => {
  it("乙、丙平局赢 → 下一局先手是乙或丙，不会是甲；换 100 个种子乙、丙都出现过", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 100; seed += 1) {
      const ended = endByHandmaid({ seed, hands: [["handmaid", "guard"], ["prince"], ["prince"]] });
      expect(ended.lastRound?.winners).toEqual(["p2", "p3"]);
      const starter = ended.lastRound!.nextStarter!;
      expect(["p2", "p3"]).toContain(starter);
      const next = ["p1", "p2", "p3"].reduce((state, id) => ready(state, id), ended);
      expect(eventsOf(next.events, "RoundStarted")[0]?.starter).toBe(starter);
      expect(next.players[next.current]!.id).toBe(starter);
      seen.add(starter);
    }
    expect([...seen].sort()).toEqual(["p2", "p3"]);
  });

  it("一个赢家时下一局由他先手；第一局先手随机", () => {
    const ended = endByHandmaid({ hands: [["handmaid", "guard"], ["prince"]], out: [2] });
    expect(ended.lastRound?.nextStarter).toBe("p2");
    const starters = new Set(Array.from({ length: 40 }, (_, seed) => createGame(scenePlayers(4), seed).current));
    expect(starters.size).toBeGreaterThan(1);
  });
});

describe("补充#补12 间谍 +1 让人同时达标", () => {
  it("4 人局甲 3 枚、乙 3 枚；乙赢，甲是唯一打过间谍的在局者 → 甲 4、乙 4，一起赢", () => {
    const game = endByHandmaid({
      players: 4,
      hands: [["handmaid", "guard"], ["king"]],
      discards: [["spy"]],
      out: [2, 3],
      tokens: [3, 3, 0, 0],
    });
    expect([P(game, "p1").tokens, P(game, "p2").tokens]).toEqual([4, 4]);
    expect(game.phase).toBe("finished");
    expect(game.winners).toEqual(["p1", "p2"]);
  });
});

describe("补充#补13（勘误 3.2 #6）2 人局开局", () => {
  it("面朝下 1 张、面朝上 3 张（两个视角都看得到）、每人 1 张、牌堆 15 张；21 张守恒", () => {
    const game = createGame(scenePlayers(2), 5, { starter: 0 });
    expect(game.faceUp).toHaveLength(3);
    expect(game.setAside).toBeTruthy();
    expect(game.deckCount + 1).toBe(15);
    expect(conservationProblem(game)).toBeNull();
    for (const viewer of ["p1", "p2", ""]) {
      const view = redactGameForViewer(game, viewer);
      expect(view.faceUp).toEqual(game.faceUp);
      expect(eventsOf(view.history, "RoundStarted")[0]?.faceUp).toEqual(game.faceUp);
      expect("setAside" in view).toBe(false);
    }
    // 明牌算「已露面」
    const unseen = unseenCounts(game, "p1");
    const total = Object.values(unseen).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(21 - 3 - 2);
  });
});

describe("补充#补14 大臣把公主放回牌堆底不出局", () => {
  it("甲打大臣，留卫兵，把公主、牧师放底 → 甲不出局，公主不在任何打出区", () => {
    let game = createScene({ hands: [["chancellor", "guard"]], deck: ["princess", "priest"] });
    game = keep(play(game, "p1", "chancellor"), "p1", "guard", ["princess", "priest"]);
    expect(P(game, "p1").out).toBe(false);
    expect(game.players.some((player) => player.discards.some((entry) => entry.card === "princess"))).toBe(false);
    expect(game.deck!.slice(-2)).toEqual(["princess", "priest"]);
  });
});

describe("补充#补15 国王把公主换给别人不出局", () => {
  it("甲国王 + 公主，乙卫兵 → 换牌后甲拿卫兵、乙拿公主，没人出局", () => {
    const next = play(createScene({ hands: [["king", "princess"], ["guard"], ["baron"]] }), "p1", "king", "p2");
    expect(P(next, "p1").hand).toEqual(["guard"]);
    expect(P(next, "p2").hand[0]).toBe("princess");
    expect(next.players.some((player) => player.out)).toBe(false);
  });
});

describe("补充#补17 超时不替人打公主", () => {
  it("甲手里公主 + 卫兵，超时 → 打卫兵", () => {
    const next = timeoutTurn(createScene({ hands: [["princess", "guard"], ["baron"]] }));
    expect(next.events[0]).toEqual({ type: "TurnTimedOut", player: "p1", stage: "play" });
    expect(lastEvent(next, "Played")?.card).toBe("guard");
    expect(P(next, "p1").out).toBe(false);
    expect(P(next, "p1").hand).toEqual(["princess"]);
  });
});

describe("补充#补18 超时被女伯爵强制", () => {
  it("甲手里女伯爵 + 王子，超时 → 打女伯爵", () => {
    const next = timeoutTurn(createScene({ hands: [["prince", "countess"]] }));
    expect(lastEvent(next, "Played")).toEqual({ type: "Played", player: "p1", card: "countess" });
  });
});

describe("其他规则", () => {
  it("轮流时跳过出局的人", () => {
    const game = createScene({ players: 4, hands: [["handmaid", "guard"]], out: [1], discards: [[], [{ card: "baron", how: "eliminated" }]] });
    expect(play(game, "p1", "handmaid").players[2]!.id).toBe("p3");
    expect(play(game, "p1", "handmaid").current).toBe(2);
  });

  it("apply 不改输入；每一步 version +1", () => {
    const game = createScene({ hands: [["guard", "priest"], ["baron"]] });
    const before = JSON.stringify(game);
    const next = play(game, "p1", "guard", "p2", "baron");
    expect(JSON.stringify(game)).toBe(before);
    expect(next.version).toBe(game.version + 1);
  });

  it("history 只记本小局：新一局开始时清空，从 RoundStarted 开始", () => {
    const ended = endByHandmaid({ hands: [["handmaid", "guard"], ["prince"]], out: [2] });
    expect(eventsOf(ended.history, "RoundEnded")).toHaveLength(1);
    const next = ["p1", "p2", "p3"].reduce((state, id) => ready(state, id), ended);
    expect(next.history.map((event) => event.type)).toEqual(["RoundStarted", "TurnStarted", "Drew"]);
    expect(next.round).toBe(2);
    expect(next.lastRound?.round).toBe(1);
    expect(next.players.every((player) => !player.out && player.discards.length === 0)).toBe(true);
    expect(conservationProblem(next)).toBeNull();
  });

  it("结算画面：每人点「下一局」，全点了才开；点过的不能再点", () => {
    const ended = endByHandmaid({ hands: [["handmaid", "guard"], ["prince"]], out: [2] });
    expect(legalActions(ended, "p3")).toEqual([{ type: "READY" }]);
    const one = ready(ended, "p1");
    expect(one.phase).toBe("roundEnd");
    expect(one.ready).toEqual(["p1"]);
    expect(legalActions(one, "p1")).toEqual([]);
    expect(() => ready(one, "p1")).toThrow("已经点过");
    expect(() => play(one, "p2", "guard", "p1", "king")).toThrow("这一小局已经结束");
  });

  it("结算画面超时 → 直接开下一局", () => {
    const ended = endByHandmaid({ hands: [["handmaid", "guard"], ["prince"]], out: [2] });
    const next = timeoutTurn(ended);
    expect(next.phase).toBe("playing");
    expect(next.round).toBe(2);
    expect(next.players[next.current]!.id).toBe("p2");
  });

  it("2 人局的明牌在牌堆空时王子也不会抽", () => {
    const next = play(twoPlayerPrinceAtEmptyDeck(), "p1", "prince", "p1");
    expect(P(next, "p1").discards.slice(-2)).toEqual([{ card: "prince", how: "played" }, { card: "handmaid", how: "discarded" }]);
    expect(lastEvent(next, "Drew")).toMatchObject({ player: "p1", source: "setAside", card: "king" });
    expect(next.faceUp).toHaveLength(3);
  });

  it("卫兵猜的角色可以是已经全部露面的（合法，只是猜不中）", () => {
    const game = createScene({ hands: [["guard", "baron"], ["priest"]], discards: [["king"]] });
    expect(lastEvent(play(game, "p1", "guard", "p2", "king"), "Guessed")?.hit).toBe(false);
  });
});

describe("超时：替人走完整个回合", () => {
  it("打大臣也替他留牌：留最大的，其余从大到小放回（最小的在最底下），只有一条 TurnTimedOut", () => {
    const game = createScene({ hands: [["chancellor", "princess"]], deck: ["baron", "guard", "spy"] });
    const next = timeoutTurn(game);
    expect(eventsOf(next.events, "TurnTimedOut")).toHaveLength(1);
    expect(lastEvent(next, "Played")?.card).toBe("chancellor");
    expect(P(next, "p1").hand).toEqual(["princess"]);
    expect(next.deck!.slice(-2)).toEqual(["baron", "guard"]);
    expect(next.players[next.current]!.id).toBe("p2");
    expect(next.history.filter((event) => event.type === "TurnTimedOut")).toHaveLength(1);
  });

  it("已经打出大臣、留牌时超时 → 只替他留牌", () => {
    const game = play(createScene({ hands: [["chancellor", "guard"]], deck: ["countess", "spy"] }), "p1", "chancellor");
    const next = timeoutTurn(game);
    expect(next.events[0]).toEqual({ type: "TurnTimedOut", player: "p1", stage: "chancellor" });
    expect(P(next, "p1").hand).toEqual(["countess"]);
  });

  it("王子选下家开始第一个能选的对手，不选自己", () => {
    const game = createScene({ hands: [["prince", "princess"], ["guard"], ["baron"]], protected: [1], discards: [[], ["handmaid"]] });
    expect(lastEvent(timeoutTurn(game), "Played")).toEqual({ type: "Played", player: "p1", card: "prince", target: "p3" });
  });

  it("卫兵选下家，猜还没露面最多的角色", () => {
    const game = createScene({ hands: [["guard", "king"], ["baron"]], discards: [["prince", "prince", "chancellor"], ["spy", "spy", "chancellor"]] });
    // 没露面最多的是牧师、男爵、侍女（各 2 张），一样多猜点数大的：侍女
    expect(lastEvent(timeoutTurn(game), "Played")).toEqual({ type: "Played", player: "p1", card: "guard", target: "p2", guess: "handmaid" });
  });

  it("换进来的 choose 只拿到裁剪后的视角；给的命令不合法时退回固定动作", () => {
    const game = createScene({ hands: [["guard", "king"], ["baron"], ["priest"]] });
    let seen: GameState | undefined;
    const next = timeoutTurn(game, (view) => {
      seen = view;
      return { type: "PLAY", card: "princess" };
    });
    expect(seen && "deck" in seen).toBe(false);
    expect(seen?.players[1]!.hand).toEqual([]);
    expect(lastEvent(next, "Played")?.card).toBe("guard");
  });

  it("整场结束后超时什么都不做", () => {
    const over = endByHandmaid({ hands: [["handmaid", "countess"], ["baron"]], out: [2], tokens: [4, 0, 0] });
    expect(timeoutTurn(over)).toBe(over);
  });
});

describe("合法行动", () => {
  it("同名的两张牌只列一次；卫兵每个可选的人 × 9 种角色", () => {
    const game = createScene({ hands: [["guard", "guard"], ["baron"], ["priest"]] });
    const actions = plays(game, "p1");
    expect(actions).toHaveLength(2 * 9);
    expect(new Set(actions.map((command) => JSON.stringify(command))).size).toBe(actions.length);
  });

  it("在裁剪过的视角上算出来的和完整状态一样", () => {
    const game = createScene({ hands: [["prince", "king"], ["baron"], ["priest"]], protected: [2], discards: [[], [], ["handmaid"]] });
    expect(legalActions(redactGameForViewer(game, "p1"), "p1")).toEqual(legalActions(game, "p1"));
    expect(legalActions(redactGameForViewer(game, "p2"), "p2")).toEqual([]);
  });

  it("每个合法行动都能执行", () => {
    for (const hand of [["guard", "king"], ["prince", "handmaid"], ["baron", "priest"], ["chancellor", "spy"], ["countess", "princess"]] as Role[][]) {
      const game = createScene({ hands: [hand] });
      for (const command of plays(game, "p1")) expect(() => applyCommand(game, "p1", command)).not.toThrow();
    }
  });
});
