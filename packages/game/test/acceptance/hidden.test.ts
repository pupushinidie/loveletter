/**
 * 规则核对：隐藏信息（规则书 §4.2、§8.3；勘误 3.2 #3、3.3 #6；补充用例 补1、补8、补13、补16；开工拍板）。
 * 对每个座位和观战（普通 / 看手牌）检查 redactGameForViewer：别人的手牌、牌堆、移出的牌、
 * 牧师看到的牌、男爵 / 国王的牌面、大臣放回的牌都拿不到。
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  createRng,
  createScene,
  legalActions,
  redactGameForViewer,
  scenePlayers,
  timeoutTurn,
  type GameEvent,
  type GameState,
} from "../../src/index.js";
import { P1, P2, P3, act, cur, eventsOf, exact, playCard, sorted } from "./helpers.js";

interface Viewer {
  readonly id: string; // 座位 id；观战是 ""
  readonly seeAll: boolean;
}

function viewersOf(state: GameState): Viewer[] {
  return [...state.players.map((p) => ({ id: p.id, seeAll: false })), { id: "", seeAll: false }, { id: "", seeAll: true }];
}

function viewOf(state: GameState, v: Viewer): GameState {
  return v.seeAll ? redactGameForViewer(state, v.id, { seeAllHands: true }) : redactGameForViewer(state, v.id);
}

/** 这个视角能不能看某个事件的私密内容（规则要求「不能看」的情况返回 false）。 */
function maySee(e: GameEvent, v: Viewer): boolean {
  switch (e.type) {
    case "Drew":
    case "ChancellorDrew":
      return v.seeAll || v.id === e.player;
    case "Peeked":
      return v.seeAll || v.id === e.player;
    case "Compared":
    case "Swapped":
      return v.seeAll || v.id === e.player || v.id === e.target;
    case "ChancellorReturned":
      return v.id === e.player; // 牌堆里的牌：观战看手牌也不行
    default:
      return true;
  }
}

function privateFields(e: GameEvent): Record<string, unknown> {
  switch (e.type) {
    case "Drew":
      return { card: e.card };
    case "ChancellorDrew":
    case "ChancellorReturned":
      return { cards: e.cards };
    case "Peeked":
      return { card: e.card };
    case "Compared":
      return { playerCard: e.playerCard, targetCard: e.targetCard };
    case "Swapped":
      return { playerGot: e.playerGot, targetGot: e.targetGot };
    default:
      return {};
  }
}

/** 返回发现的问题（空数组 = 没问题）。只查「不该看的看不到」和公开部分一致。 */
function auditView(full: GameState, v: Viewer): string[] {
  const view = viewOf(full, v);
  const tag = v.id === "" ? (v.seeAll ? "观战(看手牌)" : "观战") : v.id;
  const bad: string[] = [];
  for (const key of ["deck", "setAside", "seed", "rngState", "actions"] as const) {
    if (view[key] !== undefined) bad.push(`${tag} 拿到了 ${key}`);
  }
  view.players.forEach((p, i) => {
    const real = full.players[i];
    if (!real) return;
    const canSee = v.seeAll || v.id === p.id;
    if (canSee) {
      if (JSON.stringify(sorted(p.hand)) !== JSON.stringify(sorted(real.hand))) bad.push(`${tag} 看自己 / 看手牌时 ${p.id} 手牌不对`);
    } else if (p.hand.length !== 0) {
      bad.push(`${tag} 看到了 ${p.id} 的手牌 ${p.hand.join(",")}`);
    }
    if (p.handCount !== real.handCount) bad.push(`${tag} 看到的 ${p.id} 张数不对`);
    if (JSON.stringify(p.discards) !== JSON.stringify(real.discards)) bad.push(`${tag} 看到的 ${p.id} 打出区不对（应公开）`);
    if (p.out !== real.out || p.protected !== real.protected || p.tokens !== real.tokens || p.spy !== real.spy) bad.push(`${tag} 看到的 ${p.id} 公开状态不对`);
  });
  if (JSON.stringify(view.faceUp) !== JSON.stringify(full.faceUp)) bad.push(`${tag} 看到的明牌不对（应公开）`);
  if (view.deckCount !== full.deckCount) bad.push(`${tag} 看到的牌堆张数不对（应公开）`);
  if (JSON.stringify(view.lastRound) !== JSON.stringify(full.lastRound)) bad.push(`${tag} 看到的结算和实际不一致（应公开）`);
  if (view.setAsideTaken !== full.setAsideTaken) bad.push(`${tag} 看到的「移出的牌被拿走」不对（应公开）`);
  for (const list of ["history", "events"] as const) {
    const evs = view[list];
    const realEvs = full[list];
    if (evs.length !== realEvs.length) {
      bad.push(`${tag} ${list} 条数不对`);
      continue;
    }
    evs.forEach((e, i) => {
      const fields = privateFields(e);
      if (!maySee(e, v)) {
        for (const [k, val] of Object.entries(fields)) if (val !== undefined) bad.push(`${tag} 在 ${list} 的 ${e.type} 里看到了 ${k}=${JSON.stringify(val)}`);
      }
      // 公开字段要和完整状态一致
      const strip = (x: GameEvent) => {
        const copy: Record<string, unknown> = { ...x };
        for (const k of Object.keys(privateFields(x))) delete copy[k];
        return JSON.stringify(copy);
      };
      const real = realEvs[i];
      if (real && strip(e) !== strip(real)) bad.push(`${tag} 在 ${list} 的 ${e.type} 公开字段和实际不一致`);
    });
  }
  return bad;
}

function auditAll(full: GameState): string[] {
  return viewersOf(full).flatMap((v) => auditView(full, v));
}

describe("规则书§4.2 / §8.3 隐藏信息：每个座位和观战", () => {
  it("开局：别人的手牌、牌堆、移出的牌、种子都看不到（2–6 人）", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = createGame(scenePlayers(n), 99);
      expect(auditAll(s), `${n} 人`).toEqual([]);
      const spectator = redactGameForViewer(s, "");
      expect(spectator.players.every((p) => p.hand.length === 0)).toBe(true);
      const seeAll = redactGameForViewer(s, "", { seeAllHands: true });
      expect(seeAll.players.every((p) => p.hand.length === p.handCount)).toBe(true);
      expect(seeAll.deck).toBeUndefined();
      expect(seeAll.setAside).toBeUndefined();
    }
  });
  it("补13：2 人局 3 张明牌两个座位和观战都看得到", () => {
    const s = createGame(scenePlayers(2), 3);
    for (const v of viewersOf(s)) expect(viewOf(s, v).faceUp).toEqual(s.faceUp);
  });
  it("TC5：牧师看到的牌只有出牧师的人知道；被看的人、第三方、观战的事件里都没有牌面", () => {
    const r = act(createScene({ hands: [["priest", "spy"], ["king"], ["baron"]], deck: ["guard", "handmaid"] }), P1, { type: "PLAY", card: "priest", target: P2 });
    expect(auditAll(r.state)).toEqual([]);
    const mine = eventsOf(redactGameForViewer(r.state, P1).history, "Peeked")[0];
    expect(mine?.card).toBe("king");
    for (const id of [P2, P3, ""]) expect(eventsOf(redactGameForViewer(r.state, id).history, "Peeked")[0]?.card, id).toBeUndefined();
  });
  it("补1：男爵平手：甲乙互相看得到对方的牌，丙和观战只看到平手", () => {
    const r = act(createScene({ hands: [["baron", "priest"], ["priest"], ["guard"]], deck: ["spy", "handmaid"] }), P1, { type: "PLAY", card: "baron", target: P2 });
    expect(auditAll(r.state)).toEqual([]);
    for (const id of [P1, P2]) expect(eventsOf(redactGameForViewer(r.state, id).history, "Compared")[0], id).toMatchObject({ loser: null, playerCard: "priest", targetCard: "priest" });
    for (const id of [P3, ""]) {
      const c = eventsOf(redactGameForViewer(r.state, id).history, "Compared")[0];
      expect(c, id).toMatchObject({ loser: null });
      expect(c?.playerCard, id).toBeUndefined();
      expect(c?.targetCard, id).toBeUndefined();
    }
  });
  it("规则书§8.6：男爵分出胜负：赢家的牌不公开，输家的牌随出局公开", () => {
    const r = act(createScene({ hands: [["baron", "king"], ["prince"], ["guard"]], deck: ["spy", "handmaid"] }), P1, { type: "PLAY", card: "baron", target: P2 });
    expect(auditAll(r.state)).toEqual([]);
    const third = redactGameForViewer(r.state, P3);
    expect(eventsOf(third.history, "Compared")[0]?.playerCard).toBeUndefined();
    expect(eventsOf(third.history, "Eliminated")[0]).toMatchObject({ player: P2, revealed: ["prince"] });
    expect(JSON.stringify(third)).not.toContain('"king"'); // 国王只在甲手里，丙不该在任何地方看到
  });
  it("规则书§4.1 国王：换到的牌只有换牌的两人知道", () => {
    const r = act(createScene({ hands: [["king", "princess"], ["guard"], ["baron"]], deck: ["spy", "handmaid", "priest"] }), P1, { type: "PLAY", card: "king", target: P2 });
    expect(auditAll(r.state)).toEqual([]);
    for (const id of [P3, ""]) expect(JSON.stringify(redactGameForViewer(r.state, id)), id).not.toContain('"princess"');
    expect(eventsOf(redactGameForViewer(r.state, P2).history, "Swapped")[0]).toMatchObject({ targetGot: "princess", playerGot: "guard" });
    expect(eventsOf(redactGameForViewer(r.state, P1).history, "Swapped")[0]).toMatchObject({ targetGot: "princess", playerGot: "guard" });
  });
  it("规则书§4.1 大臣：抽到的牌和放回牌堆底的牌只有自己知道；观战看手牌也看不到放回的牌", () => {
    let s = createScene({ hands: [["chancellor", "guard"], ["baron"], ["spy"]], deck: ["princess", "countess", "handmaid", "priest"] });
    s = playCard(s, P1, "chancellor");
    expect(auditAll(s)).toEqual([]);
    expect(JSON.stringify(redactGameForViewer(s, P2))).not.toContain('"princess"');
    const r = act(s, P1, { type: "CHANCELLOR", keep: "guard", bottom: ["princess", "countess"] });
    expect(auditAll(r.state)).toEqual([]);
    for (const v of [{ id: P2, seeAll: false }, { id: P3, seeAll: false }, { id: "", seeAll: false }, { id: "", seeAll: true }]) {
      const view = viewOf(r.state, v);
      const ret = eventsOf(view.history, "ChancellorReturned")[0];
      expect(ret, JSON.stringify(v)).toMatchObject({ count: 2 });
      expect(ret?.cards, JSON.stringify(v)).toBeUndefined();
      // 观战「看手牌」在留牌时本来就看得到 3 张手牌，能推出放回的是哪两张；这里只要求顺序不给
      if (!v.seeAll) expect(JSON.stringify(view), JSON.stringify(v)).not.toContain('"princess"');
    }
    expect(eventsOf(redactGameForViewer(r.state, P1).history, "ChancellorReturned")[0]?.cards).toEqual(["princess", "countess"]);
  });
  it("补8 / 补16 / 勘误3.2#3：2 人局牌堆空时王子让乙拿走移出的牌：明牌不动；甲和观战都只知道「乙拿走了移出的牌」", () => {
    const s = exact(
      { players: 2, hands: [["prince", "handmaid"], ["priest"]], deck: [], setAside: "king", faceUp: ["princess", "baron", "guard"], discards: [[], ["spy", "spy"]] },
      1,
    );
    const r = act(s, P1, { type: "PLAY", card: "prince", target: P2 });
    expect(r.state.faceUp).toEqual(["princess", "baron", "guard"]);
    expect(r.state.setAsideTaken).toBe(true);
    // 回合结束牌堆空 → 比牌：乙国王(7) 比甲侍女(4)
    expect(r.state.lastRound).toMatchObject({ reason: "showdown", winners: [P2], hands: { [P1]: "handmaid", [P2]: "king" } });
    expect(auditAll(r.state)).toEqual([]);
    for (const v of [{ id: P1, seeAll: false }, { id: "", seeAll: false }]) {
      const drew = eventsOf(viewOf(r.state, v).history, "Drew").find((e) => e.player === P2 && e.reason === "prince");
      expect(drew, JSON.stringify(v)).toMatchObject({ source: "setAside" });
      expect(drew?.card, JSON.stringify(v)).toBeUndefined();
    }
    expect(eventsOf(redactGameForViewer(r.state, P2).history, "Drew").find((e) => e.reason === "prince")?.card).toBe("king");
  });
  it("勘误3.2#3：3 人局牌堆空时王子让丙拿走移出的牌，甲、乙、观战在事件里都看不到是什么", () => {
    const s = exact({ hands: [["prince", "guard"], ["princess"], ["baron"]], deck: [], setAside: "king", discards: [[], ["spy", "spy"]] }, 1);
    const r = act(s, P1, { type: "PLAY", card: "prince", target: P3 });
    expect(auditAll(r.state)).toEqual([]);
  });
  it("开工拍板：观战默认看不到任何手牌；房主开了「观战看手牌」才看得到，牌堆和移出的牌照样看不到", () => {
    const s = createScene({ players: 4, hands: [["guard", "king"], ["baron"], ["priest"], ["spy"]], deck: ["handmaid"] });
    expect(redactGameForViewer(s, "").players.map((p) => p.hand.length)).toEqual([0, 0, 0, 0]);
    expect(redactGameForViewer(s, "", { seeAllHands: true }).players.map((p) => p.hand.length)).toEqual([2, 1, 1, 1]);
  });
  it("规则书§8.3：裁剪后的视角里 legalActions 照样能用（和完整状态给出的一样）", () => {
    const s = createScene({ hands: [["guard", "prince"], ["baron"], ["priest"]], protected: [2], discards: [[], [], ["handmaid"]], deck: ["handmaid", "spy"] });
    expect(legalActions(redactGameForViewer(s, P1), P1)).toEqual(legalActions(s, P1));
  });
});

describe("规则书§4.2 隐藏信息：随机整场里每一步、每个视角", () => {
  it("2–6 人各 25 场随机整场（混入超时），每一步每个座位和两种观战都不泄露", () => {
    const problems: string[] = [];
    for (const n of [2, 3, 4, 5, 6]) {
      for (let g = 0; g < 25; g += 1) {
        const pick = createRng(1000 * n + g);
        let s = createGame(scenePlayers(n), 5000 * n + g);
        for (let step = 0; step < 2000 && s.phase !== "finished"; step += 1) {
          if (s.phase === "roundEnd" || pick.int(5) === 0) {
            s = timeoutTurn(s);
          } else {
            const actor = cur(s);
            const moves = legalActions(s, actor);
            const move = moves[pick.int(moves.length)];
            if (!move) {
              problems.push(`${n} 人 第 ${g} 场 第 ${step} 步：轮到 ${actor} 却没有合法行动`);
              break;
            }
            s = act(s, actor, move, pick.int(1 << 30)).state;
          }
          if (problems.length < 20) problems.push(...auditAll(s).map((x) => `${n} 人 第 ${g} 场 第 ${step} 步：${x}`));
        }
        if (s.phase !== "finished") problems.push(`${n} 人 第 ${g} 场 2000 步内没打完`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  }, 60_000);
});
