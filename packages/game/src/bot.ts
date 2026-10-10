/**
 * 人机「普通」难度（补充文件第一节）。
 *
 * 输入只能是 redactGameForViewer(game, playerId) 裁剪后的状态（拿到完整状态会直接报错）。
 * 思路（大白话）：
 * 1. 记牌：从公开事件推出各角色还剩几张没露面、每个对手手里可能是什么（见 bot-knowledge.ts）。
 * 2. 把每个合法打法都算一个分：
 *    分 = 这一下的收益（卫兵猜中、男爵比赢、王子逼出公主、牧师看到的情报、间谍资格）
 *       + 活下来的概率 ×（留下那张牌的价值 − 被人点掉的风险）
 *       − 这一下就把自己送出局的概率 × 一整局的价值。
 *    留牌价值前半局看「这张牌还能干什么」，越到后半局越看点数（补充 1.5）；
 *    被点掉的风险按下一轮会轮到的对手手里有卫兵 / 男爵 / 王子的概率估，谁知道我的牌风险就大得多。
 * 3. 最后一回合（牌堆已经抽完）直接算比牌赢的概率，不用估。
 * 4. 分数差不多（差距 < 5%）的打法里随机挑一个，免得被人摸透。
 * 每一步都给一句理由（第二人称，「提示」按钮直接用）。理由会提到牧师看到的牌，**只能给这个座位自己看**，不要广播。
 */
import { ROLE_NAME, ROLE_VALUE, ROLES, type Role } from "./cards.js";
import { buildKnowledge, handDistribution, poolDistribution, type Knowledge } from "./bot-knowledge.js";
import { legalActions, unseenCounts } from "./engine.js";
import type { GameCommand, GameState, Player } from "./types.js";

/** 可调的参数（以后「调弱一点」就改这里）。分数的单位：1 枚标记 ≈ 10 分。 */
export const BOT_PARAMS = {
  /** 自己出局的代价。 */
  self: 10,
  /** 多人局淘汰一个对手的价值（再乘领先系数）。 */
  elim: 7,
  /** 2 人局淘汰对手（= 赢下这一局）。 */
  elim2: 11,
  /** 前半局「留着有什么用」的分（补充 1.5，自对弈调过）。 */
  func: { spy: 0, guard: 2, priest: 2, baron: 3, handmaid: 4, prince: 5, chancellor: 5, king: 5, countess: 7, princess: 8 } as Record<Role, number>,
  /** 打出间谍：没人有间谍资格时 / 已经有在局对手打过时（打了就让他拿不到）。 */
  spyGain: 2.5,
  spyDeny: 1,
  /** 牧师情报的基础分，和下回合能接着用的牌（卫兵、男爵）的加分。 */
  info: 1.2,
  infoGuard: 2.5,
  infoBaron: 1,
  /** 2 人局侍女额外加分（对手这一回合的指向牌全白打）。 */
  handmaid2: 1,
  /** 后半局用王子逼对手换掉大牌的分（乘点数差）。 */
  princeStrength: 0.5,
  /** 王子逼对手弃掉间谍，反而送他间谍资格。 */
  spyGive: 1.5,
  /** 国王换完知道对方手里是什么。 */
  kingInfo: 0.6,
  /** 分数差在这个比例以内算「差不多」，随机挑。 */
  tolerance: 0.05,
  /** 对手「留大打小」的倾向（推对手手牌用）：留下的牌比打出的大 / 一样 / 小的权重。 */
  bias: { higher: 3, same: 2, lower: 1 },
  /** 后半局系数：还能轮到几回合以内算「后半局」（补充 1.5 是 3）。 */
  horizon: 3,
  /** 大臣放回牌堆底：大牌放到自己会抽到的位置、别给对手（乘点数；中途常被王子、大臣打乱，所以给得小）。 */
  orderMine: 0.12,
  orderOther: 0.08,
  /** 大臣留牌：留着公主没有说得出口的危险时（见 princessDanger）一律留公主。 */
  princessKeepBonus: 100,
  /** 放底顺序只在留同一张时比较，不影响留哪张。 */
  orderTieBreakOnly: true,
};

export type BotParams = typeof BOT_PARAMS;

export interface BotDecision {
  readonly command: GameCommand;
  /** 一句玩家听得懂的理由（第二人称）。只给这个座位自己看。 */
  readonly reason: string;
}

interface Candidate {
  readonly command: GameCommand;
  readonly score: number;
  readonly reason: string;
}

type PlayCommand = Extract<GameCommand, { type: "PLAY" }>;
type ChancellorCommand = Extract<GameCommand, { type: "CHANCELLOR" }>;

interface Ctx {
  readonly view: GameState;
  readonly me: Player;
  readonly know: Knowledge;
  /** 还在局中的对手，从下家开始按座位顺序。 */
  readonly opps: Player[];
  readonly alive: number;
  readonly dist: Map<string, Record<Role, number>>;
  readonly pool: Record<Role, number>;
  readonly unseen: Record<Role, number>;
  /** 后半局系数 0–1（补充 1.5）。 */
  readonly t: number;
  /** 牌堆已经抽完：这是本局最后一回合，打完就比牌。 */
  readonly final: boolean;
  readonly P: BotParams;
}

const V = (role: Role) => ROLE_VALUE[role];
const N = (role: Role) => ROLE_NAME[role];
/** 把概率说成玩家听得懂的话（理由里不出现小数和百分比）。 */
function odds(p: number): string {
  if (p >= 0.95) return "几乎一定";
  if (p >= 0.75) return "十有八九";
  if (p >= 0.6) return "多半";
  if (p >= 0.45) return "有一半机会";
  if (p >= 0.28) return "大约三次有一次";
  if (p >= 0.18) return "大约四五次有一次";
  if (p >= 0.08) return "大约十次有一次";
  return "只有很小的机会";
}

function nameOf(ctx: Ctx, id: string): string {
  return ctx.view.players.find((player) => player.id === id)?.name ?? id;
}

function laterHalf(deckCount: number, alive: number, horizon: number): number {
  const turnsLeft = Math.floor(deckCount / Math.max(1, alive));
  return Math.min(1, Math.max(0, 1 - turnsLeft / horizon));
}

function makeCtx(view: GameState, meId: string, params: BotParams, deckCount = view.deckCount): Ctx {
  const me = view.players.find((player) => player.id === meId)!;
  const know = buildKnowledge(view, meId);
  const opps: Player[] = [];
  for (let step = 1; step < view.players.length; step += 1) {
    const player = view.players[(me.seat + step) % view.players.length]!;
    if (!player.out) opps.push(player);
  }
  const dist = new Map<string, Record<Role, number>>();
  for (const opp of opps) dist.set(opp.id, handDistribution(know, opp.id, params.bias));
  const alive = opps.length + 1;
  return {
    view,
    me,
    know,
    opps,
    alive,
    dist,
    pool: poolDistribution(know),
    unseen: unseenCounts(view, meId),
    t: laterHalf(deckCount, alive, params.horizon),
    final: view.stage === "play" && view.deckCount === 0,
    P: params,
  };
}

// ---------------------------------------------------------------------------
// 估值

function keepValue(ctx: Ctx, card: Role): number {
  if (card === "spy") return 0;
  return ctx.t * V(card) + (1 - ctx.t) * ctx.P.func[card];
}

/**
 * 留着 card 撑到我下一回合之前被人点掉的概率。knowers：确切知道我这张牌的对手。
 * 只算下一轮会轮到的对手（牌堆不够时后面的人轮不到）。
 */
function threat(ctx: Ctx, card: Role, knowers: ReadonlySet<string>, deckCount = ctx.view.deckCount): number {
  const acting = ctx.opps.slice(0, Math.min(deckCount, ctx.opps.length));
  const size = ctx.know.poolSize;
  let higher = 0;
  for (const role of ROLES) if (V(role) > V(card)) higher += ctx.pool[role];
  const guessP = Math.min(0.6, (1.3 * (ctx.know.pool[card] + 1)) / (size + 1));
  let survive = 1;
  for (const x of acting) {
    const d = ctx.dist.get(x.id)!;
    const has = (role: Role) => 1 - (1 - d[role]) * (1 - ctx.pool[role]);
    const targets = 1 + ctx.opps.filter((other) => other.id !== x.id && !other.protected).length;
    const knows = knowers.has(x.id);
    let hit = 0;
    if (card !== "guard") hit += has("guard") * (knows ? 0.9 : guessP / targets);
    hit += has("baron") * higher * (knows ? 0.9 : 0.5 / targets);
    if (card === "princess") hit += has("prince") * (knows ? 0.9 : 0.6 / targets);
    survive *= 1 - Math.min(0.95, hit);
  }
  return 1 - survive;
}

/** 留着 card 的净价值：留牌价值 − 被点掉的风险 × 出局代价。 */
function keepNet(ctx: Ctx, card: Role, knowers: ReadonlySet<string>, deckCount = ctx.view.deckCount): number {
  return keepValue(ctx, card) - threat(ctx, card, knowers, deckCount) * ctx.P.self;
}

function lead(ctx: Ctx, opp: Player): number {
  // 只剩我们俩：淘汰他 = 我赢这一局，我出局 = 他赢这一局，两边一样重，不再按领先加权
  if (ctx.alive === 2) return 1;
  const target = ctx.view.config.tokensToWin;
  return 1 + 0.15 * Math.max(0, opp.tokens - ctx.me.tokens) + (opp.tokens >= target - 1 ? 0.4 : 0);
}

function elimValue(ctx: Ctx, opp: Player): number {
  return (ctx.alive === 2 ? ctx.P.elim2 : ctx.P.elim) * lead(ctx, opp);
}

function spyGain(ctx: Ctx): number {
  if (ctx.me.spy) return 0;
  return ctx.opps.some((opp) => opp.spy) ? ctx.P.spyDeny : ctx.P.spyGain;
}

/** 打出 played、留下 kept 之后，还确切知道我手里那张的对手。 */
function knowersAfter(ctx: Ctx, played: Role, kept: Role): Set<string> {
  const result = new Set<string>();
  for (const [knower, role] of ctx.know.exposure) if (role === kept && played !== role) result.add(knower);
  return result;
}

function expectedValue(dist: Record<Role, number>, skip?: Role): number {
  let sum = 0;
  let mass = 0;
  for (const role of ROLES) {
    if (role === skip) continue;
    sum += dist[role] * V(role);
    mass += dist[role];
  }
  return mass > 0 ? sum / mass : 0;
}

function howKnown(ctx: Ctx, oppId: string): string {
  switch (ctx.know.info.get(oppId)?.how) {
    case "priest":
      return "你用牧师看过";
    case "king":
      return "你们换过牌";
    case "baron":
      return "男爵比牌时你看到了";
    case "deck":
      return "他抽到的是你用大臣放回去的牌";
    case "tie":
      return "从男爵平手推出来";
    default:
      return "你推算出";
  }
}

// ---------------------------------------------------------------------------
// 最后一回合：直接算比牌

interface Showdown {
  /** 还在局的对手：手牌分布、有没有间谍资格。 */
  readonly opps: { dist: Record<Role, number>; spy: boolean }[];
}

/** 我拿着 card 比牌：赢（含并列）的概率 + 间谍分。单位：枚。 */
function showdownEquity(card: Role, mySpy: boolean, board: Showdown): number {
  let win = 1;
  for (const opp of board.opps) {
    let notHigher = 0;
    for (const role of ROLES) if (V(role) <= V(card)) notHigher += opp.dist[role];
    win *= notHigher;
  }
  const spy = mySpy && !board.opps.some((opp) => opp.spy) ? 1 : 0;
  return win + spy;
}

function finalBoard(ctx: Ctx, change?: { id: string; dist?: Record<Role, number>; out?: boolean; spy?: boolean }): Showdown {
  const opps: { dist: Record<Role, number>; spy: boolean }[] = [];
  for (const opp of ctx.opps) {
    if (change?.id === opp.id) {
      if (change.out) continue;
      opps.push({ dist: change.dist ?? ctx.dist.get(opp.id)!, spy: change.spy ?? opp.spy });
    } else {
      opps.push({ dist: ctx.dist.get(opp.id)!, spy: opp.spy });
    }
  }
  return { opps };
}

function single(role: Role): Record<Role, number> {
  const result = Object.fromEntries(ROLES.map((entry) => [entry, 0])) as Record<Role, number>;
  result[role] = 1;
  return result;
}

/** 最后一回合打出 command（留下 kept）后的期望（单位：枚）。 */
function finalEquity(ctx: Ctx, command: PlayCommand, kept: Role): number {
  const card = command.card;
  const mySpy = ctx.me.spy || card === "spy";
  const base = () => showdownEquity(kept, mySpy, finalBoard(ctx));
  if (card === "princess") return 0;
  const targetId = command.target;
  if (targetId === undefined) return base();
  if (card === "prince" && targetId === ctx.me.id) {
    if (kept === "princess") return 0;
    let sum = 0;
    for (const role of ROLES) if (ctx.pool[role] > 0) sum += ctx.pool[role] * showdownEquity(role, mySpy || kept === "spy", finalBoard(ctx));
    return sum;
  }
  const opp = ctx.opps.find((player) => player.id === targetId);
  if (!opp) return base();
  const d = ctx.dist.get(opp.id)!;
  let sum = 0;
  switch (card) {
    case "guard": {
      const p = command.guess ? d[command.guess] : 0;
      return p * showdownEquity(kept, mySpy, finalBoard(ctx, { id: opp.id, out: true })) + (1 - p) * base();
    }
    case "baron":
      for (const role of ROLES) {
        if (d[role] <= 0) continue;
        if (V(role) < V(kept)) sum += d[role] * showdownEquity(kept, mySpy, finalBoard(ctx, { id: opp.id, out: true }));
        else if (V(role) === V(kept)) sum += d[role] * showdownEquity(kept, mySpy, finalBoard(ctx, { id: opp.id, dist: single(role) }));
      }
      return sum;
    case "prince":
      for (const role of ROLES) {
        if (d[role] <= 0) continue;
        if (role === "princess") sum += d[role] * showdownEquity(kept, mySpy, finalBoard(ctx, { id: opp.id, out: true }));
        else sum += d[role] * showdownEquity(kept, mySpy, finalBoard(ctx, { id: opp.id, dist: ctx.pool, spy: opp.spy || role === "spy" }));
      }
      return sum;
    case "king":
      for (const role of ROLES) {
        if (d[role] > 0) sum += d[role] * showdownEquity(role, mySpy, finalBoard(ctx, { id: opp.id, dist: single(kept) }));
      }
      return sum;
    default:
      return base();
  }
}

// ---------------------------------------------------------------------------
// 出牌

function otherCard(hand: readonly Role[], played: Role): Role {
  const rest = [...hand];
  rest.splice(rest.indexOf(played), 1);
  return rest[0]!;
}

/** 打大臣：留下 kept，再从 pool 抽 1–2 张，三张里挑净价值最高的。 */
function chancellorValue(ctx: Ctx, kept: Role): number {
  const draws = Math.min(2, ctx.view.deckCount);
  const counts = ctx.know.pool;
  const size = ctx.know.poolSize;
  const net = (role: Role) => keepNet(ctx, role, new Set());
  const keptNet = net(kept);
  if (size <= 0) return keptNet;
  if (draws === 1 || size < 2) {
    let sum = 0;
    for (const role of ROLES) if (counts[role] > 0) sum += (counts[role] / size) * Math.max(keptNet, net(role));
    return sum;
  }
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < ROLES.length; i += 1) {
    const a = ROLES[i]!;
    if (counts[a] <= 0) continue;
    for (let j = i; j < ROLES.length; j += 1) {
      const b = ROLES[j]!;
      const w = a === b ? (counts[a] * (counts[a] - 1)) / 2 : counts[a] * counts[b];
      if (w <= 0) continue;
      sum += w * Math.max(keptNet, net(a), net(b));
      weight += w;
    }
  }
  return weight > 0 ? sum / weight : keptNet;
}

function scorePlay(ctx: Ctx, command: PlayCommand): Candidate {
  const { P } = ctx;
  const card = command.card;
  const kept = otherCard(ctx.me.hand, card);
  const knowers = knowersAfter(ctx, card, kept);
  const target = command.target;
  const opp = target !== undefined ? ctx.opps.find((player) => player.id === target) : undefined;
  const d = opp ? ctx.dist.get(opp.id) : undefined;
  const who = target !== undefined ? nameOf(ctx, target) : "";
  const keptText = `${N(kept)}(${V(kept)})`;
  const forced = card === "countess" && (kept === "king" || kept === "prince");

  let gain = 0;
  let pDie = 0;
  /** 2 人局里这一下就把对手淘汰、直接赢下这一局的概率（这时留下哪张已经无所谓）。 */
  let pEnd = 0;
  const lastOpponent = ctx.alive === 2;
  let keep = keepNet(ctx, kept, knowers);
  let reason = `留下${keptText}，打掉${N(card)}。`;
  /** 理由是「留下哪张」这类普通的，最后一回合换成比牌胜率。 */
  let plain = true;

  switch (card) {
    case "spy":
      gain = spyGain(ctx);
      if (ctx.me.spy) reason = `间谍只有 0 点，留到最后必输，早点打掉，留下${N(kept)}。`;
      else if (ctx.opps.some((player) => player.spy)) reason = "已经有人打过间谍，你也打一张，他就拿不到间谍分了。";
      else reason = "趁早打出间谍：活到最后、又只有你打过间谍，能多拿 1 枚。";
      break;
    case "guard": {
      if (!opp || !d) {
        reason = `别人都出局或受保护，卫兵白打，留下${N(kept)}。`;
        break;
      }
      plain = false;
      const guess = command.guess!;
      const p = d[guess];
      gain = p * elimValue(ctx, opp);
      if (lastOpponent) pEnd = p;
      if (p >= 0.999) reason = `${howKnown(ctx, opp.id)}，${who}手里是${N(guess)}：卫兵点他、猜${N(guess)}，一定中。`;
      else reason = `猜${who}是${N(guess)}：${N(guess)}还有 ${ctx.unseen[guess]} 张没露面（${odds(p)}能猜中）。`;
      break;
    }
    case "priest": {
      if (!opp || !d) {
        reason = `别人都出局或受保护，牧师白打，留下${N(kept)}。`;
        break;
      }
      const certainty = Math.max(...ROLES.map((role) => d[role]));
      const follow = kept === "guard" ? P.infoGuard : kept === "baron" ? P.infoBaron : 0;
      gain = (1 - certainty) * (P.info + follow) * lead(ctx, opp) * (ctx.alive === 2 ? 1.3 : 1);
      if (!ctx.final) {
        plain = false;
        reason =
          kept === "guard"
            ? `先用牧师看${who}的牌，下回合用卫兵点他。`
            : kept === "baron"
              ? `先用牧师看${who}的牌，再决定要不要和他比牌。`
              : `用牧师看看${who}的牌，后面好对付他。`;
      }
      break;
    }
    case "baron": {
      if (!opp || !d) {
        reason = `别人都出局或受保护，男爵白打，留下${N(kept)}。`;
        break;
      }
      plain = false;
      let win = 0;
      let lose = 0;
      let tie = 0;
      for (const role of ROLES) {
        if (V(role) < V(kept)) win += d[role];
        else if (V(role) > V(kept)) lose += d[role];
        else tie += d[role];
      }
      gain = win * elimValue(ctx, opp);
      pDie = lose;
      if (lastOpponent) pEnd = win;
      if (tie > 0) keep = (1 - tie) * keep + tie * keepNet(ctx, kept, new Set([...knowers, opp.id]));
      if (win >= 0.999) reason = `${howKnown(ctx, opp.id)}${who}的牌比你的${keptText}小，男爵比牌必赢。`;
      else if (lose >= 0.999) reason = `${who}的牌比你大，可也没有更好的打法了。`;
      else if (win >= 0.6) reason = `你留着${keptText}，没露面的牌大多比它小，和${who}比牌${odds(win)}能赢。`;
      else reason = `你留着${keptText}，和${who}比牌${odds(win)}能赢。`;
      break;
    }
    case "handmaid": {
      keep = keepValue(ctx, kept) + (ctx.alive === 2 ? P.handmaid2 : 0);
      const knower = [...knowers][0];
      reason = knower ? `${nameOf(ctx, knower)}知道你拿着${N(kept)}，先用侍女挡一回合。` : `你留着${keptText}，用侍女保护自己一回合。`;
      break;
    }
    case "prince": {
      plain = false;
      if (target === ctx.me.id) {
        if (kept === "princess") {
          pDie = 1;
          reason = "别人都受保护，王子只能选自己，弃掉公主会出局；两张都一样，没办法了。";
          break;
        }
        let sum = 0;
        for (const role of ROLES) if (ctx.pool[role] > 0) sum += ctx.pool[role] * keepNet(ctx, role, new Set());
        keep = sum;
        gain = kept === "spy" ? spyGain(ctx) : 0;
        const knower = [...knowers][0];
        reason = knower
          ? `${nameOf(ctx, knower)}知道你拿着${N(kept)}，王子选自己，把它换掉。`
          : kept === "spy"
            ? "王子选自己，弃掉间谍（也算打过间谍），再抽一张新的。"
            : `手里的${N(kept)}用处不大，王子选自己，弃掉重抽一张。`;
        break;
      }
      if (!opp || !d) break;
      const princess = d.princess;
      gain = princess * elimValue(ctx, opp);
      if (lastOpponent) pEnd = princess;
      const theirs = expectedValue(d, "princess");
      const fresh = expectedValue(ctx.pool);
      gain += (1 - princess) * ctx.t * P.princeStrength * (theirs - fresh) * lead(ctx, opp);
      if (!opp.spy) gain -= d.spy * P.spyGive;
      if (princess >= 0.999) reason = `${howKnown(ctx, opp.id)}，${who}拿着公主：王子逼他弃掉，他就出局。`;
      else if (princess >= 0.5) reason = `${who}很可能拿着公主，用王子逼他弃牌，弃掉公主就出局。`;
      else if (princess >= 0.2) reason = `${who}有可能拿着公主，用王子逼他弃牌，弃掉公主就出局。`;
      else if (theirs - fresh >= 1) reason = `${who}手里多半是大牌，用王子逼他弃掉重抽。`;
      else reason = `用王子逼${who}弃牌重抽，留下${N(kept)}。`;
      break;
    }
    case "chancellor":
      if (ctx.view.deckCount === 0) {
        reason = `牌堆空了，大臣白打，留下${N(kept)}。`;
        break;
      }
      keep = chancellorValue(ctx, kept);
      reason = "用大臣多抽两张，三张里挑最好的留下。";
      break;
    case "king": {
      if (!opp || !d) {
        reason = `别人都出局或受保护，国王白打，留下${N(kept)}。`;
        break;
      }
      plain = false;
      let sum = 0;
      for (const role of ROLES) if (d[role] > 0) sum += d[role] * keepNet(ctx, role, new Set([opp.id]));
      keep = sum + (kept !== "guard" ? P.kingInfo : 0);
      const known = ctx.know.info.get(opp.id)?.known;
      reason = kept === "princess"
        ? `不能打公主，只能打国王，把公主换给${who}。`
        : known
        ? `${howKnown(ctx, opp.id)}，${who}拿着${N(known)}，用国王换过来。`
        : expectedValue(d) > V(kept) + 1
          ? `你只剩${keptText}，${who}的牌多半比它大，用国王换过来。`
          : `用国王和${who}换牌，换完你们俩都知道对方拿着什么。`;
      break;
    }
    case "countess":
      if (forced) {
        plain = false;
        reason = `手里有${N(kept)}，规则规定必须打出女伯爵。`;
      } else {
        reason = `留下${keptText}，打掉女伯爵。`;
      }
      break;
    case "princess":
      plain = false;
      pDie = 1;
      reason = "两张牌打哪张都会出局，没办法了。";
      break;
  }

  let score = gain + (1 - pDie - pEnd) * keep - pDie * P.self;
  if (ctx.final) {
    const equity = finalEquity(ctx, command, kept);
    // 同样是输，宁可比牌输也不把自己送出局（还留着间谍分的可能，看起来也不傻）
    score = 10 * equity - pDie;
    if (plain) {
      const spyNow = card === "spy" && !ctx.me.spy && !ctx.opps.some((player) => player.spy);
      reason = spyNow
        ? `最后一回合打出间谍：只有你打过间谍，多拿 1 枚；留下${keptText}去比牌。`
        : `牌堆抽完了，留下${keptText}去比牌（${odds(Math.min(1, equity))}能赢）。`;
    }
  }
  return { command, score, reason };
}

// ---------------------------------------------------------------------------
// 大臣留牌

/**
 * 留着公主有没有说得出口的危险：有人确切知道我拿着公主（大臣前就被看穿了），
 * 或者下一轮会轮到的对手确定拿着王子。没有的话大臣一律留公主（放掉公主新手看不懂，自对弈也没有更强）。
 */
function princessDanger(ctx: Ctx, deckCount: number): string | null {
  const acting = ctx.opps.slice(0, Math.min(deckCount, ctx.opps.length));
  for (const [knower, role] of ctx.know.exposure) {
    if (role === "princess" && ctx.opps.some((opp) => opp.id === knower)) return `${nameOf(ctx, knower)}知道你拿着公主，留着很容易被他点名`;
  }
  for (const opp of acting) {
    if (ctx.know.info.get(opp.id)?.known === "prince") return `${howKnown(ctx, opp.id)}，${nameOf(ctx, opp.id)}手里有王子，留着公主会被他逼着弃掉出局`;
  }
  return null;
}

function scoreChancellor(view: GameState, meId: string, params: BotParams, command: ChancellorCommand): Candidate {
  const after = view.deckCount + command.bottom.length;
  const ctx = makeCtx(view, meId, params, after);
  const hasPrincess = command.keep === "princess" || command.bottom.includes("princess");
  const danger = hasPrincess ? princessDanger(ctx, after) : null;
  // 被看穿的公主：留着时知道的人照样会盯着它
  const knowers = new Set<string>();
  if (command.keep === "princess") for (const [knower, role] of ctx.know.exposure) if (role === "princess") knowers.add(knower);
  let keep = keepNet(ctx, command.keep, knowers, after);
  if (command.keep === "princess" && !danger) keep += params.princessKeepBonus;
  // 放回去的牌谁会抽到：抽牌节奏不被打乱时，从顶数第 i 张（0 起）由我之后第 (i mod 在局人数)+1 个人抽到
  let order = 0;
  command.bottom.forEach((card, offset) => {
    const index = after - command.bottom.length + offset;
    const mine = index % ctx.alive === ctx.alive - 1;
    order += mine ? params.orderMine * V(card) : -params.orderOther * V(card);
  });
  // 一样的时候把点数小的放最底下
  const last = command.bottom.at(-1);
  if (command.bottom.length === 2 && last && V(last) <= V(command.bottom[0]!)) order += 0.01;
  const bottomText =
    command.bottom.length === 2
      ? `${N(command.bottom[0]!)}、${N(command.bottom[1]!)}放回牌堆底（${N(command.bottom[1]!)}在最底下）`
      : `${N(command.bottom[0]!)}放回牌堆底`;
  const reason =
    danger && command.bottom.includes("princess")
      ? `${danger}；先把公主放回牌堆底（放回去不算弃牌，不会出局），留下${N(command.keep)}(${V(command.keep)})。`
      : `留下${N(command.keep)}(${V(command.keep)})，${bottomText}。`;
  return { command, score: keep + (params.orderTieBreakOnly ? 0.01 * order : order), reason };
}

// ---------------------------------------------------------------------------
// 对外

function pick(candidates: Candidate[], random: () => number, tolerance: number): Candidate {
  let best = candidates[0]!;
  for (const candidate of candidates) if (candidate.score > best.score) best = candidate;
  const slack = Math.max(tolerance * Math.abs(best.score), 0.05);
  const near = candidates.filter((candidate) => candidate.score >= best.score - slack);
  return near[Math.min(near.length - 1, Math.floor(random() * near.length))] ?? best;
}

/** 调试和调参用：这一步每个打法的分数和理由（不从 index 导出）。 */
export function botCandidates(view: GameState, playerId: string, params: BotParams = BOT_PARAMS): Candidate[] {
  const actions = legalActions(view, playerId);
  if (view.phase !== "playing" || actions.length === 0) return [];
  if (view.stage === "chancellor") return actions.map((command) => scoreChancellor(view, playerId, params, command as ChancellorCommand));
  const ctx = makeCtx(view, playerId, params);
  return actions.map((command) => scorePlay(ctx, command as PlayCommand));
}

/**
 * 人机这一步怎么走、为什么。view 必须是 redactGameForViewer(game, playerId) 的结果。
 * 轮不到它（或者已经点过「下一局」、整场结束）时返回 null。
 */
export function botDecision(view: GameState, playerId: string, random: () => number = Math.random, params: BotParams = BOT_PARAMS): BotDecision | null {
  if (Array.isArray(view.deck)) throw new Error("人机只能看裁剪后的状态（redactGameForViewer）。");
  const actions = legalActions(view, playerId);
  if (actions.length === 0) return null;
  if (view.phase === "roundEnd") return { command: actions[0]!, reason: "看完结算，准备下一局。" };
  if (view.stage === "chancellor") {
    const candidates = actions.map((command) => scoreChancellor(view, playerId, params, command as ChancellorCommand));
    const chosen = pick(candidates, random, params.tolerance);
    return { command: chosen.command, reason: chosen.reason };
  }
  const ctx = makeCtx(view, playerId, params);
  // 卫兵不猜已经全部露面的角色（概率是 0）；全都露面了才随便猜
  const sensible = (command: GameCommand) =>
    command.type !== "PLAY" || command.card !== "guard" || command.guess === undefined || ctx.unseen[command.guess] > 0;
  const usable = actions.some((command) => command.type === "PLAY" && command.card === "guard" && command.guess !== undefined)
    && actions.some((command) => command.type === "PLAY" && command.card === "guard" && command.guess !== undefined && sensible(command))
    ? actions.filter(sensible)
    : actions;
  const candidates = usable.map((command) => scorePlay(ctx, command as PlayCommand));
  const chosen = pick(candidates, random, params.tolerance);
  return { command: chosen.command, reason: chosen.reason };
}

/** 人机这一步的命令（服务器、超时代打用）。 */
export function botCommand(view: GameState, playerId: string, random: () => number = Math.random): GameCommand | null {
  return botDecision(view, playerId, random)?.command ?? null;
}

/**
 * 教程「提示」按钮：真人座位的视角里，人机会怎么打、为什么。
 * 理由会提到牧师看到的牌，只能显示给这个座位自己。
 */
export function botHint(view: GameState, playerId: string, random: () => number = Math.random): BotDecision | null {
  return botDecision(view, playerId, random);
}
