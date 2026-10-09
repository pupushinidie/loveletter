/**
 * 预览页（提交进仓库，界面维护；教程、验收可以往里加场景，不要删别人的）。
 * 不连服务器：用规则包的预览局面工厂造局面，渲染真正的 GameBoard / 首页 / 等候房间。在牌桌上点的命令直接在浏览器里跑引擎。
 *
 * 参数（都可以不写）：
 *   ?s=<场景>     牌桌场景用规则包 SCENES 里的名字（opening、my-turn-guard、six-player……），另外有：
 *                 crowded（打出区很长的局面，配 n=2 / n=6）、home（首页）、home-rooms（首页带在线牌桌）、
 *                 waiting-1 / waiting-full / waiting-bots / waiting-guest / waiting-2p（等候房间）
 *   &n=<人数>      2–6，默认 3（固定人数的场景忽略）
 *   &v=<座位>      从哪个座位看，默认 p1
 *   &bots=p2,p3   人机座位    &auto=p1  托管中    &offline=p3  离线
 *   &spec=1       观战（&all=1 观战能看手牌）
 *   &t=<毫秒>      倒计时剩余；t=none 不显示
 *   &chat=1       带几条聊天
 *   &live=1       别人的回合由人机自动走（每步 900ms），可以一直玩下去
 *   &seed=<数>     补牌种子
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import ReactDOM from "react-dom/client";
import {
  applyCommand,
  botCommand,
  createScene,
  previewRoom,
  previewSocketId,
  redactGameForViewer,
  scene,
  SCENES,
  scenePlayers,
  type Capacity,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomChatMessage,
  type SceneName,
} from "@loveletter/game";
import { HomeScreen, RoomScreen } from "./App.js";
import GameBoard from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./ll.css";
import "./theme-day.css";

applyTheme(readTheme());

const params = new URLSearchParams(location.search);
const sceneName = params.get("s") ?? "opening";
const players = Math.min(6, Math.max(2, Number(params.get("n") ?? 3)));
const viewer = params.get("v") ?? (sceneName === "waiting-guest" ? "p2" : "p1");
const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
const spectator = params.get("spec") === "1";
const seeAll = params.get("all") === "1";
const seed = Number(params.get("seed") ?? 7);
const live = params.get("live") === "1";
const timeParam = params.get("t");
const turnRemainingMs = timeParam === "none" ? null : timeParam ? Number(timeParam) : undefined;

Object.defineProperty(socket, "id", { get: () => (spectator ? "preview-spectator" : previewSocketId(viewer)), configurable: true });
// 预览页不连服务器：发出去的房间操作直接回一个失败，界面上看得到提示。
socket.emit = ((event: string, ...args: unknown[]) => {
  const ack = args[args.length - 1];
  if (typeof ack === "function") (ack as (response: unknown) => void)({ ok: false, error: `预览页不连服务器（${event}）` });
  return socket;
}) as typeof socket.emit;

const CHAT: RoomChatMessage[] = [
  { id: "c1", senderId: previewSocketId("p2"), name: "阿青", message: "这把我先手～", createdAt: "2026-10-09T20:01:00.000Z" },
  { id: "c2", senderId: previewSocketId("p1"), name: "小明", message: "卫兵别猜我公主啊", createdAt: "2026-10-09T20:01:30.000Z" },
  { id: "c3", senderId: "preview-spectator", name: "看客", message: "加油", createdAt: "2026-10-09T20:02:00.000Z", spectator: true },
];

/** 打出区很长的局面：牌堆只剩 1 张，没写到的牌都分进打出区。 */
function crowded(count: number): GameState {
  return createScene({ players: count, seed, hands: [["guard", "baron"]], deck: ["handmaid"], leftovers: "discards", tokens: Array.from({ length: count }, (_, index) => index % 3) });
}

function buildGame(): GameState {
  if (sceneName === "crowded") return crowded(players);
  if ((SCENES as readonly string[]).includes(sceneName)) return scene(sceneName as SceneName, { players, seed });
  return scene("opening", { players, seed });
}

function roomOptions() {
  return {
    viewer,
    bots: list("bots"),
    auto: list("auto"),
    offline: list("offline"),
    ...(spectator ? { spectator: { name: "看客", seeAllHands: seeAll } } : {}),
    ...(turnRemainingMs !== undefined ? { turnRemainingMs } : {}),
  };
}

function withChat(room: LobbyRoomSnapshot): LobbyRoomSnapshot {
  return params.get("chat") === "1" ? { ...room, chat: CHAT } : room;
}

/* ---------- 牌桌 ---------- */

function BoardPreview() {
  const [theme, toggleTheme] = useTheme();
  const [full, setFull] = useState<GameState>(buildGame);
  const [error, setError] = useState("");
  const [autoIds, setAutoIds] = useState(list("auto"));
  const room = useMemo(() => withChat({ ...previewRoom(full, { ...roomOptions(), auto: autoIds }) }), [full, autoIds]);
  const voice = useVoice(room);
  const [watchId, setWatchId] = useState(full.players[0]!.id);

  function command(cmd: GameCommand, as = viewer) {
    try {
      setFull((state) => applyCommand(state, as, cmd));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  // 别人的回合（live=1）：人机按自己能看到的信息走
  useEffect(() => {
    if (!live) return;
    if (full.phase === "finished") return;
    const actor = full.phase === "playing" ? full.players[full.current]!.id : full.players.find((player) => !full.ready.includes(player.id) && player.id !== viewer)?.id;
    if (!actor || (actor === viewer && !autoIds.includes(viewer))) return;
    const timer = window.setTimeout(() => {
      const view = redactGameForViewer(full, actor);
      const cmd = full.phase === "roundEnd" ? ({ type: "READY" } as const) : botCommand(view, actor);
      if (cmd) command(cmd, actor);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [full, autoIds]);

  return (
    <main className="app-shell ll-game">
      <GameBoard
        room={room}
        busy={false}
        error={error}
        notice=""
        brand={<a className="brand" href="#"><span className="brand-name">情书<span> 预览</span></span></a>}
        connection={<div className="connection-status online"><span className="connection-dot" />预览</div>}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={(cmd) => command(cmd)}
        onRematch={() => setFull(buildGame())}
        onAuto={(enabled) => setAutoIds((ids) => (enabled ? [...ids, viewer] : ids.filter((id) => id !== viewer)))}
        onDissolve={() => setError("预览页：解散只在真房间里有效")}
        watchId={watchId}
        onWatch={setWatchId}
        onLeave={() => setError("预览页：离开观战只在真房间里有效")}
      />
    </main>
  );
}

/* ---------- 首页 ---------- */

const LOBBY: PublicRoomSummary[] = [
  {
    id: "r1", status: "playing", capacity: 4, open: false, allowSpectators: true, spectators: 1,
    players: [
      { name: "阿青", isHost: true, connected: true, score: 2, isActive: true },
      { name: "老胡", isHost: false, connected: true, score: 1 },
      { name: "咕噜一号", isHost: false, connected: true, bot: true, score: 0 },
      { name: "花花", isHost: false, connected: false, score: 1 },
    ],
  },
  {
    id: "r2", status: "waiting", capacity: 5, open: true, allowSpectators: true, spectators: 0,
    players: [{ name: "大熊", isHost: true, connected: true }, { name: "七七", isHost: false, connected: true }],
  },
];

function HomePreview() {
  const [theme, toggleTheme] = useTheme();
  const [name, setName] = useState("小明");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [code, setCode] = useState("");
  return (
    <HomeScreen
      theme={theme}
      themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
      connected
      mode={mode}
      onMode={setMode}
      name={name}
      onName={setName}
      capacity={capacity}
      onCapacity={setCapacity}
      roomCode={code}
      onRoomCode={(value) => setCode(value.toUpperCase().slice(0, 6))}
      canSubmit={name.trim().length >= 2}
      busy={false}
      error=""
      notice=""
      onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
      lobbyRooms={sceneName === "home-rooms" ? LOBBY : []}
      onJoinListed={() => undefined}
    />
  );
}

/* ---------- 等候房间 ---------- */

function waitingRoom(): LobbyRoomSnapshot {
  const kind = sceneName.slice("waiting-".length);
  const capacity = (kind === "2p" ? 2 : kind === "full" ? 6 : Math.max(3, players)) as Capacity;
  const seats = kind === "1" ? 1 : kind === "full" ? 6 : kind === "bots" ? 3 : kind === "2p" ? 2 : 2;
  const names = scenePlayers(6);
  const members: LobbyMember[] = Array.from({ length: seats }, (_, index) => ({
    id: previewSocketId(names[index]!.id),
    playerId: names[index]!.id,
    name: kind === "bots" && index > 0 ? `咕噜${["一", "二"][index - 1]}号` : names[index]!.name,
    isHost: index === 0,
    connected: !(kind === "full" && index === 4),
    ...(kind === "bots" && index > 0 ? { bot: true } : {}),
  }));
  const base = previewRoom(undefined);
  return withChat({ ...base, capacity, members, status: "waiting", spectators: kind === "full" ? [{ id: "preview-spectator", name: "看客" }] : [] });
}

function RoomPreview() {
  const [theme, toggleTheme] = useTheme();
  const room = useMemo(waitingRoom, []);
  const voice = useVoice(room);
  return (
    <RoomScreen
      room={room}
      busy={false}
      error=""
      notice=""
      connected
      themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
      chat={<RoomChat room={room} voice={voice} />}
      onCopyCode={() => undefined}
      onLeave={() => undefined}
      onStart={() => undefined}
      onKick={() => undefined}
      onAddBot={() => undefined}
      onDissolve={() => undefined}
    />
  );
}

function Preview() {
  if (sceneName.startsWith("home")) return <HomePreview />;
  if (sceneName.startsWith("waiting")) return <RoomPreview />;
  return <BoardPreview />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
