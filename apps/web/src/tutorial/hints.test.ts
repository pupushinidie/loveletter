import { describe, expect, it } from "vitest";
import { botHint, redactGameForViewer, scene, seatId, type GameState } from "@loveletter/game";
import { hintFor, spyWording } from "./hints.js";
import { TUTORIAL_STEPS } from "./script.js";

/** 讲间谍 +1 的地方都要说清：没出局就行、不用赢，打过或被弃过都算（I36）。 */
const SPY_BONUS = /间谍.*\+1|多拿 1 枚/;

describe("间谍 +1 的说法（I36）", () => {
  it("剧本里讲间谍 +1 的每一步：不用赢、打过或被弃过、没出局", () => {
    const steps = TUTORIAL_STEPS.filter((step) => step.kind === "info" && SPY_BONUS.test(`${step.say}${step.note ?? ""}`) && /只有/.test(step.note ?? ""));
    expect(steps.map((step) => step.id)).toEqual(["spy", "spy2", "spy-bonus"]);
    for (const step of steps) {
      const text = `${step.say}${step.note ?? ""}`;
      expect(text, step.id).toContain("不用赢");
      expect(text, step.id).toContain("打过或被弃过间谍");
      expect(text, step.id).toContain("没出局");
    }
  });

  it("剧本里不再用「撑到最后 / 活到最后」这种会被当成「要赢」的说法", () => {
    for (const step of TUTORIAL_STEPS) {
      for (const text of [step.say, step.note, ...(step.subs ?? []).flatMap((sub) => [sub.say, sub.note])]) {
        expect(text ?? "", step.id).not.toMatch(/撑到最后|活到最后/);
      }
    }
  });

  it("人机理由的几种间谍说法都换成教程口径", () => {
    expect(spyWording("趁早打出间谍：活到最后、又只有你打过间谍，能多拿 1 枚。")).toBe("趁早打出间谍：这一小局结束时你没出局、在局的人里又只有你打过或被弃过间谍，就多拿 1 枚，不用赢。");
    expect(spyWording("最后一回合打出间谍：只有你打过间谍，多拿 1 枚；留下王子去比牌。")).toContain("不用赢");
    expect(spyWording("王子选自己，弃掉间谍（也算打过间谍），再抽一张新的。")).toContain("被弃过也算");
    expect(spyWording("留下王子，打掉卫兵。")).toBe("留下王子，打掉卫兵。");
  });

  it("练习局「提示」真的打间谍时，理由是教程口径（人机原话改了这里会报）", () => {
    // 轮到你，手里间谍 + 卫兵；多试几个种子，找到人机建议打间谍、而且还没人打过间谍的局面
    const notes: string[] = [];
    for (let seed = 1; seed <= 40 && notes.length === 0; seed++) {
      const me = seatId(0);
      const game: GameState = redactGameForViewer(scene("my-turn-spy", { seed }), me);
      const decision = botHint(game, me, () => 0);
      if (decision?.command.type !== "PLAY" || decision.command.card !== "spy") continue;
      if (game.players.some((player) => player.spy)) continue;
      notes.push(hintFor(game, me).note ?? "");
    }
    expect(notes.length).toBe(1);
    expect(notes[0]).not.toMatch(/活到最后/);
    expect(notes[0]).toContain("不用赢");
  });
});
