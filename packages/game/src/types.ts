import type { Role } from "./cards.js";

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 攒够几枚钟情标记赢整场（按人数：2→6、3→5、4→4、5→3、6→3）。 */
  readonly tokensToWin: number;
  /** 每一步的限时（秒）：出牌（含选人、猜牌）一步，大臣留牌一步。超时见 timeoutTurn。 */
  readonly turnTimeoutSec: number;
  /** 一小局结束后结算画面最多停几秒，然后自动开下一局（在线真人都点了「下一局」就提前开）。 */
  readonly roundEndSec: number;
}

/** 打出区里的一张牌：怎么到这里的。 */
export interface DiscardEntry {
  readonly card: Role;
  /**
   * played：自己作为行动打出；
   * discarded：被王子点到弃掉（不发动效果）；
   * eliminated：出局时亮出手牌弃掉（不发动效果）。
   */
  readonly how: "played" | "discarded" | "eliminated";
}

export interface Player {
  /** 座位 id（服务器里是 p1、p2…），整场不变。 */
  readonly id: string;
  readonly name: string;
  /** 座位顺序 0–5，就是 players 里的下标；按这个顺序轮流（顺时针）。 */
  readonly seat: number;
  /** 已经拿到的钟情标记（跨小局累计，不设上限）。 */
  tokens: number;
  /**
   * 手牌。裁剪后的状态里只有自己的（观战「看手牌」时是所有人的），别人的是空数组，张数看 handCount。
   * 平时 1 张；轮到自己出牌时 2 张（刚抽了 1 张）；打出大臣、等留牌时 2–3 张；出局后 0 张。
   */
  hand: Role[];
  handCount: number;
  /** 打出区（公开）：本小局打出、被弃掉、出局亮出的牌，按先后顺序。 */
  discards: DiscardEntry[];
  /** 本小局已出局。 */
  out: boolean;
  /** 受侍女保护（到他下一回合开始为止），别人的牌不能选他。 */
  protected: boolean;
  /** 本小局打出或弃掉过间谍（公开，从打出区就能看出来）。 */
  spy: boolean;
}

/**
 * playing：一小局进行中；roundEnd：一小局结束，显示结算，等下一局；finished：有人攒够标记，整场结束。
 */
export type Phase = "playing" | "roundEnd" | "finished";

/** playing 时的步骤：play 出一张牌（含选人和猜牌）；chancellor 打出大臣后留 1 张、其余放回牌堆底。 */
export type Stage = "play" | "chancellor";

/**
 * 玩家命令。
 *
 * - PLAY：打出手里的一张牌，选人和猜牌一起发（补充文件 3.3 #7）。
 *   - target：卫兵、牧师、男爵、国王必须选一名能选的别的玩家（在局中、没被侍女保护）；
 *     一个能选的人都没有时不带 target，牌白打。王子必须带 target，可以是自己。其他牌不带 target。
 *   - guess：只有卫兵在选了人时带，不能是 "guard"。
 * - CHANCELLOR：打出大臣抽牌后，keep 是留下的那张，bottom 是放回牌堆底的牌，
 *   **数组从上到下，最后一个在最底下**。keep + bottom 必须正好是手里的牌（2 或 3 张）。
 * - READY：一小局结束后点「下一局」。所有人都点了（或者结算时间到）就开下一局。
 */
export type GameCommand =
  | { readonly type: "PLAY"; readonly card: Role; readonly target?: string; readonly guess?: Role }
  | { readonly type: "CHANCELLOR"; readonly keep: Role; readonly bottom: readonly Role[] }
  | { readonly type: "READY" };

/** 出局的原因：卫兵猜中、男爵比输、被王子弃掉公主、自己打出公主。 */
export type EliminationReason = "guard" | "baron" | "prince" | "princess";

/** 一小局的结算（公开）。 */
export interface RoundResult {
  readonly round: number;
  /** lastStanding：只剩一人；showdown：牌堆抽完，亮牌比点数。 */
  readonly reason: "lastStanding" | "showdown";
  /** 赢这一小局的人（亮牌并列时有好几个）。 */
  readonly winners: string[];
  /** 拿到间谍 +1 的人：本局结束时还在局中的人里唯一打出 / 弃掉过间谍的人；没有就是 null。 */
  readonly spyBonus: string | null;
  /** 这一小局每人拿到几枚标记（只列拿到的人，最多 2 枚：赢 +1、间谍 +1）。 */
  readonly awards: Record<string, number>;
  /** 亮牌：牌堆抽完时还在局中的人的手牌。只剩一人时不亮牌，是空对象。 */
  readonly hands: Record<string, Role>;
  /** 开局面朝下移出的那张，结算时亮出来。被王子抽走了就是 null（那张在某人手里，亮牌时能看到）。 */
  readonly setAside: Role | null;
  /** 下一小局谁先手（这局的赢家；并列时在并列赢家里随机）；整场结束时是 null。 */
  readonly nextStarter: string | null;
}

/**
 * 事件：每一步发生了什么。state.events 是最近一步的，state.history 是本小局到现在的全部。
 * 打问号的字段是私密内容，裁剪时只留给有权看的人（见 redactGameForViewer）：
 * - Drew.card、ChancellorDrew.cards：只给抽牌的人（观战「看手牌」也能看）；
 * - Peeked.card：只给出牧师的人（观战「看手牌」也能看）；
 * - Compared.playerCard / targetCard：只给比牌的两人（观战「看手牌」也能看）；
 * - Swapped.playerGot / targetGot：只给换牌的两人（观战「看手牌」也能看）；
 * - ChancellorReturned.cards：只给出大臣的人（观战「看手牌」的事件里也没有；但他看得到留牌时手里的 3 张，能推出放回的是哪两张，看不到顺序）。
 */
export type GameEvent =
  /** 新的一小局：发好了牌。faceUp 是 2 人局面朝上移出的 3 张（公开）。 */
  | { readonly type: "RoundStarted"; readonly round: number; readonly starter: string; readonly faceUp: Role[] }
  /** 轮到某人。protectionEnded：他的侍女保护到此结束。 */
  | { readonly type: "TurnStarted"; readonly player: string; readonly protectionEnded: boolean }
  /**
   * 抽了一张牌。reason：turn 回合开始抽牌；prince 被王子点到后重抽。
   * source：deck 牌堆；setAside 牌堆空了，拿走开局面朝下移出的那张。
   */
  | { readonly type: "Drew"; readonly player: string; readonly reason: "turn" | "prince"; readonly source: "deck" | "setAside"; readonly card?: Role }
  /** 打出一张牌（公开：打的是什么、选了谁、猜了什么）。 */
  | { readonly type: "Played"; readonly player: string; readonly card: Role; readonly target?: string; readonly guess?: Role }
  /** 白打：卫兵、牧师、男爵、国王没有能选的人（noTarget）；大臣时牌堆已空（emptyDeck）。 */
  | { readonly type: "NoEffect"; readonly player: string; readonly card: Role; readonly reason: "noTarget" | "emptyDeck" }
  /** 卫兵猜牌的结果（公开）。猜中时紧接着有 Eliminated。 */
  | { readonly type: "Guessed"; readonly player: string; readonly target: string; readonly guess: Role; readonly hit: boolean }
  /** 牧师看了谁的牌。card 只给出牧师的人。 */
  | { readonly type: "Peeked"; readonly player: string; readonly target: string; readonly card?: Role }
  /** 男爵比牌：loser 是比输出局的人，平手是 null（公开）。两人的牌只给他们俩。 */
  | {
      readonly type: "Compared";
      readonly player: string;
      readonly target: string;
      readonly loser: string | null;
      readonly playerCard?: Role;
      readonly targetCard?: Role;
    }
  /** 侍女：受保护到自己下一回合开始。 */
  | { readonly type: "Protected"; readonly player: string }
  /** 被王子点到，弃掉手牌（公开，不发动效果）。弃掉公主紧接着有 Eliminated。 */
  | { readonly type: "Discarded"; readonly player: string; readonly card: Role; readonly by: string }
  /** 大臣抽了几张（公开张数）；cards 只给他自己。 */
  | { readonly type: "ChancellorDrew"; readonly player: string; readonly count: number; readonly cards?: Role[] }
  /** 大臣放回牌堆底几张（公开张数）；cards（从上到下）只给他自己。 */
  | { readonly type: "ChancellorReturned"; readonly player: string; readonly count: number; readonly cards?: Role[] }
  /** 国王换牌（公开谁和谁换）；换到的牌只给他们俩：playerGot 是出国王的人拿到的，targetGot 是对方拿到的。 */
  | { readonly type: "Swapped"; readonly player: string; readonly target: string; readonly playerGot?: Role; readonly targetGot?: Role }
  /** 出局：revealed 是他出局时亮出、弃掉的手牌（公开；被王子弃掉公主时是空的）。by 是让他出局的人（自己打公主时是他自己）。 */
  | { readonly type: "Eliminated"; readonly player: string; readonly reason: EliminationReason; readonly by: string; readonly revealed: Role[] }
  /** 一小局结束和结算。 */
  | { readonly type: "RoundEnded"; readonly result: RoundResult }
  /** 一小局结束后某人点了「下一局」。 */
  | { readonly type: "Ready"; readonly player: string }
  /** 有人攒够标记，整场结束；winners 是所有达标的人（可以好几个）。 */
  | { readonly type: "GameEnded"; readonly winners: string[] }
  /** 某人这一步超时，由系统替他走完这一回合（见 timeoutTurn）。 */
  | { readonly type: "TurnTimedOut"; readonly player: string; readonly stage: Stage };

export type GameEventType = GameEvent["type"];

export interface GameState {
  readonly config: Config;
  phase: Phase;
  /** playing 时的步骤；其他阶段保留最后的值，不用看。 */
  stage: Stage;
  players: Player[];
  /** 第几小局（从 1 开始）。 */
  round: number;
  /** 整场第几个回合（每轮到一个人 +1）；服务器按它和 stage 给每一步计时。 */
  turn: number;
  /** 当前玩家在 players 里的下标（roundEnd / finished 时是最后行动的人，不用看）。 */
  current: number;
  /** 牌堆还剩几张（公开）。 */
  deckCount: number;
  /** 2 人局开局面朝上移出的 3 张（公开，永远不进任何人手里）；3 人以上是空数组。 */
  faceUp: Role[];
  /** 牌堆空时王子让人拿走了面朝下移出的那张（公开；拿到的是什么只有他自己知道）。 */
  setAsideTaken: boolean;
  /** 一小局结束后已经点了「下一局」的人。 */
  ready: string[];
  /** 最近一次一小局的结算（roundEnd、finished 时就是刚结束的这局；新一局开始后保留上一局的）。 */
  lastRound?: RoundResult;
  /** 整场的赢家（finished 才有）：所有攒够标记的人。 */
  winners?: string[];
  /** 本小局到现在的事件（裁剪过的）；新一小局开始时清空。人机记牌、界面日志都看它。 */
  history: GameEvent[];
  /** 最近一步的事件（裁剪过的）。 */
  events: GameEvent[];
  /** 每走一步 +1；网页按它判断有没有新变化、要不要播动画。 */
  version: number;

  // ---- 以下只在服务器上（redactGameForViewer 会去掉），浏览器拿不到 ----
  /** 牌堆，**顶在前**（deck[0] 是下一张被抽的）。 */
  deck?: Role[];
  /** 开局面朝下移出的那张；被王子抽走后是 null。 */
  setAside?: Role | null;
  /**
   * 开局的种子和随机数状态（各 4 个 32 位整数，128 位；洗牌、第一局先手、并列赢家里抽先手）。
   * 线上服务器每个命令都另外传一个新的 crypto 随机数进来，不接着用 rngState（见 rng.ts）。
   */
  seed?: number[];
  rngState?: number[];
  /**
   * 动作序列：用开局种子重放这串动作就能复现整场。服务器传进来的随机数被用到时（小局结束抽先手、开新一局洗牌），
   * 那一步记下它的种子 seed（createRng(seed) 能重放）。
   */
  actions?: { player: string; command: GameCommand | { type: "TIMEOUT" }; seed?: number[] }[];
}
