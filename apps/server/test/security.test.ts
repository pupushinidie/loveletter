/**
 * 首发验收「隐藏信息和安全」方向发现的两条（qa-security.md）：
 * - I9 远程 DoS：客户端发事件不带回执，服务器裸调 ack() 抛 TypeError 把进程带崩。
 *   这里把服务器认识的每个事件，在房间外 / 等候房间里 / 对局中，不带回执、带回执、乱传参数各发一遍，
 *   服务器还活着、另一桌照常打；再用故障注入证明处理函数和计时器里抛出的异常都被接住。
 * - I8 种子可穷举：种子 128 位、来自 crypto；每开一小局都用服务器新注入的随机数洗牌，
 *   拿着上一局的一切（包括服务器自己的种子和随机数状态）也算不出新一局的牌；用到的随机数记进动作序列，能重放。
 */
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  FULL_DECK,
  createRng,
  createScene,
  legalActions,
  restoreRng,
  type AckResponse,
  type ClientToServerEvents,
  type GameState,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type ServerToClientEvents,
} from "@loveletter/game";

// 服务端在导入时读这些变量：步骤限时放长（这里不测超时），人机立刻行动。
process.env.TURN_MS = "20000";
process.env.BOT_DELAY_SCALE = "0";
process.env.ADMIN_TOKEN = "security-test-admin-token";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Server = typeof import("../src/index.js");

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let server: Server;
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false, forceNew: true });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

/** 原样发出去（参数随便给，测乱传），带回执时最多等 1 秒。 */
function raw(client: TestSocket, event: string, args: unknown[], withAck: boolean): Promise<unknown> {
  const emit = client.emit.bind(client) as unknown as (event: string, ...args: unknown[]) => void;
  if (!withAck) {
    emit(event, ...args);
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("没有回执"), 1000);
    emit(event, ...args, (response: unknown) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

async function alive(): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 10_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

/** 建一桌：host + 若干真人 + 人机，开局。 */
async function table(humans: number, bots: number): Promise<{ code: string; players: TestSocket[] }> {
  const host = await connect();
  const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: humans + bots } as never, ack));
  if (!created.ok) throw new Error(created.error);
  const players = [host];
  for (let seat = 1; seat < humans; seat += 1) {
    const client = await connect();
    const joined = await call<LobbyRoomSnapshot>((ack) => client.emit("room:join", { name: nick("玩家"), code: created.data.code }, ack));
    if (!joined.ok) throw new Error(joined.error);
    players.push(client);
  }
  for (let seat = 0; seat < bots; seat += 1) expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
  const started = await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
  if (!started.ok) throw new Error(started.error);
  for (const client of players) await updateWhere(client, (room) => room.game !== undefined);
  return { code: created.data.code, players };
}

/** 这一桌还在正常打：轮到真人的那位打一步，回执 ok、版本前进。 */
async function stillPlaying(players: TestSocket[]): Promise<void> {
  const seatOf = (client: TestSocket) => latest.get(client)!.members.find((member) => member.id === client.id)!.playerId;
  const mover = players.find((client) => legalActions(latest.get(client)!.game!, seatOf(client)).length > 0);
  expect(mover, "应该轮到某个真人").toBeTruthy();
  const game = latest.get(mover!)!.game!;
  const response = await call<LobbyRoomSnapshot>((ack) => mover!.emit("game:command", legalActions(game, seatOf(mover!))[0]!, ack));
  expect(response.ok).toBe(true);
  if (response.ok) expect(response.data.game!.version).toBeGreaterThan(game.version);
}

/** 乱七八糟的参数（每一项是一整组参数）。 */
const GARBAGE: unknown[][] = [
  [],
  [null],
  [undefined],
  [0],
  [-1],
  ["x"],
  [true],
  [[]],
  [{}],
  [[1, 2, 3]],
  [{ name: { a: 1 } }],
  [{ name: "正常名字", capacity: "6", code: 123, roomId: {}, spectate: "yes" }],
  [{ type: "PLAY", card: { toString: 1 }, target: [], guess: 7 }],
  [{ type: "CHANCELLOR", keep: null, bottom: "guard" }],
  [{ to: 123, data: { description: { type: "offer", sdp: 5 } } }],
  [{ sessionId: [], token: {}, roomId: null }],
  [{ allowSpectators: "true", open: 1, spectatorsSeeAll: null }],
  [JSON.parse('{"__proto__":{"polluted":true},"name":"原型污染"}')],
  ["a".repeat(50_000)],
  [1, 2, 3, 4, 5],
  [null, null, null],
];

beforeAll(async () => {
  server = await import("../src/index.js");
  await new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, resolve);
  });
  serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const client of clients) client.disconnect();
  await new Promise<void>((resolve) => server.io.close(() => resolve()));
});

describe("首发验收 I9：任何事件、任何参数、带不带回执，服务器都不能崩", () => {

  it("服务器认识的事件都在清单里（22 个），没有漏的", () => {
    const events = server.testHooks.clientEvents();
    expect(events).toHaveLength(22);
    expect(events).toEqual(expect.arrayContaining(["room:create", "room:join", "game:command", "voice:signal", "admin:kick-session", "room:auto"]));
  });

  it("每个事件在房间外、等候房间、对局中各发一遍：不带回执、带回执、乱传参数；服务器活着，另一桌照常打", async () => {
    const victim = await table(2, 1);
    const watcher = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => watcher.emit("room:join", { name: nick("看客"), code: victim.code, spectate: true }, ack))).ok).toBe(true);

    const contexts: { name: string; make: () => Promise<TestSocket> }[] = [
      { name: "房间外", make: () => connect() },
      {
        name: "等候房间",
        make: async () => {
          const client = await connect();
          expect((await call<LobbyRoomSnapshot>((ack) => client.emit("room:create", { name: nick("等候"), capacity: 3 } as never, ack))).ok).toBe(true);
          return client;
        },
      },
      { name: "对局中", make: async () => (await table(1, 1)).players[0]! },
    ];
    const noAnswer: string[] = [];
    let sent = 0;
    for (const event of server.testHooks.clientEvents()) {
      for (const context of contexts) {
        const client = await context.make();
        for (const args of GARBAGE) {
          await raw(client, event, args, false);
          sent += 1;
          if (event !== "voice:signal") {
            const response = await raw(client, event, args, true);
            sent += 1;
            // 带了回执就一定有回音（不会挂着不回）
            if (response === "没有回执") noAnswer.push(`${context.name} ${event} ${JSON.stringify(args).slice(0, 60)}`);
          }
        }
        expect(await alive(), `${context.name}发「${event}」之后`).toBe(true);
        client.disconnect();
      }
    }
    expect(sent).toBeGreaterThan(2500);
    expect(noAnswer).toEqual([]);
    // 原型没被污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // 另一桌还在：首页列表里有，观战还连着，还能接着打
    const rooms = await call<PublicRoomSummary[]>((ack) => watcher.emit("lobby:get", ack));
    expect(rooms.ok && rooms.data.some((room) => room.status === "playing" && room.players.length === 3)).toBe(true);
    expect(watcher.connected && victim.players.every((client) => client.connected)).toBe(true);
    await stillPlaying(victim.players);
  }, 120_000);

  it("处理函数里抛出的异常按连接接住：这一下回执告诉客户端出错了，服务器活着，下一步照常", async () => {
    const victim = await table(2, 0);
    const seatOf = (client: TestSocket) => latest.get(client)!.members.find((member) => member.id === client.id)!.playerId;
    const mover = victim.players.find((client) => legalActions(latest.get(client)!.game!, seatOf(client)).length > 0)!;
    const command = legalActions(latest.get(mover)!.game!, seatOf(mover))[0]!;
    server.testHooks.injectFault("game:command");
    const failed = await call<LobbyRoomSnapshot>((ack) => mover.emit("game:command", command, ack));
    expect(failed).toEqual({ ok: false, error: "服务器出错了，请稍后再试。" });
    expect(await alive()).toBe(true);
    await stillPlaying(victim.players);

    // 不带回执时出错也一样接住
    server.testHooks.injectFault("lobby:get");
    (mover.emit as unknown as (event: string) => void)("lobby:get");
    for (let waited = 0; server.testHooks.faultPending() && waited < 3000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.testHooks.faultPending()).toBe(false);
    expect(await alive()).toBe(true);
    await stillPlaying(victim.players);
  });

  it("计时器回调里抛出的异常也接住（人机行动、超时、继续投票、关房、首页推送都包了一层）", async () => {
    const other = await table(2, 0);
    server.testHooks.injectFault("timer");
    // 开一桌全是人机的：人机的第一步在计时器里，这一次故意让它抛错
    const solo = await table(1, 2);
    // 等某个计时器真的触发了这个故障（人机行动或首页列表推送，最多几秒）
    for (let waited = 0; server.testHooks.faultPending() && waited < 5000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.testHooks.faultPending()).toBe(false);
    expect(await alive()).toBe(true);
    expect(solo.players[0]!.connected).toBe(true);
    await stillPlaying(other.players);
  });

  it("断线清理里抛出的异常也接住", async () => {
    const other = await table(2, 0);
    const leaver = await connect();
    server.testHooks.injectFault("disconnect");
    leaver.disconnect();
    for (let waited = 0; server.testHooks.faultPending() && waited < 3000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.testHooks.faultPending()).toBe(false);
    expect(await alive()).toBe(true);
    await stillPlaying(other.players);
  });
});

describe("首发验收 I8：种子 128 位、来自 crypto，每开一小局都注入新的随机数", () => {
  it("开局种子 4 个 32 位整数；不同房间不一样；不下发", async () => {
    const one = await table(2, 0);
    const two = await table(2, 0);
    const a = server.testHooks.fullGame(one.code)!;
    const b = server.testHooks.fullGame(two.code)!;
    expect(a.seed).toHaveLength(4);
    expect(a.seed).not.toEqual(b.seed);
    for (const client of [...one.players, ...two.players]) {
      const view = latest.get(client)!.game!;
      expect("seed" in view || "rngState" in view || "deck" in view).toBe(false);
    }
  });

  it("新一小局用新注入的随机数洗牌：拿着上一局的种子和随机数状态（比玩家知道的还多）照着洗，也和真的新一局对不上；动作序列里记了这一步的种子，能重放", async () => {
    const { code, players } = await table(3, 0);
    const members = latest.get(players[0]!)!.members;
    const scene = createScene({
      players: members.map((member) => ({ id: member.playerId, name: member.name })),
      hands: [["handmaid", "king"], ["priest"], ["guard"]],
      deck: [],
      setAside: "princess",
      leftovers: "discards",
    });
    server.testHooks.setGame(code, { ...scene, version: 9000 });
    for (const client of players) await updateWhere(client, (room) => room.game?.version === 9000);
    const host = players[0]!;
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("game:command", { type: "PLAY", card: "handmaid" }, ack))).ok).toBe(true);
    const ended: GameState = structuredClone(server.testHooks.fullGame(code)!);
    expect(ended.phase).toBe("roundEnd");
    for (const client of players) expect((await call<LobbyRoomSnapshot>((ack) => client.emit("game:command", { type: "READY" }, ack))).ok).toBe(true);
    const next = server.testHooks.fullGame(code)!;
    expect(next.round).toBe(2);
    const deal = [next.setAside!, ...next.players.map((player) => player.hand[0]!), next.players[next.current]!.hand[1]!, ...next.deck!];
    // 接着上一局的随机数状态洗：对不上
    expect(deal).not.toEqual(restoreRng(ended.rngState!).shuffle(FULL_DECK));
    expect(deal).not.toEqual(createRng(ended.seed!).shuffle(FULL_DECK));
    // 动作序列里最后一个 READY 带着服务器这一次注入的种子，重放得出同一副牌
    const entry = next.actions!.at(-1)!;
    expect(entry.command).toEqual({ type: "READY" });
    expect(entry.seed).toHaveLength(4);
    expect(entry.seed).not.toEqual(ended.seed);
    expect(deal).toEqual(createRng(entry.seed!).shuffle(FULL_DECK));
  });
});
