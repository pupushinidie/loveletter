/**
 * 情书的服务器流程：用真的 socket 走 建房 → 加入 → 开局 → 每种牌 → 一小局结束 → 下一局 → 整场结束 → 再来一局；
 * 原昵称重连回座；超时替人走完整个回合；每个连接收到的每一份状态都查隐藏信息（和服务器上的完整状态比对）。
 */
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  actorOf,
  createScene,
  legalActions,
  type AckResponse,
  type ClientToServerEvents,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyRoomSnapshot,
  type Role,
  type SceneSpec,
  type ServerToClientEvents,
} from "@loveletter/game";

// 服务端在导入时读这两个变量：每一步 400 ms 超时，人机立刻行动。
process.env.TURN_MS = "400";
process.env.BOT_DELAY_SCALE = "0";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Hooks = typeof import("../src/index.js").testHooks;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
/** 每个连接收到的所有状态（查隐藏信息用）。 */
const received = new Map<TestSocket, LobbyRoomSnapshot[]>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let hooks: Hooks;
let nameSeq = 0;
let stageSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    received.set(client, []);
    client.on("room:updated", (room) => {
      latest.set(client, room);
      received.get(client)!.push(room);
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
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

function seatOf(client: TestSocket): string {
  return latest.get(client)?.members.find((member) => member.id === client.id)?.playerId ?? "";
}

async function command(client: TestSocket, action: GameCommand): Promise<AckResponse<LobbyRoomSnapshot>> {
  return call<LobbyRoomSnapshot>((ack) => client.emit("game:command", action, ack));
}

/** 建一个 count 人房，全是真人连接，开局。返回房间码和按座位排好的连接。 */
async function startRoom(count: number): Promise<{ code: string; players: TestSocket[] }> {
  const host = await connect();
  const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: count } as never, ack));
  if (!created.ok) throw new Error(created.error);
  const players = [host];
  for (let seat = 1; seat < count; seat += 1) {
    const client = await connect();
    const joined = await call<LobbyRoomSnapshot>((ack) => client.emit("room:join", { name: nick("玩家"), code: created.data.code }, ack));
    if (!joined.ok) throw new Error(joined.error);
    players.push(client);
  }
  const started = await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
  if (!started.ok) throw new Error(started.error);
  for (const client of players) await updateWhere(client, (room) => room.game !== undefined);
  return { code: created.data.code, players };
}

/** 把房间里的对局换成一个精确局面（座位 id 和名字用房间里的）。 */
async function stage(code: string, players: TestSocket[], spec: SceneSpec): Promise<GameState> {
  const members = latest.get(players[0]!)!.members;
  const game = createScene({ ...spec, players: members.map((member) => ({ id: member.playerId, name: member.name })) });
  stageSeq += 1;
  const version = 1000 * stageSeq;
  hooks.setGame(code, { ...game, version });
  for (const client of players) await updateWhere(client, (room) => room.game?.version === version);
  return hooks.fullGame(code)!;
}

/** 轮到这个连接时随机走一个合法行动；返回停止函数。 */
function autoplay(client: TestSocket, pick: (actions: GameCommand[]) => GameCommand = (actions) => actions[Math.floor(Math.random() * actions.length)]!): () => void {
  let sentFor = "";
  const handler = (room: LobbyRoomSnapshot) => {
    const game = room.game;
    if (!game || game.phase === "finished") return;
    const actions = legalActions(game, seatOf(client));
    const key = `${game.version}`;
    if (actions.length === 0 || sentFor === key) return;
    sentFor = key;
    client.emit("game:command", pick(actions), () => {});
  };
  client.on("room:updated", handler);
  const current = latest.get(client);
  if (current) handler(current);
  return () => client.off("room:updated", handler);
}

const PRIVATE_FIELDS: Partial<Record<GameEvent["type"], string[]>> = {
  Drew: ["card"],
  Peeked: ["card"],
  ChancellorDrew: ["cards"],
  ChancellorReturned: ["cards"],
  Compared: ["playerCard", "targetCard"],
  Swapped: ["playerGot", "targetGot"],
};

/** 某个座位（或观战）收到的一份状态里有没有不该有的东西。 */
function leaks(game: GameState, viewer: string, seeAll: boolean): string[] {
  const problems: string[] = [];
  for (const key of ["deck", "setAside", "seed", "rngState", "actions"]) {
    if (key in game) problems.push(`拿到了 ${key}`);
  }
  for (const player of game.players) {
    if (player.id !== viewer && !seeAll && player.hand.length > 0) problems.push(`看到了 ${player.id} 的手牌`);
  }
  for (const event of [...game.history, ...game.events]) {
    for (const field of PRIVATE_FIELDS[event.type] ?? []) {
      if (!(field in event)) continue;
      const owner = "player" in event ? event.player : "";
      const other = "target" in event ? event.target : "";
      const allowed = event.type === "ChancellorReturned"
        ? owner === viewer
        : event.type === "Compared" || event.type === "Swapped"
          ? owner === viewer || other === viewer || seeAll
          : owner === viewer || seeAll;
      if (!allowed) problems.push(`${event.type}.${field} 发给了 ${viewer || "观战"}`);
    }
  }
  return problems;
}

/** 查这个连接收到过的所有状态。 */
function auditReceived(client: TestSocket, viewer: string): string[] {
  const problems: string[] = [];
  for (const room of received.get(client) ?? []) {
    if (!room.game) continue;
    const seat = viewer || room.members.find((member) => member.id === client.id)?.playerId || "";
    const spectating = !room.members.some((member) => member.id === client.id);
    problems.push(...leaks(room.game, spectating ? "" : seat, spectating && room.access.spectatorsSeeAll));
  }
  return problems;
}

describe("情书服务器", () => {
  beforeAll(async () => {
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    hooks = serverModule.testHooks;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
  });

  it("房间人数 2–6；7 人和 1 人的房间建不了；一个人开不了局", async () => {
    for (const capacity of [2, 3, 4, 5, 6]) {
      const client = await connect();
      expect((await call<LobbyRoomSnapshot>((ack) => client.emit("room:create", { name: nick("房主"), capacity } as never, ack))).ok).toBe(true);
      expect((await call<LobbyRoomSnapshot>((ack) => client.emit("room:start", ack))).ok).toBe(false);
    }
    for (const capacity of [1, 7]) {
      const client = await connect();
      const response = await call<LobbyRoomSnapshot>((ack) => client.emit("room:create", { name: nick("房主"), capacity } as never, ack));
      expect(response.ok).toBe(false);
    }
  });

  it("每种牌都能通过 socket 打出：卫兵、牧师、男爵、侍女、王子、大臣（含留牌）、国王、女伯爵、公主、间谍", async () => {
    const { code, players } = await startRoom(3);
    const seat = (client: TestSocket) => seatOf(client);
    const cases: { hands: Role[][]; action: GameCommand; check: (game: GameState) => void; deck?: Role[] }[] = [
      { hands: [["guard", "priest"], ["baron"]], action: { type: "PLAY", card: "guard", target: "p2", guess: "baron" }, check: (game) => expect(game.players[1]!.out).toBe(true) },
      { hands: [["priest", "guard"], ["king"]], action: { type: "PLAY", card: "priest", target: "p2" }, check: (game) => expect(game.events.some((event) => event.type === "Peeked")).toBe(true) },
      { hands: [["baron", "king"], ["handmaid"]], action: { type: "PLAY", card: "baron", target: "p2" }, check: (game) => expect(game.players[1]!.out).toBe(true) },
      { hands: [["handmaid", "guard"]], action: { type: "PLAY", card: "handmaid" }, check: (game) => expect(game.players[0]!.protected).toBe(true) },
      { hands: [["prince", "guard"], ["spy"]], action: { type: "PLAY", card: "prince", target: "p2" }, check: (game) => expect(game.players[1]!.spy).toBe(true) },
      { hands: [["king", "guard"], ["countess"]], action: { type: "PLAY", card: "king", target: "p2" }, check: (game) => expect(game.players[0]!.hand).toEqual(["countess"]) },
      { hands: [["countess", "king"]], action: { type: "PLAY", card: "countess" }, check: (game) => expect(game.players[0]!.hand).toEqual(["king"]) },
      { hands: [["princess", "guard"]], action: { type: "PLAY", card: "princess" }, check: (game) => expect(game.players[0]!.out).toBe(true) },
      { hands: [["spy", "guard"]], action: { type: "PLAY", card: "spy" }, check: (game) => expect(game.players[0]!.spy).toBe(true) },
    ];
    for (const entry of cases) {
      await stage(code, players, { hands: entry.hands, ...(entry.deck ? { deck: entry.deck } : {}) });
      const response = await command(players[0]!, entry.action);
      if (!response.ok) throw new Error(response.error);
      entry.check(hooks.fullGame(code)!);
    }
    // 大臣：打出后停在留牌这一步，再发留牌
    await stage(code, players, { hands: [["chancellor", "guard"]], deck: ["princess", "baron"] });
    expect((await command(players[0]!, { type: "PLAY", card: "chancellor" })).ok).toBe(true);
    const choosing = await updateWhere(players[0]!, (room) => room.game?.stage === "chancellor");
    expect(choosing.game!.players[0]!.hand).toEqual(["guard", "princess", "baron"]);
    // 别人看不到他抽到了什么，只知道他手里现在 3 张
    const other = await updateWhere(players[1]!, (room) => room.game?.stage === "chancellor");
    expect(other.game!.players[0]!.hand).toEqual([]);
    expect(other.game!.players[0]!.handCount).toBe(3);
    expect((await command(players[0]!, { type: "CHANCELLOR", keep: "princess", bottom: ["guard", "baron"] })).ok).toBe(true);
    expect(hooks.fullGame(code)!.deck!.slice(-2)).toEqual(["guard", "baron"]);
    // 不合法的命令拿到中文错误
    await stage(code, players, { hands: [["countess", "king"]] });
    const refused = await command(players[0]!, { type: "PLAY", card: "king", target: "p2" });
    expect(refused).toEqual({ ok: false, error: "手里有女伯爵，又有国王或王子时，必须打出女伯爵。" });
    expect((await command(players[1]!, { type: "PLAY", card: "countess" })).ok).toBe(false);
    for (const client of players) expect(auditReceived(client, seat(client))).toEqual([]);
  });

  it("一小局结束：结算公开亮牌和移出的牌；在线真人都点了「下一局」就开下一局，由赢家先手", async () => {
    const { code, players } = await startRoom(3);
    await stage(code, players, { hands: [["handmaid", "king"], ["priest"], ["guard"]], deck: [], setAside: "princess", leftovers: "discards" });
    expect((await command(players[0]!, { type: "PLAY", card: "handmaid" })).ok).toBe(true);
    const ended = await updateWhere(players[2]!, (room) => room.game?.phase === "roundEnd");
    expect(ended.game!.lastRound).toMatchObject({ reason: "showdown", winners: ["p1"], hands: { p1: "king", p2: "priest", p3: "guard" }, setAside: "princess" });
    expect(ended.turnRemainingMs).toBeGreaterThan(0);
    expect((await command(players[0]!, { type: "READY" })).ok).toBe(true);
    expect((await command(players[1]!, { type: "READY" })).ok).toBe(true);
    expect(latest.get(players[0]!)!.game!.phase).toBe("roundEnd");
    expect((await command(players[2]!, { type: "READY" })).ok).toBe(true);
    const next = await updateWhere(players[0]!, (room) => room.game?.phase === "playing" && room.game.round === 2);
    expect(actorOf(next.game!)).toBe("p1");
    expect(next.game!.history[0]).toMatchObject({ type: "RoundStarted", round: 2, starter: "p1" });
  });

  it("结算画面：离线的人不用等，在线的人点完就开；到点没点也会自动开（不算超时）", async () => {
    const { code, players } = await startRoom(3);
    await stage(code, players, { hands: [["handmaid", "king"], ["priest"], ["guard"]], deck: [], setAside: "princess", leftovers: "discards" });
    players[2]!.disconnect();
    await updateWhere(players[0]!, (room) => room.members.some((member) => !member.connected));
    expect((await command(players[0]!, { type: "PLAY", card: "handmaid" })).ok).toBe(true);
    expect((await command(players[0]!, { type: "READY" })).ok).toBe(true);
    expect((await command(players[1]!, { type: "READY" })).ok).toBe(true);
    await updateWhere(players[0]!, (room) => room.game?.round === 2);
    // 没人点：TURN_MS 后自动开下一局，不记超时
    await stage(code, players.slice(0, 2), { round: 5, hands: [["handmaid", "king"], ["priest"], ["guard"]], deck: [], setAside: "princess", leftovers: "discards" });
    expect((await command(players[0]!, { type: "PLAY", card: "handmaid" })).ok).toBe(true);
    const auto = await updateWhere(players[0]!, (room) => room.game?.phase === "playing" && room.game.round === 6);
    expect(auto.members.every((member) => !member.auto)).toBe(true);
  });

  it("超时：系统替他走完整个回合（不打公主），只记一次 TurnTimedOut；大臣留牌时超时只替他留牌", async () => {
    const { code, players } = await startRoom(2);
    await stage(code, players, { players: 2, hands: [["princess", "guard"], ["baron"]] });
    const timedOut = await updateWhere(players[1]!, (room) => room.game?.events[0]?.type === "TurnTimedOut");
    expect(timedOut.game!.events[0]).toEqual({ type: "TurnTimedOut", player: "p1", stage: "play" });
    expect(timedOut.game!.events.find((event) => event.type === "Played")).toMatchObject({ card: "guard", target: "p2" });
    expect(timedOut.game!.events.filter((event) => event.type === "TurnTimedOut")).toHaveLength(1);
    expect(hooks.fullGame(code)!.players[0]!.out).toBe(false);
    expect(timedOut.members.find((member) => member.playerId === "p1")?.auto).toBeUndefined();

    // 打出大臣后留牌超时：只替他留牌（留最大的）
    await stage(code, players, { players: 2, hands: [["chancellor", "guard"], ["baron"]], deck: ["countess", "spy", "guard", "guard"] });
    expect((await command(players[0]!, { type: "PLAY", card: "chancellor" })).ok).toBe(true);
    const kept = await updateWhere(players[1]!, (room) => room.game?.events[0]?.type === "TurnTimedOut");
    expect(kept.game!.events[0]).toEqual({ type: "TurnTimedOut", player: "p1", stage: "chancellor" });
    expect(hooks.fullGame(code)!.players[0]!.hand).toEqual(["countess"]);
  });

  it("连续两次超时进托管；托管中由人机代打、没有倒计时；自己动一下就取消", async () => {
    const { code, players } = await startRoom(2);
    const stop = autoplay(players[1]!);
    await stage(code, players, { players: 2, hands: [["guard", "priest"], ["baron"]], deck: ["handmaid", "guard", "priest", "spy", "baron", "king"] });
    const auto = await updateWhere(players[0]!, (room) => room.members.find((member) => member.playerId === "p1")?.auto === true);
    expect(auto.members.find((member) => member.playerId === "p1")?.auto).toBe(true);
    const myTurn = await updateWhere(players[0]!, (room) => room.game !== undefined && actorOf(room.game) === "p1" && room.game.phase === "playing");
    expect(myTurn.turnRemainingMs).toBeUndefined();
    expect((await call<void>((ack) => players[0]!.emit("room:auto", false, ack))).ok).toBe(true);
    await updateWhere(players[0]!, (room) => room.members.find((member) => member.playerId === "p1")?.auto !== true);
    stop();
  });

  it("掉线后用原昵称回到座位，手牌和打出区原样交还", async () => {
    const { code, players } = await startRoom(3);
    const name = latest.get(players[1]!)!.members.find((member) => member.id === players[1]!.id)!.name;
    await stage(code, players, { current: 0, hands: [["handmaid", "guard"], ["king"], ["baron"]] });
    players[1]!.disconnect();
    await updateWhere(players[0]!, (room) => room.members.find((member) => member.playerId === "p2")?.connected === false);
    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name, code }, ack));
    if (!rejoined.ok) throw new Error(rejoined.error);
    expect(rejoined.data.members.find((member) => member.id === back.id)).toMatchObject({ playerId: "p2", connected: true });
    // 离线期间轮到他时人机替他打过，手牌以服务器上的为准
    expect(rejoined.data.game!.players[1]!.hand).toEqual(hooks.fullGame(code)!.players[1]!.hand);
    expect(rejoined.data.game!.players[1]!.hand.length).toBeGreaterThan(0);
    // 原昵称在线时别人冒用不了
    const impostor = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => impostor.emit("room:join", { name, code }, ack))).ok).toBe(false);
  });

  it("整场打完 → 再来一局；全程每个连接（含观战、人机房）收到的状态都没有不该看的东西", async () => {
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 4 } as never, ack));
    if (!created.ok) throw new Error(created.error);
    const { code } = created.data;
    const guest = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("玩家"), code }, ack))).ok).toBe(true);
    const third = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => third.emit("room:join", { name: nick("玩家"), code }, ack))).ok).toBe(true);
    expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
    const watcher = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => watcher.emit("room:join", { name: nick("看客"), code, spectate: true }, ack))).ok).toBe(true);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    const stops = [host, guest, third].map((client) => autoplay(client));
    // 打到一半让观战打开「看手牌」
    await updateWhere(watcher, (room) => (room.game?.round ?? 0) >= 2, 60_000);
    expect((await call<void>((ack) => host.emit("room:access", { spectatorsSeeAll: true }, ack))).ok).toBe(true);
    const finished = await updateWhere(host, (room) => room.game?.phase === "finished", 90_000);
    stops.forEach((stop) => stop());
    const champions = finished.game!.winners!;
    expect(champions.length).toBeGreaterThan(0);
    for (const player of finished.game!.players) {
      expect(champions.includes(player.id)).toBe(player.tokens >= finished.game!.config.tokensToWin);
    }
    const summary = await call<unknown[]>((ack) => watcher.emit("lobby:get", ack as never));
    expect(summary.ok).toBe(true);

    for (const client of [host, guest, third]) {
      expect(auditReceived(client, "")).toEqual([]);
      expect(received.get(client)!.length).toBeGreaterThan(20);
    }
    expect(auditReceived(watcher, "")).toEqual([]);
    // 观战一开始只看公开信息，打开「看手牌」后能看到所有人的手牌
    const watched = received.get(watcher)!.filter((room) => room.game?.phase === "playing");
    expect(watched.some((room) => !room.access.spectatorsSeeAll && room.game!.players.every((player) => player.hand.length === 0))).toBe(true);
    expect(watched.some((room) => room.access.spectatorsSeeAll && room.game!.players.some((player) => player.hand.length > 0))).toBe(true);

    for (const client of [host, guest, third]) expect((await call<void>((ack) => client.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(host, (room) => room.game?.phase === "playing" && !room.rematch);
    expect(again.game!.round).toBe(1);
    expect(again.game!.players.every((player) => player.tokens === 0)).toBe(true);
  }, 120_000);
});
