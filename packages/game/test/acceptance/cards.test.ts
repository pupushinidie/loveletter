/**
 * 规则核对：规则书 §2 配件、§4 回合流程、§4.1 每种角色的效果和边界，补充文件 3.5 的相关用例。
 * 只按规则书、补充勘误、开工拍板和对外接口写（见 helpers.ts 开头）。
 */
import { describe, expect, it } from "vitest";
import {
  FULL_DECK,
  GUARD_GUESSES,
  ROLE_COUNT,
  ROLE_VALUE,
  TOKENS_TO_WIN,
  createScene,
  legalActions,
  type Role,
} from "../../src/index.js";
import { P1, P2, P3, P4, act, cur, eventsOf, exact, expectRejected, pl, playCard, sorted } from "./helpers.js";

describe("规则书§2 配件", () => {
  it("规则书§2.1 / TC1：21 张、10 种，点数 0–9 和张数照表", () => {
    expect(FULL_DECK.length).toBe(21);
    expect(ROLE_COUNT).toEqual({ spy: 2, guard: 6, priest: 2, baron: 2, handmaid: 2, prince: 2, chancellor: 2, king: 1, countess: 1, princess: 1 });
    expect(ROLE_VALUE).toEqual({ spy: 0, guard: 1, priest: 2, baron: 3, handmaid: 4, prince: 5, chancellor: 6, king: 7, countess: 8, princess: 9 });
  });
  it("规则书§6：目标枚数 2→6、3→5、4→4、5→3、6→3", () => {
    expect(TOKENS_TO_WIN).toEqual({ 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 });
  });
  it("规则书§4.1 卫兵：能猜的是除卫兵外 9 种（含间谍）", () => {
    expect(sorted([...GUARD_GUESSES])).toEqual(sorted(["spy", "priest", "baron", "handmaid", "prince", "chancellor", "king", "countess", "princess"]));
  });
});

describe("规则书§4 回合流程（抽 1 打 1）", () => {
  it("TC3：轮到的人手里 2 张，打 1 张剩 1 张，打出的牌进打出区，下一位抽 1 张", () => {
    let s = createScene({ hands: [["handmaid", "guard"], ["priest"], ["baron"]], deck: ["king", "spy"] });
    expect(pl(s, P1).hand.length).toBe(2);
    const deckBefore = s.deckCount;
    s = playCard(s, P1, "handmaid");
    expect(pl(s, P1).hand).toEqual(["guard"]);
    expect(pl(s, P1).discards.at(-1)).toEqual({ card: "handmaid", how: "played" });
    expect(cur(s)).toBe(P2);
    expect(sorted(pl(s, P2).hand)).toEqual(sorted(["priest", "king"]));
    expect(s.deckCount).toBe(deckBefore - 1);
  });
  it("规则书§4：按座位顺序轮流，出局的人被跳过（规则书§5）", () => {
    let s = exact(
      { players: 4, hands: [["handmaid", "guard"], [], ["baron"], ["priest"]], out: [1], deck: ["king", "prince", "handmaid"], setAside: "countess", discards: [[], ["princess"]] },
      1,
    );
    s = playCard(s, P1, "handmaid");
    expect(cur(s)).toBe(P3);
  });
  it("规则书§4：打出的牌必须结算，哪怕对自己不利（男爵比输自己出局）", () => {
    let s = createScene({ hands: [["baron", "guard"], ["king"], ["priest"]], deck: ["spy", "handmaid"] });
    s = playCard(s, P1, "baron", P2);
    expect(pl(s, P1).out).toBe(true);
    expect(pl(s, P2).out).toBe(false);
  });
});

describe("规则书§4.1 卫兵", () => {
  it("TC4：猜中对方手牌 → 对方出局，亮出的牌进他的打出区", () => {
    let s = createScene({ hands: [["guard", "spy"], ["baron"], ["priest"]], deck: ["king", "handmaid"] });
    const { state, events } = act(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "baron" });
    s = state;
    expect(pl(s, P2).out).toBe(true);
    expect(pl(s, P2).hand).toEqual([]);
    expect(pl(s, P2).discards.map((d) => d.card)).toContain("baron");
    const g = eventsOf(events, "Guessed")[0];
    expect(g).toMatchObject({ player: P1, target: P2, guess: "baron", hit: true });
    expect(eventsOf(events, "Eliminated")[0]).toMatchObject({ player: P2, reason: "guard", revealed: ["baron"] });
  });
  it("TC4：猜错 → 无事，轮到下一位", () => {
    let s = createScene({ hands: [["guard", "spy"], ["baron"], ["priest"]], deck: ["king", "handmaid"] });
    const { state, events } = act(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "princess" });
    s = state;
    expect(pl(s, P2).out).toBe(false);
    expect(sorted(pl(s, P2).hand)).toEqual(sorted(["baron", "king"])); // 原来的男爵 + 回合开始抽的国王
    expect(eventsOf(events, "Guessed")[0]).toMatchObject({ hit: false });
    expect(cur(s)).toBe(P2);
  });
  it("TC4 / TC17：猜「卫兵」被拒绝", () => {
    const s = createScene({ hands: [["guard", "spy"], ["guard"], ["priest"]], deck: ["king"] });
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "guard" });
  });
  it("规则书§4.1 卫兵：可以猜间谍（点数 0），猜中出局", () => {
    let s = createScene({ hands: [["guard", "priest"], ["spy"], ["baron"]], deck: ["king"] });
    s = playCard(s, P1, "guard", P2, "spy");
    expect(pl(s, P2).out).toBe(true);
  });
  it("规则书§4.1 卫兵：只能指定其他玩家；有能选的人时必须选人、必须猜", () => {
    const s = createScene({ hands: [["guard", "spy"], ["baron"], ["priest"]], deck: ["king"] });
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: P1, guess: "spy" });
    expectRejected(s, P1, { type: "PLAY", card: "guard" });
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: P2 });
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: "p9", guess: "baron" });
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "joker" as Role });
  });
  it("补10：其余在局的人全被侍女保护 → 卫兵白打，不选人不猜牌，进打出区，轮到下一位", () => {
    let s = createScene({ hands: [["guard", "baron"], ["priest"], ["king"]], protected: [1, 2], discards: [[], ["handmaid"], ["handmaid"]], deck: ["spy", "prince"] });
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "priest" });
    const { state, events } = act(s, P1, { type: "PLAY", card: "guard" });
    s = state;
    expect(eventsOf(events, "NoEffect")[0]).toMatchObject({ player: P1, card: "guard", reason: "noTarget" });
    expect(pl(s, P1).discards.at(-1)).toEqual({ card: "guard", how: "played" });
    expect(pl(s, P2).out || pl(s, P3).out).toBe(false);
    expect(cur(s)).toBe(P2);
  });
  it("规则书§4.1 侍女：有一人出局、其余被保护时也是白打（出局的人不能被选）", () => {
    const s = exact(
      { hands: [["guard", "baron"], ["priest"], []], out: [2], protected: [1], discards: [[], ["handmaid"], ["princess"]], deck: ["spy", "prince"], setAside: "king" },
      2,
    );
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: P3, guess: "baron" });
    const next = act(s, P1, { type: "PLAY", card: "guard" });
    expect(eventsOf(next.events, "NoEffect")).toHaveLength(1);
  });
});

describe("规则书§4.1 牧师", () => {
  it("TC5：看一名其他玩家的手牌，没有任何人出局，事件只记看了谁", () => {
    const { state, events } = act(createScene({ hands: [["priest", "spy"], ["king"], ["baron"]], deck: ["guard"] }), P1, { type: "PLAY", card: "priest", target: P2 });
    expect(eventsOf(events, "Peeked")[0]).toMatchObject({ player: P1, target: P2 });
    expect(state.players.some((p) => p.out)).toBe(false);
    expect(sorted(pl(state, P2).hand)).toEqual(sorted(["king", "guard"])); // 被看的牌没动，加上回合开始抽的
  });
  it("规则书§4.1 牧师：不能看自己、不能看受保护的人", () => {
    const s = createScene({ hands: [["priest", "spy"], ["king"], ["baron"]], protected: [2], discards: [[], [], ["handmaid"]], deck: ["guard"] });
    expectRejected(s, P1, { type: "PLAY", card: "priest", target: P1 });
    expectRejected(s, P1, { type: "PLAY", card: "priest", target: P3 });
  });
});

describe("规则书§4.1 男爵", () => {
  it("TC6 前半：甲打男爵、留男爵(3)，乙手里女伯爵(8) → 甲出局", () => {
    let s = createScene({ hands: [["baron", "baron"], ["countess"], ["priest"]], deck: ["guard"] });
    const r = act(s, P1, { type: "PLAY", card: "baron", target: P2 });
    s = r.state;
    expect(pl(s, P1).out).toBe(true);
    expect(pl(s, P2).out).toBe(false);
    expect(eventsOf(r.events, "Compared")[0]).toMatchObject({ player: P1, target: P2, loser: P1 });
    expect(eventsOf(r.events, "Eliminated")[0]).toMatchObject({ player: P1, reason: "baron", revealed: ["baron"] });
  });
  it("规则书§4.1 男爵：比的是留下的那张，不是男爵本身（留卫兵(1) 对牧师(2) → 自己出局）", () => {
    let s = createScene({ hands: [["baron", "guard"], ["priest"], ["handmaid"]], deck: ["spy"] });
    s = playCard(s, P1, "baron", P2);
    expect(pl(s, P1).out).toBe(true);
    expect(pl(s, P2).out).toBe(false);
  });
  it("规则书§4.1 男爵：留国王(7) 对王子(5) → 对方出局，对方的牌亮出", () => {
    const r = act(createScene({ hands: [["baron", "king"], ["prince"], ["handmaid"]], deck: ["spy"] }), P1, { type: "PLAY", card: "baron", target: P2 });
    expect(pl(r.state, P2).out).toBe(true);
    expect(pl(r.state, P1).out).toBe(false);
    expect(eventsOf(r.events, "Eliminated")[0]).toMatchObject({ player: P2, reason: "baron", by: P1, revealed: ["prince"] });
  });
  it("补1（替换 TC6 后半）：甲留牧师、乙也是牧师 → 平手，都不出局", () => {
    const r = act(createScene({ hands: [["baron", "priest"], ["priest"], ["guard"]], deck: ["spy"] }), P1, { type: "PLAY", card: "baron", target: P2 });
    expect(pl(r.state, P1).out).toBe(false);
    expect(pl(r.state, P2).out).toBe(false);
    expect(eventsOf(r.events, "Compared")[0]).toMatchObject({ loser: null });
  });
});

describe("规则书§4.1 侍女", () => {
  it("TC7：侍女保护到自己下一回合开始：期间别人不能选他，到他回合开始解除", () => {
    let s = createScene({ hands: [["handmaid", "spy"], ["guard"], ["guard"]], deck: ["priest", "king", "baron", "prince", "spy"] });
    s = playCard(s, P1, "handmaid");
    expect(pl(s, P1).protected).toBe(true);
    // 乙的回合：不能选甲
    expect(cur(s)).toBe(P2);
    expectRejected(s, P2, { type: "PLAY", card: "guard", target: P1, guess: "spy" });
    expect(legalActions(s, P2).every((c) => c.type !== "PLAY" || c.target !== P1)).toBe(true);
    s = playCard(s, P2, "guard", P3, "princess");
    // 丙的回合：照样不能选甲
    expect(cur(s)).toBe(P3);
    expect(pl(s, P1).protected).toBe(true);
    expectRejected(s, P3, { type: "PLAY", card: "guard", target: P1, guess: "spy" });
    const r = act(s, P3, { type: "PLAY", card: "guard", target: P2, guess: "princess" });
    s = r.state;
    // 甲的回合开始：保护解除
    expect(cur(s)).toBe(P1);
    expect(pl(s, P1).protected).toBe(false);
    expect(eventsOf(r.events, "TurnStarted").find((e) => e.player === P1)).toMatchObject({ protectionEnded: true });
  });
  it("TC10 / TC17：国王、男爵、牧师都不能选受保护的人", () => {
    const s = createScene({ hands: [["king", "baron"], ["guard"], ["priest"]], protected: [1], discards: [[], ["handmaid"]], deck: ["spy"] });
    expectRejected(s, P1, { type: "PLAY", card: "king", target: P2 });
    expectRejected(s, P1, { type: "PLAY", card: "baron", target: P2 });
  });
  it("TC7 / 补9：其余全被保护，王子只能选自己", () => {
    const s = createScene({ hands: [["prince", "guard"], ["priest"], ["king"]], protected: [1, 2], discards: [[], ["handmaid"], ["handmaid"]], deck: ["spy", "baron"] });
    expectRejected(s, P1, { type: "PLAY", card: "prince", target: P2 });
    expectRejected(s, P1, { type: "PLAY", card: "prince" });
    const princeMoves = legalActions(s, P1).filter((c) => c.type === "PLAY" && c.card === "prince");
    expect(princeMoves).toEqual([{ type: "PLAY", card: "prince", target: P1 }]);
    const after = playCard(s, P1, "prince", P1);
    expect(pl(after, P1).discards.map((d) => d.card)).toEqual(["prince", "guard"]);
    expect(pl(after, P1).hand).toEqual(["spy"]);
  });
  it("补9：死局：其余全被保护、手里王子 + 公主 → 打王子（只能选自己）或打公主，都出局", () => {
    const s = createScene({ hands: [["prince", "princess"], ["priest"], ["king"]], protected: [1, 2], discards: [[], ["handmaid"], ["handmaid"]], deck: ["spy", "baron"] });
    expect(pl(playCard(s, P1, "prince", P1), P1).out).toBe(true);
    expect(pl(playCard(s, P1, "princess"), P1).out).toBe(true);
  });
  it("规则书§4.1 侍女：国王、牧师、男爵在没人可选时白打", () => {
    for (const card of ["king", "priest", "baron"] as const) {
      const s = createScene({ hands: [[card, "guard"], ["spy"], ["handmaid"]], protected: [1, 2], discards: [[], ["handmaid"], ["countess"]], deck: ["prince", "guard"] });
      const r = act(s, P1, { type: "PLAY", card });
      expect(eventsOf(r.events, "NoEffect")[0], card).toMatchObject({ card, reason: "noTarget" });
      expect(pl(r.state, P1).hand, card).toEqual(["guard"]);
      expect(r.state.players.some((p) => p.out), card).toBe(false);
    }
  });
});

describe("规则书§4.1 王子", () => {
  it("TC8：王子选乙 → 乙弃掉手牌（不结算）并重抽 1 张", () => {
    let s = createScene({ hands: [["prince", "guard"], ["baron"], ["spy"]], deck: ["handmaid", "priest", "king"] });
    const deck = s.deckCount;
    const r = act(s, P1, { type: "PLAY", card: "prince", target: P2 });
    s = r.state;
    expect(pl(s, P2).out).toBe(false);
    expect(pl(s, P2).discards.at(-1)).toEqual({ card: "baron", how: "discarded" });
    expect(pl(s, P2).hand.length).toBeGreaterThanOrEqual(1);
    expect(pl(s, P2).hand).toContain("handmaid");
    expect(eventsOf(r.events, "Compared")).toHaveLength(0); // 被弃掉的男爵不发动
    expect(eventsOf(r.events, "Discarded")[0]).toMatchObject({ player: P2, card: "baron", by: P1 });
    // 乙重抽 1 张，然后轮到乙再抽 1 张
    expect(s.deckCount).toBe(deck - 2);
  });
  it("规则书§4.1 王子：可以选自己，弃掉另一张重抽", () => {
    const s = playCard(createScene({ hands: [["prince", "guard"], ["baron"], ["spy"]], deck: ["countess", "priest"] }), P1, "prince", P1);
    expect(pl(s, P1).hand).toEqual(["countess"]);
    expect(pl(s, P1).discards).toEqual([
      { card: "prince", how: "played" },
      { card: "guard", how: "discarded" },
    ]);
  });
  it("规则书§4.1 王子：被弃掉的是国王 → 不发动换牌", () => {
    const r = act(createScene({ hands: [["prince", "guard"], ["king"], ["spy"]], deck: ["priest", "baron"] }), P1, { type: "PLAY", card: "prince", target: P2 });
    expect(eventsOf(r.events, "Swapped")).toHaveLength(0);
    expect(pl(r.state, P1).hand).toEqual(["guard"]);
  });
  it("TC8 / TC12：王子弃掉对方的公主 → 对方出局，不再抽牌", () => {
    const s0 = createScene({ hands: [["prince", "guard"], ["princess"], ["spy"]], deck: ["priest", "baron"] });
    const r = act(s0, P1, { type: "PLAY", card: "prince", target: P2 });
    const p2 = pl(r.state, P2);
    expect(p2.out).toBe(true);
    expect(p2.hand).toEqual([]);
    expect(p2.discards.map((d) => d.card)).toEqual(["princess"]);
    expect(eventsOf(r.events, "Eliminated")[0]).toMatchObject({ player: P2, reason: "prince", by: P1 });
    expect(eventsOf(r.events, "Drew").filter((e) => e.player === P2)).toHaveLength(0);
    // 乙没抽：牌堆只少了丙回合开始的那 1 张
    expect(r.state.deckCount).toBe(s0.deckCount - 1);
  });
  it("规则书§4.1 王子：不能选受保护或已出局的人；必须选人", () => {
    const s = exact(
      { hands: [["prince", "guard"], ["baron"], [], ["king"]], players: 4, out: [2], protected: [1], discards: [[], ["handmaid"], ["princess"]], deck: ["priest", "spy"], setAside: "countess" },
      2,
    );
    expectRejected(s, P1, { type: "PLAY", card: "prince", target: P2 });
    expectRejected(s, P1, { type: "PLAY", card: "prince", target: P3 });
    expectRejected(s, P1, { type: "PLAY", card: "prince" });
    expect(pl(playCard(s, P1, "prince", P4), P4).discards.at(-1)).toEqual({ card: "king", how: "discarded" });
  });
  it("TC8：牌堆空时王子选丙 → 丙拿走面朝下移出的那张；这一回合结束牌堆空 → 比牌", () => {
    const s = exact(
      { hands: [["prince", "guard"], ["princess"], ["baron"]], deck: [], setAside: "king", discards: [[], ["spy", "spy"]] },
      1,
    );
    const r = act(s, P1, { type: "PLAY", card: "prince", target: P3 });
    expect(pl(r.state, P3).discards.at(-1)).toEqual({ card: "baron", how: "discarded" });
    expect(pl(r.state, P3).hand).toEqual(["king"]);
    expect(r.state.setAsideTaken).toBe(true);
    expect(eventsOf(r.events, "Drew").find((e) => e.player === P3)).toMatchObject({ reason: "prince", source: "setAside" });
    expect(r.state.phase).toBe("roundEnd");
    expect(r.state.lastRound).toMatchObject({ reason: "showdown", winners: [P2], hands: { [P1]: "guard", [P2]: "princess", [P3]: "king" }, setAside: null });
  });
  it("规则书§4.1 王子：牌堆空、被点的人手里是公主 → 出局、不抽牌，移出的牌留着（结算时亮出）", () => {
    const s = exact(
      { hands: [["prince", "guard"], ["princess"], ["baron"]], deck: [], setAside: "king", discards: [[], ["spy", "spy"]] },
      1,
    );
    const r = act(s, P1, { type: "PLAY", card: "prince", target: P2 });
    expect(pl(r.state, P2).out).toBe(true);
    expect(r.state.setAsideTaken).toBe(false);
    expect(r.state.lastRound).toMatchObject({ reason: "showdown", winners: [P3], setAside: "king" });
  });
});

describe("规则书§4.1 大臣", () => {
  it("TC9：抽 2 张成 3 张，留 1 张，其余 2 张按指定顺序放到牌堆底（最后一个在最底下）", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["spy"]], deck: ["priest", "king", "handmaid", "prince"], seed: 3 });
    const before = s.deck ?? [];
    s = playCard(s, P1, "chancellor");
    expect(s.stage).toBe("chancellor");
    expect(cur(s)).toBe(P1);
    expect(sorted(pl(s, P1).hand)).toEqual(sorted(["guard", "priest", "king"]));
    expect(s.deckCount).toBe(before.length - 2);
    const r = act(s, P1, { type: "CHANCELLOR", keep: "king", bottom: ["guard", "priest"] });
    expect(pl(r.state, P1).hand).toEqual(["king"]);
    expect(eventsOf(r.events, "ChancellorReturned")[0]).toMatchObject({ player: P1, count: 2 });
    // 放回后轮到乙，乙从牌堆顶抽了 1 张；牌堆底是 guard、priest（priest 最底下）
    const deck = r.state.deck ?? [];
    expect(deck.slice(-2)).toEqual(["guard", "priest"]);
    expect(deck.length).toBe(before.length - 2 + 2 - 1);
    expect(cur(r.state)).toBe(P2);
    expect(sorted(pl(r.state, P2).hand)).toEqual(sorted(["baron", "handmaid"]));
  });
  it("TC9 反向顺序：bottom 写 [priest, guard] → guard 在最底下", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["spy"]], deck: ["priest", "king", "handmaid", "prince"] });
    s = playCard(s, P1, "chancellor");
    s = act(s, P1, { type: "CHANCELLOR", keep: "king", bottom: ["priest", "guard"] }).state;
    expect((s.deck ?? []).slice(-2)).toEqual(["priest", "guard"]);
  });
  it("TC9 / 规则书§4.1 大臣：抽牌不触发女伯爵强制（3 张里有女伯爵 + 国王，可以留国王）", () => {
    let s = createScene({ hands: [["chancellor", "king"], ["baron"], ["spy"]], deck: ["countess", "prince", "guard", "guard"] });
    s = playCard(s, P1, "chancellor");
    expect(sorted(pl(s, P1).hand)).toEqual(sorted(["king", "countess", "prince"]));
    const r = act(s, P1, { type: "CHANCELLOR", keep: "king", bottom: ["countess", "prince"] });
    expect(pl(r.state, P1).hand).toEqual(["king"]);
    const r2 = act(s, P1, { type: "CHANCELLOR", keep: "prince", bottom: ["king", "countess"] });
    expect(pl(r2.state, P1).hand).toEqual(["prince"]);
  });
  it("补14 / 开工拍板：大臣把公主放回牌堆底不出局，公主不进任何打出区", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["spy"]], deck: ["princess", "priest", "handmaid"] });
    s = playCard(s, P1, "chancellor");
    const r = act(s, P1, { type: "CHANCELLOR", keep: "guard", bottom: ["princess", "priest"] });
    expect(pl(r.state, P1).out).toBe(false);
    expect(r.state.players.flatMap((p) => p.discards.map((d) => d.card))).not.toContain("princess");
    expect(eventsOf(r.events, "Eliminated")).toHaveLength(0);
  });
  it("补6：牌堆只剩 1 张（公主）：抽它、留卫兵、把公主放回 → 不出局，牌堆仍 1 张，这一回合结束不比牌，下一位抽到公主", () => {
    let s = exact(
      { hands: [["chancellor", "guard"], ["baron"], []], out: [2], deck: ["princess"], setAside: "handmaid", discards: [[], [], ["countess"]] },
      2,
    );
    s = playCard(s, P1, "chancellor");
    expect(s.stage).toBe("chancellor");
    expect(sorted(pl(s, P1).hand)).toEqual(sorted(["guard", "princess"]));
    expect(s.deckCount).toBe(0);
    const r = act(s, P1, { type: "CHANCELLOR", keep: "guard", bottom: ["princess"] });
    expect(pl(r.state, P1).out).toBe(false);
    expect(r.state.phase).toBe("playing");
    expect(cur(r.state)).toBe(P2);
    expect(sorted(pl(r.state, P2).hand)).toEqual(sorted(["baron", "princess"]));
    expect(r.state.deckCount).toBe(0);
    expect(eventsOf(r.events, "ChancellorReturned")[0]).toMatchObject({ count: 1 });
  });
  it("派活要求 / 规则书§4.1 大臣：牌堆正好 2 张：两张都抽走，再放回 2 张，牌堆仍 2 张，这一回合结束不比牌", () => {
    let s = exact(
      { hands: [["chancellor", "guard"], ["baron"], []], out: [2], deck: ["king", "priest"], setAside: "handmaid", discards: [[], [], ["countess"]] },
      2,
    );
    s = playCard(s, P1, "chancellor");
    expect(s.deckCount).toBe(0);
    expect(sorted(pl(s, P1).hand)).toEqual(sorted(["guard", "king", "priest"]));
    const r = act(s, P1, { type: "CHANCELLOR", keep: "king", bottom: ["guard", "priest"] });
    expect(r.state.phase).toBe("playing");
    expect(cur(r.state)).toBe(P2);
    expect(sorted(pl(r.state, P2).hand)).toEqual(sorted(["baron", "guard"])); // 乙抽到放回去的第一张
    expect(r.state.deck).toEqual(["priest"]);
  });
  it("规则书§8.2：大臣留牌阶段 legalActions 列出所有留法和放回顺序，每条都能执行", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["spy"]], deck: ["priest", "king", "handmaid"] });
    s = playCard(s, P1, "chancellor");
    const acts = legalActions(s, P1);
    expect(acts.every((c) => c.type === "CHANCELLOR")).toBe(true);
    expect(acts).toHaveLength(6); // 3 种留法 × 2 种顺序
    for (const c of acts) expect(() => act(s, P1, c)).not.toThrow();
    expect(legalActions(s, P2)).toEqual([]);
  });
  it("补7：牌堆空时打大臣 → 白打，不进留牌阶段，这一回合结束马上比牌", () => {
    const s = exact(
      { hands: [["chancellor", "priest"], ["baron"], []], out: [2], deck: [], setAside: "handmaid", discards: [[], [], ["countess"]] },
      2,
    );
    const r = act(s, P1, { type: "PLAY", card: "chancellor" });
    expect(eventsOf(r.events, "NoEffect")[0]).toMatchObject({ card: "chancellor", reason: "emptyDeck" });
    expect(r.state.phase).toBe("roundEnd");
    expect(r.state.lastRound).toMatchObject({ reason: "showdown", winners: [P2], hands: { [P1]: "priest", [P2]: "baron" } });
  });
  it("规则书§8.2 / 补充3.3#1：大臣留牌的非法命令被拒绝", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["spy"]], deck: ["priest", "king", "handmaid"] });
    expectRejected(s, P1, { type: "CHANCELLOR", keep: "guard", bottom: [] }); // 还没打大臣
    s = playCard(s, P1, "chancellor");
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: P2, guess: "baron" }); // 留牌阶段不能出牌
    expectRejected(s, P1, { type: "CHANCELLOR", keep: "princess", bottom: ["guard", "priest"] }); // 留的不在手里
    expectRejected(s, P1, { type: "CHANCELLOR", keep: "king", bottom: ["guard"] }); // 少放一张
    expectRejected(s, P1, { type: "CHANCELLOR", keep: "king", bottom: ["guard", "priest", "king"] }); // 多放一张
    expectRejected(s, P1, { type: "CHANCELLOR", keep: "king", bottom: ["guard", "guard"] }); // 只有 1 张卫兵
    expectRejected(s, P1, { type: "CHANCELLOR", keep: "king", bottom: ["guard", "baron"] }); // 男爵不在手里
    expectRejected(s, P2, { type: "CHANCELLOR", keep: "baron", bottom: [] }); // 不是他
  });
});

describe("规则书§4.1 国王", () => {
  it("TC10：国王选乙 → 甲留下的那张和乙的手牌互换", () => {
    const r = act(createScene({ hands: [["king", "guard"], ["countess"], ["spy"]], deck: ["priest", "baron"] }), P1, { type: "PLAY", card: "king", target: P2 });
    expect(pl(r.state, P1).hand).toEqual(["countess"]);
    expect(sorted(pl(r.state, P2).hand)).toEqual(sorted(["guard", "priest"]));
    expect(eventsOf(r.events, "Swapped")[0]).toMatchObject({ player: P1, target: P2 });
  });
  it("补15：甲用国王把公主换给乙 → 谁都不出局", () => {
    const r = act(createScene({ hands: [["king", "princess"], ["guard"], ["spy"]], deck: ["priest", "baron"] }), P1, { type: "PLAY", card: "king", target: P2 });
    expect(pl(r.state, P1).hand).toEqual(["guard"]);
    expect(pl(r.state, P2).hand).toContain("princess");
    expect(r.state.players.some((p) => p.out)).toBe(false);
  });
  it("规则书§4.1 国王：不能选自己", () => {
    expectRejected(createScene({ hands: [["king", "guard"], ["countess"], ["spy"]], deck: ["priest"] }), P1, { type: "PLAY", card: "king", target: P1 });
  });
});

describe("规则书§4.1 女伯爵", () => {
  it("TC11：女伯爵 + 国王 → 只能打女伯爵", () => {
    const s = createScene({ hands: [["countess", "king"], ["guard"], ["spy"]], deck: ["priest"] });
    expectRejected(s, P1, { type: "PLAY", card: "king", target: P2 });
    expect(legalActions(s, P1)).toEqual([{ type: "PLAY", card: "countess" }]);
    const after = playCard(s, P1, "countess");
    expect(pl(after, P1).hand).toEqual(["king"]);
  });
  it("TC11：女伯爵 + 王子 → 只能打女伯爵（王子选谁都不行）", () => {
    const s = createScene({ hands: [["countess", "prince"], ["guard"], ["spy"]], deck: ["priest"] });
    expectRejected(s, P1, { type: "PLAY", card: "prince", target: P2 });
    expectRejected(s, P1, { type: "PLAY", card: "prince", target: P1 });
    expect(legalActions(s, P1)).toEqual([{ type: "PLAY", card: "countess" }]);
  });
  it("TC11：女伯爵 + 卫兵 → 两张都能打；没有国王王子时也可以主动打女伯爵", () => {
    const s = createScene({ hands: [["countess", "guard"], ["baron"], ["spy"]], deck: ["priest"] });
    expect(pl(playCard(s, P1, "guard", P2, "baron"), P2).out).toBe(true);
    expect(pl(playCard(s, P1, "countess"), P1).hand).toEqual(["guard"]);
  });
  it("规则书§4.1 女伯爵：打出时不亮另一张（Played 事件只带女伯爵）", () => {
    const r = act(createScene({ hands: [["countess", "king"], ["guard"], ["spy"]], deck: ["priest"] }), P1, { type: "PLAY", card: "countess" });
    const played = eventsOf(r.events, "Played")[0];
    expect(played).toEqual({ type: "Played", player: P1, card: "countess" });
    expect(pl(r.state, P1).discards).toEqual([{ card: "countess", how: "played" }]);
  });
});

describe("规则书§4.1 公主", () => {
  it("TC12：主动打公主 → 立即出局，另一张亮出弃掉（不发动）", () => {
    const r = act(createScene({ hands: [["princess", "baron"], ["guard"], ["spy"]], deck: ["priest", "king"] }), P1, { type: "PLAY", card: "princess" });
    const p1 = pl(r.state, P1);
    expect(p1.out).toBe(true);
    expect(p1.hand).toEqual([]);
    expect(p1.discards.map((d) => d.card)).toEqual(["princess", "baron"]);
    expect(eventsOf(r.events, "Compared")).toHaveLength(0);
    expect(eventsOf(r.events, "Eliminated")[0]).toMatchObject({ player: P1, reason: "princess", by: P1, revealed: ["baron"] });
  });
  it("TC12：公主被卫兵猜中出局时，公主效果不额外结算（只出局一次）", () => {
    const r = act(createScene({ hands: [["guard", "spy"], ["princess"], ["baron"]], deck: ["priest", "king"] }), P1, { type: "PLAY", card: "guard", target: P2, guess: "princess" });
    expect(pl(r.state, P2).out).toBe(true);
    expect(eventsOf(r.events, "Eliminated")).toHaveLength(1);
    expect(eventsOf(r.events, "Eliminated")[0]).toMatchObject({ reason: "guard" });
  });
});

describe("规则书§5 出局", () => {
  it("规则书§5：出局的人不能被选为目标，也不能发命令（TC17）", () => {
    const s = exact(
      { players: 4, hands: [["guard", "king"], ["baron"], [], ["priest"]], out: [2], deck: ["spy", "handmaid"], setAside: "countess", discards: [[], [], ["princess"]] },
      2,
    );
    expectRejected(s, P1, { type: "PLAY", card: "guard", target: P3, guess: "spy" });
    expectRejected(s, P1, { type: "PLAY", card: "king", target: P3 });
    expectRejected(s, P3, { type: "PLAY", card: "guard", target: P2, guess: "baron" });
    expect(legalActions(s, P3)).toEqual([]);
  });
  it("TC17：不是自己回合出牌被拒绝；打不在手里的牌被拒绝；不存在的座位被拒绝", () => {
    const s = createScene({ players: 4, hands: [["guard", "king"], ["baron"], ["priest"], ["spy"]], deck: ["handmaid"] });
    expectRejected(s, P2, { type: "PLAY", card: "baron", target: P1 });
    expectRejected(s, P1, { type: "PLAY", card: "princess" });
    expectRejected(s, P1, { type: "PLAY", card: "handmaid" });
    expectRejected(s, "p9", { type: "PLAY", card: "guard", target: P2, guess: "baron" });
    expectRejected(s, P1, { type: "READY" });
    expect(legalActions(s, P2)).toEqual([]);
    expect(legalActions(s, P4)).toEqual([]);
  });
  it("规则书§8.2：legalActions 给出的每条命令都能执行", () => {
    const states = [
      createScene({ hands: [["guard", "king"], ["baron"], ["priest"]], deck: ["handmaid"] }),
      createScene({ hands: [["prince", "handmaid"], ["baron"], ["priest"]], protected: [2], discards: [[], [], ["handmaid"]], deck: ["guard"] }),
      createScene({ players: 2, hands: [["chancellor", "spy"], ["baron"]], deck: ["guard", "guard"] }),
    ];
    for (const s of states) {
      const actions = legalActions(s, cur(s));
      expect(actions.length).toBeGreaterThan(0);
      for (const c of actions) expect(() => act(s, cur(s), c), JSON.stringify(c)).not.toThrow();
    }
  });
  it("规则书§4.1 卫兵：legalActions 里卫兵的猜法正好是每个可选的人 × 9 种（不含卫兵）", () => {
    const s = createScene({ players: 4, hands: [["guard", "king"], ["baron"], ["priest"], ["spy"]], protected: [2], discards: [[], [], ["handmaid"]], deck: ["handmaid"] });
    const guards = legalActions(s, P1).filter((c) => c.type === "PLAY" && c.card === "guard");
    expect(guards).toHaveLength(2 * 9);
    expect(guards.some((c) => c.type === "PLAY" && (c.guess === "guard" || c.target === P3 || c.target === P1))).toBe(false);
  });
});

describe("开工拍板 / 规则书§4：纯函数", () => {
  it("apply 不改输入状态，version 前进", () => {
    const s = createScene({ hands: [["guard", "king"], ["baron"], ["priest"]], deck: ["handmaid", "spy"] });
    const copy = structuredClone(s);
    const next = playCard(s, P1, "guard", P2, "baron");
    expect(s).toEqual(copy);
    expect(next.version).toBeGreaterThan(s.version);
  });
  it("规则书§4：被选中的人手牌张数对（出牌后 1 张，下一位 2 张）", () => {
    const s = playCard(createScene({ players: 4, hands: [["handmaid", "king"], ["baron"], ["priest"], ["spy"]], deck: ["guard", "guard"] }), P1, "handmaid");
    expect(s.players.map((p) => p.handCount)).toEqual([1, 2, 1, 1]);
    void P3;
    void P4;
  });
});

// 角色类型的穷举检查：每种角色在这份文件里都有专门的效果测试
const COVERED: Record<Role, true> = { spy: true, guard: true, priest: true, baron: true, handmaid: true, prince: true, chancellor: true, king: true, countess: true, princess: true };
void COVERED;
