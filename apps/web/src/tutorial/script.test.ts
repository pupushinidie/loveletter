import { describe, expect, it } from "vitest";
import { botCommand, legalActions, redactGameForViewer, type GameState } from "@loveletter/game";
import {
  anchorVisible,
  createPracticeGame,
  createTutorialGame,
  playSubs,
  RIVAL_1,
  RIVAL_2,
  sameCommand,
  sentences,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  tutorialApply,
} from "./script.js";

const NAME = "小蒲";

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length): GameState {
  let game = createTutorialGame(NAME);
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = tutorialApply(game, TUTORIAL_SELF, step.expect, true, NAME);
    if (step.kind === "watch") for (const move of step.moves) game = tutorialApply(game, tutorialActor(game)!, move, true, NAME);
  }
  return game;
}

const after = (id: string) => playScript(TUTORIAL_STEPS.findIndex((step) => step.id === id) + 1);
const player = (game: GameState, id: string) => game.players.find((candidate) => candidate.id === id)!;

describe("情书新手教程剧本", () => {
  it("从头走到尾：要你做的都合法，对手的每一步合法，高亮的东西在那时看得见", () => {
    let game = createTutorialGame(NAME);
    for (const step of TUTORIAL_STEPS) {
      const first = step.subs?.[0]?.anchor ?? step.anchor;
      if (first) expect(anchorVisible(game, first), `「${step.id}」高亮的 ${first} 看不见`).toBe(true);
      if (step.anchor && step.anchor !== first) expect(anchorVisible(game, step.anchor), `「${step.id}」的 ${step.anchor} 看不见`).toBe(true);
      if (step.kind === "do") {
        expect(tutorialActor(game), `「${step.id}」不是轮到你`).toBe(TUTORIAL_SELF);
        if (step.expect.type !== "READY") {
          expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect)), `「${step.id}」不合法`).toBe(true);
        }
        game = tutorialApply(game, TUTORIAL_SELF, step.expect, true, NAME);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          const actor = tutorialActor(game);
          expect(actor === RIVAL_1 || actor === RIVAL_2, `「${step.id}」该对手走，却是 ${actor}`).toBe(true);
          expect(legalActions(game, actor!).some((command) => sameCommand(command, move)), `「${step.id}」对手的 ${JSON.stringify(move)} 不合法`).toBe(true);
          game = tutorialApply(game, actor!, move, true, NAME);
        }
      }
    }
    // 走完停在残局的结算画面，等你点「下一局」接练习局
    expect(game.phase).toBe("roundEnd");
    expect(tutorialActor(game)).toBe(TUTORIAL_SELF);
  });

  it("关键的几幕一定发生（补充 2.2 的每个回合）", () => {
    // 1 卫兵猜男爵没中，什么都不公开
    const g1 = after("guard");
    expect(g1.events.find((event) => event.type === "Guessed")).toMatchObject({ target: RIVAL_1, guess: "baron", hit: false });
    expect(g1.players.every((candidate) => !candidate.out)).toBe(true);
    // 2 一号牧师看你；3 二号打间谍
    expect(after("w-priest").events.some((event) => event.type === "Peeked" && event.player === RIVAL_1 && event.target === TUTORIAL_SELF)).toBe(true);
    expect(player(after("w-spy"), RIVAL_2).spy).toBe(true);
    // 4 女伯爵 + 王子：王子不合法，只能打女伯爵
    const g4 = after("w-spy");
    expect(player(g4, TUTORIAL_SELF).hand.sort()).toEqual(["countess", "prince"]);
    expect(legalActions(g4, TUTORIAL_SELF).every((command) => command.type === "PLAY" && command.card === "countess")).toBe(true);
    // 5 一号侍女受保护；6 二号国王只能选你，换完你拿男爵、他拿王子
    expect(player(after("w-handmaid"), RIVAL_1).protected).toBe(true);
    const g6 = after("w-king");
    expect(player(g6, TUTORIAL_SELF).hand).toContain("baron");
    expect(player(g6, RIVAL_2).hand).toEqual(["prince"]);
    // 7 卫兵点二号猜王子命中，一号受保护选不了
    expect(legalActions(g6, TUTORIAL_SELF).some((command) => command.type === "PLAY" && command.target === RIVAL_1)).toBe(false);
    expect(player(after("guard-hit"), RIVAL_2).out).toBe(true);
    // 8 一号王子点你：弃男爵、重抽大臣
    const g8 = after("w-prince");
    expect(player(g8, TUTORIAL_SELF).discards.at(-1)).toEqual({ card: "baron", how: "discarded" });
    expect(player(g8, TUTORIAL_SELF).hand.sort()).toEqual(["chancellor", "guard"]);
    // 9 大臣抽到公主、牧师，留公主，牌堆回到 7 张，不出局
    const g9a = after("chancellor");
    expect(g9a.stage).toBe("chancellor");
    expect(player(g9a, TUTORIAL_SELF).hand.sort()).toEqual(["guard", "priest", "princess"]);
    const g9 = after("keep");
    expect(player(g9, TUTORIAL_SELF).hand).toEqual(["princess"]);
    expect(player(g9, TUTORIAL_SELF).out).toBe(false);
    expect(g9.deckCount).toBe(6); // 放回后 7 张，一号回合开始又抽了 1 张
    // 10 一号打间谍；11 男爵比一号，公主赢卫兵，只剩你赢，两个打过间谍的都出局 → 没人拿间谍分
    expect(player(after("w-spy2"), RIVAL_1).spy).toBe(true);
    const g11 = after("baron");
    expect(g11.phase).toBe("roundEnd");
    expect(g11.lastRound).toMatchObject({ reason: "lastStanding", winners: [TUTORIAL_SELF], spyBonus: null, awards: { [TUTORIAL_SELF]: 1 } });
    // 残局：点「下一局」换成残局，标记接得上
    const end = after("next-round");
    expect(end.phase).toBe("playing");
    expect(end.deckCount).toBe(0);
    expect(end.players.map((candidate) => candidate.tokens)).toEqual([1, 0, 0]);
    expect(end.version).toBeGreaterThan(g11.version);
    // 打侍女 → 亮牌平局两人各 +1，你再拿间谍 +1；下一局在你和一号里选
    const tie = after("handmaid-end");
    expect(tie.lastRound).toMatchObject({ reason: "showdown", winners: [TUTORIAL_SELF, RIVAL_1], spyBonus: TUTORIAL_SELF, awards: { [TUTORIAL_SELF]: 2, [RIVAL_1]: 1 } });
    expect([TUTORIAL_SELF, RIVAL_1]).toContain(tie.lastRound!.nextStarter);
    expect(tie.players.map((candidate) => candidate.tokens)).toEqual([3, 1, 0]);
  });

  it("剧本本身：id 不重复，finale 唯一且在最后，每一步（和每一下）主句一句、加补充最多两句", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      for (const text of [step, ...(step.subs ?? [])]) {
        expect(sentences(text.say), `「${step.id}」主句「${text.say}」不止一句`).toBe(1);
        expect(sentences(text.say) + sentences(text.note), `「${step.id}」「${text.say}」超过两句`).toBeLessThanOrEqual(2);
        if (text.noteTouch) expect(sentences(text.say) + sentences(text.noteTouch)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("打一张牌的几下：卫兵是 点牌 → 选人 → 猜牌 → 指认，其他是 点牌 →（选人）→ 打出", () => {
    const guard = playSubs({ type: "PLAY", card: "guard", target: "p2", guess: "baron" }, { card: ["a"] }).map((sub) => sub.anchor);
    expect(guard).toEqual(["card:guard", "target-p2", "guess-baron", "guess-confirm"]);
    const prince = playSubs({ type: "PLAY", card: "prince", target: TUTORIAL_SELF }, { card: ["a"] }).map((sub) => sub.anchor);
    expect(prince).toEqual(["card:prince", "target-me", "play-button"]);
    expect(playSubs({ type: "PLAY", card: "spy" }, { card: ["a"] }).map((sub) => sub.anchor)).toEqual(["card:spy", "play-button"]);
  });

  it("大臣放回牌堆底的顺序不限；其他命令要完全一样", () => {
    expect(sameCommand({ type: "CHANCELLOR", keep: "princess", bottom: ["guard", "priest"] }, { type: "CHANCELLOR", keep: "princess", bottom: ["priest", "guard"] })).toBe(true);
    expect(sameCommand({ type: "CHANCELLOR", keep: "guard", bottom: ["princess", "priest"] }, { type: "CHANCELLOR", keep: "princess", bottom: ["priest", "guard"] })).toBe(false);
    expect(sameCommand({ type: "PLAY", card: "guard", target: "p2", guess: "priest" }, { type: "PLAY", card: "guard", target: "p2", guess: "baron" })).toBe(false);
  });

  it("剧本走完接练习局（接着打完这一整场），或者再练一局：三个座位都交给人机，120 场都能打完", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 120; seed += 1) {
      let game = seed % 2 === 0 ? playScript() : createPracticeGame(NAME, seed);
      let moves = 0;
      while (game.phase !== "finished" && moves < 3000) {
        const actor = tutorialActor(game);
        if (!actor) break;
        const command = botCommand(redactGameForViewer(game, actor), actor);
        if (!command) break;
        game = tutorialApply(game, actor, command, false, NAME);
        moves += 1;
      }
      if (game.phase !== "finished" || !game.winners?.length) stuck.push(`第 ${seed} 场（${moves} 步，${game.phase}）`);
    }
    expect(stuck).toEqual([]);
  }, 60_000);
});
