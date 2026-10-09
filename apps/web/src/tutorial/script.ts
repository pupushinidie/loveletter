/**
 * 情书的新手教程剧本（补充文件 2.2 的两段：11 个回合的一整局 + 牌堆抽完的残局）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：第一段按引擎的 TUTORIAL_DEAL 发牌（一小局里不用随机数，
 * 所以每次都一样），对手按剧本走；点「下一局」时直接换成残局（tutorialEndgame），讲平局和间谍 +1；
 * 剧本走完接着把这一整场打完（练习局），对手交给人机。
 *
 * 和欲罢不能不同的地方：情书打一张牌要点好几下（点牌 → 选人 → 卫兵再猜牌 → 确认），
 * 所以 do 步骤可以带 subs：每一下高亮哪里、咕噜嘎说什么。现在走到哪一下看界面（when 条件），
 * 剧本只认最后发出的那条命令。info 步骤带 until 时是「点一下界面看看」（不发命令），条件满足自动下一步。
 *
 * 这份文件不碰 DOM，剧本单测（script.test.ts）直接跑。
 */
import {
  actorOf,
  applyCommand,
  createGame,
  ROLE_NAME,
  tutorialEndgame,
  TUTORIAL_DEAL,
  type GameCommand,
  type GameState,
  type NewPlayer,
  type Role,
} from "@loveletter/game";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/**
 * 锚点：网页里 data-tutorial 的值。另外 `card:<角色>` 指自己手里那张牌（换算成 hand-<下标>），
 * `keep:<角色>` 指大臣留牌框里那张（换算成 chancellor-keep-<下标>）。
 */
export type Anchor = string;

/** 界面条件（都满足才算）：pressed 元素 aria-pressed="true"；present 元素在；enabled 元素在且能点；absent 元素不在。 */
export interface Cond {
  readonly pressed?: Anchor;
  readonly present?: Anchor;
  readonly enabled?: Anchor;
  readonly absent?: Anchor;
}

/** 一步里的一下：高亮哪里、说什么。when 满足的最后一下就是现在这一下（第一下不写 when）。 */
export interface SubStep {
  readonly anchor: Anchor;
  readonly say: string;
  readonly note?: string;
  readonly noteTouch?: string;
  readonly when?: Cond;
}

interface StepBase {
  readonly id: string;
  /** 侧栏进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话。 */
  readonly say: string;
  /** 补充（12px），最多一句（主句 + 补充最多两句，单测检查）。 */
  readonly note?: string;
  /** 触屏设备上换成这句。 */
  readonly noteTouch?: string;
  readonly anchor?: Anchor;
  readonly face?: TutorialFace;
  /** 要点好几下的步骤：每一下的高亮和说法（有它时 say / anchor 只用在单测和第一下之前）。 */
  readonly subs?: readonly SubStep[];
}

export type TutorialStep =
  /** 讲解：点「下一步」继续；带 until 时不出「下一步」，界面满足条件自动继续。finale 是最后一步。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean; readonly until?: Cond })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly GameCommand[] });

export const TUTORIAL_SELF = "p1";
export const RIVAL_1 = "p2";
export const RIVAL_2 = "p3";
export const RIVAL_NAMES: Readonly<Record<string, string>> = { [RIVAL_1]: "咕噜一号", [RIVAL_2]: "咕噜二号" };

export function tutorialPlayers(selfName: string): NewPlayer[] {
  return [
    { id: TUTORIAL_SELF, name: selfName },
    { id: RIVAL_1, name: RIVAL_NAMES[RIVAL_1]! },
    { id: RIVAL_2, name: RIVAL_NAMES[RIVAL_2]! },
  ];
}

/** 第一段：补充 2.2 的固定发牌，你先手（一小局里引擎不用随机数，所以每次都一样）。 */
export function createTutorialGame(selfName: string, seed = 20261009): GameState {
  return createGame(tutorialPlayers(selfName), seed, { starter: 0, deal: TUTORIAL_DEAL });
}

/**
 * 第二段：残局。引擎的 tutorialEndgame()（二号已出局、你和一号各一张王子、牌堆空、你刚抽到侍女），
 * 标记数改成和第一段接得上（你刚赢了 1 枚，一号、二号 0 枚）；version 接着上一个局面往上加，网页才会刷新。
 */
export function createEndgame(selfName: string, afterVersion: number): GameState {
  const game = tutorialEndgame();
  game.players = game.players.map((player) => ({
    ...player,
    name: player.id === TUTORIAL_SELF ? selfName : RIVAL_NAMES[player.id] ?? player.name,
    tokens: player.id === TUTORIAL_SELF ? 1 : 0,
  }));
  game.version = afterVersion + 1;
  return game;
}

/** 练习局「再练一局」：同样 3 个人，随机发牌、随机先手。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame(tutorialPlayers(selfName), seed);
}

/**
 * 教程里走一步。剧本进行中（script）点「下一局」直接换成残局；练习局里你点「下一局」时两个人机一起点。
 * 不合法就抛错（引擎的中文错误信息）。
 */
export function tutorialApply(state: GameState, playerId: string, command: GameCommand, script: boolean, selfName: string): GameState {
  if (script && command.type === "READY" && state.phase === "roundEnd" && state.round === 1) {
    if (playerId !== TUTORIAL_SELF) throw new Error("剧本里只有你点「下一局」。");
    return createEndgame(selfName, state.version);
  }
  let next = applyCommand(state, playerId, command);
  if (command.type === "READY") {
    for (const player of next.players) {
      if (next.phase !== "roundEnd") break;
      if (player.id !== playerId && !next.ready.includes(player.id)) next = applyCommand(next, player.id, { type: "READY" });
    }
  }
  return next;
}

/** 现在等谁：一小局进行中是当前玩家；结算画面等你点「下一局」；整场结束没有人。 */
export function tutorialActor(state: GameState): string | null {
  if (state.phase === "playing") return actorOf(state);
  if (state.phase === "roundEnd") return state.ready.includes(TUTORIAL_SELF) ? null : TUTORIAL_SELF;
  return null;
}

/** 两条命令是不是同一步。大臣放回牌堆底的顺序不限（剧本后面用不到），只看留哪张、放回哪几张。 */
export function sameCommand(a: GameCommand, b: GameCommand): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "PLAY" && b.type === "PLAY") return a.card === b.card && a.target === b.target && a.guess === b.guess;
  if (a.type === "CHANCELLOR" && b.type === "CHANCELLOR") {
    return a.keep === b.keep && [...a.bottom].sort().join() === [...b.bottom].sort().join();
  }
  return true;
}

// ---------------------------------------------------------------------------
// 打一张牌要点的几下

type PlayCommand = Extract<GameCommand, { type: "PLAY" }>;

interface PlayTexts {
  /** 点牌这一下（主句和补充）。 */
  readonly card: readonly [string, string?];
  /** 选人这一下。 */
  readonly target?: string;
  /** 卫兵猜牌。 */
  readonly guess?: readonly [string, string?];
  /** 最后确认这一下（不写就用默认说法）。 */
  readonly confirm?: string;
}

const targetAnchor = (target: string) => (target === TUTORIAL_SELF ? "target-me" : `target-${target}`);

/** 按命令排出要点的几下：点牌 →（选人）→（卫兵：猜牌 → 指认）/ 打出按钮。 */
export function playSubs(command: PlayCommand, texts: PlayTexts): SubStep[] {
  const card = `card:${command.card}`;
  const subs: SubStep[] = [{ anchor: card, say: texts.card[0], ...(texts.card[1] ? { note: texts.card[1] } : {}) }];
  if (command.target) {
    subs.push({ anchor: targetAnchor(command.target), say: texts.target ?? "选一个人。", when: { pressed: card } });
  }
  if (command.guess) {
    const [say, note] = texts.guess ?? [`猜「${ROLE_NAME[command.guess]}」。`];
    subs.push({ anchor: `guess-${command.guess}`, say, ...(note ? { note } : {}), when: { present: "guess-picker" } });
    subs.push({ anchor: "guess-confirm", say: texts.confirm ?? "点下面的「指认」按钮。", when: { present: "guess-picker", enabled: "guess-confirm" } });
  } else {
    subs.push({ anchor: "play-button", say: texts.confirm ?? `点「打出${ROLE_NAME[command.card]}」。`, when: { pressed: card, present: "play-button" } });
  }
  return subs;
}

const play = (card: Role, target?: string, guess?: Role): PlayCommand => ({
  type: "PLAY",
  card,
  ...(target ? { target } : {}),
  ...(guess ? { guess } : {}),
});

// ---------------------------------------------------------------------------
// 剧本

const GUARD_1 = play("guard", RIVAL_1, "baron");
const GUARD_2 = play("guard", RIVAL_2, "prince");
const COUNTESS = play("countess");
const CHANCELLOR = play("chancellor");
const BARON = play("baron", RIVAL_1);
const HANDMAID = play("handmaid");

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // ---- 第一段：一整局 ----
  {
    kind: "info", id: "welcome", lesson: "目标", face: "happy",
    say: "情书：撑到最后，或者牌堆抽完时手里点数最大，就赢这一小局。",
    note: "赢一小局拿 1 枚钟情标记，先攒够的人赢整场；这局我们 3 个人玩，你先手。",
  },
  {
    kind: "info", id: "turn", lesson: "抽一张打一张", anchor: "hand",
    say: "轮到你时先抽 1 张，手里变成 2 张，再打出其中 1 张。",
    note: "打出的牌要照它做（哪怕对自己不利），所以手里永远只剩 1 张；牌左上角的数字是点数。",
  },
  {
    kind: "do", id: "guard", lesson: "卫兵", expect: GUARD_1, anchor: "card:guard",
    say: "先打卫兵：点手里的卫兵。",
    subs: playSubs(GUARD_1, {
      card: ["先打卫兵：点手里的卫兵。", "卫兵：点一个人、猜他手里是什么，猜中他就出局（不能猜卫兵）。"],
      target: "选咕噜一号。",
      guess: ["猜他是「男爵」。", "每种牌下面写着还有几张没露面。"],
      confirm: "点「指认 咕噜一号 是男爵」。",
    }),
  },
  {
    kind: "info", id: "miss", anchor: "recent", face: "think",
    say: "没猜中，什么都不会发生。",
    note: "一号手里不是男爵；打出的卫兵摆在你面前，大家都看得见。",
  },
  {
    kind: "info", id: "stats", lesson: "记牌", anchor: "stats",
    say: "这里数着每种牌还有几张没露面。",
    note: "整副只有 21 张，打出的牌人人都看得见，记牌是取胜的关键。",
  },
  {
    kind: "watch", id: "w-priest", anchor: `seat-${RIVAL_1}`,
    say: "轮到咕噜一号了，看它怎么打。",
    moves: [play("priest", TUTORIAL_SELF)],
  },
  {
    kind: "info", id: "priest", lesson: "牧师", anchor: `discards-${RIVAL_1}`, face: "surprised",
    say: "咕噜一号打出牧师，偷看了你的牌。",
    note: "牧师看到的牌只有他自己知道：现在他知道你拿着女伯爵。",
  },
  {
    kind: "watch", id: "w-spy", anchor: `seat-${RIVAL_2}`,
    say: "轮到咕噜二号了。",
    moves: [play("spy")],
  },
  {
    kind: "info", id: "spy", lesson: "间谍", anchor: `marks-${RIVAL_2}`, face: "think",
    say: "咕噜二号打出间谍，间谍本身没效果。",
    note: "但一小局结束时，还在局中的人里只有他打过间谍，他就额外 +1 枚；名字旁的面具就是标记。",
  },
  {
    kind: "info", id: "try-prince", lesson: "女伯爵", anchor: "card:prince",
    say: "你抽到了王子，点它试试。",
    until: { present: "action-hint" },
  },
  {
    kind: "do", id: "countess", expect: COUNTESS, anchor: "card:countess",
    say: "王子打不了：手里有女伯爵和王子时必须打女伯爵，点她。",
    subs: playSubs(COUNTESS, {
      card: ["王子打不了：手里有女伯爵和王子时必须打女伯爵，点她。", "和国王在一起也一样；打她时不亮另一张，别人分不清你是被迫还是故意的。"],
      confirm: "点「打出女伯爵」。",
    }),
  },
  {
    kind: "watch", id: "w-handmaid", anchor: `seat-${RIVAL_1}`,
    say: "咕噜一号的回合。",
    moves: [play("handmaid")],
  },
  {
    kind: "info", id: "handmaid", lesson: "侍女", anchor: `marks-${RIVAL_1}`,
    say: "咕噜一号打出侍女：到他下一回合开始前，别人的牌都不能选他。",
    note: "要是别人全被保护，卫兵、牧师、男爵、国王就白打，王子只能选自己。",
  },
  {
    kind: "watch", id: "w-king", anchor: `seat-${RIVAL_2}`,
    say: "咕噜二号的回合。",
    moves: [play("king", TUTORIAL_SELF)],
  },
  {
    kind: "info", id: "king", lesson: "国王", anchor: "reveal-dialog",
    say: "咕噜二号用国王和你换了手牌，看完点「知道了」。",
    note: "你拿到男爵，他拿走了王子，你们俩都知道对方的牌；一号受保护，所以他只能选你。",
    until: { absent: "reveal-dialog" },
  },
  {
    kind: "do", id: "guard-hit", expect: GUARD_2, anchor: "card:guard",
    say: "你知道二号拿着王子：用卫兵点他！",
    subs: playSubs(GUARD_2, {
      card: ["你知道二号拿着王子：用卫兵点他！", "点手里的卫兵。"],
      target: "选咕噜二号（一号受保护，选不了）。",
      guess: ["猜「王子」。"],
      confirm: "点「指认 咕噜二号 是王子」。",
    }),
  },
  {
    kind: "info", id: "out", lesson: "出局", anchor: `seat-${RIVAL_2}`, face: "happy",
    say: "猜中了，咕噜二号出局！",
    note: "出局的人亮出手牌，这一小局不再轮到他、别人也不能选他；他打过的间谍也不再算数。",
  },
  {
    kind: "watch", id: "w-prince", anchor: `seat-${RIVAL_1}`,
    say: "一号的回合到了，侍女的保护到此结束。",
    moves: [play("prince", TUTORIAL_SELF)],
  },
  {
    kind: "info", id: "prince", lesson: "王子", anchor: "discards-me", face: "surprised",
    say: "一号用王子点了你：你弃掉男爵，重抽了一张。",
    note: "王子能点任何人（包括自己），弃掉的牌不发动效果；但弃掉的要是公主，照样出局。",
  },
  {
    kind: "do", id: "chancellor", lesson: "大臣", expect: CHANCELLOR, anchor: "card:chancellor",
    say: "打出大臣。",
    subs: playSubs(CHANCELLOR, {
      card: ["打出大臣：点手里的大臣。", "大臣：再抽 2 张，3 张里留 1 张，另外 2 张放回牌堆底。"],
      confirm: "点「打出大臣」。",
    }),
  },
  {
    kind: "do", id: "keep", expect: { type: "CHANCELLOR", keep: "princess", bottom: ["priest", "guard"] }, anchor: "keep:princess",
    say: "抽到了公主和牧师：留下公主。",
    subs: [
      {
        anchor: "keep:princess", say: "抽到了公主和牧师：点公主，留下她。",
        note: "放回牌堆底的牌不发动、不算弃牌，公主放回去也不会出局；这时手里 3 张也不用管女伯爵。",
      },
      {
        anchor: "chancellor-dialog", say: "另外 2 张按你定的顺序放回牌堆底，点下面的确认按钮。",
        note: "想换顺序就点「换顺序」，最后一张在最底下。",
        when: { pressed: "keep:princess" },
      },
    ],
  },
  {
    kind: "watch", id: "w-spy2", anchor: `seat-${RIVAL_1}`,
    say: "咕噜一号的回合。",
    moves: [play("spy")],
  },
  {
    kind: "info", id: "spy2", anchor: `marks-${RIVAL_1}`, face: "think",
    say: "一号也打了间谍。",
    note: "二号已经出局，不算了；现在在局的人里只有一号打过间谍，他撑到最后就能多拿 1 枚。",
  },
  {
    kind: "info", id: "try-princess", lesson: "男爵和公主", anchor: "card:princess",
    say: "公主千万别打，不过先点一下看看会怎样。",
    subs: [
      { anchor: "card:princess", say: "公主千万别打，不过先点一下看看会怎样。" },
      { anchor: "play-button", say: "再点「打出公主」。", note: "放心，下一步会先问你。", when: { pressed: "card:princess", present: "play-button" } },
    ],
    until: { present: "confirm-dialog" },
  },
  {
    kind: "info", id: "princess-warn", anchor: "confirm-dialog", face: "surprised",
    say: "看，打出公主你立刻出局，所以会先问你：点「取消」。",
    note: "被王子弃掉也一样出局，公主只能一直攥在手里。",
    until: { absent: "confirm-dialog" },
  },
  {
    kind: "do", id: "baron", expect: BARON, anchor: "card:baron",
    say: "改用男爵和咕噜一号比牌。",
    subs: playSubs(BARON, {
      card: ["改用男爵和咕噜一号比牌：点男爵。", "比的是你手里剩下的那张，不是男爵本身；小的出局，一样大谁都不出局。"],
      target: "选咕噜一号。",
      confirm: "点「打出男爵 → 咕噜一号」。",
    }),
  },
  {
    kind: "info", id: "win", lesson: "一局结束", anchor: "round-tokens", face: "happy",
    say: "你的公主(9) 比他的卫兵(1) 大，一号出局，只剩你，你赢了！",
    note: "只剩一个人时他立刻赢，+1 枚；两个打过间谍的人都出局了，这局没人拿间谍 +1。",
  },
  {
    kind: "do", id: "next-round", expect: { type: "READY" }, anchor: "next-round-button",
    say: "点「下一局」，我们直接跳到一局快结束的时候。",
  },
  // ---- 第二段：残局 ----
  {
    kind: "info", id: "endgame", lesson: "牌堆抽完", anchor: "deck",
    say: "这一局你刚抽走了牌堆的最后一张。",
    note: "这个回合结束牌堆就空了，在局的人亮牌比大小；牌堆空了以后被王子点到的人，拿开局移出的那张。",
  },
  {
    kind: "do", id: "handmaid-end", expect: HANDMAID, anchor: "card:handmaid",
    say: "打出侍女，留下王子。",
    subs: playSubs(HANDMAID, {
      card: ["打出侍女，留下王子：点侍女。"],
      confirm: "点「打出侍女」。",
    }),
  },
  {
    kind: "info", id: "tie", anchor: "showdown", face: "surprised",
    say: "亮牌：你和一号都是王子(5)，一样大！",
    note: "一样大就都算赢，两个人各 +1 枚，不比别的。",
  },
  {
    kind: "info", id: "spy-bonus", anchor: "round-tokens", face: "happy",
    say: "你还多拿 1 枚：间谍 +1。",
    note: "二号也打过间谍，但他出局了不算；在局的人里只有你打过，这 1 枚和赢的 1 枚可以叠加。",
  },
  {
    kind: "info", id: "starter", lesson: "下一局谁先手", anchor: "next-starter",
    say: "下一局由这局的赢家先手。",
    note: "几个人一起赢时，从他们当中随机挑一个。",
  },
  {
    kind: "info", id: "goal", lesson: "攒够标记", anchor: "round-tokens",
    say: "3 人局先攒够 5 枚钟情标记就赢整场。",
    note: "2、4、5、6 人局分别是 6、4、3、3 枚，名字旁一直显示「几枚 / 目标」。",
  },
  {
    kind: "info", id: "auto", lesson: "超时和托管",
    say: "每一步限时 30 秒，超时由人机替你打完这一回合。",
    note: "连续 2 次超时就进托管（人机一直替你打），点「取消托管」就收回来；掉线时人机也会代打。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！",
    note: "接着和两个咕噜把这一整场打完吧，拿不准就点「提示」，我告诉你我会怎么打。",
  },
];

// ---------------------------------------------------------------------------
// 给单测和网页用的小工具

/** 锚点换算：card:<角色> → hand-<下标>，keep:<角色> → chancellor-keep-<下标>；找不到时原样返回（界面上就不会有）。 */
export function resolveAnchor(state: GameState, anchor: Anchor, viewer = TUTORIAL_SELF): string {
  const me = state.players.find((player) => player.id === viewer);
  if (anchor.startsWith("card:") || anchor.startsWith("keep:")) {
    const role = anchor.slice(5) as Role;
    const index = me?.hand.indexOf(role) ?? -1;
    if (index < 0) return anchor;
    return anchor.startsWith("card:") ? `hand-${index}` : `chancellor-keep-${index}`;
  }
  return anchor;
}

/**
 * 这一步一开始（还没点任何东西时）高亮的锚点，在这个局面下界面上应该看得见吗（剧本单测用，
 * 对应 GameBoard / Dialogs 的显示条件）。只管剧本里用到的锚点。
 */
export function anchorVisible(state: GameState, anchor: Anchor, viewer = TUTORIAL_SELF): boolean {
  const me = state.players.find((player) => player.id === viewer);
  const playing = state.phase === "playing";
  const myTurn = playing && actorOf(state) === viewer;
  if (!me) return false;
  if (anchor.startsWith("card:")) return myTurn && state.stage === "play" && me.hand.includes(anchor.slice(5) as Role);
  if (anchor.startsWith("keep:")) return myTurn && state.stage === "chancellor" && me.hand.includes(anchor.slice(5) as Role);
  // 打公主前的确认框：上一步（try-princess）点出来的，局面上只要求轮到你、手里有公主
  if (anchor === "confirm-dialog") return myTurn && state.stage === "play" && me.hand.includes("princess");
  if (anchor === "hand" || anchor === "stats" || anchor === "deck" || anchor === "discards-me") return true;
  if (anchor === "recent") return playing && state.events.length > 0;
  if (anchor.startsWith("seat-") || anchor.startsWith("discards-")) return state.players.some((player) => `seat-${player.id}` === anchor || `discards-${player.id}` === anchor);
  if (anchor.startsWith("marks-")) {
    const player = state.players.find((candidate) => `marks-${candidate.id}` === anchor);
    return player !== undefined && (player.protected || player.out || player.spy);
  }
  if (anchor === "reveal-dialog") {
    return playing && state.events.some((event) =>
      (event.type === "Swapped" && (event.player === viewer || event.target === viewer))
      || (event.type === "Compared" && (event.player === viewer || event.target === viewer))
      || (event.type === "Peeked" && event.player === viewer));
  }
  if (anchor === "round-tokens" || anchor === "next-starter") return state.phase === "roundEnd" && state.lastRound !== undefined;
  if (anchor === "next-round-button") return state.phase === "roundEnd" && !state.ready.includes(viewer);
  if (anchor === "showdown") return state.phase === "roundEnd" && Object.keys(state.lastRound?.hands ?? {}).length > 0;
  return false;
}

/** 一段话里有几句（按句末的 。！？ 数；最后没有句末标点的半句也算一句）。 */
export function sentences(text: string | undefined): number {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return 0;
  const ends = trimmed.match(/[。！？]/g)?.length ?? 0;
  return ends + (/[。！？]$/.test(trimmed) ? 0 : 1);
}
