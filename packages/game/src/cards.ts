/**
 * 情书（2019 六人版）的 21 张角色牌：10 种角色，点数 0–9。
 *
 * 牌在状态里只用角色名表示（"guard" 等），不用「卫兵 3 号」这种实例编号：
 * 实体牌里同名的牌分不出来，如果给每张牌编号，玩家就能靠编号认出「这张卫兵是不是我看过的那张」，
 * 等于多拿了实体游戏里没有的信息。牌堆顺序照样是一个有序数组（顶在前）。
 */
export const ROLES = [
  "spy",
  "guard",
  "priest",
  "baron",
  "handmaid",
  "prince",
  "chancellor",
  "king",
  "countess",
  "princess",
] as const;

export type Role = (typeof ROLES)[number];

/** 点数（亮牌比大小用）。 */
export const ROLE_VALUE: Readonly<Record<Role, number>> = {
  spy: 0,
  guard: 1,
  priest: 2,
  baron: 3,
  handmaid: 4,
  prince: 5,
  chancellor: 6,
  king: 7,
  countess: 8,
  princess: 9,
};

/** 每种角色几张，合计 21。 */
export const ROLE_COUNT: Readonly<Record<Role, number>> = {
  spy: 2,
  guard: 6,
  priest: 2,
  baron: 2,
  handmaid: 2,
  prince: 2,
  chancellor: 2,
  king: 1,
  countess: 1,
  princess: 1,
};

/** 中文名（界面、日志、错误提示用）。 */
export const ROLE_NAME: Readonly<Record<Role, string>> = {
  spy: "间谍",
  guard: "卫兵",
  priest: "牧师",
  baron: "男爵",
  handmaid: "侍女",
  prince: "王子",
  chancellor: "大臣",
  king: "国王",
  countess: "女伯爵",
  princess: "公主",
};

/**
 * 打出时要不要选人：
 * - other：选一名别的玩家（卫兵、牧师、男爵、国王）；没有能选的人就白打。
 * - any：选任意玩家，可以是自己（王子）；别人都选不了时只能选自己。
 * - none：不选人。
 */
export type TargetKind = "other" | "any" | "none";

export const ROLE_TARGET: Readonly<Record<Role, TargetKind>> = {
  spy: "none",
  guard: "other",
  priest: "other",
  baron: "other",
  handmaid: "none",
  prince: "any",
  chancellor: "none",
  king: "other",
  countess: "none",
  princess: "none",
};

/** 卫兵能猜的角色：除了卫兵都行（间谍也能猜）。 */
export const GUARD_GUESSES: readonly Role[] = ROLES.filter((role) => role !== "guard");

/** 一整副 21 张，按点数排好（洗牌前）。 */
export const FULL_DECK: readonly Role[] = ROLES.flatMap((role) => Array.from({ length: ROLE_COUNT[role] }, () => role));

/** 各人数要攒几枚钟情标记（2019 规则书第 7 页）。 */
export const TOKENS_TO_WIN: Readonly<Record<number, number>> = { 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 };

/** 2 人局开局另外面朝上移出几张。 */
export const TWO_PLAYER_FACE_UP = 3;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** 按角色数张数。 */
export function countRoles(cards: readonly Role[]): Record<Role, number> {
  const counts = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<Role, number>;
  for (const card of cards) counts[card] += 1;
  return counts;
}
