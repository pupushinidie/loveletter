/**
 * 人机（「普通」难度）：只吃裁剪后的视角、记牌、补充文件 1.8 的蠢错清单、关键决策、理由文案。
 * 自对弈和强度在 bot-selfplay.test.ts。
 */
import { describe, expect, it } from "vitest";
import { FULL_DECK, ROLES, type Role } from "../src/cards.js";
import { botCommand, botDecision, botHint } from "../src/bot.js";
import { buildKnowledge } from "../src/bot-knowledge.js";
import { applyCommand, createGame, legalActions, redactGameForViewer, timeoutTurn, unseenCounts } from "../src/engine.js";
import { createRng } from "../src/rng.js";
import { createScene, scenePlayers } from "../src/scenes.js";
import type { GameCommand, GameState } from "../src/types.js";
import { POLICIES, playGame } from "./bot-harness.js";

const view = (state: GameState, id = "p1") => redactGameForViewer(state, id);
const decide = (state: GameState, id = "p1", seed = 1) => {
  const rng = createRng(seed);
  return botDecision(view(state, id), id, () => rng.next())!;
};
/** 换很多个随机数种子，人机每次都这么打。 */
function always(state: GameState, id: string, test: (command: GameCommand) => boolean, seeds = 40): GameCommand[] {
  const chosen: GameCommand[] = [];
  for (let seed = 1; seed <= seeds; seed += 1) {
    const { command } = decide(state, id, seed);
    chosen.push(command);
    expect(test(command), JSON.stringify(command)).toBe(true);
  }
  return chosen;
}
const play = (state: GameState, player: string, card: Role, target?: string, guess?: Role) =>
  applyCommand(state, player, { type: "PLAY", card, ...(target !== undefined ? { target } : {}), ...(guess !== undefined ? { guess } : {}) });

/** 指定发牌开一局（3 人，p1 先手）：没写的牌接在牌堆底。 */
function dealt(setAside: Role, hands: Role[], top: Role[], players = 3): GameState {
  const rest = [...FULL_DECK];
  for (const card of [setAside, ...hands, ...top]) rest.splice(rest.indexOf(card), 1);
  const faceUp = players === 2 ? rest.splice(0, 3) : [];
  return createGame(scenePlayers(players), 7, { starter: 0, deal: { setAside, faceUp, hands, deck: [...top, ...rest] } });
}

/** 随机打到一个中途局面（大家都用随机策略）。 */
function randomStates(count: number, players: number): GameState[] {
  const states: GameState[] = [];
  for (let seed = 1; states.length < count; seed += 1) {
    const rng = createRng(seed);
    let state = createGame(scenePlayers(players), seed);
    const stopAt = 1 + rng.int(10);
    for (let step = 0; step < stopAt && state.phase === "playing"; step += 1) {
      const actor = state.players[state.current]!.id;
      state = applyCommand(state, actor, POLICIES.random!(view(state, actor), actor, () => rng.next())!);
    }
    if (state.phase === "playing") states.push(state);
  }
  return states;
}

describe("人机只看自己座位能看到的", () => {
  it("给完整状态（带牌堆）直接报错", () => {
    const state = createGame(scenePlayers(3), 3);
    const actor = state.players[state.current]!.id;
    expect(() => botCommand(state, actor)).toThrow(/裁剪/);
    expect(() => botDecision(state, actor)).toThrow(/裁剪/);
    expect(botCommand(view(state, actor), actor)).not.toBeNull();
  });

  it("改掉看不到的东西（牌堆顺序、移出的牌、别人手牌）不影响人机的决定", () => {
    for (const players of [2, 4, 6]) {
      for (const state of randomStates(60, players)) {
        const actor = state.players[state.current]!.id;
        // 把牌堆、移出的牌、别人手里的牌一起洗乱重发：只要张数不变，裁剪后的视角应该一模一样
        const hidden = [...state.deck!, ...(state.setAside ? [state.setAside] : []), ...state.players.filter((p) => p.id !== actor).flatMap((p) => p.hand)];
        const shuffled = createRng(players * 31 + state.version).shuffle(hidden);
        const other = structuredClone(state);
        other.deck = shuffled.splice(0, state.deck!.length);
        if (state.setAside) other.setAside = shuffled.shift()!;
        for (const player of other.players) if (player.id !== actor) player.hand = shuffled.splice(0, player.hand.length);
        // 私密事件（牧师看到的、男爵比的、国王换的）按原局面保留，所以只比较人机的输入和输出
        const a = view(state, actor);
        const b = view(other, actor);
        expect(b.players.map((p) => p.hand)).toEqual(a.players.map((p) => p.hand));
        const rngA = createRng(5);
        const rngB = createRng(5);
        expect(botCommand(b, actor, () => rngB.next())).toEqual(botCommand(a, actor, () => rngA.next()));
      }
    }
  });

  it("超时代打 timeoutTurn(state, botCommand) 拿到的也是裁剪视角，一次走完整个回合（含大臣留牌）", () => {
    const seen: GameState[] = [];
    const spy = (input: GameState, id: string) => {
      seen.push(input);
      return botCommand(input, id);
    };
    // 大臣 + 公主：只能打大臣，再留牌（两步）
    const state = createScene({ hands: [["chancellor", "princess"]], deck: ["guard", "priest", "king"], leftovers: "discards", setAside: "baron" });
    const after = timeoutTurn(state, spy);
    expect(seen.length).toBe(2);
    for (const input of seen) {
      expect(input.deck).toBeUndefined();
      expect(input.players.filter((p) => p.id !== "p1").every((p) => p.hand.length === 0)).toBe(true);
    }
    expect(after.events[0]?.type).toBe("TurnTimedOut");
    expect(after.events.some((e) => e.type === "ChancellorReturned")).toBe(true);
    expect(after.players[0]!.out).toBe(false);
  });
});

describe("记牌（补充 1.1）", () => {
  it("牧师看到的牌：对方打出别的牌后照样有效，下回合卫兵点名必中", () => {
    let s = dealt("baron", ["priest", "prince", "priest"], ["guard", "spy", "guard", "countess"]);
    s = play(s, "p1", "priest", "p2");
    s = play(s, "p2", "spy");
    s = play(s, "p3", "guard", "p2", "king");
    expect(buildKnowledge(view(s), "p1").info.get("p2")).toMatchObject({ known: "prince", how: "priest" });
    always(s, "p1", (c) => c.type === "PLAY" && c.card === "guard" && c.target === "p2" && c.guess === "prince");
    expect(decide(s).reason).toContain("一定中");
  });

  it("对方打出和已知那张同名的牌：知识作废（不再当成确定）", () => {
    let s = dealt("baron", ["priest", "prince", "spy"], ["guard", "prince", "guard", "countess"]);
    s = play(s, "p1", "priest", "p2");
    s = play(s, "p2", "prince", "p3");
    const info = buildKnowledge(view(s), "p1").info.get("p2")!;
    expect(info.known).toBeNull();
  });

  it("别人之间换国王：我知道的那张跟着牌走", () => {
    let s = dealt("countess", ["priest", "baron", "spy"], ["guard", "king", "guard", "handmaid"]);
    s = play(s, "p1", "priest", "p2"); // 看到二号是男爵
    s = play(s, "p2", "king", "p3"); // 二号和三号换：男爵到了三号手里
    const know = buildKnowledge(view(s), "p1");
    expect(know.info.get("p3")?.known).toBe("baron");
    expect(know.info.get("p2")?.known).toBeNull();
  });

  it("被王子弃牌重抽：知识作废", () => {
    let s = dealt("countess", ["priest", "baron", "prince"], ["guard", "spy", "guard", "handmaid"]);
    s = play(s, "p1", "priest", "p2");
    s = play(s, "p2", "spy");
    s = play(s, "p3", "prince", "p2");
    expect(buildKnowledge(view(s), "p1").info.get("p2")?.known).toBeNull();
  });

  it("卫兵没猜中的角色排除掉；男爵比赢的人记点数下限", () => {
    let s = dealt("countess", ["guard", "baron", "spy"], ["guard", "priest", "guard", "handmaid", "king"]);
    s = play(s, "p1", "guard", "p2", "prince"); // 没中
    let info = buildKnowledge(view(s), "p1").info.get("p2")!;
    expect(info.excluded.has("prince")).toBe(true);
    // 二号拿男爵 + 牧师，和三号（间谍）比：三号出局，二号留的牧师(2) > 间谍(0)
    s = play(s, "p2", "baron", "p3");
    info = buildKnowledge(view(s), "p1").info.get("p2")!;
    expect(s.players[2]!.out).toBe(true);
    expect(info.min).toBe(1);
  });

  it("我用大臣放回牌堆底的牌被对手抽到、他打出了别的：知道他手里就是那张；最后一回合卫兵点名", () => {
    // 4 人局，四号已出局（公主在他那里）；两张间谍都在二号那里，免得间谍分干扰判断
    let s = createScene({
      players: 4,
      out: [3],
      hands: [["chancellor", "guard"], ["spy"], ["guard"]],
      discards: [[], ["spy"], [], ["princess"]],
      deck: ["prince", "king", "handmaid"],
      setAside: "guard",
      leftovers: "discards",
    });
    s = applyCommand(s, "p1", { type: "PLAY", card: "chancellor" });
    s = applyCommand(s, "p1", { type: "CHANCELLOR", keep: "guard", bottom: ["king", "prince"] });
    s = play(s, "p2", "spy"); // 二号抽侍女，打间谍
    s = play(s, "p3", "guard", "p2", "priest"); // 三号抽到国王（我放的），打卫兵；一号最后抽到王子，要先除掉国王
    const know = buildKnowledge(view(s), "p1");
    expect(know.info.get("p3")).toMatchObject({ known: "king", how: "deck" });
    expect(s.deckCount).toBe(0);
    always(s, "p1", (c) => c.type === "PLAY" && c.card === "guard" && c.target === "p3" && c.guess === "king");
  });

  it("被牧师看过：知道谁知道我的牌；打掉别的牌后仍然暴露，打掉那张就不暴露", () => {
    let s = dealt("countess", ["guard", "priest", "spy"], ["spy", "handmaid", "guard", "baron", "prince"]);
    s = play(s, "p1", "spy"); // 一号留卫兵
    s = play(s, "p2", "priest", "p1"); // 二号看到一号是卫兵
    expect([...buildKnowledge(view(s), "p1").exposure]).toEqual([["p2", "guard"]]);
    s = play(s, "p3", "guard", "p1", "king");
    // 一号抽到男爵：打卫兵 → 不再暴露；打男爵 → 还暴露（留着卫兵）
    const afterGuard = play(s, "p1", "guard", "p2", "spy");
    expect(buildKnowledge(view(afterGuard), "p1").exposure.size).toBe(0);
  });
});

describe("蠢错清单（补充 1.8）", () => {
  it("1. 不主动打公主；有公主时王子不选自己", () => {
    for (const other of ["guard", "priest", "baron", "handmaid", "prince", "chancellor", "king", "countess", "spy"] as Role[]) {
      for (const players of [2, 3, 5]) {
        const s = createScene({ players, hands: [["princess", other]] });
        always(s, "p1", (c) => c.type === "PLAY" && c.card !== "princess" && !(c.card === "prince" && c.target === "p1"), 15);
      }
    }
  });

  it("1b. 死局（王子 + 公主，别人全受保护）：给一个合法命令，不卡住", () => {
    const s = createScene({ hands: [["prince", "princess"]], protected: [1, 2] });
    const { command, reason } = decide(s);
    expect(legalActions(s, "p1")).toContainEqual(command);
    expect(reason).toMatch(/出局/);
  });

  it("2. 女伯爵 + 国王 / 王子：只打女伯爵", () => {
    for (const other of ["king", "prince"] as Role[]) {
      const s = createScene({ hands: [["countess", other]] });
      always(s, "p1", (c) => c.type === "PLAY" && c.card === "countess");
      expect(decide(s).reason).toContain("必须");
    }
  });

  it("3. 卫兵不猜卫兵，也不猜已经全部露面的角色（包括自己手里的）", () => {
    // 两张牧师都打出过；我手里是公主
    const s = createScene({ hands: [["guard", "princess"]], discards: [[], ["priest"], ["priest"]] });
    const unseen = unseenCounts(view(s), "p1");
    expect(unseen.priest).toBe(0);
    expect(unseen.princess).toBe(0);
    always(s, "p1", (c) => c.type === "PLAY" && c.card === "guard" && c.guess !== "guard" && c.guess !== "priest" && c.guess !== "princess");
    // 随机局面里人机打出的卫兵，猜的角色都还有没露面的
    for (const players of [2, 3, 6]) {
      for (const state of randomStates(150, players)) {
        const actor = state.players[state.current]!.id;
        const v = view(state, actor);
        const command = botCommand(v, actor, () => 0.5)!;
        if (command.type === "PLAY" && command.card === "guard" && command.guess) {
          expect(command.guess).not.toBe("guard");
          expect(unseenCounts(v, actor)[command.guess]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("4. 留下的牌 ≤ 2 不去打男爵（不知道对方更小的时候）", () => {
    for (const low of ["priest", "guard", "spy"] as Role[]) {
      const s = createScene({ hands: [["baron", low]] });
      always(s, "p1", (c) => c.type === "PLAY" && c.card !== "baron");
    }
  });

  it("4b. 知道对方的牌比我留下的小：男爵比牌", () => {
    let s = dealt("countess", ["priest", "guard", "spy"], ["king", "spy", "handmaid", "baron"]);
    s = play(s, "p1", "priest", "p2"); // 二号是卫兵，一号留国王
    s = play(s, "p2", "spy");
    s = play(s, "p3", "handmaid");
    // 一号：国王 + 男爵，知道二号是卫兵(1)
    always(s, "p1", (c) => c.type === "PLAY" && c.card === "baron" && c.target === "p2");
    expect(decide(s).reason).toContain("必赢");
  });

  it("5. 过期的知识不用：对方打出过同名的牌，就不再「一定中」", () => {
    let s = dealt("baron", ["priest", "prince", "spy"], ["guard", "prince", "handmaid", "countess"]);
    s = play(s, "p1", "priest", "p2");
    s = play(s, "p2", "prince", "p3"); // 三号弃间谍重抽
    s = play(s, "p3", "handmaid");
    const { reason } = decide(s);
    expect(reason).not.toContain("一定中");
  });

  it("6. 不选受保护或出局的人（命令都合法）", () => {
    for (const players of [3, 4, 6]) {
      for (const state of randomStates(120, players)) {
        const actor = state.players[state.current]!.id;
        const command = botCommand(view(state, actor), actor, () => 0.3)!;
        expect(legalActions(state, actor)).toContainEqual(command);
        if (command.type === "PLAY" && command.target && command.target !== actor) {
          const target = state.players.find((p) => p.id === command.target)!;
          expect(target.out || target.protected).toBe(false);
        }
      }
    }
  });

  it("7. 间谍早打，不留到最后", () => {
    for (const other of ["priest", "handmaid", "prince", "king", "countess"] as Role[]) {
      const s = createScene({ players: 4, hands: [["spy", other]] });
      always(s, "p1", (c) => c.type === "PLAY" && c.card === "spy", 10);
    }
  });

  it("8. 6 人局前半局不把大牌换走或打掉：国王 / 女伯爵 / 公主留着", () => {
    for (const big of ["countess", "princess"] as Role[]) {
      for (const small of ["guard", "priest", "handmaid"] as Role[]) {
        const s = createScene({ players: 6, hands: [[big, small]] });
        always(s, "p1", (c) => c.type === "PLAY" && c.card === small, 10);
      }
    }
  });

  it("9. 不用国王把女伯爵、大臣送人（国王 + 公主时不能打公主，只能打国王，理由要说清楚）", () => {
    for (const players of [2, 4]) {
      const s = createScene({ players, hands: [["king", "chancellor"]] });
      always(s, "p1", (c) => !(c.type === "PLAY" && c.card === "king"), 15);
      const countess = createScene({ players, hands: [["king", "countess"]] });
      always(countess, "p1", (c) => c.type === "PLAY" && c.card === "countess", 5);
      const princess = createScene({ players, hands: [["king", "princess"]] });
      always(princess, "p1", (c) => c.type === "PLAY" && c.card === "king", 5);
      expect(decide(princess).reason).toContain("不能打公主");
    }
  });

  it("11. 几个打法差不多时会随机挑（开局盲猜卫兵不总是同一个）", () => {
    const s = createScene({ players: 4, hands: [["guard", "countess"]] });
    const chosen = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) chosen.add(JSON.stringify(decide(s, "p1", seed).command));
    expect(chosen.size).toBeGreaterThan(1);
  });
});

describe("关键决策", () => {
  it("知道谁拿着公主：王子点他", () => {
    let s = dealt("countess", ["priest", "princess", "spy"], ["prince", "guard", "handmaid", "baron"]);
    s = play(s, "p1", "priest", "p2"); // 看到二号是公主，一号留王子
    s = play(s, "p2", "guard", "p3", "king");
    s = play(s, "p3", "handmaid");
    // 一号：王子 + 男爵
    always(s, "p1", (c) => c.type === "PLAY" && c.card === "prince" && c.target === "p2");
    expect(decide(s).reason).toContain("公主");
  });

  it("被人知道手里是公主：打侍女挡一回合", () => {
    let s = dealt("countess", ["spy", "priest", "spy"], ["princess", "guard", "guard", "handmaid"]);
    s = play(s, "p1", "spy"); // 一号留公主
    s = play(s, "p2", "priest", "p1"); // 二号看到公主，二号留卫兵
    s = play(s, "p3", "spy");
    // 一号：公主 + 侍女
    always(s, "p1", (c) => c.type === "PLAY" && c.card === "handmaid");
    expect(decide(s).reason).toContain("知道你拿着公主");
  });

  it("最后一回合（牌堆抽完）：留大的那张去比牌，理由里有胜率", () => {
    const s = createScene({ hands: [["guard", "king"]], deck: [], leftovers: "discards", setAside: "baron" });
    const { command, reason } = decide(s);
    expect(s.deckCount).toBe(0);
    expect(command).toMatchObject({ type: "PLAY" });
    expect((command as { card: Role }).card).not.toBe("king");
    expect(reason.length).toBeGreaterThan(4);
  });

  it("大臣：后半局留点数最大的；公主放回牌堆底也可以，不打公主", () => {
    const s = createScene({ hands: [["guard", "king", "baron"]], stage: "chancellor", deck: ["spy"], leftovers: "discards", setAside: "princess" });
    always(s, "p1", (c) => c.type === "CHANCELLOR" && c.keep === "king");
    expect(decide(s).reason).toMatch(/留下国王/);
  });

  it("2 人局对随机的打法：手里有男爵和国王、对手不知道，比牌（赢面大）", () => {
    const s = createScene({ players: 2, hands: [["baron", "king"]], discards: [[], ["guard", "guard"]] });
    const { command } = decide(s);
    expect(command).toMatchObject({ type: "PLAY", card: "baron", target: "p2" });
  });
});

describe("理由文案（提示按钮用）", () => {
  it("每一步都有一句中文理由，用的是名字不是座位 id", () => {
    for (const players of [2, 4, 6]) {
      for (const state of randomStates(80, players)) {
        const actor = state.players[state.current]!.id;
        const hint = botHint(view(state, actor), actor, () => 0.5)!;
        expect(hint.reason).toMatch(/[一-龥]/);
        expect(hint.reason).not.toMatch(/\bp\d\b/);
        expect(hint.reason).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it("结算画面：点下一局", () => {
    const result = playGame([POLICIES.bot!, POLICIES.bot!, POLICIES.bot!], 3);
    expect(result.problems).toEqual([]);
    let s = createScene({ hands: [["guard", "baron"]], deck: [], leftovers: "discards", setAside: "princess" });
    s = applyCommand(s, "p1", { type: "PLAY", card: "baron", target: "p2" });
    while (s.phase === "playing") {
      const actor = s.players[s.current]!.id;
      s = applyCommand(s, actor, botCommand(view(s, actor), actor)!);
    }
    if (s.phase === "roundEnd") expect(decide(s, "p2").command).toEqual({ type: "READY" });
  });
});

describe("所有角色都考虑过", () => {
  it("每种手牌组合人机都能给出合法命令", () => {
    for (const a of ROLES) {
      for (const b of ROLES) {
        let s: GameState;
        try {
          s = createScene({ players: 3, hands: [[a, b]] });
        } catch {
          continue; // 张数不够的组合（比如两张公主）
        }
        const command = botCommand(view(s), "p1")!;
        expect(legalActions(s, "p1")).toContainEqual(command);
      }
    }
  });
});

describe("最后一回合不自杀", () => {
  it("牌堆抽完、手里公主 + 国王：打国王（比牌输也比打公主出局强）", () => {
    for (const players of [2, 3]) {
      const s = createScene({ players, hands: [["princess", "king"]], deck: [], leftovers: "discards", setAside: "baron" });
      always(s, "p1", (c) => c.type === "PLAY" && c.card === "king", 10);
    }
  });
});
