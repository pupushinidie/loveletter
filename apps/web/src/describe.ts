import { ROLE_NAME, ROLE_VALUE, type GameEvent, type Role } from "@loveletter/game";
import type { IconName } from "./art.js";

/** 角色名带点数：卫兵(1)。 */
export const roleLabel = (role: Role) => `${ROLE_NAME[role]}(${ROLE_VALUE[role]})`;

/** 每种牌一句话的效果（自己的话，参考卡、手牌提示、规则说明共用）。 */
export const ROLE_EFFECT: Record<Role, string> = {
  spy: "打出没有效果。一小局结束时，还在局中的人里只有你打过或弃过间谍，额外 +1 枚。",
  guard: "指定一个人，猜他手里是哪种牌（不能猜卫兵），猜中他就出局。",
  priest: "偷看一个人的手牌，只有你看得到。",
  baron: "和一个人比手里剩下那张牌的点数，小的出局；一样大谁都不出局。",
  handmaid: "到你下一回合开始前，别人的牌都不能选你。",
  prince: "让一个人（可以是自己）弃掉手牌、重抽一张；弃掉的牌不发动。",
  chancellor: "再抽 2 张，3 张里留 1 张，另外 2 张按你排的顺序放回牌堆底。",
  king: "和一个人交换手牌。",
  countess: "打出没有效果；手里同时有国王或王子时，必须打她。",
  princess: "打出或被弃掉，你立刻出局。",
};

/** 很短的效果（窄的地方用）。 */
export const ROLE_SHORT: Record<Role, string> = {
  spy: "局末独有 +1",
  guard: "猜中对手出局",
  priest: "偷看一人手牌",
  baron: "比点数，小的出局",
  handmaid: "保护到下回合",
  prince: "让一人弃牌重抽",
  chancellor: "抽 2 留 1",
  king: "和一人换手牌",
  countess: "遇国王王子必打",
  princess: "丢掉就出局",
};

const REASON: Record<string, string> = {
  guard: "被卫兵猜中",
  baron: "比牌输了",
  prince: "公主被弃掉",
  princess: "打出了公主",
};

export interface Line {
  readonly text: string;
  readonly icon?: IconName | undefined;
  /** 只有自己看得到的内容（牧师看到的牌、比牌双方的牌、换到的牌、大臣抽到的牌）。 */
  readonly secret?: boolean;
  /** 和自己有关（自己做的、别人对自己做的）。 */
  readonly mine?: boolean;
}

/**
 * 一条事件的文字。name(id) 是显示名（自己是「你」），me 是自己的座位 id（观战时是空字符串）。
 * forLog 为 false 时（「刚才」那一栏）不写例行的抽牌、准备。
 */
export function describeEvent(event: GameEvent, name: (id: string) => string, me: string, forLog = true): Line | null {
  const mine = (...ids: (string | undefined)[]) => ids.some((id) => id !== undefined && id === me && me !== "");
  switch (event.type) {
    case "RoundStarted":
      return {
        text: `第 ${event.round} 小局开始，${name(event.starter)} 先手${event.faceUp.length ? `；面朝上移出 ${event.faceUp.map((role) => ROLE_NAME[role]).join("、")}` : ""}`,
        icon: "letter",
      };
    case "TurnStarted":
      return event.protectionEnded ? { text: `${name(event.player)} 的侍女保护结束了`, icon: "shield", mine: mine(event.player) } : null;
    case "Drew":
      if (event.source === "setAside") {
        return { text: `牌堆空了，${name(event.player)} 拿走了开局移出的那张${event.card ? `：${roleLabel(event.card)}` : ""}`, icon: "sealed", mine: mine(event.player), secret: !!event.card };
      }
      if (event.reason === "prince") {
        return { text: `${name(event.player)} 重抽了一张${event.card ? `：${roleLabel(event.card)}` : ""}`, icon: "deck", mine: mine(event.player), secret: !!event.card };
      }
      if (!forLog) return null;
      return event.card ? { text: `你抽到 ${roleLabel(event.card)}`, icon: "deck", mine: true, secret: true } : null;
    case "Played": {
      const target = event.target ? (event.target === event.player ? " → 自己" : ` → ${name(event.target)}`) : "";
      const guess = event.guess ? `，猜 ${ROLE_NAME[event.guess]}` : "";
      return { text: `${name(event.player)} 打出 ${roleLabel(event.card)}${target}${guess}`, icon: event.card === "guard" ? "target" : undefined, mine: mine(event.player, event.target) };
    }
    case "NoEffect":
      return { text: event.reason === "noTarget" ? `没人能选，${ROLE_NAME[event.card]}白打` : `牌堆空了，${ROLE_NAME[event.card]}白打`, mine: mine(event.player) };
    case "Guessed":
      return { text: event.hit ? `猜中了！${name(event.target)} 手里就是 ${ROLE_NAME[event.guess]}` : `没猜中，${name(event.target)} 手里不是 ${ROLE_NAME[event.guess]}`, icon: "target", mine: mine(event.player, event.target) };
    case "Peeked":
      if (event.card) return { text: `你看到 ${name(event.target)} 的手牌：${roleLabel(event.card)}`, icon: "eye", secret: true, mine: true };
      if (mine(event.target)) return { text: `${name(event.player)} 看了你的手牌`, icon: "eye", mine: true };
      return { text: `${name(event.player)} 查看了 ${name(event.target)} 的手牌`, icon: "eye" };
    case "Compared": {
      const result = event.loser ? `${name(event.loser)} 出局` : "平手，谁都不出局";
      if (event.playerCard && event.targetCard) {
        return { text: `比牌：${name(event.player)} ${roleLabel(event.playerCard)} 对 ${name(event.target)} ${roleLabel(event.targetCard)}，${result}`, icon: "duel", secret: true, mine: true };
      }
      return { text: `${name(event.player)} 与 ${name(event.target)} 比牌：${result}`, icon: "duel", mine: mine(event.player, event.target) };
    }
    case "Protected":
      return { text: `${name(event.player)} 受侍女保护，到下一回合开始`, icon: "shield", mine: mine(event.player) };
    case "Discarded":
      return {
        text: event.by === event.player ? `${name(event.player)} 弃掉了自己的 ${roleLabel(event.card)}` : `${name(event.player)} 被王子弃掉 ${roleLabel(event.card)}`,
        mine: mine(event.player, event.by),
      };
    case "ChancellorDrew":
      return { text: `${name(event.player)} 用大臣抽了 ${event.count} 张${event.cards ? `：${event.cards.map((role) => ROLE_NAME[role]).join("、")}` : ""}`, icon: "deck", secret: !!event.cards, mine: mine(event.player) };
    case "ChancellorReturned":
      return {
        text: `${name(event.player)} 把 ${event.count} 张放回牌堆底${event.cards ? `（从上到下：${event.cards.map((role) => ROLE_NAME[role]).join("、")}）` : ""}`,
        icon: "deck",
        secret: !!event.cards,
        mine: mine(event.player),
      };
    case "Swapped":
      if (event.playerGot && event.targetGot) {
        return { text: `${name(event.player)} 和 ${name(event.target)} 换了手牌：${name(event.player)} 拿到 ${roleLabel(event.playerGot)}，${name(event.target)} 拿到 ${roleLabel(event.targetGot)}`, icon: "swap", secret: true, mine: true };
      }
      return { text: `${name(event.player)} 和 ${name(event.target)} 换了手牌`, icon: "swap", mine: mine(event.player, event.target) };
    case "Eliminated":
      return {
        text: `${name(event.player)} 出局（${REASON[event.reason] ?? ""}）${event.revealed.length ? `，亮出 ${event.revealed.map(roleLabel).join("、")}` : ""}`,
        icon: "out",
        mine: mine(event.player),
      };
    case "RoundEnded": {
      const result = event.result;
      return {
        text: `第 ${result.round} 小局结束：${result.winners.map(name).join("、")} 赢${result.spyBonus ? `；${name(result.spyBonus)} 间谍 +1` : ""}`,
        icon: "crown",
        mine: result.winners.includes(me) || result.spyBonus === me,
      };
    }
    case "Ready":
      return null;
    case "GameEnded":
      return { text: `整场结束：${event.winners.map(name).join("、")} 获胜`, icon: "crown", mine: event.winners.includes(me) };
    case "TurnTimedOut":
      return { text: `${name(event.player)} 超时，人机替${mine(event.player) ? "你" : "他"}打完这一回合`, mine: mine(event.player) };
  }
}
