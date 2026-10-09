/**
 * 隐藏信息：对每个玩家视角和观战视角（默认 / 看手牌）逐项检查 redactGameForViewer。
 * 牌堆顺序、种子、面朝下移出的牌、别人的手牌、各种私密事件都拿不到。
 */
import { describe, expect, it } from "vitest";
import { redactGameForViewer } from "../src/engine.js";
import { createScene, scene } from "../src/scenes.js";
import type { GameState } from "../src/types.js";
import { eventsOf, keep, play } from "./helpers.js";

const SERVER_ONLY = ["deck", "setAside", "seed", "rngState", "actions"];
const VIEWERS = ["p1", "p2", "p3", ""] as const;

function views(game: GameState) {
  return {
    p1: redactGameForViewer(game, "p1"),
    p2: redactGameForViewer(game, "p2"),
    p3: redactGameForViewer(game, "p3"),
    spectator: redactGameForViewer(game, ""),
    god: redactGameForViewer(game, "", { seeAllHands: true }),
  };
}

describe("裁剪：每个视角都拿不到服务器字段", () => {
  it("牌堆、移出的牌、种子、随机数状态、动作序列都不在；牌堆张数在", () => {
    const game = scene("opening");
    for (const view of Object.values(views(game))) {
      for (const key of SERVER_ONLY) expect(key in view, key).toBe(false);
      expect(view.deckCount).toBe(game.deckCount);
    }
  });

  it("不改原状态，裁剪出来的是新对象", () => {
    const game = scene("after-priest");
    const before = JSON.stringify(game);
    const view = redactGameForViewer(game, "p2");
    view.players[0]!.hand.push("princess");
    expect(JSON.stringify(game)).toBe(before);
  });
});

describe("裁剪：手牌", () => {
  it("每个座位只看到自己的手牌，别人只给张数；观战默认谁都看不到，「看手牌」看得到全部", () => {
    const game = scene("my-turn-guard");
    const all = views(game);
    for (const viewer of ["p1", "p2", "p3"] as const) {
      for (const player of all[viewer].players) {
        expect(player.hand).toEqual(player.id === viewer ? game.players[player.seat]!.hand : []);
        expect(player.handCount).toBe(game.players[player.seat]!.hand.length);
      }
    }
    expect(all.spectator.players.every((player) => player.hand.length === 0)).toBe(true);
    expect(all.god.players.map((player) => player.hand)).toEqual(game.players.map((player) => player.hand));
  });

  it("每个座位的视角里，别人抽到的牌都没有牌面", () => {
    const game = scene("opening");
    const drew = eventsOf(game.history, "Drew")[0]!;
    expect(drew.card).toBeTruthy();
    expect(eventsOf(redactGameForViewer(game, "p1").history, "Drew")[0]?.card).toBe(drew.card);
    for (const viewer of ["p2", "p3", ""]) expect("card" in eventsOf(redactGameForViewer(game, viewer).history, "Drew")[0]!).toBe(false);
  });
});

describe("裁剪：私密事件", () => {
  it("牧师：只有出牧师的人（和观战看手牌）看得到牌面", () => {
    const all = views(scene("after-priest"));
    expect(eventsOf(all.p1.history, "Peeked")[0]?.card).toBeTruthy();
    for (const view of [all.p2, all.p3, all.spectator]) expect("card" in eventsOf(view.history, "Peeked")[0]!).toBe(false);
    expect(eventsOf(all.god.history, "Peeked")[0]?.card).toBeTruthy();
  });

  it("男爵：比牌的两人看得到两张牌，第三人和观战只看到结果", () => {
    const all = views(scene("after-baron-tie"));
    for (const view of [all.p1, all.p2, all.god]) expect(eventsOf(view.history, "Compared")[0]).toMatchObject({ playerCard: "priest", targetCard: "priest" });
    for (const view of [all.p3, all.spectator]) expect(eventsOf(view.history, "Compared")[0]).toEqual({ type: "Compared", player: "p1", target: "p2", loser: null });
  });

  it("国王：换牌的两人看得到换到了什么，第三人和观战只知道谁和谁换了", () => {
    const all = views(scene("after-king"));
    for (const view of [all.p1, all.p2, all.god]) expect(eventsOf(view.history, "Swapped")[0]?.playerGot).toBeTruthy();
    for (const view of [all.p3, all.spectator]) expect(eventsOf(view.history, "Swapped")[0]).toEqual({ type: "Swapped", player: "p1", target: "p2" });
  });

  it("大臣：抽到的牌只给他自己（观战看手牌也能看，因为在他手里）；放回牌堆底的牌只给他自己，观战看手牌也看不到", () => {
    const drawn = play(createScene({ hands: [["chancellor", "guard"]], deck: ["princess", "baron"] }), "p1", "chancellor");
    const chosen = keep(drawn, "p1", "princess", ["baron", "guard"]);
    const before = views(drawn);
    expect(eventsOf(before.p1.history, "ChancellorDrew")[0]?.cards).toEqual(["princess", "baron"]);
    expect(eventsOf(before.god.history, "ChancellorDrew")[0]?.cards).toEqual(["princess", "baron"]);
    for (const view of [before.p2, before.p3, before.spectator]) {
      expect(eventsOf(view.history, "ChancellorDrew")[0]).toEqual({ type: "ChancellorDrew", player: "p1", count: 2 });
      expect(view.players[0]!.handCount).toBe(3);
    }
    const after = views(chosen);
    expect(eventsOf(after.p1.history, "ChancellorReturned")[0]?.cards).toEqual(["baron", "guard"]);
    for (const view of [after.p2, after.p3, after.spectator, after.god]) {
      expect(eventsOf(view.history, "ChancellorReturned")[0]).toEqual({ type: "ChancellorReturned", player: "p1", count: 2 });
    }
  });

  it("王子在牌堆空时：拿走移出牌的人看得到，其他人和观战只知道他拿走了移出的牌", () => {
    const game = play(scene("prince-empty-deck"), "p1", "prince", "p2");
    const all = views(game);
    const redraw = (view: GameState) => eventsOf(view.history, "Drew").find((event) => event.reason === "prince")!;
    expect(redraw(all.p2).card).toBe("king");
    for (const view of [all.p1, all.p3, all.spectator]) expect(redraw(view)).toEqual({ type: "Drew", player: "p2", reason: "prince", source: "setAside" });
    expect(game.setAsideTaken).toBe(true);
  });

  it("公开事件人人都有：卫兵点了谁猜什么中没中、王子弃掉什么、出局亮出的牌", () => {
    const guard = scene("after-guard-hit");
    for (const viewer of VIEWERS) {
      const view = redactGameForViewer(guard, viewer);
      expect(eventsOf(view.history, "Guessed")[0]).toMatchObject({ player: "p1", target: "p2", guess: "baron", hit: true });
      expect(eventsOf(view.history, "Eliminated")[0]?.revealed).toEqual(["baron"]);
    }
    const prince = scene("after-prince");
    for (const viewer of VIEWERS) expect(eventsOf(redactGameForViewer(prince, viewer).history, "Discarded")[0]).toMatchObject({ player: "p2", card: "spy" });
  });

  it("结算：亮牌、移出的牌、间谍 +1 人人可见；只剩一人时赢家的牌不公开", () => {
    const showdown = scene("round-end-showdown");
    for (const viewer of VIEWERS) {
      expect(redactGameForViewer(showdown, viewer).lastRound).toEqual(showdown.lastRound);
    }
    const last = scene("round-end-last-standing");
    expect(redactGameForViewer(last, "p2").players[0]!.hand).toEqual([]);
    expect(redactGameForViewer(last, "p2").lastRound?.hands).toEqual({});
  });
});
