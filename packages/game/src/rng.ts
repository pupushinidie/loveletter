/**
 * 可复现的随机数：sfc32，状态 128 位（4 个 32 位整数）。
 *
 * 安全上的约定（首发验收 I8）：
 * - 线上的种子由服务器用 crypto 生成（128 位，见 randomSeed），不是 32 位整数：玩家拿着自己看得到的牌，
 *   没法在种子空间里穷举出整副牌。
 * - 服务器每执行一个命令都传进一个新的、用 crypto 种子造的 Rng（见 apply / applyCommand / timeoutTurn 的 rng 参数），
 *   所以每一小局洗牌、并列赢家里抽先手用的都是新注入的随机数，不会从上一局的随机数流接着取。
 * - 种子和状态只在服务器上（redactGameForViewer 会去掉）。
 *
 * 测试、预览局面、教程可以照旧传一个数字当种子（会展开成 128 位），同一种子、同一串操作总能得到同一局。
 */
export type Seed = number | readonly number[];

export interface Rng {
  /** [0, 1) 的浮点数（53 位精度）。 */
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** 现在的内部状态（4 个 32 位整数）；用 restoreRng 能从这里接着取。 */
  readonly state: number[];
  /** 规整后的种子（4 个 32 位整数）：createRng(seed) 用它能重放出同一串数。 */
  readonly seed: number[];
  /** 从创建到现在一共取了几次数（next/int/pick/shuffle 都算）。 */
  readonly draws: number;
}

const WARM_UP = 16;

/** splitmix32：把一个数字种子展开成 4 个互不相关的 32 位整数。 */
function expand(seed: number): number[] {
  const low = Math.floor(seed) >>> 0;
  const high = Math.floor(seed / 4294967296) >>> 0;
  let x = (low ^ Math.imul(high, 0x9e3779b9)) >>> 0;
  const words: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    words.push((z ^ (z >>> 15)) >>> 0);
  }
  return words;
}

function normalize(seed: Seed): number[] {
  if (typeof seed === "number") return expand(seed);
  if (!Array.isArray(seed) || seed.length === 0 || !seed.every((word) => typeof word === "number" && Number.isFinite(word))) {
    throw new Error("种子要是一个数字，或者 4 个 32 位整数。");
  }
  // 少于 4 个整数的补齐（用前面的整数展开），多出的忽略
  const words = seed.slice(0, 4).map((word) => word >>> 0);
  while (words.length < 4) words.push(expand(words[words.length - 1]! + words.length)[0]!);
  return words;
}

function make(initial: readonly number[], seed: number[], warmUp: boolean): Rng {
  let [a, b, c, d] = initial.map((word) => word >>> 0) as [number, number, number, number];
  let draws = 0;
  const step = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  if (warmUp) for (let index = 0; index < WARM_UP; index += 1) step();
  const next = () => {
    draws += 1;
    const high = step() >>> 5;
    const low = step() >>> 6;
    return (high * 67108864 + low) / 9007199254740992;
  };
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    pick: (items) => items[int(items.length)]!,
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
    get state() {
      return [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    },
    get seed() {
      return [...seed];
    },
    get draws() {
      return draws;
    },
  };
}

/** 用种子造一个随机数发生器（数字种子会展开成 128 位）。 */
export function createRng(seed: Seed): Rng {
  const words = normalize(seed);
  return make(words, words, true);
}

/** 从 Rng.state 接着取（不重新预热）。 */
export function restoreRng(state: readonly number[]): Rng {
  const words = normalize(state);
  return make(words, words, false);
}

/**
 * 128 位密码学安全的随机种子（浏览器和 Node 都有的 crypto.getRandomValues）。
 * 服务器用 node:crypto 自己生成也一样，见 apps/server。
 */
export function randomSeed(): number[] {
  const crypto = (globalThis as { crypto?: { getRandomValues<T extends Uint32Array>(array: T): T } }).crypto;
  if (!crypto?.getRandomValues) throw new Error("这个环境没有 crypto.getRandomValues，请自己传种子。");
  return [...crypto.getRandomValues(new Uint32Array(4))];
}
