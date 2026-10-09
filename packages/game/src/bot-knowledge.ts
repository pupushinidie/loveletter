/**
 * 人机的记牌（补充文件 1.1）：只从裁剪后的视角（redactGameForViewer 的结果）推。
 *
 * - 各角色还剩几张没露面（unseen），再扣掉「我确切知道在别人手里」和「我放到牌堆底、还没被抽走」的牌，叫 pool；
 * - 对每个对手的确定知识（牧师看到、国王换到、男爵平手、抽到了我用大臣放回去的牌）和作废规则；
 * - 排除和推断：卫兵没猜中、男爵赢家的点数下限、两个别人男爵平手、刚打出女伯爵；
 * - 谁知道我手里是什么（被牧师看过、国王换过、男爵平手过、我抽到了别人放回去的牌）。
 *
 * 打的是刚抽的还是原来那张不公开，所以「对手打出的牌和已知那张同名」时知识作废（补充 1.1 B）。
 */
import { ROLES, ROLE_COUNT, ROLE_VALUE, type Role } from "./cards.js";
import { unseenCounts } from "./engine.js";
import type { GameState } from "./types.js";

/** 我对某个对手手牌知道多少。 */
export interface OpponentInfo {
  /** 确定知道他手里是这张。 */
  known: Role | null;
  /** 怎么知道的（理由文案用）。 */
  how: "priest" | "king" | "baron" | "deck" | "tie" | null;
  /** 卫兵猜过没中的角色（直到他下次出牌或换牌）。 */
  excluded: Set<Role>;
  /** 点数下限（男爵比赢了别人）。 */
  min: number;
  /** 刚打出女伯爵：手里是国王、王子的可能性加倍。 */
  countess: boolean;
  /** 和这个人男爵比平了（两人手里同一种角色），对方还没换过牌。 */
  tiePartner: string | null;
  /** 这一回合他抽到的是我放到牌堆底的这张（他出牌后就知道他留的是哪张）。 */
  pendingDraw: Role | null;
  /** 他最近一次打出的牌（手牌未知时用：一般人留大打小，留下的那张多半比打出的大）。 */
  lastPlayed: Role | null;
}

export interface Knowledge {
  readonly me: string;
  /** 每个对手（包括已出局的）。 */
  readonly info: Map<string, OpponentInfo>;
  /** 谁确切知道我手里那张（座位 id → 他以为的牌；只有和我手里一致的才算数）。 */
  readonly exposure: Map<string, Role>;
  /** 我知道的牌堆位置：index 是从顶数第几张（0 是下一张），owner 是放回去的人；card 只在 owner 是我时有。 */
  readonly deckKnown: { index: number; owner: string; card: Role | null }[];
  /** 没露面的牌（unseenCounts）再扣掉：我确切知道在对手手里的、我知道还在牌堆里的。 */
  readonly pool: Record<Role, number>;
  readonly poolSize: number;
  /** 推出来的牌堆张数和视角里的不一致时为 false（不应该发生；发生了就不用牌堆位置的知识）。 */
  readonly deckConsistent: boolean;
}

function blank(): OpponentInfo {
  return { known: null, how: null, excluded: new Set(), min: 0, countess: false, tiePartner: null, pendingDraw: null, lastPlayed: null };
}

function reset(info: OpponentInfo): void {
  info.known = null;
  info.how = null;
  info.excluded = new Set();
  info.min = 0;
  info.countess = false;
  info.tiePartner = null;
  info.lastPlayed = null;
}

function removeOne(cards: Role[], card: Role): void {
  const index = cards.indexOf(card);
  if (index >= 0) cards.splice(index, 1);
}

/**
 * 我这一小局开局发到的那张：开局发牌没有事件，从现在的手牌把我自己的事件倒着退回去。
 */
function initialHand(view: GameState, me: string): Role[] {
  let hand = [...(view.players.find((player) => player.id === me)?.hand ?? [])];
  for (let index = view.history.length - 1; index >= 0; index -= 1) {
    const event = view.history[index]!;
    switch (event.type) {
      case "Drew":
        if (event.player === me && event.card) removeOne(hand, event.card);
        break;
      case "ChancellorDrew":
        if (event.player === me) for (const card of event.cards ?? []) removeOne(hand, card);
        break;
      case "Played":
        if (event.player === me) hand.push(event.card);
        break;
      case "Discarded":
        if (event.player === me) hand.push(event.card);
        break;
      case "ChancellorReturned":
        if (event.player === me) hand.push(...(event.cards ?? []));
        break;
      case "Eliminated":
        if (event.player === me) hand.push(...event.revealed);
        break;
      case "Swapped":
        if (event.player === me && event.targetGot) hand = [event.targetGot];
        else if (event.target === me && event.playerGot) hand = [event.playerGot];
        break;
      default:
        break;
    }
  }
  return hand;
}

export function buildKnowledge(view: GameState, me: string): Knowledge {
  if (Array.isArray(view.deck)) throw new Error("人机只能看裁剪后的状态（redactGameForViewer）。");
  const info = new Map<string, OpponentInfo>();
  for (const player of view.players) if (player.id !== me) info.set(player.id, blank());
  const get = (id: string) => info.get(id);
  let exposure = new Map<string, Role>();
  let myHand: Role[] = initialHand(view, me);
  /** 我这一回合抽到的是别人放回去的牌：他知道我抽到了什么。 */
  let drawnKnownBy: { owner: string; card: Role } | null = null;
  let deckKnown: { index: number; owner: string; card: Role | null }[] = [];
  let deckCount = 0;
  let lastBaron: { winnerCandidates: [string, string] } | null = null;

  /** 从牌堆顶抽 n 张（给 player）：返回抽到的、我知道来历的那几条。 */
  const drawFromDeck = (n: number) => {
    const taken = deckKnown.filter((entry) => entry.index < n);
    deckKnown = deckKnown.filter((entry) => entry.index >= n).map((entry) => ({ ...entry, index: entry.index - n }));
    deckCount -= n;
    return taken;
  };

  // 牌堆张数：从现在的张数倒推回这一小局开头（预览局面开局时打出区里已经有牌，不能按 21 张算）
  for (const event of view.history) {
    if (event.type === "Drew" && event.source === "deck") deckCount -= 1;
    else if (event.type === "ChancellorDrew") deckCount -= event.count;
    else if (event.type === "ChancellorReturned") deckCount += event.count;
  }
  deckCount = view.deckCount - deckCount;

  for (const event of view.history) {
    switch (event.type) {
      case "Drew": {
        const taken = event.source === "deck" ? drawFromDeck(1) : [];
        const entry = taken[0];
        if (event.player === me) {
          if (event.card) myHand.push(event.card);
          if (event.reason === "prince") exposure = new Map();
          drawnKnownBy = entry && entry.owner !== me && event.card ? { owner: entry.owner, card: event.card } : null;
          if (event.reason === "prince" && drawnKnownBy) {
            exposure.set(drawnKnownBy.owner, drawnKnownBy.card);
            drawnKnownBy = null;
          }
        } else {
          const opp = get(event.player);
          if (!opp) break;
          if (event.reason === "prince") {
            // 被王子弃牌后重抽：手里只有这一张
            reset(opp);
            if (entry && entry.owner === me && entry.card) {
              opp.known = entry.card;
              opp.how = "deck";
            }
          } else {
            opp.pendingDraw = entry && entry.owner === me && entry.card ? entry.card : null;
          }
        }
        break;
      }
      case "Played": {
        const card = event.card;
        if (event.player === me) {
          removeOne(myHand, card);
          const kept = myHand[0];
          const next = new Map<string, Role>();
          for (const [knower, role] of exposure) if (card !== role && kept === role) next.set(knower, role);
          if (drawnKnownBy && card !== drawnKnownBy.card && kept === drawnKnownBy.card) next.set(drawnKnownBy.owner, drawnKnownBy.card);
          exposure = next;
          drawnKnownBy = null;
          break;
        }
        const opp = get(event.player);
        if (!opp) break;
        if (opp.pendingDraw !== null) {
          if (card !== opp.pendingDraw) {
            const drawn = opp.pendingDraw;
            reset(opp);
            opp.known = drawn;
            opp.how = "deck";
          }
          // 打掉的就是我放回去的那张：他留的还是原来那张，原来的知识照旧
        } else if (opp.known !== null) {
          if (card === opp.known) reset(opp);
        } else {
          reset(opp);
        }
        opp.pendingDraw = null;
        if (opp.known === null) {
          if (card === "countess") opp.countess = true;
          opp.lastPlayed = card;
        }
        break;
      }
      case "Guessed": {
        if (!event.hit && event.target !== me) {
          const opp = get(event.target);
          if (opp && opp.known === null) opp.excluded.add(event.guess);
        }
        break;
      }
      case "Peeked": {
        if (event.player === me && event.card) {
          const opp = get(event.target);
          if (opp) {
            reset(opp);
            opp.known = event.card;
            opp.how = "priest";
          }
        } else if (event.target === me && myHand[0]) {
          exposure.set(event.player, myHand[0]);
        }
        break;
      }
      case "Compared": {
        lastBaron = null;
        if (event.player === me || event.target === me) {
          const other = event.player === me ? event.target : event.player;
          const theirs = event.player === me ? event.targetCard : event.playerCard;
          const opp = get(other);
          if (event.loser === null && opp && theirs) {
            reset(opp);
            opp.known = theirs;
            opp.how = "baron";
            if (myHand[0]) exposure.set(other, myHand[0]);
          }
        } else if (event.loser === null) {
          const a = get(event.player);
          const b = get(event.target);
          if (a && b && a.known === null && b.known === null) {
            a.tiePartner = event.target;
            b.tiePartner = event.player;
          } else if (a && b) {
            // 一方我知道：另一方就是同一种角色
            const role = a.known ?? b.known;
            for (const opp of [a, b]) {
              if (role && opp.known === null) {
                reset(opp);
                opp.known = role;
                opp.how = "tie";
              }
            }
          }
        } else {
          lastBaron = { winnerCandidates: [event.player, event.target] };
        }
        break;
      }
      case "Discarded": {
        if (event.player === me) {
          removeOne(myHand, event.card);
          exposure = new Map();
        } else {
          const opp = get(event.player);
          if (opp) reset(opp);
        }
        break;
      }
      case "ChancellorDrew": {
        drawFromDeck(event.count);
        if (event.player === me && event.cards) myHand.push(...event.cards);
        break;
      }
      case "ChancellorReturned": {
        const before = deckCount;
        for (let index = 0; index < event.count; index += 1) {
          deckKnown.push({ index: before + index, owner: event.player, card: event.player === me ? event.cards?.[index] ?? null : null });
        }
        deckCount += event.count;
        if (event.player === me) {
          for (const card of event.cards ?? []) removeOne(myHand, card);
          exposure = new Map();
        } else {
          const opp = get(event.player);
          if (opp) reset(opp);
        }
        break;
      }
      case "Swapped": {
        if (event.player === me || event.target === me) {
          const other = event.player === me ? event.target : event.player;
          const mine = event.player === me ? event.playerGot : event.targetGot;
          const theirs = event.player === me ? event.targetGot : event.playerGot;
          if (mine) myHand = [mine];
          exposure = new Map();
          if (mine) exposure.set(other, mine);
          const opp = get(other);
          if (opp && theirs) {
            reset(opp);
            opp.known = theirs;
            opp.how = "king";
          }
        } else {
          const a = get(event.player);
          const b = get(event.target);
          if (a && b) {
            const copyA = { ...a, excluded: new Set(a.excluded) };
            Object.assign(a, { ...b, excluded: new Set(b.excluded), tiePartner: null, pendingDraw: null });
            Object.assign(b, { ...copyA, tiePartner: null, pendingDraw: null });
          }
          // 他们俩之中有人确切知道我的牌，不受影响
        }
        break;
      }
      case "Eliminated": {
        const opp = get(event.player);
        const revealed = event.revealed[0];
        if (opp?.tiePartner && revealed) {
          const partner = get(opp.tiePartner);
          if (partner && partner.tiePartner === event.player && partner.known === null) {
            reset(partner);
            partner.known = revealed;
            partner.how = "tie";
          }
        }
        if (lastBaron && event.reason === "baron" && revealed) {
          const winner = lastBaron.winnerCandidates.find((id) => id !== event.player);
          const w = winner ? get(winner) : undefined;
          if (w && w.known === null) w.min = Math.max(w.min, ROLE_VALUE[revealed] + 1);
        }
        lastBaron = null;
        if (opp) reset(opp);
        if (event.player !== me) exposure.delete(event.player);
        break;
      }
      default:
        break;
    }
  }

  const deckConsistent = deckCount === view.deckCount;
  if (!deckConsistent) deckKnown = [];
  // 出局的人知道我的牌也没用了
  for (const player of view.players) if (player.out) exposure.delete(player.id);
  const meNow = view.players.find((player) => player.id === me);
  const currentHand = meNow?.hand ?? [];
  for (const [knower, role] of exposure) if (!currentHand.includes(role)) exposure.delete(knower);

  const pool = unseenCounts(view, me);
  for (const player of view.players) {
    if (player.id === me || player.out) continue;
    const known = info.get(player.id)?.known;
    if (known) pool[known] = Math.max(0, pool[known] - 1);
  }
  for (const entry of deckKnown) if (entry.card) pool[entry.card] = Math.max(0, pool[entry.card] - 1);
  const poolSize = ROLES.reduce((sum, role) => sum + pool[role], 0);
  return { me, info, exposure, deckKnown, pool, poolSize, deckConsistent };
}

/** 对手 id 手里各角色的概率（补充 1.1 A + C）。 */
/** 「留大打小」的倾向：对手打出 played 后，留下的牌比它大 / 一样 / 小的权重。 */
export const PLAY_BIAS = { higher: 3, same: 2, lower: 1 };

export function handDistribution(knowledge: Knowledge, opponentId: string, bias = PLAY_BIAS): Record<Role, number> {
  const info = knowledge.info.get(opponentId);
  const result = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<Role, number>;
  if (info?.known) {
    result[info.known] = 1;
    return result;
  }
  const pool = knowledge.pool;
  let total = 0;
  for (const role of ROLES) {
    let weight = pool[role];
    if (!info) {
      result[role] = weight;
      total += weight;
      continue;
    }
    if (info.excluded.has(role)) weight = 0;
    if (ROLE_VALUE[role] < info.min) weight = 0;
    if (info.tiePartner && knowledge.info.get(info.tiePartner)?.tiePartner === opponentId) {
      weight = (pool[role] * (pool[role] - 1)) / 2;
    }
    if (info.countess && (role === "king" || role === "prince")) weight *= 2;
    if (info.lastPlayed && info.lastPlayed !== "countess") {
      const played = ROLE_VALUE[info.lastPlayed];
      // 公主从来不会主动打出，所以拿着公主的人一定打另一张
      weight *= role === "princess" ? bias.higher : ROLE_VALUE[role] > played ? bias.higher : ROLE_VALUE[role] === played ? bias.same : bias.lower;
    }
    result[role] = weight;
    total += weight;
  }
  if (total <= 0) {
    // 推断互相矛盾（不应该发生）：退回只按没露面的牌算
    total = 0;
    for (const role of ROLES) {
      result[role] = pool[role];
      total += pool[role];
    }
  }
  if (total <= 0) {
    for (const role of ROLES) result[role] = ROLE_COUNT[role] / 21;
    return result;
  }
  for (const role of ROLES) result[role] /= total;
  return result;
}

/** 从 pool 里随便抽一张的分布。 */
export function poolDistribution(knowledge: Knowledge): Record<Role, number> {
  const result = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<Role, number>;
  const size = knowledge.poolSize;
  for (const role of ROLES) result[role] = size > 0 ? knowledge.pool[role] / size : ROLE_COUNT[role] / 21;
  return result;
}
