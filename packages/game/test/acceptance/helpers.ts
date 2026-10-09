/**
 * 规则核对（背靠背）的共用工具。
 *
 * 这一目录的测试只按规则书（~/Desktop/游戏规则/情书.md）、补充和勘误（情书-补充.md）、
 * 开工拍板（pipeline/games/loveletter/decisions/kickoff.json）和引擎对外接口写，没有看引擎实现和引擎自己的测试。
 * 归验收 agent 所有，引擎不能改；觉得哪条写错了，记 gpipe issue 由制作人裁决。
 */
import { expect } from "vitest";
import {
  FULL_DECK,
  ROLES,
  apply,
  countRoles,
  createRng,
  createScene,
  type DiscardEntry,
  type GameCommand,
  type GameEvent,
  type GameState,
  type Player,
  type Role,
  type SceneSpec,
} from "../../src/index.js";

export const P1 = "p1";
export const P2 = "p2";
export const P3 = "p3";
export const P4 = "p4";
export const P5 = "p5";
export const P6 = "p6";

/** 按座位 id 取玩家。 */
export function pl(state: GameState, id: string): Player {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`没有座位 ${id}`);
  return p;
}

/** 当前玩家的座位 id。 */
export function cur(state: GameState): string {
  const p = state.players[state.current];
  if (!p) throw new Error("current 越界");
  return p.id;
}

/** 执行一条命令（rng 用固定种子；只有小局结束和开新局才会用到）。 */
export function act(state: GameState, playerId: string, command: GameCommand, seed = 7): { state: GameState; events: GameEvent[] } {
  return apply(state, playerId, command, createRng(seed));
}

export function playCard(state: GameState, playerId: string, card: Role, target?: string, guess?: Role, seed = 7): GameState {
  const command: { type: "PLAY"; card: Role; target?: string; guess?: Role } = { type: "PLAY", card };
  if (target !== undefined) command.target = target;
  if (guess !== undefined) command.guess = guess;
  return act(state, playerId, command, seed).state;
}

/** 断言命令被拒绝：抛错、错误信息是给玩家看的中文，而且输入状态没被改动。 */
export function expectRejected(state: GameState, playerId: string, command: GameCommand): void {
  const before = structuredClone(state);
  let message = "";
  try {
    act(state, playerId, command);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message, `命令应被拒绝：${playerId} ${JSON.stringify(command)}`).not.toBe("");
  expect(message, `错误提示要有中文：${message}`).toMatch(/[一-龥]/);
  expect(state).toEqual(before);
}

/** 多重集合比较（顺序无关）。 */
export function sorted(cards: readonly Role[]): Role[] {
  return [...cards].sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b));
}

type ExactSpec = Omit<SceneSpec, "leftovers"> & {
  readonly hands: readonly (readonly Role[])[];
  readonly setAside: Role | null;
};

/**
 * 写全 21 张的精确局面：没写到的牌塞进 dump 指定的地方（"deck" 接在牌堆底，数字是那个座位的打出区），
 * 然后用 leftovers: "error" 让工厂核对一整副正好 21 张。
 * 间谍、公主要放哪必须自己写明，避免被塞进在局的人的打出区。
 */
export function exact(spec: ExactSpec, dump: "deck" | number): GameState {
  const used: Role[] = [];
  for (const hand of spec.hands) used.push(...hand);
  for (const discards of spec.discards ?? []) {
    for (const entry of discards ?? []) used.push(typeof entry === "string" ? entry : entry.card);
  }
  used.push(...(spec.deck ?? []));
  if (spec.setAside) used.push(spec.setAside);
  used.push(...(spec.faceUp ?? []));
  const left = countRoles(FULL_DECK);
  for (const card of used) {
    left[card] -= 1;
    if (left[card] < 0) throw new Error(`测试局面写错：${card} 超出张数`);
  }
  const leftovers: Role[] = ROLES.flatMap((role) => Array.from({ length: left[role] }, () => role));
  let deck = [...(spec.deck ?? [])];
  const seats = typeof spec.players === "number" ? spec.players : (spec.players?.length ?? 3);
  const discards: (readonly (Role | DiscardEntry)[])[] = Array.from({ length: seats }, (_, i) => [...(spec.discards?.[i] ?? [])]);
  if (dump === "deck") {
    deck = [...deck, ...leftovers];
  } else {
    if ((leftovers.includes("princess") || leftovers.includes("spy")) && !(spec.out ?? []).includes(dump)) {
      throw new Error("测试局面写错：公主或间谍会被塞进在局的人的打出区");
    }
    discards[dump] = [...(discards[dump] ?? []), ...leftovers];
  }
  return createScene({ ...spec, deck, discards, leftovers: "error" });
}

/** 全部事件里某种类型的。 */
export function eventsOf<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** 21 张守恒：牌堆 + 所有手牌 + 所有打出区 + 没被拿走的移出牌 + 2 人局明牌 = 一整副。只用在完整状态上。 */
export function allCards(state: GameState): Role[] {
  const cards: Role[] = [...(state.deck ?? [])];
  for (const p of state.players) {
    cards.push(...p.hand);
    cards.push(...p.discards.map((d) => d.card));
  }
  if (state.setAside) cards.push(state.setAside);
  cards.push(...state.faceUp);
  return sorted(cards);
}
