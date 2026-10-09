/**
 * 预览局面工厂（对外接口）：每个命名局面都造得出来、牌数守恒、说明里说的事真的发生；
 * createScene 的参数照写照造、自相矛盾时报错；教程剧本按补充文件 2.2 的表一步步对得上；previewRoom 包出来的快照能直接给网页用。
 */
import { describe, expect, it } from "vitest";
import { ROLE_VALUE } from "../src/cards.js";
import { applyCommand, legalActions, redactGameForViewer } from "../src/engine.js";
import {
  SCENES,
  SCENE_NOTES,
  TUTORIAL_DEAL,
  TUTORIAL_PLAYERS,
  TUTORIAL_SCRIPT,
  createScene,
  previewRoom,
  previewSocketId,
  scene,
  tutorialEndgame,
} from "../src/scenes.js";
import type { GameState } from "../src/types.js";
import { P, conservationProblem, eventsOf, play } from "./helpers.js";

describe("命名局面", () => {
  it("每个名字、每种人数都造得出来，21 张守恒，每个名字都有说明", () => {
    for (const name of SCENES) {
      expect(SCENE_NOTES[name]).toBeTruthy();
      for (const players of [2, 3, 4, 5, 6]) {
        const game = scene(name, { players });
        expect(conservationProblem(game), `${name} ${players} 人`).toBeNull();
        if (game.phase === "playing") expect(legalActions(game, game.players[game.current]!.id).length, `${name} ${players} 人`).toBeGreaterThan(0);
      }
    }
  });

  it("说明里写的事真的成立（3 人）", () => {
    const at = (name: (typeof SCENES)[number]) => scene(name);
    expect(at("opening")).toMatchObject({ round: 1, current: 0, phase: "playing" });
    for (const [name, card] of [
      ["my-turn-spy", "spy"], ["my-turn-guard", "guard"], ["my-turn-priest", "priest"], ["my-turn-baron", "baron"],
      ["my-turn-handmaid", "handmaid"], ["my-turn-prince", "prince"], ["my-turn-chancellor", "chancellor"],
      ["my-turn-king", "king"], ["my-turn-countess", "countess"], ["my-turn-princess", "princess"],
    ] as const) {
      const game = at(name);
      expect(game.players[0]!.hand).toContain(card);
      expect(legalActions(game, "p1").some((command) => command.type === "PLAY" && command.card === card)).toBe(true);
    }
    expect(legalActions(at("countess-forced"), "p1")).toEqual([{ type: "PLAY", card: "countess" }]);
    expect(at("chancellor-choose")).toMatchObject({ stage: "chancellor" });
    expect(at("chancellor-choose").players[0]!.hand).toHaveLength(3);
    expect(at("chancellor-last-card").players[0]!.hand).toHaveLength(2);
    expect(legalActions(at("all-protected"), "p1")).toContainEqual({ type: "PLAY", card: "guard" });
    expect(legalActions(at("all-protected"), "p1").filter((command) => command.type === "PLAY" && command.card === "prince")).toEqual([{ type: "PLAY", card: "prince", target: "p1" }]);
    for (const command of legalActions(at("prince-princess-trap"), "p1")) {
      expect(P(applyCommand(at("prince-princess-trap"), "p1", command), "p1").out).toBe(true);
    }
    expect(at("prince-empty-deck").deckCount).toBe(0);
    expect(at("others-turn").current).toBe(1);
    expect(eventsOf(at("after-guard-miss").events, "Guessed")[0]?.hit).toBe(false);
    expect(P(at("after-guard-hit"), "p2").out).toBe(true);
    expect(eventsOf(redactGameForViewer(at("after-priest"), "p1").events, "Peeked")[0]?.card).toBeTruthy();
    expect(eventsOf(at("after-baron-win").events, "Compared")[0]?.loser).toBe("p2");
    expect(eventsOf(at("after-baron-tie").events, "Compared")[0]?.loser).toBeNull();
    expect(eventsOf(at("after-king").events, "Swapped")).toHaveLength(1);
    expect(P(at("after-prince"), "p2").spy).toBe(true);
    expect(eventsOf(at("after-chancellor").events, "ChancellorReturned")).toHaveLength(1);
    expect(P(at("i-am-out"), "p1").out).toBe(true);
    expect(at("two-player").faceUp).toHaveLength(3);
    expect(at("six-player").players).toHaveLength(6);
    expect(at("timeout").events[0]?.type).toBe("TurnTimedOut");
    expect(at("round-end-showdown").lastRound).toMatchObject({ reason: "showdown", winners: ["p1"] });
    expect(at("round-end-tie").lastRound?.winners).toEqual(["p1", "p2"]);
    expect(at("round-end-last-standing").lastRound).toMatchObject({ reason: "lastStanding", winners: ["p1"] });
    expect(at("round-end-spy").lastRound).toMatchObject({ winners: ["p2"], spyBonus: "p1" });
    expect(at("round-end-spy-double").lastRound).toMatchObject({ winners: ["p1"], spyBonus: "p1", awards: { p1: 2 } });
    expect(at("round-start-next")).toMatchObject({ phase: "playing", round: 2, current: 0 });
    expect(at("game-over")).toMatchObject({ phase: "finished", winners: ["p1"] });
    expect(at("game-over-tie")).toMatchObject({ phase: "finished", winners: ["p1", "p2"] });
  });

  it("结算类局面在 2–6 人都成立（赢家、间谍 +1、整场结束）", () => {
    for (const players of [2, 3, 4, 5, 6]) {
      expect(scene("round-end-tie", { players }).lastRound?.winners).toEqual(["p1", "p2"]);
      expect(scene("round-end-spy", { players }).lastRound).toMatchObject({ winners: ["p2"], spyBonus: "p1" });
      expect(scene("round-end-spy-double", { players }).lastRound?.awards).toEqual({ p1: 2 });
      expect(scene("game-over", { players }).winners).toEqual(["p1"]);
      expect(scene("game-over-tie", { players }).winners).toEqual(["p1", "p2"]);
    }
  });
});

describe("createScene 按参数造精确局面", () => {
  it("照写照造：手牌、打出区、出局、保护、标记、牌堆顺序、移出的牌、步骤", () => {
    const game = createScene({
      players: 4,
      current: 2,
      hands: [["baron"], [], ["guard", "king"], ["priest"]],
      discards: [["handmaid"], ["spy", { card: "countess", how: "eliminated" }], [], []],
      out: [1],
      protected: [0],
      tokens: [1, 2, 0, 3],
      deck: ["princess", "prince"],
      setAside: "chancellor",
      round: 3,
      turn: 9,
    });
    expect(game.players.map((player) => player.hand)).toEqual([["baron"], [], ["guard", "king"], ["priest"]]);
    expect(game.players[1]).toMatchObject({ out: true, spy: true });
    expect(game.players[0]).toMatchObject({ protected: true, tokens: 1 });
    expect(game.deck!.slice(0, 2)).toEqual(["princess", "prince"]);
    expect(game.setAside).toBe("chancellor");
    expect(game).toMatchObject({ current: 2, round: 3, turn: 9, stage: "play", phase: "playing" });
    expect(conservationProblem(game)).toBeNull();
    // 能接着往下走
    const next = play(game, "p3", "guard", "p4", "priest");
    expect(P(next, "p4").out).toBe(true);
  });

  it("leftovers: error 时必须写全 21 张；写全了就是精确局面", () => {
    expect(() => createScene({ hands: [["guard", "king"]], leftovers: "error" })).toThrow("没写到");
    const exact = tutorialEndgame();
    expect(conservationProblem(exact)).toBeNull();
    expect(exact.deckCount).toBe(0);
  });

  it("自相矛盾的写法报错", () => {
    expect(() => createScene({ hands: [["king", "king"]] })).toThrow("国王一共只有 1 张");
    expect(() => createScene({ hands: [["guard"]] })).toThrow("出牌前手里是 2 张");
    expect(() => createScene({ hands: [["guard", "king"], ["priest", "baron"]] })).toThrow("没轮到的人手里是 1 张");
    expect(() => createScene({ out: [0] })).toThrow("轮到的人不能已经出局");
    expect(() => createScene({ out: [1], hands: [undefined, ["guard"]] })).toThrow("已经出局");
    expect(() => createScene({ protected: [0] })).toThrow("受保护");
    expect(() => createScene({ out: [1, 2] })).toThrow("至少要有 2 个人");
    expect(() => createScene({ discards: [["princess"]] })).toThrow("应该已经出局");
    expect(() => createScene({ players: 3, faceUp: ["guard", "guard", "guard"] })).toThrow("3 人以上");
    expect(() => createScene({ players: 7 })).toThrow("2–6");
  });

  it("2 人局自动补 3 张明牌；补的牌按种子固定", () => {
    const game = createScene({ players: 2 });
    expect(game.faceUp).toHaveLength(3);
    expect(JSON.stringify(createScene({ players: 2, seed: 5 }))).toBe(JSON.stringify(createScene({ players: 2, seed: 5 })));
  });
});

describe("教程剧本（补充文件 2.2）", () => {
  it("第一段：固定发牌 21 张守恒、你先手", () => {
    const game = scene("tutorial-start");
    expect(game.players.map((player) => player.name)).toEqual(TUTORIAL_PLAYERS.map((player) => player.name));
    expect(game.players[0]!.hand).toEqual(["countess", "guard"]);
    expect(game.players[1]!.hand).toEqual(["priest"]);
    expect(game.players[2]!.hand).toEqual(["spy"]);
    expect(game.deckCount).toBe(TUTORIAL_DEAL.deck.length - 1);
    expect(conservationProblem(game)).toBeNull();
  });

  it("11 个回合每一步都和表里一样，最后你以「只剩一人」赢 +1，没人拿间谍分", () => {
    let game: GameState = scene("tutorial-start");
    const step = (index: number) => {
      const entry = TUTORIAL_SCRIPT[index]!;
      expect(legalActions(game, entry.player), entry.note).toContainEqual(entry.command);
      game = applyCommand(game, entry.player, entry.command);
      return game;
    };
    // 1 你：女伯爵 + 卫兵，卫兵点一号猜男爵，没中，什么都不公开
    step(0);
    expect(eventsOf(game.events, "Guessed")[0]).toMatchObject({ target: "p2", guess: "baron", hit: false });
    // 2 一号：牧师 + 侍女，牧师看你 → 一号知道你是女伯爵；你只知道「一号看了你的牌」
    expect(P(game, "p2").hand).toEqual(["priest", "handmaid"]);
    step(1);
    expect(eventsOf(redactGameForViewer(game, "p2").events, "Peeked")[0]?.card).toBe("countess");
    expect(eventsOf(redactGameForViewer(game, "p1").events, "Peeked")[0]).toEqual({ type: "Peeked", player: "p2", target: "p1" });
    // 3 二号：间谍 + 男爵，打间谍 → 有间谍资格
    expect(P(game, "p3").hand).toEqual(["spy", "baron"]);
    step(2);
    expect(P(game, "p3").spy).toBe(true);
    // 4 你：女伯爵 + 王子，只能打女伯爵；别人看不到你的王子
    expect(P(game, "p1").hand).toEqual(["countess", "prince"]);
    expect(legalActions(game, "p1")).toEqual([{ type: "PLAY", card: "countess" }]);
    step(3);
    expect(P(redactGameForViewer(game, "p2"), "p1").hand).toEqual([]);
    // 5 一号：侍女 + 卫兵，打侍女
    step(4);
    expect(P(game, "p2").protected).toBe(true);
    // 6 二号：男爵 + 国王，国王只能和你换（一号受保护）
    expect(legalActions(game, "p3").filter((command) => command.type === "PLAY" && command.card === "king")).toEqual([{ type: "PLAY", card: "king", target: "p1" }]);
    step(5);
    expect(P(game, "p3").hand).toEqual(["prince"]);
    expect(P(game, "p1").hand[0]).toBe("baron");
    // 7 你：男爵 + 卫兵，卫兵点二号（一号还在保护中）猜王子 → 命中，二号出局亮出王子
    expect(P(game, "p1").hand).toEqual(["baron", "guard"]);
    expect(legalActions(game, "p1").some((command) => command.type === "PLAY" && command.target === "p2")).toBe(false);
    step(6);
    expect(eventsOf(game.events, "Eliminated")[0]).toMatchObject({ player: "p3", reason: "guard", revealed: ["prince"] });
    // 8 一号：卫兵 + 王子，王子点你 → 你弃男爵，重抽到大臣
    expect(P(game, "p2")).toMatchObject({ hand: ["guard", "prince"], protected: false });
    step(7);
    expect(eventsOf(game.events, "Discarded")[0]).toMatchObject({ player: "p1", card: "baron" });
    expect(eventsOf(game.events, "Drew").find((event) => event.reason === "prince")?.card).toBe("chancellor");
    // 9 你：大臣 + 卫兵，打大臣抽到公主、牧师；留公主，卫兵和牧师放回牌堆底 → 牌堆回到 7 张
    expect(P(game, "p1").hand).toEqual(["chancellor", "guard"]);
    step(8);
    expect(P(game, "p1").hand).toEqual(["guard", "princess", "priest"]);
    step(9);
    expect(P(game, "p1")).toMatchObject({ hand: ["princess"], out: false });
    // 10 一号：卫兵 + 间谍，打间谍（这时一号抽走 1 张，牌堆 6 张）
    expect(game.deckCount + 1).toBe(7);
    expect(P(game, "p2").hand).toEqual(["guard", "spy"]);
    step(10);
    expect(P(game, "p2").spy).toBe(true);
    // 11 你：公主 + 男爵，男爵比一号：公主(9) 赢卫兵(1)，只剩你，你赢 +1；两个打过间谍的都出局了，没人拿间谍分
    expect(P(game, "p1").hand).toEqual(["princess", "baron"]);
    step(11);
    expect(eventsOf(game.events, "Compared")[0]).toMatchObject({ loser: "p2", playerCard: "princess", targetCard: "guard" });
    expect(game.lastRound).toMatchObject({ reason: "lastStanding", winners: ["p1"], spyBonus: null, awards: { p1: 1 }, nextStarter: "p1" });
    expect(TUTORIAL_SCRIPT).toHaveLength(12);
  });

  it("第二段残局：打侍女后牌堆空亮牌，你和一号都是王子 → 平局各 +1，你再拿间谍 +1；下一局先手在你们俩里随机", () => {
    const game = tutorialEndgame();
    expect(P(game, "p1").hand).toEqual(["prince", "handmaid"]);
    expect(P(game, "p2")).toMatchObject({ hand: ["prince"], spy: false });
    expect(P(game, "p3")).toMatchObject({ out: true, spy: true });
    expect(P(game, "p1").spy).toBe(true);
    const ended = play(game, "p1", "handmaid");
    expect(ended.lastRound).toMatchObject({ reason: "showdown", winners: ["p1", "p2"], spyBonus: "p1", awards: { p1: 2, p2: 1 } });
    expect(["p1", "p2"]).toContain(ended.lastRound?.nextStarter);
    expect(ROLE_VALUE.prince).toBe(5);
  });
});

describe("previewRoom 包成房间快照", () => {
  it("默认从 p1 看：牌已裁剪、有倒计时、成员和座位对得上", () => {
    const game = scene("my-turn-guard");
    const room = previewRoom(game);
    expect(room.status).toBe("playing");
    expect(room.members.map((member) => member.playerId)).toEqual(["p1", "p2", "p3"]);
    expect(room.members[0]).toMatchObject({ id: previewSocketId("p1"), isHost: true, connected: true });
    expect(room.game!.players[0]!.hand).toEqual(game.players[0]!.hand);
    expect(room.game!.players[1]!.hand).toEqual([]);
    expect("deck" in room.game!).toBe(false);
    expect(room.turnRemainingMs).toBe(30_000);
  });

  it("对手离线、人机、托管：轮到他们时没有倒计时", () => {
    const game = scene("others-turn");
    expect(previewRoom(game, { offline: ["p2"] }).members[1]!.connected).toBe(false);
    expect(previewRoom(game, { offline: ["p2"] }).turnRemainingMs).toBeUndefined();
    expect(previewRoom(game, { bots: ["p2"] }).members[1]!.bot).toBe(true);
    expect(previewRoom(game, { auto: ["p2"] }).members[1]!.auto).toBe(true);
    expect(previewRoom(game, { turnRemainingMs: 5000 }).turnRemainingMs).toBe(5000);
    expect(previewRoom(game, { turnRemainingMs: null }).turnRemainingMs).toBeUndefined();
  });

  it("观战视角：默认看不到手牌，「看手牌」时看得到，房间码为空", () => {
    const game = scene("my-turn-guard");
    const blind = previewRoom(game, { spectator: {} });
    expect(blind.code).toBe("");
    expect(blind.spectators).toHaveLength(1);
    expect(blind.game!.players.every((player) => player.hand.length === 0)).toBe(true);
    const all = previewRoom(game, { spectator: { seeAllHands: true } });
    expect(all.access.spectatorsSeeAll).toBe(true);
    expect(all.game!.players.every((player) => player.hand.length > 0)).toBe(true);
  });

  it("整场结束时带再来一局的投票；没有对局时是等候房间", () => {
    expect(previewRoom(scene("game-over")).rematch).toBeTruthy();
    expect(previewRoom(undefined).status).toBe("waiting");
  });
});
