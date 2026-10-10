/**
 * 情书和教程有关的部分（共用的教练层之外，每款游戏自己写的）：游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 * 欲罢不能放在 src/tutorialGame.ts；情书的教程文件都收在 src/tutorial/ 里。
 */
import { botHint, mustPlayCountess, ROLE_NAME, ROLE_TARGET, targetChoices, type GameCommand, type GameState } from "@loveletter/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "loveletter";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪里（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

/** 「提示」：让人机从你的位置算一步（它只看你看得到的信息），说它会怎么打、为什么。理由里可能有你牧师看到的牌，只给你自己看。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase === "finished") return { say: "这一场已经结束了。", anchor: null };
  const me = game.players.find((player) => player.id === playerId);
  if (!me) return { say: "你在观战。", anchor: null };
  if (game.phase === "roundEnd") return { say: "看完结算，点「下一局」。", anchor: "next-round-button" };
  const current = game.players[game.current]!;
  if (current.id !== playerId) return { say: `等 ${current.name} 打完再问我。`, anchor: null };
  // 理由要稳定（同一个局面问两次说法一样），随机数固定成 0
  const decision = botHint(game, playerId, () => 0);
  if (!decision) return { say: "现在没有能做的。", anchor: null };
  return { say: describe(game, playerId, decision.command), note: spyWording(decision.reason), anchor: anchorOf(game, me.hand, decision.command) };
}

/**
 * 人机理由里讲间谍 +1 的说法，统一成教程的口径（I36）：这一小局结束时没出局就行、不用赢，打过或被弃过都算。
 * 人机的原话（packages/game/src/bot.ts）改了以后这里对不上就原样显示，hints.test.ts 会报出来。
 */
const SPY_WORDING: readonly (readonly [string, string])[] = [
  ["活到最后、又只有你打过间谍，能多拿 1 枚", "这一小局结束时你没出局、在局的人里又只有你打过或被弃过间谍，就多拿 1 枚，不用赢"],
  ["只有你打过间谍，多拿 1 枚", "你没出局、在局的人里只有你打过或被弃过间谍，就多拿 1 枚，不用赢"],
  ["弃掉间谍（也算打过间谍）", "弃掉间谍（被弃过也算，这一小局结束时没出局就能拿间谍 +1）"],
  ["已经有人打过间谍", "已经有在局的人打过或被弃过间谍"],
];

export function spyWording(reason: string): string {
  let text = reason;
  for (const [from, to] of SPY_WORDING) text = text.replace(from, to);
  return text;
}

function describe(game: GameState, me: string, command: GameCommand): string {
  const name = (id: string) => (id === me ? "自己" : game.players.find((player) => player.id === id)?.name ?? "?");
  if (command.type === "READY") return "看完结算，点「下一局」。";
  if (command.type === "CHANCELLOR") {
    const bottom = command.bottom.map((role) => ROLE_NAME[role]).join("、");
    return `我会留下${ROLE_NAME[command.keep]}，把${bottom}放回牌堆底。`;
  }
  const card = ROLE_NAME[command.card];
  if (command.card === "guard" && command.target && command.guess) return `我会打卫兵，猜 ${name(command.target)} 是${ROLE_NAME[command.guess]}。`;
  if (command.card === "baron" && command.target) return `我会打男爵，和 ${name(command.target)} 比牌。`;
  if (command.card === "priest" && command.target) return `我会打牧师，看 ${name(command.target)} 的牌。`;
  if (command.card === "king" && command.target) return `我会打国王，和 ${name(command.target)} 换牌。`;
  if (command.card === "prince" && command.target) return `我会打王子，点${command.target === me ? "自己" : ` ${name(command.target)}`}。`;
  if (ROLE_TARGET[command.card] !== "none" && !command.target) return `我会打${card}（没人能选，白打）。`;
  return `我会打${card}。`;
}

function anchorOf(game: GameState, hand: readonly string[], command: GameCommand): string | null {
  if (command.type === "READY") return "next-round-button";
  if (command.type === "CHANCELLOR") {
    const index = hand.indexOf(command.keep);
    return index >= 0 ? `chancellor-keep-${index}` : null;
  }
  const index = hand.indexOf(command.card);
  return game.stage === "play" && index >= 0 ? `hand-${index}` : null;
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  peeked: { title: "有人看了你的牌", text: "他现在知道你拿着什么，下回合可能用卫兵点你、或者和你比牌；能换掉就换掉。" },
  swapped: { title: "你的手牌被国王换了", text: "你们俩都知道对方现在拿着什么。" },
  countess: { title: "必须打女伯爵", text: "女伯爵和国王或王子在一起时只能打她；别人看不出你是被迫的。" },
  shielded: { title: "别人都受侍女保护", text: "卫兵、牧师、男爵、国王打出去会白打，王子只能选自己。" },
  princess: { title: "你拿到了公主", text: "公主打出或被王子弃掉都会立刻出局；牌堆抽完时她最大。" },
  out: { title: "你出局了", text: "这一小局看别人打，下一局再来。出局时手牌亮出来，不发动效果。" },
  timeout: { title: "超时了", text: "这一回合由人机替你打完；连续 2 次超时会进托管，点「取消托管」就收回。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const me = game.players.find((player) => player.id === selfId);
  if (!me) return ids;
  for (const event of game.events) {
    if (event.type === "TurnTimedOut" && event.player === selfId) ids.push("timeout");
    if (event.type === "Eliminated" && event.player === selfId) ids.push("out");
    if (event.type === "Peeked" && event.target === selfId) ids.push("peeked");
    if (event.type === "Swapped" && event.target === selfId) ids.push("swapped");
    // 一小局结束时的事（平局都赢、间谍 +1）结算弹窗里写着，小贴士又会被弹窗盖住，所以不出（I24）
  }
  const myTurn = game.phase === "playing" && game.players[game.current]?.id === selfId && game.stage === "play";
  if (myTurn) {
    if (mustPlayCountess(me.hand)) ids.push("countess");
    const others = game.players.filter((player) => player.id !== selfId && !player.out);
    const aims = me.hand.some((role) => ROLE_TARGET[role] === "other");
    if (others.length > 0 && others.every((player) => player.protected) && aims && targetChoices(game, selfId, "guard").length === 0) ids.push("shielded");
    if (me.hand.includes("princess")) ids.push("princess");
  }
  return ids;
}
