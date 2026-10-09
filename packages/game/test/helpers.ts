import { FULL_DECK, countRoles, ROLES, type Role } from "../src/cards.js";
import { applyCommand } from "../src/engine.js";
import type { GameEvent, GameState, Player } from "../src/types.js";

/** 座位 id 找玩家。 */
export function P(state: GameState, id: string): Player {
  const player = state.players.find((candidate) => candidate.id === id);
  if (!player) throw new Error(`没有 ${id}`);
  return player;
}

/** 打一张牌（不带的字段就不发）。 */
export function play(state: GameState, player: string, card: Role, target?: string, guess?: Role): GameState {
  return applyCommand(state, player, {
    type: "PLAY",
    card,
    ...(target !== undefined ? { target } : {}),
    ...(guess !== undefined ? { guess } : {}),
  });
}

export function keep(state: GameState, player: string, card: Role, bottom: Role[]): GameState {
  return applyCommand(state, player, { type: "CHANCELLOR", keep: card, bottom });
}

export function ready(state: GameState, player: string): GameState {
  return applyCommand(state, player, { type: "READY" });
}

/** 局面里所有的牌：牌堆、移出的、明牌、手牌、打出区。 */
export function allCards(state: GameState): Role[] {
  return [
    ...(state.deck ?? []),
    ...(state.setAside ? [state.setAside] : []),
    ...state.faceUp,
    ...state.players.flatMap((player) => player.hand),
    ...state.players.flatMap((player) => player.discards.map((entry) => entry.card)),
  ];
}

/** 21 张守恒：每种角色的张数都对。返回问题描述，没问题是 null。 */
export function conservationProblem(state: GameState): string | null {
  const all = allCards(state);
  if (all.length !== FULL_DECK.length) return `一共 ${all.length} 张`;
  const counts = countRoles(all);
  const full = countRoles(FULL_DECK);
  for (const role of ROLES) if (counts[role] !== full[role]) return `${role} ${counts[role]} 张`;
  return null;
}

export function eventsOf<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);
}

/** 整个对象（JSON）里有没有某个字段名。 */
export function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([name, child]) => name === key || hasKey(child, key));
  }
  return false;
}
