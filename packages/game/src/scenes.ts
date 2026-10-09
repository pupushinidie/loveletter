/**
 * 预览局面工厂（对外接口）：界面的预览页、教程、验收（包括背靠背的规则核对）都用它造局面。
 *
 * - createScene(spec)：按参数造任意一个精确局面（谁手里什么、牌堆从顶往下是什么、谁出局、谁受保护……）。
 * - scene(name, options)：按名字造常见局面（开局、每种牌打出前、大臣留牌、结算、整场结束……）。
 * - previewRoom(game, options)：把局面包成网页收到的房间快照（对手离线、人机、托管、超时倒计时、观战）。
 * - TUTORIAL_*：教程剧本局（补充文件 2.2）的发牌和每一步命令。
 *
 * 造出来的都是服务器上的完整状态（带牌堆），可以直接接着 applyCommand / apply 往下走；
 * 给网页显示前用 redactGameForViewer 裁剪成某个座位的视角（previewRoom 会替你裁剪）。
 */
import { FULL_DECK, ROLE_COUNT, ROLE_NAME, ROLES, TWO_PLAYER_FACE_UP, countRoles, type Role } from "./cards.js";
import { applyCommand, createGame, defaultConfig, redactGameForViewer, timeoutTurn, type Deal, type NewPlayer } from "./engine.js";
import { createRng } from "./rng.js";
import { DEFAULT_ROOM_ACCESS, type Capacity, type LobbyMember, type LobbyRoomSnapshot, type RoomAccess } from "./roomTypes.js";
import type { Config, DiscardEntry, GameCommand, GameState, Player, Stage } from "./types.js";

/** 预览里默认的玩家名字（座位 id 是 p1、p2…，和服务器一样）。 */
export const SCENE_NAMES = ["小明", "阿青", "老胡", "花花", "大熊", "七七"] as const;

/** 座位 id：第 seat 个座位（从 0 数）是 p{seat+1}。 */
export function seatId(seat: number): string {
  return `p${seat + 1}`;
}

export function scenePlayers(count: number): NewPlayer[] {
  if (!Number.isInteger(count) || count < 2 || count > 6) throw new Error("人数要在 2–6 之间。");
  return Array.from({ length: count }, (_, seat) => ({ id: seatId(seat), name: SCENE_NAMES[seat]! }));
}

export interface SceneSpec {
  /** 人数（默认 3）或者玩家列表。人数时座位 id 是 p1…pN，名字见 SCENE_NAMES。 */
  readonly players?: number | readonly NewPlayer[];
  /**
   * 每个座位的手牌（按座位顺序，可以只写前几个，没写或 undefined 的座位自动补）。
   * 当前玩家 stage 为 play 时是 2 张（已经抽过牌了），chancellor 时 2–3 张；其他在局的人 1 张；出局的人空。
   */
  readonly hands?: readonly (readonly Role[] | undefined)[];
  /** 每个座位的打出区（直接写角色名就当「自己打出」，也可以写 { card, how }）。 */
  readonly discards?: readonly (readonly (Role | DiscardEntry)[] | undefined)[];
  /** 已出局的座位下标。 */
  readonly out?: readonly number[];
  /** 受侍女保护的座位下标（不能是当前玩家，也不能是出局的人）。 */
  readonly protected?: readonly number[];
  /** 每个座位的钟情标记。 */
  readonly tokens?: readonly number[];
  /** 牌堆，**顶在前**。leftovers 为 deck 时，没用到的牌接在后面（牌堆底）。 */
  readonly deck?: readonly Role[];
  /** 面朝下移出的那张；null 表示已经被王子拿走；不写就从剩下的牌里取。 */
  readonly setAside?: Role | null;
  /** 2 人局面朝上移出的 3 张；不写就从剩下的牌里取。 */
  readonly faceUp?: readonly Role[];
  /** 轮到谁（座位下标，默认 0）。 */
  readonly current?: number;
  /** 默认 play。 */
  readonly stage?: Stage;
  /** 第几小局（默认 1）。 */
  readonly round?: number;
  /** 整场第几个回合（默认按打出区的张数估一个）。 */
  readonly turn?: number;
  /**
   * 21 张里没写到的牌放哪：
   * - deck（默认）：洗一下接在牌堆底；
   * - discards：分进各座位的打出区（公主只会放进出局的人那里或当移出的牌）；
   * - error：不许有没写到的牌（写全 21 张的精确局面用）。
   */
  readonly leftovers?: "deck" | "discards" | "error";
  /** 补牌顺序和之后随机数用的种子（默认 1）。 */
  readonly seed?: number;
  readonly config?: Partial<Config>;
}

function normalizePlayers(players: SceneSpec["players"]): NewPlayer[] {
  if (players === undefined) return scenePlayers(3);
  if (typeof players === "number") return scenePlayers(players);
  if (players.length < 2 || players.length > 6) throw new Error("人数要在 2–6 之间。");
  return players.map((player) => ({ id: player.id, name: player.name }));
}

/**
 * 按参数造一个精确局面（一小局进行中）。牌数不对、手牌张数和步骤对不上、出局的人还有手牌、
 * 在局的人打出区里有公主之类自相矛盾的写法会直接报错。
 */
export function createScene(spec: SceneSpec = {}): GameState {
  const players = normalizePlayers(spec.players);
  const count = players.length;
  const stage: Stage = spec.stage ?? "play";
  const current = spec.current ?? 0;
  const outSeats = new Set(spec.out ?? []);
  const protectedSeats = new Set(spec.protected ?? []);
  if (current < 0 || current >= count) throw new Error("current 座位不对。");
  if (outSeats.has(current)) throw new Error("轮到的人不能已经出局。");
  if (protectedSeats.has(current)) throw new Error("轮到的人的侍女保护已经结束了，不能还受保护。");
  for (const seat of protectedSeats) if (outSeats.has(seat)) throw new Error("出局的人不受保护。");
  if (count - outSeats.size < 2) throw new Error("一小局进行中至少要有 2 个人还在局中。");

  const seed = spec.seed ?? 1;
  const rng = createRng(seed);
  const discards: DiscardEntry[][] = players.map((_, seat) =>
    (spec.discards?.[seat] ?? []).map((entry) => (typeof entry === "string" ? { card: entry, how: "played" as const } : { ...entry })),
  );
  const hands: (Role[] | undefined)[] = players.map((_, seat) => (spec.hands?.[seat] ? [...spec.hands[seat]!] : undefined));
  const deck = [...(spec.deck ?? [])];
  let faceUp = spec.faceUp ? [...spec.faceUp] : undefined;
  let setAside = spec.setAside;

  const used = [
    ...discards.flat().map((entry) => entry.card),
    ...hands.flatMap((hand) => hand ?? []),
    ...deck,
    ...(faceUp ?? []),
    ...(setAside ? [setAside] : []),
  ];
  const usedCounts = countRoles(used);
  for (const role of ROLES) {
    if (usedCounts[role] > ROLE_COUNT[role]) {
      throw new Error(`${ROLE_NAME[role]}一共只有 ${ROLE_COUNT[role]} 张，局面里写了 ${usedCounts[role]} 张。`);
    }
  }
  const remaining = [...FULL_DECK];
  for (const card of used) remaining.splice(remaining.indexOf(card), 1);
  const pool = rng.shuffle(remaining);
  const take = (prefer?: (role: Role) => boolean): Role => {
    if (pool.length === 0) throw new Error("21 张牌不够分了。");
    const index = prefer ? Math.max(0, pool.findIndex(prefer)) : 0;
    return pool.splice(index, 1)[0]!;
  };
  const mode = spec.leftovers ?? "deck";
  // leftovers 为 discards 时，没写到的公主不能进在局的人的打出区：依次放进 2 人局的明牌、移出的牌、
  // 没写手牌的对手手里，都不行才放进出局的人的打出区。
  const placePrincess = mode === "discards";
  const isPrincess = (role: Role) => role === "princess";
  const notPrincess = (role: Role) => role !== "princess";

  if (count === 2) {
    if (faceUp === undefined) {
      faceUp = Array.from({ length: TWO_PLAYER_FACE_UP }, () => take(placePrincess ? isPrincess : notPrincess));
    }
    if (faceUp.length !== TWO_PLAYER_FACE_UP) throw new Error("2 人局面朝上移出 3 张。");
  } else if (faceUp && faceUp.length > 0) {
    throw new Error("3 人以上不面朝上移出牌。");
  }
  if (setAside === undefined) setAside = take(placePrincess ? isPrincess : undefined);

  players.forEach((_, seat) => {
    const hand = hands[seat];
    if (outSeats.has(seat)) {
      if (hand && hand.length > 0) throw new Error(`座位 ${seat} 已经出局，手里不能有牌。`);
      hands[seat] = [];
      return;
    }
    const size = seat === current ? (stage === "chancellor" ? 3 : 2) : 1;
    if (!hand) {
      hands[seat] = Array.from({ length: size }, () => take(placePrincess && seat !== current ? isPrincess : notPrincess));
      return;
    }
    const ok = seat === current ? (stage === "chancellor" ? hand.length === 2 || hand.length === 3 : hand.length === 2) : hand.length === 1;
    if (!ok) {
      throw new Error(
        seat === current
          ? `轮到的人${stage === "chancellor" ? "在大臣留牌时手里是 2–3 张" : "出牌前手里是 2 张"}，座位 ${seat} 写了 ${hand.length} 张。`
          : `没轮到的人手里是 1 张，座位 ${seat} 写了 ${hand.length} 张。`,
      );
    }
  });

  if (mode === "deck") {
    deck.push(...pool.splice(0));
  } else if (mode === "discards") {
    // 间谍优先放进出局的人那里（免得凭空给在局的人间谍资格）；没人出局就在局的人轮流放。
    const outList = [...outSeats].sort((left, right) => left - right);
    const aliveList = players.map((_, seat) => seat).filter((seat) => !outSeats.has(seat));
    let next = 0;
    let spyNext = 0;
    for (const card of pool.splice(0)) {
      if (card === "princess") {
        const outSeat = outList[0];
        if (outSeat === undefined) throw new Error("公主没地方放：没人出局，移出的牌和手牌也都写死了。");
        discards[outSeat]!.push({ card, how: "eliminated" });
      } else if (card === "spy") {
        const seats = outList.length > 0 ? outList : aliveList;
        discards[seats[spyNext % seats.length]!]!.push({ card, how: "played" });
        spyNext += 1;
      } else {
        discards[next % count]!.push({ card, how: "played" });
        next += 1;
      }
    }
  } else if (pool.length > 0) {
    throw new Error(`还有 ${pool.length} 张牌没写到：${pool.map((role) => ROLE_NAME[role]).join("、")}。`);
  }

  players.forEach((_, seat) => {
    if (!outSeats.has(seat) && discards[seat]!.some((entry) => entry.card === "princess")) {
      throw new Error(`座位 ${seat} 的打出区里有公主，他应该已经出局。`);
    }
  });

  const total = discards.flat().length + hands.flat().length + deck.length + (faceUp?.length ?? 0) + (setAside ? 1 : 0);
  // 移出的牌被拿走（setAside 为 null）时，它在某人手里，已经算进手牌了
  if (total !== FULL_DECK.length) throw new Error(`局面里一共 ${total} 张牌，应该正好 21 张。`);

  const config = defaultConfig(count, spec.config);
  const statePlayers: Player[] = players.map((player, seat) => ({
    id: player.id,
    name: player.name,
    seat,
    tokens: spec.tokens?.[seat] ?? 0,
    hand: hands[seat]!,
    handCount: hands[seat]!.length,
    discards: discards[seat]!,
    out: outSeats.has(seat),
    protected: protectedSeats.has(seat),
    spy: discards[seat]!.some((entry) => entry.card === "spy"),
  }));
  const round = spec.round ?? 1;
  const played = discards.flat().filter((entry) => entry.how === "played").length;
  return {
    config,
    phase: "playing",
    stage,
    players: statePlayers,
    round,
    turn: spec.turn ?? played + 1,
    current,
    deckCount: deck.length,
    faceUp: faceUp ?? [],
    setAsideTaken: setAside === null,
    ready: [],
    history: [{ type: "RoundStarted", round, starter: players[current]!.id, faceUp: [...(faceUp ?? [])] }],
    events: [],
    version: 1,
    deck,
    setAside,
    seed,
    rngState: rng.state,
    actions: [],
  };
}

/** 依次执行几步命令（每一步 [座位 id, 命令]）。 */
export function playSteps(state: GameState, steps: readonly (readonly [string, GameCommand])[]): GameState {
  return steps.reduce((current, [player, command]) => applyCommand(current, player, command), state);
}

// ---------------------------------------------------------------------------
// 教程剧本（补充文件 2.2）

export const TUTORIAL_PLAYERS: readonly NewPlayer[] = [
  { id: "p1", name: "你" },
  { id: "p2", name: "咕噜一号" },
  { id: "p3", name: "咕噜二号" },
];

/** 第一段剧本局的发牌：你先手。 */
export const TUTORIAL_DEAL: Deal = {
  setAside: "guard",
  hands: ["countess", "priest", "spy"],
  deck: [
    "guard", "handmaid", "baron", "prince", "guard", "king", "guard", "prince", "chancellor",
    "guard", "princess", "priest", "spy", "baron", "guard", "handmaid", "chancellor",
  ],
};

export interface ScriptStep {
  readonly player: string;
  readonly command: GameCommand;
  /** 这一步讲什么（补充文件 2.2 的表）。 */
  readonly note: string;
}

/** 第一段剧本局的 11 个回合（第 9 回合大臣多一步留牌），走完你以「只剩一人」赢下这一小局。 */
export const TUTORIAL_SCRIPT: readonly ScriptStep[] = [
  { player: "p1", command: { type: "PLAY", card: "guard", target: "p2", guess: "baron" }, note: "1 你：卫兵点一号猜男爵，没中" },
  { player: "p2", command: { type: "PLAY", card: "priest", target: "p1" }, note: "2 一号：牧师看你的牌（女伯爵）" },
  { player: "p3", command: { type: "PLAY", card: "spy" }, note: "3 二号：打间谍" },
  { player: "p1", command: { type: "PLAY", card: "countess" }, note: "4 你：女伯爵 + 王子，只能打女伯爵" },
  { player: "p2", command: { type: "PLAY", card: "handmaid" }, note: "5 一号：侍女，受保护" },
  { player: "p3", command: { type: "PLAY", card: "king", target: "p1" }, note: "6 二号：国王和你换（一号受保护）" },
  { player: "p1", command: { type: "PLAY", card: "guard", target: "p3", guess: "prince" }, note: "7 你：卫兵点二号猜王子，命中" },
  { player: "p2", command: { type: "PLAY", card: "prince", target: "p1" }, note: "8 一号：王子点你，你弃男爵重抽到大臣" },
  { player: "p1", command: { type: "PLAY", card: "chancellor" }, note: "9 你：大臣抽到公主、牧师" },
  { player: "p1", command: { type: "CHANCELLOR", keep: "princess", bottom: ["priest", "guard"] }, note: "9 你：留公主，牧师、卫兵放回牌堆底" },
  { player: "p2", command: { type: "PLAY", card: "spy" }, note: "10 一号：打间谍" },
  { player: "p1", command: { type: "PLAY", card: "baron", target: "p2" }, note: "11 你：男爵比一号，公主(9) 赢卫兵(1)，你赢这一小局" },
];

/** 第二段残局：牌堆抽完、平局两人都 +1、间谍 +1（你手里王子 + 刚抽的侍女，打侍女就结算）。 */
export function tutorialEndgame(): GameState {
  return createScene({
    players: TUTORIAL_PLAYERS,
    current: 0,
    hands: [["prince", "handmaid"], ["prince"], []],
    discards: [
      ["guard", "spy", "baron", "guard", "handmaid"],
      ["guard", "priest", "chancellor", "guard", "king"],
      ["priest", "guard", "spy", "baron", "countess", "guard", { card: "princess", how: "eliminated" }],
    ],
    out: [2],
    deck: [],
    setAside: "chancellor",
    tokens: [1, 1, 0],
    round: 2,
    leftovers: "error",
  });
}

// ---------------------------------------------------------------------------
// 按名字造的常见局面（视角默认是座位 0 的 p1）

export const SCENES = [
  "opening",
  "my-turn-spy",
  "my-turn-guard",
  "my-turn-priest",
  "my-turn-baron",
  "my-turn-handmaid",
  "my-turn-prince",
  "my-turn-chancellor",
  "my-turn-king",
  "my-turn-countess",
  "my-turn-princess",
  "countess-forced",
  "chancellor-choose",
  "chancellor-last-card",
  "all-protected",
  "prince-princess-trap",
  "prince-empty-deck",
  "others-turn",
  "after-guard-miss",
  "after-guard-hit",
  "after-priest",
  "after-baron-win",
  "after-baron-tie",
  "after-king",
  "after-prince",
  "after-chancellor",
  "i-am-out",
  "two-player",
  "six-player",
  "timeout",
  "round-end-showdown",
  "round-end-tie",
  "round-end-last-standing",
  "round-end-spy",
  "round-end-spy-double",
  "round-start-next",
  "game-over",
  "game-over-tie",
  "tutorial-start",
  "tutorial-endgame",
] as const;

export type SceneName = (typeof SCENES)[number];

export interface SceneOptions {
  /** 人数（2–6，默认 3；tutorial-*、two-player、six-player 固定人数，忽略这一项）。 */
  readonly players?: number;
  /** 补牌用的种子。 */
  readonly seed?: number;
}

/** 轮到座位 0、手里是 card 和一张不碍事的牌。 */
function myTurn(card: Role, players: number, seed: number, other: Role = card === "guard" ? "priest" : "guard"): GameState {
  return createScene({ players, seed, hands: [[card, other]], discards: [["guard"], ["priest"]] });
}

/**
 * 按名字造局面。说明见 SCENE_NOTES；全部场景名见 SCENES。
 * 结算、整场结束这些局面是从一个精确局面真的走出来的，事件和日志都是真的。
 */
export function scene(name: SceneName, options: SceneOptions = {}): GameState {
  const players = options.players ?? 3;
  const seed = options.seed ?? 7;
  switch (name) {
    case "opening":
      return createGame(scenePlayers(players), seed, { starter: 0 });
    case "my-turn-spy":
      return myTurn("spy", players, seed);
    case "my-turn-guard":
      return myTurn("guard", players, seed);
    case "my-turn-priest":
      return myTurn("priest", players, seed);
    case "my-turn-baron":
      return myTurn("baron", players, seed, "king");
    case "my-turn-handmaid":
      return myTurn("handmaid", players, seed);
    case "my-turn-prince":
      return myTurn("prince", players, seed);
    case "my-turn-chancellor":
      return myTurn("chancellor", players, seed);
    case "my-turn-king":
      return myTurn("king", players, seed);
    case "my-turn-countess":
      return myTurn("countess", players, seed, "baron");
    case "my-turn-princess":
      return myTurn("princess", players, seed);
    case "countess-forced":
      return myTurn("countess", players, seed, "king");
    case "chancellor-choose":
      return playSteps(
        createScene({ players, seed, hands: [["chancellor", "guard"]], deck: ["princess", "baron"] }),
        [["p1", { type: "PLAY", card: "chancellor" }]],
      );
    case "chancellor-last-card":
      return playSteps(
        createScene({ players, seed, hands: [["chancellor", "guard"]], deck: ["handmaid"], leftovers: "discards", setAside: "prince" }),
        [["p1", { type: "PLAY", card: "chancellor" }]],
      );
    case "all-protected":
      return createScene({ players, seed, hands: [["guard", "prince"]], ...othersShielded(players) });
    case "prince-princess-trap":
      return createScene({ players, seed, hands: [["prince", "princess"]], ...othersShielded(players) });
    case "prince-empty-deck":
      return createScene({
        players,
        seed,
        hands: [["prince", "handmaid"], ["priest"]],
        deck: [],
        setAside: "king",
        leftovers: "discards",
        out: range(2, players),
      });
    case "others-turn":
      return createScene({ players, seed, current: 1, hands: [["baron"], ["guard", "handmaid"]], discards: [["guard"], ["priest"]] });
    case "after-guard-miss":
      return playSteps(createScene({ players, seed, hands: [["guard", "king"], ["handmaid"]] }), [
        ["p1", { type: "PLAY", card: "guard", target: "p2", guess: "baron" }],
      ]);
    case "after-guard-hit":
      return playSteps(createScene({ players, seed, hands: [["guard", "king"], ["baron"]] }), [
        ["p1", { type: "PLAY", card: "guard", target: "p2", guess: "baron" }],
      ]);
    case "after-priest":
      return playSteps(createScene({ players, seed, hands: [["priest", "king"], ["handmaid"]] }), [
        ["p1", { type: "PLAY", card: "priest", target: "p2" }],
      ]);
    case "after-baron-win":
      return playSteps(createScene({ players, seed, hands: [["baron", "king"], ["handmaid"]] }), [
        ["p1", { type: "PLAY", card: "baron", target: "p2" }],
      ]);
    case "after-baron-tie":
      return playSteps(createScene({ players, seed, hands: [["baron", "priest"], ["priest"]] }), [
        ["p1", { type: "PLAY", card: "baron", target: "p2" }],
      ]);
    case "after-king":
      return playSteps(createScene({ players, seed, hands: [["king", "guard"], ["countess"]] }), [
        ["p1", { type: "PLAY", card: "king", target: "p2" }],
      ]);
    case "after-prince":
      return playSteps(createScene({ players, seed, hands: [["prince", "guard"], ["spy"]], deck: ["handmaid"] }), [
        ["p1", { type: "PLAY", card: "prince", target: "p2" }],
      ]);
    case "after-chancellor":
      return playSteps(
        createScene({ players, seed, hands: [["chancellor", "guard"]], deck: ["princess", "baron"] }),
        [
          ["p1", { type: "PLAY", card: "chancellor" }],
          ["p1", { type: "CHANCELLOR", keep: "princess", bottom: ["guard", "baron"] }],
        ],
      );
    case "i-am-out":
      return createScene({
        players: Math.max(players, 3),
        seed,
        current: 1,
        out: [0],
        hands: [[], ["guard", "handmaid"]],
        discards: [["guard", { card: "baron", how: "eliminated" }], ["priest"]],
      });
    case "two-player":
      return createGame(scenePlayers(2), seed, { starter: 0 });
    case "six-player":
      return createScene({
        players: 6,
        seed,
        current: 3,
        out: [5],
        protected: [1],
        hands: [["baron"], ["prince"], ["guard"], ["guard", "chancellor"], ["countess"], []],
        discards: [["guard", "spy"], ["priest", "handmaid"], ["guard"], ["baron"], ["guard"], ["handmaid", { card: "princess", how: "eliminated" }]],
        tokens: [1, 0, 2, 0, 1, 0],
        round: 4,
      });
    case "timeout":
      return timeoutTurn(myTurn("guard", players, seed));
    case "round-end-showdown":
      return playSteps(
        createScene({ players, seed, hands: [["handmaid", "king"], ["priest"]], deck: [], setAside: "baron", leftovers: "discards", out: range(2, players) }),
        [["p1", { type: "PLAY", card: "handmaid" }]],
      );
    case "round-end-tie":
      return playSteps(
        createScene({ players, seed, hands: [["handmaid", "prince"], ["prince"]], deck: [], setAside: "guard", leftovers: "discards", out: range(2, players) }),
        [["p1", { type: "PLAY", card: "handmaid" }]],
      );
    case "round-end-last-standing":
      return playSteps(createScene({ players, seed, hands: [["guard", "king"], ["baron"]], out: range(2, players) }), [
        ["p1", { type: "PLAY", card: "guard", target: "p2", guess: "baron" }],
      ]);
    case "round-end-spy":
      return playSteps(
        createScene({
          players,
          seed,
          hands: [["handmaid", "guard"], ["king"]],
          discards: [["spy"], ["guard"]],
          deck: [],
          setAside: "baron",
          leftovers: "discards",
          out: range(2, players),
        }),
        [["p1", { type: "PLAY", card: "handmaid" }]],
      );
    case "round-end-spy-double":
      return playSteps(
        createScene({
          players,
          seed,
          hands: [["handmaid", "king"], ["guard"]],
          discards: [["spy"], ["guard"]],
          deck: [],
          setAside: "baron",
          leftovers: "discards",
          out: range(2, players),
        }),
        [["p1", { type: "PLAY", card: "handmaid" }]],
      );
    case "round-start-next": {
      const ended = scene("round-end-showdown", options);
      return playSteps(ended, ended.players.map((player) => [player.id, { type: "READY" }] as const));
    }
    case "game-over": {
      const tokens = Array.from({ length: players }, (_, seat) => (seat === 0 ? defaultConfig(players).tokensToWin - 1 : 1));
      return playSteps(
        createScene({
          players,
          seed,
          hands: [["handmaid", "king"], ["priest"]],
          deck: [],
          setAside: "baron",
          leftovers: "discards",
          tokens,
          out: range(2, players),
        }),
        [["p1", { type: "PLAY", card: "handmaid" }]],
      );
    }
    case "game-over-tie": {
      const target = defaultConfig(players).tokensToWin;
      const tokens = Array.from({ length: players }, (_, seat) => (seat <= 1 ? target - 1 : 0));
      return playSteps(
        createScene({
          players,
          seed,
          hands: [["handmaid", "prince"], ["prince"]],
          deck: [],
          setAside: "guard",
          leftovers: "discards",
          tokens,
          out: range(2, players),
        }),
        [["p1", { type: "PLAY", card: "handmaid" }]],
      );
    }
    case "tutorial-start":
      return createGame(TUTORIAL_PLAYERS, seed, { starter: 0, deal: TUTORIAL_DEAL });
    case "tutorial-endgame":
      return tutorialEndgame();
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);
}

/** 除了座位 0，在局的人都受侍女保护：侍女只有 2 张，所以座位 1、2 受保护，3 以后的人已经出局。 */
function othersShielded(players: number): Pick<SceneSpec, "protected" | "out" | "discards"> {
  const shielded = range(1, Math.min(players, 3));
  const out = range(3, players);
  return {
    protected: shielded,
    out,
    discards: range(0, players).map((seat) =>
      shielded.includes(seat) ? ["handmaid"] : out.includes(seat) ? [{ card: "guard", how: "eliminated" }] : [],
    ),
  };
}

/** 每个场景一句话说明（预览页的下拉框可以直接用）。 */
export const SCENE_NOTES: Readonly<Record<SceneName, string>> = {
  "opening": "开局：第 1 小局，轮到你（座位 0）出第一张牌",
  "my-turn-spy": "轮到你，手里间谍 + 卫兵",
  "my-turn-guard": "轮到你，手里卫兵 + 牧师（卫兵选人 + 猜牌）",
  "my-turn-priest": "轮到你，手里牧师 + 卫兵",
  "my-turn-baron": "轮到你，手里男爵 + 国王",
  "my-turn-handmaid": "轮到你，手里侍女 + 卫兵",
  "my-turn-prince": "轮到你，手里王子 + 卫兵（可以选自己）",
  "my-turn-chancellor": "轮到你，手里大臣 + 卫兵",
  "my-turn-king": "轮到你，手里国王 + 卫兵",
  "my-turn-countess": "轮到你，手里女伯爵 + 男爵（没被强制，可以自由选）",
  "my-turn-princess": "轮到你，手里公主 + 卫兵（打公主会出局）",
  "countess-forced": "女伯爵 + 国王：只能打女伯爵",
  "chancellor-choose": "大臣留牌：手里 3 张（卫兵、公主、男爵），留 1 张、2 张按顺序放回牌堆底",
  "chancellor-last-card": "牌堆只剩 1 张时打大臣：手里 2 张，留 1 放 1",
  "all-protected": "其他人都受侍女保护：卫兵白打，王子只能选自己",
  "prince-princess-trap": "王子 + 公主，其他人全受保护：打哪张都出局（补9）",
  "prince-empty-deck": "牌堆已空：王子点人时，他拿走面朝下移出的那张",
  "others-turn": "轮到座位 1，你在等",
  "after-guard-miss": "你刚用卫兵猜错",
  "after-guard-hit": "你刚用卫兵猜中，座位 1 出局",
  "after-priest": "你刚用牧师看了座位 1 的牌（事件里有牌面，只给你）",
  "after-baron-win": "你刚用男爵比赢座位 1（国王 7 比侍女 4）",
  "after-baron-tie": "你刚和座位 1 男爵平手（都是牧师）",
  "after-king": "你刚用国王和座位 1 换牌",
  "after-prince": "你刚用王子让座位 1 弃掉间谍重抽（他拿到间谍资格）",
  "after-chancellor": "你刚打完大臣：留公主，卫兵、男爵放回牌堆底",
  "i-am-out": "你已经出局，看别人打",
  "two-player": "2 人局开局：面朝上移出 3 张",
  "six-player": "6 人局中途：有人出局、有人受保护、有人有间谍资格",
  "timeout": "座位 0 超时，系统替他打完这一回合（事件里有 TurnTimedOut）",
  "round-end-showdown": "牌堆抽完亮牌比点数，一人赢",
  "round-end-tie": "牌堆抽完两人都是王子，平局都 +1",
  "round-end-last-standing": "只剩一人（你用卫兵猜中最后一个对手），立即赢、不亮牌",
  "round-end-spy": "牌堆抽完：座位 1 赢，你拿间谍 +1",
  "round-end-spy-double": "牌堆抽完：你赢又拿间谍 +1，一共 +2",
  "round-start-next": "结算后大家点了「下一局」，第 2 小局由上一局赢家先手",
  "game-over": "整场结束：你攒够标记",
  "game-over-tie": "整场结束：平局两人同时攒够，一起赢",
  "tutorial-start": "教程第一段剧本局的开局（固定发牌，你先手）",
  "tutorial-endgame": "教程第二段残局：打侍女后亮牌平局，你再拿间谍 +1",
};

// ---------------------------------------------------------------------------
// 包成网页收到的房间快照

export interface PreviewRoomOptions {
  /** 从哪个座位看（默认 p1）；观战时传 "" 并设 spectator。 */
  readonly viewer?: string;
  /** 观战视角；seeAllHands 为房主打开「观战看手牌」。 */
  readonly spectator?: { readonly name?: string; readonly seeAllHands?: boolean };
  /** 离线的座位 id。 */
  readonly offline?: readonly string[];
  /** 人机座位 id。 */
  readonly bots?: readonly string[];
  /** 托管中的座位 id。 */
  readonly auto?: readonly string[];
  /** 倒计时剩余毫秒；不填时：轮到真人在线就按这一步的限时给满，轮到人机 / 托管 / 离线的人就没有。 */
  readonly turnRemainingMs?: number | null;
  readonly access?: Partial<RoomAccess>;
  readonly code?: string;
}

/** 预览页冒充自己时用的 socket id：Object.defineProperty(socket, "id", { value: previewSocketId("p1") })。 */
export function previewSocketId(playerId: string): string {
  return `preview-${playerId}`;
}

export function previewRoom(game: GameState | undefined, options: PreviewRoomOptions = {}): LobbyRoomSnapshot {
  const viewer = options.spectator ? "" : options.viewer ?? "p1";
  const offline = new Set(options.offline ?? []);
  const bots = new Set(options.bots ?? []);
  const auto = new Set(options.auto ?? []);
  const players = game?.players ?? scenePlayers(3).map((player, seat) => ({ ...player, seat }));
  const members: LobbyMember[] = players.map((player, seat) => ({
    id: previewSocketId(player.id),
    playerId: player.id,
    name: player.name,
    isHost: seat === 0,
    connected: !offline.has(player.id),
    ...(bots.has(player.id) ? { bot: true } : {}),
    ...(auto.has(player.id) ? { auto: true } : {}),
  }));
  const access: RoomAccess = { ...DEFAULT_ROOM_ACCESS, ...options.access };
  const actor = game?.phase === "playing" ? game.players[game.current]?.id : undefined;
  const robot = actor !== undefined && (bots.has(actor) || auto.has(actor) || offline.has(actor));
  let turnRemainingMs: number | undefined;
  if (options.turnRemainingMs !== undefined) {
    if (options.turnRemainingMs !== null) turnRemainingMs = options.turnRemainingMs;
  } else if (game && game.phase !== "finished" && !robot) {
    turnRemainingMs = (game.phase === "roundEnd" ? game.config.roundEndSec : game.config.turnTimeoutSec) * 1000;
  }
  const spectators = options.spectator ? [{ id: "preview-spectator", name: options.spectator.name ?? "看客" }] : [];
  return {
    code: options.spectator ? "" : options.code ?? "LOVE23",
    spectators,
    access: options.spectator?.seeAllHands ? { ...access, spectatorsSeeAll: true } : access,
    capacity: players.length as Capacity,
    status: game ? "playing" : "waiting",
    members,
    chat: [],
    voice: [],
    ...(turnRemainingMs !== undefined ? { turnRemainingMs } : {}),
    ...(game?.phase === "finished" ? { rematch: { remainingMs: 60_000, acceptedIds: members.filter((member) => member.bot).map((member) => member.id) } } : {}),
    ...(game
      ? { game: redactGameForViewer(game, viewer, options.spectator?.seeAllHands ? { seeAllHands: true } : {}) }
      : {}),
  };
}
