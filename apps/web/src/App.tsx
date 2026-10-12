import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { CAPACITY_OPTIONS, ROLE_COUNT, ROLE_NAME, ROLES, type Capacity, type GameCommand, type LobbyRoomSnapshot, type PublicRoomSummary } from "@loveletter/game";
import { art, seatHex } from "./art.js";
import { Card, Mini, RoleTip } from "./Cards.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import OnlineRooms from "./OnlineRooms.js";
import RoomChat from "./RoomChat.js";
import { roomRole, RoomSettingsPanel, SeatSwitch } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { forgetSeat, readName, readSeat, rememberName, rememberSeat, retryable } from "./seat.js";
import { ThemeToggle, useTheme, type Theme } from "./theme.js";
import { type BgmTrack, SoundToggle, sfx, useBgm, useRoomSfx } from "./gm-sound.js";
import { GAME_ID } from "./tutorial/hints.js";
import { TutorialInvite } from "./tutorial/Invite.js";
import { readTutorial } from "./tutorial/storage.js";
import TutorialMode from "./tutorial/TutorialMode.js";
import { useVoice } from "./voice.js";

type EntryMode = "create" | "join";

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

// 背景音乐：进了房间（等候房间、对局、观战）和新手教程里放，首页和房间列表不放。gain / start / end 按这首曲子量（见 gm-sound.tsx）。
const BGM: BgmTrack = { src: `${import.meta.env.BASE_URL}bgm/loveletter.mp3`, gain: 0.84, start: 0.45, end: 136.5 };

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState(readName);
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [confirmAction, confirmDialog] = useConfirm();
  // 白天 / 夜间画面：首页、等候房间、牌桌共用，顶栏按钮随时切换；和游戏中心、其他游戏共用同一个选择。
  const [theme, toggleTheme] = useTheme();
  const themeToggle = <><ThemeToggle theme={theme} onToggle={toggleTheme} /><SoundToggle /></>;
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  // 观战时从谁的座位看（默认第一位玩家）。
  const [watchId, setWatchId] = useState("");
  const voice = useVoice(room);
  // 新手教程：首页或等候房间点进来（地址带 ?tutorial 时直接打开，游戏中心可以直接链过来）
  const [tutorialOpen, setTutorialOpen] = useState(() => new URLSearchParams(window.location.search).has("tutorial"));
  // 声音：进了房间（等候房间、对局、观战）和新手教程里顶栏有 ♪ 面板（音效、语音音量）；这款还没有背景音乐。
  useBgm(room || tutorialOpen ? BGM : null);
  // 房间里的提示音：有人进出、开局、收到聊天（对局里的动作音效在 game-sfx.ts，牌桌自己接）
  const lastChat = room?.chat[room.chat.length - 1];
  useRoomSfx(room ? { members: room.members.length + room.spectators.length, playing: room.status === "playing", chatCount: room.chat.length, lastChatMine: lastChat?.senderId === socket.id } : null);

  function closeTutorial() {
    setTutorialOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has("tutorial")) {
      params.delete("tutorial");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }

  // 在等候房间里看教程时，房主一开局就回到牌桌（不然这一步会超时、转成托管）
  useEffect(() => {
    if (tutorialOpen && room?.status === "playing") {
      closeTutorial();
      setNotice("对局开始了，教程先停在这里。");
    }
  }, [tutorialOpen, room?.status]);

  // 在房间里时服务端不推送在线牌桌列表；回到首页时主动拉一次最新的。
  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  // 对局里的出错提示（比如「还没轮到你。」）走一步就清掉，最多挂 6 秒（I25）
  const gameVersion = room?.game?.version;
  useEffect(() => { if (gameVersion !== undefined) setError(""); }, [gameVersion]);
  useEffect(() => {
    if (!error || !room?.game) return;
    const timer = window.setTimeout(() => setError(""), 6000);
    return () => window.clearTimeout(timer);
  }, [error, room?.game !== undefined]);

  // ---------- 断线 / 刷新后回到座位（I18、I19，见 seat.ts） ----------
  const roomRef = useRef<LobbyRoomSnapshot | null>(null);
  roomRef.current = room;
  const [rejoining, setRejoining] = useState(false);
  const rejoinTimer = useRef<number | undefined>(undefined);
  // 坐着的玩家（不是观战）进了房间就记住昵称和房间码
  useEffect(() => {
    const me = room?.members.find((member) => member.id === socket.id);
    if (room && me && room.code) rememberSeat({ name: me.name, code: room.code });
  }, [room]);
  function rejoinSeat(tries = 0) {
    window.clearTimeout(rejoinTimer.current);
    const seat = readSeat();
    if (!seat || !socket.connected) {
      setRejoining(false);
      return;
    }
    setRejoining(true);
    socket.emit("room:join", { name: seat.name, code: seat.code }, (response) => {
      if (response.ok) {
        setRejoining(false);
        setRoom(response.data);
        setError("");
        setNotice(response.data.status === "playing" ? "已回到对局。" : "已回到房间。");
        return;
      }
      if (retryable(response.error) && tries < 45) {
        rejoinTimer.current = window.setTimeout(() => rejoinSeat(tries + 1), 2000);
        return;
      }
      setRejoining(false);
      forgetSeat();
      setRoom(null);
      setNotice("");
      setError(`没能回到刚才的房间：${response.error}`);
    });
  }

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
      // 刚打开（刷新）页面、或者断线重连：之前坐在某个房间里，就自动回去
      const current = roomRef.current;
      if (readSeat() && (!current || !current.members.some((member) => member.id === socket.id))) rejoinSeat();
    };
    const handleDisconnect = () => setConnected(false);
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom(snapshot);
    const handleRoomError = (message: string) => {
      sfx.error();
      setError(message);
    };
    const handleLobbyUpdate = (rooms: PublicRoomSummary[]) => setLobbyRooms(rooms);
    const handleRoomClosed = ({ reason }: { reason: string }) => {
      forgetSeat();
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("lobby:updated", handleLobbyUpdate);
    socket.on("room:closed", handleRoomClosed);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("lobby:updated", handleLobbyUpdate);
      socket.off("room:closed", handleRoomClosed);
      window.clearTimeout(rejoinTimer.current);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  /** 从首页列表加入空座位或进去观战（用上面填的昵称）。 */
  function joinListed(roomId: string, spectate: boolean) {
    const nickname = name.trim();
    if (nickname.length < 2 || nickname.length > 18) {
      setNotice("");
      setError("先在上面填好你的昵称（2–18 个字符）。");
      document.getElementById("player-name")?.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    socket.emit("room:join", { name: nickname, roomId, spectate }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(spectate ? "正在观战。" : "已加入房间。");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();
    rememberName(nickname);

    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(mode === "create"
        ? "房间已创建，可以邀请朋友加入。"
        : response.data.status === "playing" ? "已回到对局，继续游戏吧。" : "已加入房间。");
    };

    if (mode === "create") {
      socket.emit("room:create", { name: nickname, capacity }, complete);
    } else {
      socket.emit("room:join", { name: nickname, code: roomCode }, complete);
    }
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("");
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      forgetSeat();
      setRoom(null);
      setError("");
      setNotice("已离开房间。");
    });
  }

  function submitGameCommand(command: GameCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:command", command, (response) => {
      setBusy(false);
      if (!response.ok) {
        sfx.error();
        setError(response.error);
        return;
      }
      setRoom(response.data);
    });
  }

  /** 房间管理类操作：只关心成败，界面更新由服务端广播。 */
  function roomCommand(send: (ack: (response: { ok: true; data: void } | { ok: false; error: string }) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) {
        sfx.error();
        setError(response.error);
      }
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const addBot = () => roomCommand((ack) => socket.emit("room:add-bot", ack));
  const setAuto = (enabled: boolean) => roomCommand((ack) => socket.emit("room:auto", enabled, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  async function dissolveRoom() {
    const ok = await confirmAction({
      title: "解散房间？",
      detail: "所有玩家都会被移出，当前对局也会结束。",
      confirmLabel: "解散",
    });
    if (ok) roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。");
    } catch {
      setNotice("请手动复制房间码。");
    }
  }

  if (tutorialOpen && room?.status !== "playing") {
    return (
      <main data-gc-table className="app-shell ll-game tut-on">
        <TutorialMode name={name} brand={<Brand />} themeToggle={themeToggle} theme={theme} waitingRoom={room?.code} onExit={closeTutorial} />
      </main>
    );
  }

  const reconnectBanner = (rejoining || (room && !connected)) ? (
    <div className="ll-reconnect" role="status" aria-live="polite">
      <span className="spinner" />
      {!connected ? "连接断开了，正在重连…" : "正在回到你的座位…"}
    </div>
  ) : null;

  if (room?.status === "playing" && room.game) {
    const players = room.game.players;
    const watched = players.some((player) => player.id === watchId) ? watchId : players[0]!.id;
    return (
      <main data-gc-table className="app-shell ll-game">
        <GameBoard
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          themeToggle={themeToggle}
          theme={theme}
          chat={<RoomChat room={room} voice={voice} />}
          onCommand={submitGameCommand}
          onRematch={voteRematch}
          onAuto={setAuto}
          onDissolve={dissolveRoom}
          watchId={watched}
          onWatch={setWatchId}
          onLeave={leaveRoom}
        />
        {confirmDialog}
        {reconnectBanner}
      </main>
    );
  }

  if (room) {
    return (
      <RoomScreen
        room={room}
        busy={busy}
        error={error}
        notice={notice}
        connected={connected}
        themeToggle={themeToggle}
        chat={<RoomChat room={room} voice={voice} />}
        onCopyCode={copyRoomCode}
        onLeave={leaveRoom}
        onStart={startGame}
        onKick={kickMember}
        onAddBot={addBot}
        onDissolve={dissolveRoom}
        dialog={<>{confirmDialog}{reconnectBanner}</>}
        onTutorial={() => setTutorialOpen(true)}
      />
    );
  }

  return (
    <>
    {reconnectBanner}
    <HomeScreen
      theme={theme}
      themeToggle={themeToggle}
      connected={connected}
      mode={mode}
      onMode={(next) => { setMode(next); setError(""); }}
      name={name}
      onName={setName}
      capacity={capacity}
      onCapacity={setCapacity}
      roomCode={roomCode}
      onRoomCode={(value) => setRoomCode(normalizeRoomCode(value))}
      canSubmit={canSubmit}
      busy={busy}
      error={error}
      notice={notice}
      onSubmit={handleSubmit}
      lobbyRooms={lobbyRooms}
      onJoinListed={joinListed}
      onTutorial={() => setTutorialOpen(true)}
    />
    </>
  );
}

/* ---------- 首页 ---------- */

export interface HomeScreenProps {
  theme: Theme;
  themeToggle: ReactNode;
  connected: boolean;
  mode: EntryMode;
  onMode: (mode: EntryMode) => void;
  name: string;
  onName: (name: string) => void;
  capacity: Capacity;
  onCapacity: (capacity: Capacity) => void;
  roomCode: string;
  onRoomCode: (code: string) => void;
  canSubmit: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  lobbyRooms: PublicRoomSummary[];
  onJoinListed: (roomId: string, spectate: boolean) => void;
  /** 打开新手教程（预览页不传就不显示入口）。 */
  onTutorial?: () => void;
}

export function HomeScreen(props: HomeScreenProps) {
  const { mode, busy, error, notice } = props;
  return (
    <main className="app-shell ll-home">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <a className="center-link" href={CENTER_URL}>← 游戏中心</a>
          <GameRules />
          {props.themeToggle}
          <ConnectionStatus connected={props.connected} />
        </div>
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> 在线对战 · 2–6 人 · 空座可以加人机</div>
          <h1>情书</h1>
          <p className="welcome-description">
            整副只有 21 张牌，每人手里只拿一张。轮到你时抽一张、打一张：猜别人的牌、偷看、比大小、换牌……
            撑到最后，或者牌堆抽完时手里点数最大，就赢下这一小局。先攒够钟情标记的人赢得公主的心。
          </p>
          <ul className="ll-home-points">
            <li><b>抽</b>轮到你先抽一张，手里变成两张</li>
            <li><b>打</b>打出一张、照它做：猜、看、比、换、护</li>
            <li><b>撑</b>撑到最后或者点数最大，拿一枚钟情标记</li>
          </ul>
          {props.onTutorial && (
            <TutorialInvite
              record={readTutorial(GAME_ID)}
              title="第一次玩？3 分钟学会"
              text="咕噜嘎在真牌桌上带你打一小局，学完和人机练一场。"
              again="再看一遍新手教程"
              onOpen={props.onTutorial}
            />
          )}
          <Hero theme={props.theme} />
        </div>

        <div className="ll-home-side">
          <section className="entry-card" aria-labelledby="entry-title">
            <div className="entry-card-heading">
              <div>
                <span className="section-kicker">准备开始</span>
                <h2 id="entry-title">进入宴会厅</h2>
              </div>
              <span className="step-indicator">01 <i /> 02</span>
            </div>

            <div className="mode-switch" role="tablist" aria-label="选择房间操作">
              <button className={mode === "create" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "create"} onClick={() => props.onMode("create")}>
                创建房间
              </button>
              <button className={mode === "join" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "join"} onClick={() => props.onMode("join")}>
                加入房间
              </button>
            </div>

            <form className="entry-form" onSubmit={props.onSubmit}>
              <label className="field-label" htmlFor="player-name">你的昵称</label>
              <input
                id="player-name"
                className="text-input"
                value={props.name}
                onChange={(event) => props.onName(event.target.value)}
                placeholder="输入 2–18 个字符"
                minLength={2}
                maxLength={18}
                autoComplete="nickname"
                required
              />

              {mode === "create" ? (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数</label>
                  <div className="capacity-options capacity-many" id="room-capacity" role="group" aria-label="选择房间人数">
                    {CAPACITY_OPTIONS.map((seats) => (
                      <button
                        key={seats}
                        type="button"
                        className={props.capacity === seats ? "capacity-option selected" : "capacity-option"}
                        aria-pressed={props.capacity === seats}
                        onClick={() => props.onCapacity(seats)}
                      >
                        <strong>{seats}</strong>
                        <span>位玩家</span>
                      </button>
                    ))}
                  </div>
                  <p className="field-hint">3 人以上更好玩。至少 2 位玩家后房主就能开始，空座位可以加人机。</p>
                </>
              ) : (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                  <input
                    id="room-code"
                    className="text-input room-code-input"
                    value={props.roomCode}
                    onChange={(event) => props.onRoomCode(event.target.value)}
                    placeholder="例如：7KQ2TX"
                    autoComplete="off"
                    maxLength={6}
                    required
                  />
                  <p className="field-hint">房间码为 6 位字母或数字，不含易混淆字符。掉线后用原昵称和房间码可回到进行中的对局。</p>
                </>
              )}

              {error && <p className="feedback feedback-error" role="alert">{error}</p>}
              {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

              <button className="primary-button" type="submit" disabled={!props.canSubmit}>
                {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建私人房间" : "加入牌桌"}
                {!busy && <span aria-hidden="true">↗</span>}
              </button>
            </form>
            <div className="entry-footnote"><span className="lock-icon">◇</span> 默认邀请制 · 房主可以设为公开</div>
          </section>
          <OnlineRooms rooms={props.lobbyRooms} connected={props.connected} busy={busy} onJoin={props.onJoinListed} />
        </div>
      </section>
    </main>
  );
}

/** 首页主图：宴会厅场景 + 扇开的几张牌。 */
function Hero({ theme }: { theme: Theme }) {
  const cards = ["guard", "priest", "princess", "king", "countess"] as const;
  return (
    <div className="ll-hero" style={{ backgroundImage: `url(${art.scene(theme === "day", 0)})` }}>
      <div className="ll-showcase" aria-hidden="true">
        {cards.map((role, index) => (
          <span key={role} style={{ "--i": index } as CSSProperties}><Card role={role} scale={1} /></span>
        ))}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="情书首页">
      <img className="brand-icon" src={art.icon("letter")} width={32} height={32} alt="" />
      <span className="brand-name">情书<span> LOVE LETTER</span></span>
    </a>
  );
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "服务已连接" : "连接中…"}
    </div>
  );
}

/* ---------- 等候房间 ---------- */

export interface RoomScreenProps {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  connected: boolean;
  themeToggle: ReactNode;
  chat: ReactNode;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
  onKick: (memberId: string) => void;
  onAddBot: () => void;
  onDissolve: () => void;
  dialog?: ReactNode;
  /** 打开新手教程（不离开房间）。 */
  onTutorial?: () => void;
}

export function RoomScreen(props: RoomScreenProps) {
  return (
    <main className="app-shell ll-room">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <GameRules />
          {props.themeToggle}
          <ConnectionStatus connected={props.connected} />
        </div>
      </header>
      <RoomView {...props} />
      {props.dialog}
    </main>
  );
}

function RoomView({ room, busy, error, notice, onCopyCode, onLeave, onStart, onKick, onAddBot, onDissolve, chat, onTutorial }: RoomScreenProps) {
  const { isHost, spectating } = roomRole(room);
  const openSeats = Math.max(0, room.capacity - room.members.length);
  const tokens = { 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 }[room.capacity] ?? 4;

  return (
    <section className="room-layout">
      <div className="room-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> {room.status === "waiting" ? "等待大厅" : "对局已创建"} · 情书</div>
          <h1>{spectating ? "你在观战。" : room.status === "waiting" ? "宴会厅准备中。" : "好戏即将开始。"}</h1>
          <p>{spectating ? "等房主开始对局；有空座位时可以坐下一起玩。" : "把房间码分享给朋友，等大家就位后开始；空座位可以加人机。"}</p>
        </div>
        <div className="room-heading-actions">
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve} disabled={busy}>解散房间</button>}
          <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || (room.status === "playing" && !spectating)}>
            {spectating ? "离开观战" : "离开房间"}
          </button>
        </div>
      </div>

      {room.status === "waiting" ? (
        <div className="room-grid">
          <section className="room-panel room-code-panel">
            <div className="panel-label">房间码 <span>仅分享给朋友</span></div>
            {room.code ? (
              <>
                <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码">
                  {room.code}<span aria-hidden="true">⧉</span>
                </button>
                <div className="room-code-caption">点击复制 · 6 位邀请代码</div>
              </>
            ) : (
              <div className="room-code-caption">从首页列表进来观战，看不到房间码</div>
            )}
            <p className="ll-room-note" data-tutorial="room-note">
              {room.capacity} 人局：先攒够 <b>{tokens}</b> 枚钟情标记的人赢。{room.capacity === 2 ? "2 人局也能玩，不过 3 人以上更好玩。" : "3 人以上更好玩。"}
            </p>
            <div className="panel-label ll-deck-label">21 张牌 <span>指着看效果</span></div>
            <ul className="ll-deck-list">
              {ROLES.map((role) => (
                <li key={role} tabIndex={0}>
                  <Mini role={role} />
                  <span>{ROLE_NAME[role]}×{ROLE_COUNT[role]}</span>
                  <RoleTip role={role} />
                </li>
              ))}
            </ul>
            {onTutorial && !spectating && (
              <TutorialInvite
                record={readTutorial(GAME_ID)}
                title="等人的时候，先学一下？"
                text="咕噜嘎带你在真牌桌上打一小局。不会离开房间，房主一开局就自动回来。"
                again="再看一遍新手教程（不离开房间）"
                onOpen={onTutorial}
              />
            )}
          </section>

          <section className="room-panel player-panel">
            {room.code && (
              /* 手机上房间码那一栏排在下面：这里放一行房间码 + 复制，第一屏就能发给朋友（I27） */
              <button className="ll-mobile-code" type="button" onClick={onCopyCode} title="复制房间码">
                <span>房间码</span><b>{room.code}</b><em>复制</em>
              </button>
            )}
            <div className="panel-topline">
              <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
              <span className="waiting-pill"><i /> 等待中</span>
            </div>
            <div className="player-list">
              {room.members.map((member, index) => (
                <div className="player-row" key={member.id}>
                  <div className="player-avatar ll-member-avatar" style={{ "--seat-color": seatHex(index) } as CSSProperties}>
                    <img src={art.seal(index)} alt="" width={48} height={48} />
                  </div>
                  <div className="player-details">
                    <strong>{member.name}{member.id === socket.id ? <small>你</small> : null}</strong>
                    <span>{member.isHost ? "房主" : member.bot ? "人机 · 普通难度" : member.connected ? "已加入" : "离线"}</span>
                  </div>
                  {member.isHost && <span className="host-badge">房主</span>}
                  {member.bot && <span className="bot-badge">人机</span>}
                  {isHost && !member.isHost && (
                    <button className="kick-button" type="button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
                  )}
                </div>
              ))}
              {Array.from({ length: openSeats }, (_, index) => (
                <div className="player-row open-seat" key={`open-${index}`}>
                  <div className="empty-avatar"><span>＋</span></div>
                  <div className="player-details"><strong>等待玩家加入</strong><span>{room.access.open ? "公开房间，路过的人也能加入" : "分享房间码邀请朋友"}</span></div>
                  {isHost && <button className="quiet-button add-bot-button" type="button" onClick={onAddBot} disabled={busy} data-tutorial="add-bot">加人机</button>}
                </div>
              ))}
            </div>
            <p className="field-hint">每一步限时 30 秒，超时由人机替你打完这一回合；连续两次超时转人机托管，掉线时也由人机代打，回来能接上。</p>
            <RoomSettingsPanel room={room} />
            <SeatSwitch room={room} />
            <div className="room-actions">
              {isHost ? (
                <button className="primary-button" type="button" onClick={onStart} disabled={busy || room.members.length < 2}>
                  {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}<span aria-hidden="true">↗</span>
                </button>
              ) : (
                <div className="host-wait-note"><span className="pulse-dot" /> {spectating ? "等房主开始，开始后在这里观战" : "等待房主开始对局"}</div>
              )}
              {isHost && room.members.length < 2 && <p className="field-hint centered">还需要至少 {2 - room.members.length} 位玩家加入，也可以点空座位上的「加人机」。</p>}
            </div>
          </section>
          <div className="ll-room-chat">{chat}</div>
        </div>
      ) : null}

      {error && <p className="feedback feedback-error room-feedback" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success room-feedback" role="status">{notice}</p>}
      <div className="room-secure-note"><span>◇</span> {room.access.open ? "公开房间：首页列表里的人可以直接加入空座位。" : "邀请制：要有房间码才能加入；首页列表不显示房间码。"}</div>
    </section>
  );
}

export default App;
