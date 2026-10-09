// 抓包脚本：连上真实服务器（先 npm run dev），查服务器发给别人的数据里有没有不该有的东西。
//   node scripts/spy.mjs [人数=3] [场数=1]
// 两个 socket 当玩家 A、B（其余座位加人机），再开一个 socket 观战（不开「看手牌」）。A、B 随机打，打完整场。
// 记下 A、B、观战收到的每一条 room:updated（原始 JSON），逐条检查 B 和观战的：
//   - 没有牌堆 deck、面朝下移出的 setAside、种子 seed、随机数状态 rngState、动作序列 actions；
//   - 别人的手牌是空数组（只给张数）；观战谁的手牌都看不到；
//   - 事件里的私密内容只给有权看的人（抽到的牌、牧师看到的牌、男爵/国王的牌面、大臣抽的牌和放回牌堆底的牌）；
//   - 拿 A 自己收到的同一版本数据对照：B 那份里 A 的手牌是空的、张数对得上，A 抽到的牌不在 B 的事件里。
// 有问题时打印出来并以退出码 1 结束。SERVER_URL 换服务器地址（默认 http://localhost:3017）。
import { io } from "socket.io-client";
import { legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3017";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const CAPACITY = Number(process.argv[2] ?? 3);
const GAMES = Number(process.argv[3] ?? 1);
const SERVER_ONLY = ["deck", "setAside", "seed", "rngState", "actions"];
const PRIVATE = {
  Drew: ["card"],
  Peeked: ["card"],
  ChancellorDrew: ["cards"],
  ChancellorReturned: ["cards"],
  Compared: ["playerCard", "targetCard"],
  Swapped: ["playerGot", "targetGot"],
};
const tag = Date.now().toString(36).slice(-4);
const problems = [];

function connect(label) {
  const socket = io(URL, { path: PATH, transports: ["websocket"], reconnection: false });
  const frames = [];
  socket.on("room:updated", (room) => frames.push(JSON.stringify(room)));
  socket.on("connect_error", (error) => {
    console.log(label, "连不上服务器：", error.message);
    process.exit(1);
  });
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  return { label, socket, frames, emit };
}

/** 轮到自己就从合法行动里随机挑一个（结算画面点下一局）。 */
function autoplay(client) {
  let last = "";
  client.socket.on("room:updated", (room) => {
    const game = room.game;
    if (!game || game.phase === "finished") return;
    const seat = room.members.find((member) => member.id === client.socket.id)?.playerId;
    const actions = seat ? legalActions(game, seat) : [];
    if (actions.length === 0 || last === `${game.version}`) return;
    last = `${game.version}`;
    setTimeout(() => client.socket.emit("game:command", actions[Math.floor(Math.random() * actions.length)], () => {}), 20);
  });
}

function eventLeak(event, viewer) {
  for (const field of PRIVATE[event.type] ?? []) {
    if (!(field in event)) continue;
    const allowed = event.type === "ChancellorReturned"
      ? event.player === viewer
      : event.type === "Compared" || event.type === "Swapped"
        ? event.player === viewer || event.target === viewer
        : event.player === viewer;
    if (!allowed) return `${event.type}.${field}`;
  }
  return null;
}

/** 查一条原始数据。viewer 是座位 id；观战传 ""。 */
function audit(label, raw, viewer) {
  const game = JSON.parse(raw).game;
  if (!game) return;
  for (const key of SERVER_ONLY) if (key in game) problems.push(`${label} v${game.version}：收到了 ${key}`);
  for (const player of game.players) {
    if (player.id !== viewer && player.hand.length > 0) problems.push(`${label} v${game.version}：看到了 ${player.id} 的手牌`);
  }
  for (const event of [...game.history, ...game.events]) {
    const leak = eventLeak(event, viewer);
    if (leak) problems.push(`${label} v${game.version}：${leak} 发给了 ${viewer || "观战"}`);
  }
}

function seatIn(frames, socketId) {
  for (const raw of frames) {
    const member = JSON.parse(raw).members.find((candidate) => candidate.id === socketId);
    if (member) return member.playerId;
  }
  return "";
}

/** 每条数据配上「第几场 + version」：再来一局后 version 从头数，按 version 变小来分场。 */
function keyed(frames) {
  let gameIndex = 0;
  let lastVersion = -1;
  return frames.map((raw) => {
    const game = JSON.parse(raw).game;
    if (game && game.version < lastVersion) gameIndex += 1;
    if (game) lastVersion = game.version;
    return { raw, game, key: game ? `${gameIndex}:${game.version}` : "" };
  });
}

function report(a, b, watcher) {
  const aSeat = seatIn(a.frames, a.socket.id);
  const bSeat = seatIn(b.frames, b.socket.id);
  const aHands = new Map();
  for (const { game, key } of keyed(a.frames)) {
    if (game) aHands.set(key, game.players.find((player) => player.id === aSeat)?.hand ?? []);
  }
  let compared = 0;
  for (const { raw, game, key } of keyed(b.frames)) {
    audit("B", raw, bSeat);
    if (!game || !aHands.has(key)) continue;
    compared += 1;
    const aView = game.players.find((player) => player.id === aSeat);
    if (aView.hand.length > 0) problems.push(`B v${game.version}：A 的手牌发给了 B`);
    if (aView.handCount !== aHands.get(key).length) problems.push(`B v${game.version}：A 的手牌张数对不上`);
    for (const event of [...game.history, ...game.events]) {
      if (event.type === "Drew" && event.player === aSeat && "card" in event) problems.push(`B v${game.version}：A 抽到的牌发给了 B`);
    }
  }
  for (const raw of watcher.frames) audit("观战", raw, "");
  const rounds = new Set(b.frames.map((raw) => JSON.parse(raw).game?.round).filter(Boolean)).size;
  console.log(`抓包：${CAPACITY} 人房（A、B + ${CAPACITY - 2} 个人机）打了 ${GAMES} 场、${rounds} 个小局；B 收到 ${b.frames.length} 条、观战收到 ${watcher.frames.length} 条 room:updated，其中 ${compared} 条和 A 同一版本的数据对照过。`);
  if (problems.length > 0) {
    console.log(`发现 ${problems.length} 个问题：`);
    for (const problem of problems.slice(0, 30)) console.log(" -", problem);
    process.exit(1);
  }
  console.log("没发现泄露：没有牌堆、移出的牌、种子、随机数状态、动作序列，没有别人的手牌，私密事件只发给了有权看的人。");
  process.exit(0);
}

async function main() {
  const a = connect("A");
  const b = connect("B");
  const watcher = connect("观战");
  await Promise.all([a, b, watcher].map((client) => new Promise((resolve) => client.socket.once("connect", resolve))));
  const created = await a.emit("room:create", { name: `间谍甲${tag}`, capacity: CAPACITY });
  if (!created.ok) throw new Error(created.error);
  const code = created.data.code;
  const joined = await b.emit("room:join", { name: `间谍乙${tag}`, code });
  if (!joined.ok) throw new Error(joined.error);
  for (let seat = 2; seat < CAPACITY; seat += 1) {
    const added = await a.emit("room:add-bot");
    if (!added.ok) throw new Error(added.error);
  }
  const watching = await watcher.emit("room:join", { name: `看客${tag}`, code, spectate: true });
  if (!watching.ok) throw new Error(watching.error);
  autoplay(a);
  autoplay(b);
  let finished = 0;
  const done = new Promise((resolve) => {
    let lastFinished = -1;
    a.socket.on("room:updated", (room) => {
      const game = room.game;
      if (game?.phase !== "finished" || game.version === lastFinished) return;
      lastFinished = game.version;
      finished += 1;
      if (finished >= GAMES) {
        resolve();
        return;
      }
      void a.emit("room:rematch", true);
      void b.emit("room:rematch", true);
    });
  });
  const started = await a.emit("room:start");
  if (!started.ok) throw new Error(started.error);
  const timer = setTimeout(() => {
    problems.push("10 分钟内没打完");
    report(a, b, watcher);
  }, 10 * 60_000);
  await done;
  clearTimeout(timer);
  await new Promise((resolve) => setTimeout(resolve, 300));
  report(a, b, watcher);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
