// 本地测试用的陪玩脚本（先 npm run dev，或者在服务器上连 localhost:3017）。
//   node scripts/test-bot.mjs host [人数] [脚本玩家数]  → 脚本建房、拉够脚本玩家，等真人加入凑满后自动开局
//                                                       （脚本玩家数 = 人数时自己打完一整场）
//   node scripts/test-bot.mjs join <房间码> [昵称]       → 以一个脚本玩家的身份加入别人的房间
// 轮到自己时：不打公主（除非只能打它），其余从合法行动里随机挑；结算画面点「下一局」。
// 环境变量：BOT_DELAY_MS 每步思考时间（默认 1200）；BOT_IDLE=1 只挂着不动（等超时）；
// SERVER_URL 服务器地址（默认 http://localhost:3017）；SOCKET_PATH 默认 /socket.io；REMATCH=1 打完再来一局（第二场打完退出）。
import { io } from "socket.io-client";
import { legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3017";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1200);
const IDLE = process.env.BOT_IDLE === "1";
const REMATCH = process.env.REMATCH === "1";
const NAMES = ["信使阿甲", "信使阿乙", "信使阿丙", "信使阿丁", "信使阿戊", "信使阿己"];

function choose(actions) {
  const safe = actions.filter((command) => !(command.type === "PLAY" && command.card === "princess"));
  const pool = safe.length > 0 ? safe : actions;
  return pool[Math.floor(Math.random() * pool.length)];
}

const nameOf = (game, id) => game.players.find((player) => player.id === id)?.name ?? id;
const tokens = (game) => game.players.map((player) => `${player.name}:${player.tokens}`).join(" ");

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  let latest = null;
  let games = 0;
  let announced = false;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  // 回执和新状态的广播可能在同一批消息里到达：每做完一步都回头看最新状态，免得漏掉轮到自己。
  async function tick() {
    const room = latest;
    const game = room?.game;
    if (!game || game.phase === "finished" || IDLE || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    if (!seat || legalActions(game, seat).length === 0) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, game.phase === "roundEnd" ? DELAY * 2 : DELAY));
    try {
      // 等的时候状态可能变了（超时、别人动了）：重新读最新状态再决定
      const fresh = latest?.game;
      const actions = fresh ? legalActions(fresh, seat) : [];
      if (actions.length > 0) {
        const result = await emit("game:command", choose(actions));
        if (!result.ok) console.log(name, "行动失败", result.error);
      }
    } finally {
      acting = false;
    }
    if (latest !== room) void tick();
  }
  socket.on("room:updated", (room) => {
    const before = latest?.game;
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game && game.phase !== "playing" && before?.phase === "playing" && game.lastRound) {
      const result = game.lastRound;
      console.log(
        name,
        `第 ${result.round} 小局（${result.reason === "showdown" ? "亮牌" : "只剩一人"}）：${result.winners.map((id) => nameOf(game, id)).join("、")} 赢`
          + `${result.spyBonus ? `，${nameOf(game, result.spyBonus)} 间谍 +1` : ""}；标记 ${tokens(game)}`,
      );
    }
    if (game?.phase === "finished") {
      if (!announced) {
        announced = true;
        games += 1;
        console.log(name, `整场结束，赢家 ${(game.winners ?? []).map((id) => nameOf(game, id)).join("、")}；标记 ${tokens(game)}`);
        if (REMATCH && games === 1) void emit("room:rematch", true);
        else setTimeout(() => process.exit(0), 300);
      }
      return;
    }
    announced = false;
    void tick();
  });
  socket.on("room:closed", ({ reason }) => {
    console.log(name, "房间关闭：", reason);
    process.exit(0);
  });
  socket.on("connect_error", (error) => {
    console.log(name, "连不上服务器：", error.message);
    process.exit(1);
  });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const name = arg2 ?? NAMES[1];
  const { socket, emit } = bot(name);
  socket.on("connect", async () => {
    const result = await emit("room:join", { name, code: arg1 });
    console.log("加入", result.ok ? "成功" : result.error);
    if (!result.ok) process.exit(1);
  });
} else {
  const capacity = Number(arg1 ?? 3);
  const bots = Number(arg2 ?? capacity - 1);
  let started = false;
  const host = bot(NAMES[0], async (room) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok ? "成功" : result.error);
    }
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity });
    if (!created.ok) {
      console.log(created.error);
      process.exit(1);
    }
    console.log("房间码", created.data.code);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
