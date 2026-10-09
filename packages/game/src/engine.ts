import {
  FULL_DECK,
  GUARD_GUESSES,
  ROLE_COUNT,
  ROLE_NAME,
  ROLE_TARGET,
  ROLE_VALUE,
  ROLES,
  TOKENS_TO_WIN,
  TWO_PLAYER_FACE_UP,
  countRoles,
  isRole,
  type Role,
} from "./cards.js";
import { createRng, type Rng } from "./rng.js";
import type {
  Config,
  EliminationReason,
  GameCommand,
  GameEvent,
  GameState,
  Player,
  RoundResult,
  Stage,
} from "./types.js";

export function defaultConfig(playerCount: number, overrides: Partial<Config> = {}): Config {
  return {
    minPlayers: 2,
    maxPlayers: 6,
    tokensToWin: TOKENS_TO_WIN[playerCount] ?? 3,
    turnTimeoutSec: 30,
    roundEndSec: 15,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/**
 * 指定第一小局怎么发牌（测试、教程、预览用）。四部分加起来必须正好是一整副 21 张。
 * - setAside：面朝下移出的那张；
 * - faceUp：2 人局面朝上移出的 3 张（3 人以上不填或填空数组）；
 * - hands：每个座位一张（按 players 顺序）；
 * - deck：牌堆，**顶在前**。
 */
export interface Deal {
  readonly setAside: Role;
  readonly faceUp?: readonly Role[];
  readonly hands: readonly Role[];
  readonly deck: readonly Role[];
}

export interface CreateOptions {
  readonly config?: Partial<Config>;
  /** 第一小局谁先手（座位下标）；不填就随机。 */
  readonly starter?: number;
  /** 第一小局按这个发牌；不填就洗牌。 */
  readonly deal?: Deal;
}

interface Ctx {
  readonly state: GameState;
  readonly rng: Rng;
  readonly events: GameEvent[];
}

// ---------------------------------------------------------------------------
// 小工具（都能用在裁剪过的状态上）

/** 此刻要做决定的人：一小局进行中是当前玩家；结算画面、整场结束时没有（null）。 */
export function actorOf(state: GameState): string | null {
  return state.phase === "playing" ? state.players[state.current]?.id ?? null : null;
}

/** 手里同时有女伯爵和国王或王子：必须打女伯爵。 */
export function mustPlayCountess(hand: readonly Role[]): boolean {
  return hand.includes("countess") && (hand.includes("king") || hand.includes("prince"));
}

/**
 * 打出这张牌时能选谁（座位 id，按座位顺序从出牌的人下家开始）。
 * 卫兵、牧师、男爵、国王：在局中、没被侍女保护的别人；王子：这些人再加上自己（自己放最后）；其他牌：空。
 */
export function targetChoices(state: GameState, actorId: string, card: Role): string[] {
  const kind = ROLE_TARGET[card];
  if (kind === "none") return [];
  const index = state.players.findIndex((player) => player.id === actorId);
  const others: string[] = [];
  for (let step = 1; step < state.players.length; step += 1) {
    const player = state.players[(index + step) % state.players.length]!;
    if (!player.out && !player.protected) others.push(player.id);
  }
  return kind === "any" ? [...others, actorId] : others;
}

/** 本小局人人都看得见的牌各有几张：所有人的打出区，加上 2 人局面朝上移出的 3 张。 */
export function visibleCounts(state: GameState): Record<Role, number> {
  return countRoles([
    ...state.players.flatMap((player) => player.discards.map((entry) => entry.card)),
    ...state.faceUp,
  ]);
}

/**
 * 从某个座位看，各角色还有几张没露面：总张数 − 公开的 − 自己手里的。
 * 没露面的牌在牌堆里、面朝下移出的那张、或者别人手里。界面的「还剩几张」统计、超时猜牌都用它。
 */
export function unseenCounts(state: GameState, viewerId: string): Record<Role, number> {
  const visible = visibleCounts(state);
  const own = countRoles(state.players.find((player) => player.id === viewerId)?.hand ?? []);
  return Object.fromEntries(ROLES.map((role) => [role, Math.max(0, ROLE_COUNT[role] - visible[role] - own[role])])) as Record<Role, number>;
}

function findPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((player) => player.id === id);
}

function alivePlayers(state: GameState): Player[] {
  return state.players.filter((player) => !player.out);
}

function removeOne(hand: Role[], card: Role): void {
  const index = hand.indexOf(card);
  if (index < 0) throw new Error(`手里没有${ROLE_NAME[card]}。`);
  hand.splice(index, 1);
}

function sameCards(left: readonly Role[], right: readonly Role[]): boolean {
  if (left.length !== right.length) return false;
  const a = countRoles(left);
  const b = countRoles(right);
  return ROLES.every((role) => a[role] === b[role]);
}

function emit(ctx: Ctx, event: GameEvent): void {
  ctx.events.push(event);
  ctx.state.history.push(event);
}

function syncHand(player: Player): void {
  player.handCount = player.hand.length;
}

// ---------------------------------------------------------------------------
// 一小局的流程

function validateDeal(deal: Deal, playerCount: number): void {
  const faceUp = deal.faceUp ?? [];
  if (faceUp.length !== (playerCount === 2 ? TWO_PLAYER_FACE_UP : 0)) {
    throw new Error(playerCount === 2 ? "2 人局要面朝上移出 3 张。" : "3 人以上不面朝上移出牌。");
  }
  if (deal.hands.length !== playerCount) throw new Error("每个座位发一张手牌。");
  const all = [deal.setAside, ...faceUp, ...deal.hands, ...deal.deck];
  if (!all.every(isRole) || !sameCards(all, FULL_DECK)) throw new Error("发牌必须正好是一整副 21 张。");
  if (deal.deck.length === 0) throw new Error("牌堆不能是空的。");
}

function startRound(ctx: Ctx, starter: number, deal?: Deal): void {
  const { state, rng } = ctx;
  const count = state.players.length;
  let deck: Role[];
  let setAside: Role;
  let faceUp: Role[];
  let hands: Role[];
  if (deal) {
    validateDeal(deal, count);
    deck = [...deal.deck];
    setAside = deal.setAside;
    faceUp = [...(deal.faceUp ?? [])];
    hands = [...deal.hands];
  } else {
    deck = rng.shuffle(FULL_DECK);
    setAside = deck.shift()!;
    faceUp = count === 2 ? deck.splice(0, TWO_PLAYER_FACE_UP) : [];
    hands = state.players.map(() => deck.shift()!);
  }
  state.round += 1;
  state.phase = "playing";
  state.deck = deck;
  state.deckCount = deck.length;
  state.setAside = setAside;
  state.setAsideTaken = false;
  state.faceUp = faceUp;
  state.ready = [];
  state.history = [];
  state.players.forEach((player, index) => {
    player.hand = [hands[index]!];
    player.handCount = 1;
    player.discards = [];
    player.out = false;
    player.protected = false;
    player.spy = false;
  });
  emit(ctx, { type: "RoundStarted", round: state.round, starter: state.players[starter]!.id, faceUp: [...faceUp] });
  startTurn(ctx, starter);
}

/** 轮到某人：侍女保护到此结束，抽 1 张（这时牌堆一定还有牌，空了这一小局早就结束了）。 */
function startTurn(ctx: Ctx, index: number): void {
  const { state } = ctx;
  const player = state.players[index]!;
  state.current = index;
  state.turn += 1;
  state.stage = "play";
  const protectionEnded = player.protected;
  player.protected = false;
  emit(ctx, { type: "TurnStarted", player: player.id, protectionEnded });
  const card = state.deck!.shift();
  if (!card) throw new Error("内部错误：回合开始时牌堆是空的。");
  state.deckCount = state.deck!.length;
  player.hand.push(card);
  syncHand(player);
  emit(ctx, { type: "Drew", player: player.id, reason: "turn", source: "deck", card });
}

/** 出局：手牌亮出来弃掉（不发动效果）。 */
function eliminate(ctx: Ctx, player: Player, reason: EliminationReason, by: string): void {
  const revealed = [...player.hand];
  for (const card of revealed) {
    player.discards.push({ card, how: "eliminated" });
    if (card === "spy") player.spy = true;
  }
  player.hand = [];
  syncHand(player);
  player.out = true;
  player.protected = false;
  emit(ctx, { type: "Eliminated", player: player.id, reason, by, revealed });
}

/** 回合结束：只剩一人或牌堆空了就结算这一小局，否则轮到下一位还在局中的人。 */
function finishTurn(ctx: Ctx): void {
  const { state } = ctx;
  state.stage = "play";
  if (alivePlayers(state).length <= 1) {
    endRound(ctx, "lastStanding");
    return;
  }
  if (state.deckCount === 0) {
    endRound(ctx, "showdown");
    return;
  }
  let index = state.current;
  do index = (index + 1) % state.players.length;
  while (state.players[index]!.out);
  startTurn(ctx, index);
}

function endRound(ctx: Ctx, reason: RoundResult["reason"]): void {
  const { state, rng } = ctx;
  const living = alivePlayers(state);
  const hands: Record<string, Role> = {};
  let winners: string[];
  if (reason === "lastStanding") {
    winners = living.map((player) => player.id);
  } else {
    for (const player of living) hands[player.id] = player.hand[0]!;
    const best = Math.max(...living.map((player) => ROLE_VALUE[player.hand[0]!]));
    winners = living.filter((player) => ROLE_VALUE[player.hand[0]!] === best).map((player) => player.id);
  }
  const spies = living.filter((player) => player.spy);
  const spyBonus = spies.length === 1 ? spies[0]!.id : null;
  const awards: Record<string, number> = {};
  for (const id of winners) awards[id] = (awards[id] ?? 0) + 1;
  if (spyBonus) awards[spyBonus] = (awards[spyBonus] ?? 0) + 1;
  for (const player of state.players) player.tokens += awards[player.id] ?? 0;

  const champions = state.players.filter((player) => player.tokens >= state.config.tokensToWin).map((player) => player.id);
  const nextStarter = champions.length > 0 ? null : winners.length === 1 ? winners[0]! : rng.pick(winners);
  const result: RoundResult = {
    round: state.round,
    reason,
    winners,
    spyBonus,
    awards,
    hands,
    setAside: state.setAside ?? null,
    nextStarter,
  };
  state.lastRound = result;
  state.ready = [];
  emit(ctx, { type: "RoundEnded", result });
  if (champions.length > 0) {
    state.phase = "finished";
    state.winners = champions;
    emit(ctx, { type: "GameEnded", winners: champions });
  } else {
    state.phase = "roundEnd";
  }
}

// ---------------------------------------------------------------------------
// 命令

function targetError(state: GameState, actor: Player, card: Role, target: string): string {
  const player = findPlayer(state, target);
  if (!player) return "没有这位玩家。";
  if (player.id === actor.id) return `${ROLE_NAME[card]}不能选自己。`;
  if (player.out) return `${player.name}已经出局了，不能选。`;
  if (player.protected) return `${player.name}受侍女保护，不能选。`;
  return "不能选这位玩家。";
}

function applyPlay(ctx: Ctx, actor: Player, command: Extract<GameCommand, { type: "PLAY" }>): void {
  const { state } = ctx;
  if (state.stage !== "play") throw new Error("先选好大臣留下哪张牌。");
  const card = command.card;
  if (!isRole(card) || !actor.hand.includes(card)) throw new Error("你手里没有这张牌。");
  if (mustPlayCountess(actor.hand) && card !== "countess") {
    throw new Error("手里有女伯爵，又有国王或王子时，必须打出女伯爵。");
  }
  const kind = ROLE_TARGET[card];
  const choices = targetChoices(state, actor.id, card);
  const target = command.target;
  if (kind === "none") {
    if (target !== undefined) throw new Error(`${ROLE_NAME[card]}不用选人。`);
  } else if (choices.length === 0) {
    // 只有「选别人」的牌会走到这里：没人能选，白打
    if (target !== undefined) throw new Error(`现在没有能选的人（都出局了或受侍女保护），${ROLE_NAME[card]}直接白打，不用选人。`);
  } else {
    if (typeof target !== "string") throw new Error(`${ROLE_NAME[card]}要选一名玩家。`);
    if (!choices.includes(target)) throw new Error(targetError(state, actor, card, target));
  }
  const guess = command.guess;
  if (card === "guard" && target !== undefined) {
    if (guess === "guard") throw new Error("卫兵不能猜卫兵。");
    if (!isRole(guess)) throw new Error("卫兵要猜一个角色。");
  } else if (guess !== undefined) {
    throw new Error(card === "guard" ? "没有选人时卫兵不用猜。" : "只有卫兵要猜角色。");
  }

  removeOne(actor.hand, card);
  syncHand(actor);
  actor.discards.push({ card, how: "played" });
  if (card === "spy") actor.spy = true;
  emit(ctx, {
    type: "Played",
    player: actor.id,
    card,
    ...(target !== undefined ? { target } : {}),
    ...(guess !== undefined ? { guess } : {}),
  });

  const victim = target !== undefined ? findPlayer(state, target)! : undefined;
  switch (card) {
    case "guard": {
      if (!victim) break;
      const hit = victim.hand[0] === guess;
      emit(ctx, { type: "Guessed", player: actor.id, target: victim.id, guess: guess!, hit });
      if (hit) eliminate(ctx, victim, "guard", actor.id);
      break;
    }
    case "priest":
      if (victim) emit(ctx, { type: "Peeked", player: actor.id, target: victim.id, card: victim.hand[0]! });
      break;
    case "baron": {
      if (!victim) break;
      const mine = actor.hand[0]!;
      const theirs = victim.hand[0]!;
      const loser = ROLE_VALUE[mine] < ROLE_VALUE[theirs] ? actor : ROLE_VALUE[theirs] < ROLE_VALUE[mine] ? victim : null;
      emit(ctx, { type: "Compared", player: actor.id, target: victim.id, loser: loser?.id ?? null, playerCard: mine, targetCard: theirs });
      if (loser) eliminate(ctx, loser, "baron", actor.id);
      break;
    }
    case "handmaid":
      actor.protected = true;
      emit(ctx, { type: "Protected", player: actor.id });
      break;
    case "prince": {
      const who = victim!;
      const dropped = who.hand.shift()!;
      syncHand(who);
      who.discards.push({ card: dropped, how: "discarded" });
      if (dropped === "spy") who.spy = true;
      emit(ctx, { type: "Discarded", player: who.id, card: dropped, by: actor.id });
      if (dropped === "princess") {
        eliminate(ctx, who, "prince", actor.id);
        break;
      }
      let drawn: Role;
      let source: "deck" | "setAside";
      if (state.deckCount > 0) {
        drawn = state.deck!.shift()!;
        state.deckCount = state.deck!.length;
        source = "deck";
      } else {
        if (!state.setAside) throw new Error("内部错误：牌堆空了，移出的牌也被拿走了。");
        drawn = state.setAside;
        state.setAside = null;
        state.setAsideTaken = true;
        source = "setAside";
      }
      who.hand.push(drawn);
      syncHand(who);
      emit(ctx, { type: "Drew", player: who.id, reason: "prince", source, card: drawn });
      break;
    }
    case "chancellor": {
      const count = Math.min(2, state.deckCount);
      if (count === 0) {
        emit(ctx, { type: "NoEffect", player: actor.id, card, reason: "emptyDeck" });
        break;
      }
      const cards = state.deck!.splice(0, count);
      state.deckCount = state.deck!.length;
      actor.hand.push(...cards);
      syncHand(actor);
      emit(ctx, { type: "ChancellorDrew", player: actor.id, count, cards });
      state.stage = "chancellor";
      return;
    }
    case "king": {
      if (!victim) break;
      const mine = actor.hand[0]!;
      const theirs = victim.hand[0]!;
      actor.hand = [theirs];
      victim.hand = [mine];
      emit(ctx, { type: "Swapped", player: actor.id, target: victim.id, playerGot: theirs, targetGot: mine });
      break;
    }
    case "princess":
      eliminate(ctx, actor, "princess", actor.id);
      break;
    case "spy":
    case "countess":
      break;
  }
  if (victim === undefined && ROLE_TARGET[card] === "other") {
    emit(ctx, { type: "NoEffect", player: actor.id, card, reason: "noTarget" });
  }
  finishTurn(ctx);
}

function applyChancellor(ctx: Ctx, actor: Player, command: Extract<GameCommand, { type: "CHANCELLOR" }>): void {
  const { state } = ctx;
  if (state.stage !== "chancellor") throw new Error("现在不用选大臣留哪张。");
  const bottom = command.bottom;
  if (!isRole(command.keep) || !Array.isArray(bottom) || !bottom.every(isRole)) throw new Error("留牌的选择不正确。");
  if (!sameCards([command.keep, ...bottom], actor.hand)) {
    throw new Error("留下的 1 张和放回牌堆底的牌，要正好是你手里的这几张。");
  }
  actor.hand = [command.keep];
  syncHand(actor);
  state.deck!.push(...bottom);
  state.deckCount = state.deck!.length;
  emit(ctx, { type: "ChancellorReturned", player: actor.id, count: bottom.length, cards: [...bottom] });
  finishTurn(ctx);
}

function applyReady(ctx: Ctx, playerId: string): void {
  const { state } = ctx;
  if (state.phase !== "roundEnd") throw new Error("这一小局还没结束。");
  if (state.ready.includes(playerId)) throw new Error("你已经点过「下一局」了。");
  state.ready.push(playerId);
  emit(ctx, { type: "Ready", player: playerId });
  if (state.players.every((player) => state.ready.includes(player.id))) beginNextRound(ctx);
}

function beginNextRound(ctx: Ctx): void {
  const { state } = ctx;
  const starterId = state.lastRound?.nextStarter;
  const starter = state.players.findIndex((player) => player.id === starterId);
  startRound(ctx, starter >= 0 ? starter : 0);
}

/**
 * 纯函数：在 state 上执行 playerId 的命令，返回新状态和这一步的事件。不改 state 本身。
 * state 必须是服务器上的完整状态（带牌堆）；裁剪过的状态不能推进。
 * rng 只在一小局结束（并列赢家里抽下一局先手）和开新一局（洗牌）时用到。
 */
export function apply(state: GameState, playerId: string, command: GameCommand, rng: Rng): { state: GameState; events: GameEvent[] } {
  if (!Array.isArray(state.deck)) throw new Error("这是裁剪过的状态，不能用来推进对局。");
  if (state.phase === "finished") throw new Error("这一场已经结束了。");
  if (!findPlayer(state, playerId)) throw new Error("你不在这局里。");
  const type = (command as { type?: unknown } | null)?.type;
  if (type !== "PLAY" && type !== "CHANCELLOR" && type !== "READY") throw new Error("未知的行动。");
  if (type !== "READY") {
    if (state.phase !== "playing") throw new Error("这一小局已经结束了，等下一局。");
    if (state.players[state.current]?.id !== playerId) throw new Error("还没轮到你。");
  }

  const next = structuredClone(state);
  const ctx: Ctx = { state: next, rng, events: [] };
  const actor = findPlayer(next, playerId)!;
  switch (command.type) {
    case "PLAY":
      applyPlay(ctx, actor, command);
      break;
    case "CHANCELLOR":
      applyChancellor(ctx, actor, command);
      break;
    case "READY":
      applyReady(ctx, playerId);
      break;
  }
  next.version += 1;
  next.events = ctx.events;
  return { state: next, events: ctx.events };
}

function runCommand(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const result = apply(state, playerId, command, rng);
  result.state.rngState = rng.state;
  result.state.actions = [...(state.actions ?? []), { player: playerId, command }];
  return result;
}

/** 服务器用：执行命令，随机数状态从 state.rngState 接着用，并把命令记进动作序列。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

// ---------------------------------------------------------------------------
// 合法行动

function distinct(cards: readonly Role[]): Role[] {
  return [...new Set(cards)];
}

/**
 * playerId 现在能做的所有命令（同名的牌只列一次）。能用在裁剪过的状态上（人机、网页都靠它）。
 * 卫兵有人可选时，每个可选的人 × 9 种可猜的角色各一条。
 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase === "finished") return [];
  if (state.phase === "roundEnd") {
    return findPlayer(state, playerId) && !state.ready.includes(playerId) ? [{ type: "READY" }] : [];
  }
  const actor = state.players[state.current];
  if (!actor || actor.id !== playerId) return [];
  if (state.stage === "chancellor") {
    const commands: GameCommand[] = [];
    for (const keep of distinct(actor.hand)) {
      const rest = [...actor.hand];
      removeOne(rest, keep);
      const orders = rest.length === 2 && rest[0] !== rest[1] ? [rest, [rest[1]!, rest[0]!]] : [rest];
      for (const bottom of orders) commands.push({ type: "CHANCELLOR", keep, bottom });
    }
    return commands;
  }
  const commands: GameCommand[] = [];
  const forced = mustPlayCountess(actor.hand);
  for (const card of distinct(actor.hand)) {
    if (forced && card !== "countess") continue;
    const choices = targetChoices(state, playerId, card);
    if (choices.length === 0) {
      commands.push({ type: "PLAY", card });
      continue;
    }
    for (const target of choices) {
      if (card === "guard") {
        for (const guess of GUARD_GUESSES) commands.push({ type: "PLAY", card, target, guess });
      } else {
        commands.push({ type: "PLAY", card, target });
      }
    }
  }
  return commands;
}

// ---------------------------------------------------------------------------
// 超时

/**
 * 超时时替人走的「固定动作」（补充文件第四节）。只看 view（这个座位裁剪后的状态）：
 * - 出牌：不打公主；被女伯爵强制就打女伯爵；否则打点数小的那张；
 * - 卫兵、牧师、男爵、国王：选下家开始第一个能选的人；卫兵猜「还没露面最多」的角色（一样多猜点数大的）；
 * - 王子：选下家开始第一个能选的对手，没有对手可选才选自己；
 * - 大臣：留点数最大的，另外的按点数从大到小放回（最小的在最底下）；
 * - 结算画面：点「下一局」。
 * 人机阶段可以把 timeoutTurn 的 choose 换成 botCommand，这个函数留作兜底。
 */
export function timeoutCommand(view: GameState, playerId: string): GameCommand | null {
  if (view.phase === "roundEnd") return view.ready.includes(playerId) ? null : { type: "READY" };
  if (view.phase !== "playing" || view.players[view.current]?.id !== playerId) return null;
  const me = view.players[view.current]!;
  const byValue = (left: Role, right: Role) => ROLE_VALUE[right] - ROLE_VALUE[left];
  if (view.stage === "chancellor") {
    const sorted = [...me.hand].sort(byValue);
    return { type: "CHANCELLOR", keep: sorted[0]!, bottom: sorted.slice(1) };
  }
  let card: Role;
  if (mustPlayCountess(me.hand)) {
    card = "countess";
  } else {
    const candidates = me.hand.filter((entry) => entry !== "princess");
    card = [...(candidates.length > 0 ? candidates : me.hand)].sort(byValue).at(-1)!;
  }
  const choices = targetChoices(view, playerId, card);
  if (choices.length === 0) return { type: "PLAY", card };
  // 王子把自己放在最后，第一个就是对手（没有对手时就是自己）
  const target = choices[0]!;
  if (card !== "guard") return { type: "PLAY", card, target };
  const unseen = unseenCounts(view, playerId);
  const guess = [...GUARD_GUESSES].sort((left, right) => unseen[right] - unseen[left] || ROLE_VALUE[right] - ROLE_VALUE[left])[0]!;
  return { type: "PLAY", card, target, guess };
}

/** 人机阶段可以换进来的「替人决定」函数：吃这个座位裁剪后的状态，返回命令。 */
export type TurnChooser = (view: GameState, playerId: string) => GameCommand | null;

/**
 * 当前这一步超时：
 * - 一小局进行中：由 choose（默认 timeoutCommand 的固定动作）替当前玩家把**整个回合**走完——
 *   出牌（含选人、猜牌），打出大臣还要留牌。整个回合前面加一条 TurnTimedOut，服务器只记 1 次超时。
 *   choose 只拿到当前玩家的裁剪视角；它给的命令不合法时退回固定动作。
 * - 结算画面：直接开下一小局（不算谁超时）。
 */
export function timeoutTurn(state: GameState, choose: TurnChooser = timeoutCommand): GameState {
  if (state.phase === "finished") return state;
  if (state.phase === "roundEnd") {
    const next = structuredClone(state);
    const rng = createRng(next.rngState ?? next.seed ?? 0);
    const ctx: Ctx = { state: next, rng, events: [] };
    next.ready = next.players.map((player) => player.id);
    beginNextRound(ctx);
    next.version += 1;
    next.events = ctx.events;
    next.rngState = rng.state;
    next.actions = [...(state.actions ?? []), { player: "", command: { type: "TIMEOUT" } }];
    return next;
  }
  const actor = state.players[state.current]!;
  const stage: Stage = state.stage;
  const turn = state.turn;
  let current = state;
  const events: GameEvent[] = [];
  // 一个回合最多两步（出牌、大臣留牌）
  for (let step = 0; step < 2; step += 1) {
    if (current.phase !== "playing" || current.turn !== turn) break;
    const view = redactGameForViewer(current, actor.id);
    let result: { state: GameState; events: GameEvent[] };
    try {
      const command = choose(view, actor.id);
      if (!command) throw new Error("没有给出命令");
      result = runCommand(current, actor.id, command);
    } catch {
      result = runCommand(current, actor.id, timeoutCommand(view, actor.id)!);
    }
    events.push(...result.events);
    current = result.state;
  }
  const timedOut: GameEvent = { type: "TurnTimedOut", player: actor.id, stage };
  current.events = [timedOut, ...events];
  current.history = [...state.history, timedOut, ...events];
  return current;
}

/** 服务器计时用的 key：每个回合的每一步（出牌、大臣留牌）各一个；结算画面一小局一个。只在换人、换步骤时变。 */
export function timerKey(state: GameState): string {
  if (state.phase === "playing") return `r${state.round}-t${state.turn}-${state.stage}`;
  return `r${state.round}-${state.phase}`;
}

/** 这一步限时几秒。 */
export function timerSeconds(state: GameState): number {
  return state.phase === "roundEnd" ? state.config.roundEndSec : state.config.turnTimeoutSec;
}

// ---------------------------------------------------------------------------
// 隐藏信息

export interface RedactOptions {
  /** 观战「看手牌」：能看到所有人的手牌和手牌相关的私密事件；牌堆、移出的牌、放回牌堆底的牌照样看不到。 */
  readonly seeAllHands?: boolean;
}

function redactEvent(event: GameEvent, viewerId: string, seeAll: boolean): GameEvent {
  switch (event.type) {
    case "Drew": {
      if (event.player === viewerId || seeAll) return event;
      const { card: _card, ...rest } = event;
      return rest;
    }
    case "ChancellorDrew": {
      if (event.player === viewerId || seeAll) return event;
      const { cards: _cards, ...rest } = event;
      return rest;
    }
    case "ChancellorReturned": {
      if (event.player === viewerId) return event;
      const { cards: _cards, ...rest } = event;
      return rest;
    }
    case "Peeked": {
      if (event.player === viewerId || seeAll) return event;
      const { card: _card, ...rest } = event;
      return rest;
    }
    case "Compared": {
      if (event.player === viewerId || event.target === viewerId || seeAll) return event;
      const { playerCard: _a, targetCard: _b, ...rest } = event;
      return rest;
    }
    case "Swapped": {
      if (event.player === viewerId || event.target === viewerId || seeAll) return event;
      const { playerGot: _a, targetGot: _b, ...rest } = event;
      return rest;
    }
    default:
      return event;
  }
}

/**
 * 发给某个座位（或观战的人）的状态。去掉：牌堆和顺序、面朝下移出的那张、种子、随机数状态、动作序列；
 * 别人的手牌（只留张数）；事件里不该他看的私密内容（见 GameEvent 的说明）。
 * viewerId 是座位 id；观战的人传空字符串，「看手牌」时再加 { seeAllHands: true }。
 */
export function redactGameForViewer(state: GameState, viewerId: string, options: RedactOptions = {}): GameState {
  const seeAll = options.seeAllHands === true;
  const {
    deck: _deck,
    setAside: _setAside,
    seed: _seed,
    rngState: _rngState,
    actions: _actions,
    ...rest
  } = state;
  return structuredClone({
    ...rest,
    players: state.players.map((player) => (player.id === viewerId || seeAll ? player : { ...player, hand: [] })),
    history: state.history.map((event) => redactEvent(event, viewerId, seeAll)),
    events: state.events.map((event) => redactEvent(event, viewerId, seeAll)),
  });
}

// ---------------------------------------------------------------------------
// 开局

export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  options: CreateOptions = {},
): GameState {
  const config = defaultConfig(players.length, options.config);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  const rng = createRng(seed);
  const state: GameState = {
    config,
    phase: "playing",
    stage: "play",
    players: players.map((player, index) => ({
      id: player.id,
      name: player.name,
      seat: index,
      tokens: 0,
      hand: [],
      handCount: 0,
      discards: [],
      out: false,
      protected: false,
      spy: false,
    })),
    round: 0,
    turn: 0,
    current: 0,
    deckCount: 0,
    faceUp: [],
    setAsideTaken: false,
    ready: [],
    history: [],
    events: [],
    version: 0,
    deck: [],
    setAside: null,
    seed,
    actions: [],
  };
  const starter = options.starter ?? rng.int(players.length);
  if (!Number.isInteger(starter) || starter < 0 || starter >= players.length) throw new Error("先手座位不对。");
  const ctx: Ctx = { state, rng, events: [] };
  startRound(ctx, starter, options.deal);
  state.events = ctx.events;
  state.rngState = rng.state;
  return state;
}
