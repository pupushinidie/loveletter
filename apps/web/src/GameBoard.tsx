/**
 * 情书牌桌。一屏放下：顶栏一行；下面左边是牌桌（场景图当底），右边（够宽时）是状态和「记录 / 聊天」，
 * 不够宽时收进抽屉，手机上排在下面。
 * 牌桌是一圈座位：自己在最下面（打出区、手牌、操作区），对手按出牌顺序从左中绕到上排再到右中，中央是牌堆、移出区和记牌条。
 * 打一张牌时先在手里点牌，再点座位（或名字按钮）选人，卫兵再在弹窗里猜牌，三样收齐才发一条 PLAY。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ROLE_NAME,
  ROLE_TARGET,
  ROLES,
  legalActions,
  mustPlayCountess,
  targetChoices,
  unseenCounts,
  visibleCounts,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Player,
  type Role,
} from "@loveletter/game";
import { art, coverSize, PILE_W, sceneIndex, seatHex } from "./art.js";
import { Card, Fan, Icon, Mini, RoleTip, Seal, Sprite } from "./Cards.js";
import { useConfirm } from "./confirm.js";
import { describeEvent, ROLE_EFFECT, roleLabel, type Line } from "./describe.js";
import { ChancellorDialog, FinalDialog, GuessDialog, RevealDialog, RoundResultDialog, type Reveal } from "./Dialogs.js";
import GameRules from "./GameRules.js";
import { useLayout, type Layout } from "./layout.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}

/** 正在选的这一手：打哪张（手牌下标）、选谁。卫兵猜什么在弹窗里选，选完直接发。 */
interface Selection {
  readonly index: number;
  readonly card: Role;
  readonly target?: string;
}

/** 一步里刚发生的变化（只在 game.version 变化时重算），给入场动画用。 */
interface Fresh {
  readonly discards: Record<string, number>;
  readonly out: ReadonlySet<string>;
  readonly shield: ReadonlySet<string>;
}
const NO_FRESH: Fresh = { discards: {}, out: new Set(), shield: new Set() };

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  // 观战的人没有座位：按 watchId 那位玩家的座位摆，什么都不能点，也不叫「你」。
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const meIndex = Math.max(0, game.players.findIndex((player) => player.id === myId));
  const me = game.players[meIndex]!;
  const count = game.players.length;
  const opponents = useMemo(() => Array.from({ length: count - 1 }, (_, step) => game.players[(meIndex + step + 1) % count]!), [game.players, meIndex, count]);
  const playing = game.phase === "playing";
  const actor = playing ? game.players[game.current] : undefined;
  const myTurn = !spectating && playing && actor?.id === myId;
  const autoPlaying = member?.auto === true;
  const secondsLeft = useCountdown(room);
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const nameOf = useCallback(
    (playerId: string) => (playerId === selfId && selfId !== "" ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?"),
    [game.players, selfId],
  );
  const seatOf = useCallback((playerId: string) => game.players.find((player) => player.id === playerId)?.seat ?? 0, [game.players]);
  const [confirm, confirmDialog] = useConfirm();

  // ---------- 摆法 ----------
  const oppDiscards = Math.max(0, ...opponents.map((player) => player.discards.length));
  const [mainRef, layout, mainBox] = useLayout({ opponents: opponents.length, oppDiscards, myDiscards: me.discards.length, twoPlayer: count === 2 });

  // ---------- 后台标题提醒 ----------
  useEffect(() => {
    const base = "情书 · 在线对战";
    const update = () => { document.title = myTurn && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myTurn]);

  // ---------- 每一步的变化：记录、动画、秘密结果（只看 game.version） ----------
  const initialLog = useMemo(() => game.history.map((event) => describeEvent(event, nameOf, selfId)).filter((line): line is Line => line !== null), []);
  const [log, setLog] = useState<Line[]>(initialLog);
  const [fresh, setFresh] = useState<Fresh>(NO_FRESH);
  // 刚进来（或刷新）时，最近一步里有只给自己看的结果也弹出来
  const [reveal, setReveal] = useState<Reveal | null>(() => (spectating ? null : revealFrom(game.events, selfId)));
  const seen = useRef({ version: game.version, round: game.round, len: game.history.length, players: game.players });
  useEffect(() => {
    const prev = seen.current;
    if (game.version === prev.version) return;
    const sameRound = game.round === prev.round && game.history.length >= prev.len;
    const newEvents: GameEvent[] = sameRound ? game.history.slice(prev.len) : game.history;
    const lines = newEvents.map((event) => describeEvent(event, nameOf, selfId)).filter((line): line is Line => line !== null);
    if (lines.length) setLog((old) => [...old, ...lines].slice(-200));
    const discards: Record<string, number> = {};
    const out = new Set<string>();
    const shield = new Set<string>();
    for (const player of game.players) {
      const before = prev.players.find((candidate) => candidate.id === player.id);
      if (!before || !sameRound) continue;
      if (player.discards.length > before.discards.length) discards[player.id] = player.discards.length - before.discards.length;
      if (player.out && !before.out) out.add(player.id);
      if (player.protected && !before.protected) shield.add(player.id);
    }
    setFresh({ discards, out, shield });
    if (!spectating) {
      const found = revealFrom(newEvents, selfId);
      if (found) setReveal(found);
    }
    seen.current = { version: game.version, round: game.round, len: game.history.length, players: game.players };
  }, [game.version]);

  // ---------- 选牌 ----------
  const [sel, setSel] = useState<Selection | null>(null);
  const [hint, setHint] = useState("");
  const selVersion = useRef(game.version);
  useEffect(() => {
    if (selVersion.current === game.version) return;
    selVersion.current = game.version;
    setSel(null);
    setHint("");
  }, [game.version]);
  const legal = useMemo(() => (myTurn && !autoPlaying ? legalActions(game, myId) : []), [game, myTurn, myId, autoPlaying]);
  const canPlay = myTurn && !autoPlaying && game.stage === "play";
  const forced = canPlay && mustPlayCountess(me.hand);
  const playable = (role: Role) => canPlay && legal.some((command) => command.type === "PLAY" && command.card === role);
  const choices = sel ? targetChoices(game, myId, sel.card) : [];
  const needsTarget = sel !== null && ROLE_TARGET[sel.card] !== "none" && choices.length > 0;
  const unseen = useMemo(() => unseenCounts(game, myId), [game, myId]);
  const visible = useMemo(() => visibleCounts(game), [game]);

  const send = useCallback((command: GameCommand) => {
    onCommand(command);
    setSel(null);
    setHint("");
  }, [onCommand]);

  async function playNow(selection: Selection, target?: string, guess?: Role) {
    if (selection.card === "princess") {
      const ok = await confirm({ title: "真的要打出公主？", detail: "公主一旦打出（或被弃掉），你立刻出局，这一小局就输了。", confirmLabel: "打出公主" });
      if (!ok) return;
    }
    const command: GameCommand = { type: "PLAY", card: selection.card, ...(target ? { target } : {}), ...(guess ? { guess } : {}) };
    send(command);
  }

  function pickCard(index: number) {
    if (!canPlay || busy) return;
    const role = me.hand[index];
    if (!role) return;
    if (!playable(role)) {
      setHint(forced ? `手里有女伯爵和${me.hand.includes("king") ? "国王" : "王子"}，这回合必须打女伯爵。` : "这张现在打不了。");
      return;
    }
    setHint("");
    if (sel?.index === index) {
      // 再点同一张：不用选人的牌直接打出
      if (!needsTarget) void playNow(sel);
      else if (sel.target && sel.card !== "guard") void playNow(sel, sel.target);
      return;
    }
    setSel({ index, card: role });
  }

  function pickTarget(playerId: string) {
    if (!sel || !needsTarget) return;
    const player = game.players.find((candidate) => candidate.id === playerId);
    if (!choices.includes(playerId)) {
      setHint(player?.out ? `${nameOf(playerId)} 已经出局了，选不了。` : player?.protected ? `${nameOf(playerId)} 受侍女保护，别人的牌都不能选他。` : "选不了这个人。");
      return;
    }
    setHint("");
    setSel({ ...sel, target: playerId });
  }

  function confirmPlay() {
    if (!sel) return;
    if (needsTarget) {
      if (!sel.target) { setHint("先选一个人。"); return; }
      if (sel.card === "guard") return;
      void playNow(sel, sel.target);
      return;
    }
    void playNow(sel);
  }

  // 键盘：1 / 2 选手牌，空格或回车确认，Esc 取消
  useEffect(() => {
    if (!canPlay) return;
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector(".gm-modal-backdrop")) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "BUTTON")) {
        if (target.tagName !== "BUTTON" || (event.key !== "1" && event.key !== "2" && event.key !== "Escape")) return;
      }
      if (event.key === "1" || event.key === "2") pickCard(Number(event.key) - 1);
      else if (event.key === "Escape") { setSel(null); setHint(""); }
      else if ((event.key === " " || event.key === "Enter") && sel) { event.preventDefault(); confirmPlay(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 弹窗 ----------
  const [resultHidden, setResultHidden] = useState(false);
  const [finalHidden, setFinalHidden] = useState(false);
  useEffect(() => { setResultHidden(false); }, [game.phase, game.round]);

  // ---------- 文字：现在该做什么 ----------
  let headline: string;
  let detail = "";
  if (game.phase === "finished") {
    headline = "整场结束";
    detail = `${(game.winners ?? []).map(nameOf).join("、")} 攒够了 ${game.config.tokensToWin} 枚标记`;
  } else if (game.phase === "roundEnd") {
    headline = `第 ${game.round} 小局结束`;
    detail = game.lastRound ? `${game.lastRound.winners.map(nameOf).join("、")} 赢${game.lastRound.nextStarter ? `，下一局 ${nameOf(game.lastRound.nextStarter)} 先手` : ""}` : "";
  } else if (spectating) {
    headline = game.stage === "chancellor" ? `${actor?.name ?? ""} 在用大臣挑牌` : `轮到 ${actor?.name ?? ""}`;
  } else if (me.out) {
    headline = "你出局了";
    detail = "这一小局看别人打，下一局再来。";
  } else if (autoPlaying) {
    headline = "托管中：人机替你出牌";
    detail = "点「取消托管」就能收回。";
  } else if (myTurn && game.stage === "chancellor") {
    headline = "大臣：留 1 张，其余放回牌堆底";
  } else if (myTurn) {
    if (!sel) {
      headline = "轮到你：点一张牌打出";
      detail = forced ? "手里有女伯爵和国王 / 王子，这回合只能打女伯爵。" : "刚抽了一张。两张里打出一张，另一张留在手里。";
    } else if (needsTarget) {
      headline = sel.card === "prince" ? "王子：选一个人（可以选自己）" : `${ROLE_NAME[sel.card]}：选一个人`;
      detail = ROLE_EFFECT[sel.card];
    } else {
      headline = `打出${ROLE_NAME[sel.card]}`;
      detail = ROLE_TARGET[sel.card] !== "none" ? "别人都出局或受保护，没人能选，这张白打。" : ROLE_EFFECT[sel.card];
    }
  } else {
    headline = game.stage === "chancellor" ? `${actor?.name ?? ""} 在用大臣挑牌` : `等 ${actor?.name ?? ""} 出牌`;
  }

  const recent = game.events.map((event) => describeEvent(event, nameOf, selfId, false)).filter((line): line is Line => line !== null);

  // ---------- 场景 ----------
  const day = theme === "day";
  const scene = art.scene(day, sceneIndex(room.code || room.members[0]?.id || "x"));

  // ---------- 座位 ----------
  const seatProps = (player: Player) => {
    const choosable = needsTarget && choices.includes(player.id);
    const blocked = needsTarget && !choices.includes(player.id) ? (player.out ? "已出局" : player.protected ? "侍女保护中" : "") : "";
    return { choosable, blocked, chosen: sel?.target === player.id };
  };

  const seatEl = (player: Player, area: string) => (
    <Seat
      key={player.id}
      player={player}
      member={memberOf(player.id)}
      game={game}
      layout={layout}
      area={area}
      fresh={fresh}
      {...seatProps(player)}
      onPick={() => pickTarget(player.id)}
    />
  );

  const ring = layout.ring && !layout.mobile;
  const midL = ring ? opponents[0] : undefined;
  const midR = ring ? opponents[opponents.length - 1] : undefined;
  const topSeats = ring ? opponents.slice(1, -1) : opponents;

  const center = (
    <div className="ll-center" style={{ gridArea: "center" }}>
      <div className="ll-piles">
        <div className="ll-pile" data-tutorial="deck" title={`牌堆还剩 ${game.deckCount} 张`}>
          <img src={game.deckCount === 0 ? art.slot : game.deckCount >= 8 ? art.deck : art.deckLow} width={PILE_W} height={112} alt="" />
          <span className="ll-pile-count"><b>{game.deckCount}</b><small>牌堆</small></span>
        </div>
        <div className="ll-pile" data-tutorial="set-aside" title={game.setAsideTaken ? "开局移出的那张已经被王子点到的人拿走" : "开局面朝下移出的 1 张：这一小局谁都不用，结束时亮出来"}>
          <img src={game.setAsideTaken ? art.slot : art.aside} width={PILE_W} height={112} alt="" />
          <span className="ll-pile-count"><small>{game.setAsideTaken ? "被拿走" : "移出"}</small></span>
        </div>
        {game.faceUp.length > 0 && (
          <div className="ll-faceup" data-tutorial="face-up" title="2 人局开局面朝上移出的 3 张：谁都不会拿到">
            <span className="ll-faceup-cards">{game.faceUp.map((role, index) => <Card key={index} role={role} scale={1} />)}</span>
            <small>明牌移出</small>
          </div>
        )}
      </div>
      <Strip unseen={unseen} visible={visible} scale={layout.mobile ? 1 : layout.strip} publicOnly={spectating} />
    </div>
  );

  const actionPanel = (
    <ActionPanel
      headline={headline}
      detail={detail}
      hint={hint || error}
      notice={notice}
      recent={recent}
      myTurn={canPlay}
      sel={sel}
      needsTarget={needsTarget}
      choices={choices}
      candidates={[...opponents, ...(sel?.card === "prince" ? [me] : [])]}
      nameOf={nameOf}
      myId={myId}
      autoPlaying={autoPlaying}
      spectating={spectating}
      phase={game.phase}
      resultHidden={resultHidden || finalHidden}
      onTarget={pickTarget}
      onConfirm={confirmPlay}
      onCancel={() => { setSel(null); setHint(""); }}
      onAuto={onAuto}
      onShowResult={() => { setResultHidden(false); setFinalHidden(false); }}
    />
  );

  const mySeat = (
    <MyArea
      game={game}
      me={me}
      member={member ?? memberOf(myId)}
      spectating={spectating}
      layout={layout}
      fresh={fresh}
      sel={sel}
      canPlay={canPlay}
      playable={playable}
      forced={forced}
      busy={busy}
      targetable={needsTarget && choices.includes(myId)}
      chosen={sel?.target === myId}
      onCard={pickCard}
      onPickSelf={() => pickTarget(myId)}
      action={actionPanel}
    />
  );

  const sideTabs = useSideTabs(room);
  const [drawer, setDrawer] = useState(false);
  const side = (
    <aside className="ll-side">
      {spectating && <SpectateBar room={room} watchId={myId} onWatch={onWatch} onLeave={onLeave} />}
      <section className="ll-panel ll-status" data-tutorial="status">
        <h2>第 {game.round} 小局</h2>
        <p className="ll-goal" data-tutorial="goal"><Icon name="favor" scale={1} /> {count} 人局：先攒够 <b>{game.config.tokensToWin}</b> 枚钟情标记的人赢整场</p>
        {!spectating && game.phase !== "finished" && !autoPlaying && (
          <button className="quiet-button ll-auto-toggle" type="button" data-tutorial="auto-button" onClick={() => onAuto(true)}>托管</button>
        )}
      </section>
      <section className="ll-panel ll-tabs">
        <div className="ll-tab-bar" role="tablist">
          <button type="button" role="tab" aria-selected={sideTabs.tab === "log"} className={sideTabs.tab === "log" ? "active" : ""} data-tutorial="log-tab" onClick={() => sideTabs.setTab("log")}>记录</button>
          <button type="button" role="tab" aria-selected={sideTabs.tab === "chat"} className={sideTabs.tab === "chat" ? "active" : ""} data-tutorial="chat-tab" onClick={() => sideTabs.setTab("chat")}>
            聊天{sideTabs.unread > 0 && <em>{sideTabs.unread}</em>}
          </button>
        </div>
        {sideTabs.tab === "log" ? <LogList lines={log} /> : <div className="ll-chat">{chat}</div>}
      </section>
    </aside>
  );

  const timer = secondsLeft !== null && game.phase !== "finished" && (
    <b className={secondsLeft <= 10 ? "ll-timer low" : "ll-timer"} data-tutorial="timer" title="这一步还剩几秒；超时由系统替你打完这一回合">{secondsLeft}s</b>
  );

  const turnWho = playing && actor ? (
    <span className={myTurn ? "ll-turn-who mine" : "ll-turn-who"} data-tutorial="turn">
      <Seal seat={actor.seat} />
      <span>{myTurn ? "轮到你" : `轮到 ${actor.name}`}</span>
    </span>
  ) : (
    <span className="ll-turn-who" data-tutorial="turn"><span>{headline}</span></span>
  );

  return (
    <div className={["ll-screen", layout.mobile ? "mobile" : "", layout.side ? "with-side" : "", `hand-${layout.hand}`, `disc-${layout.disc}`].join(" ")}>
      <header className="ll-topbar">
        {brand}
        <div className="ll-turn">
          {turnWho}
          {timer}
        </div>
        <div className="ll-topbar-right">
          <GameRules />
          {themeToggle}
          <GameRoomMenu room={room} />
          {spectating && !layout.mobile && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {!layout.side && !layout.mobile && (
            <button className="quiet-button ll-drawer-toggle" type="button" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
              记录 / 聊天{sideTabs.unread > 0 ? ` · ${sideTabs.unread}` : ""}
            </button>
          )}
          {connection}
        </div>
        {layout.mobile && (
          <div className="ll-chips" aria-label="座位一览">
            {game.players.map((player) => (
              <span key={player.id} className={["ll-chip", player.id === actor?.id ? "active" : "", player.out ? "out" : ""].join(" ")} style={{ "--seat-color": seatHex(player.seat) } as CSSProperties}>
                <Seal seat={player.seat} />
                <b>{player.tokens}</b>
                {player.protected && <Icon name="shield" scale={1} />}
                {player.out && <Icon name="out" scale={1} />}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="ll-main" ref={mainRef}>
        <div
          className={["ll-table", ring ? "ring" : "top", layout.mobile ? "stack" : ""].join(" ")}
          style={{ "--scene": `url(${scene})`, "--scene-size": coverSize(mainBox.width, mainBox.height), "--cloth": `url(${art.cloth(day)})` } as CSSProperties}
        >
          {layout.mobile ? (
            <>
              {mySeat}
              {center}
              <div className="ll-opps">{opponents.map((player) => seatEl(player, "opp"))}</div>
            </>
          ) : (
            <>
              <div className="ll-top" style={{ gridArea: "top" }}>{topSeats.map((player) => seatEl(player, "top"))}</div>
              {midL && <div className="ll-mid left" style={{ gridArea: "left" }}>{seatEl(midL, "left")}</div>}
              {center}
              {midR && <div className="ll-mid right" style={{ gridArea: "right" }}>{seatEl(midR, "right")}</div>}
              {mySeat}
            </>
          )}
        </div>
        {(layout.side || drawer || layout.mobile) && side}
      </div>

      {myTurn && !autoPlaying && game.stage === "chancellor" && (
        <ChancellorDialog key={game.version} hand={me.hand} scale={layout.mobile ? 1 : 2} onSubmit={send} />
      )}
      {sel?.card === "guard" && sel.target && canPlay && (
        <GuessDialog
          targetName={nameOf(sel.target)}
          unseen={unseen}
          scale={layout.mobile ? 1 : 2}
          compact={layout.mobile}
          onPick={(guess) => void playNow(sel, sel.target, guess)}
          onCancel={() => setSel({ index: sel.index, card: sel.card })}
        />
      )}
      {reveal && <RevealDialog reveal={reveal} me={selfId} name={nameOf} seatOf={seatOf} scale={layout.mobile ? 1 : 2} onClose={() => setReveal(null)} />}
      {!reveal && game.lastRound && game.phase !== "playing" && !resultHidden && (
        <RoundResultDialog game={game} room={room} me={selfId} name={nameOf} compact={layout.mobile} seconds={game.phase === "roundEnd" ? secondsLeft : null} onReady={() => onCommand({ type: "READY" })} onHide={() => setResultHidden(true)} />
      )}
      {!reveal && game.phase === "finished" && !finalHidden && resultHidden && (
        <FinalDialog game={game} room={room} me={selfId} spectating={spectating} name={nameOf} onRematch={onRematch} onLeave={onLeave} onHide={() => setFinalHidden(true)} />
      )}
      {confirmDialog}
    </div>
  );
}

/** 一串事件里最后一个只给自己看的结果：自己出牧师看到的牌、自己参与的比牌、自己参与的换牌。 */
function revealFrom(events: readonly GameEvent[], me: string): Reveal | null {
  let found: Reveal | null = null;
  if (!me) return null;
  for (const event of events) {
    if (event.type === "Peeked" && event.player === me && event.card) found = { kind: "peek", target: event.target, card: event.card };
    if (event.type === "Compared" && event.playerCard && event.targetCard && (event.player === me || event.target === me)) {
      found = { kind: "compare", player: event.player, target: event.target, playerCard: event.playerCard, targetCard: event.targetCard, loser: event.loser };
    }
    if (event.type === "Swapped" && event.playerGot && event.targetGot && (event.player === me || event.target === me)) {
      found = { kind: "swap", player: event.player, target: event.target, playerGot: event.playerGot, targetGot: event.targetGot };
    }
  }
  return found;
}

/* ---------- 侧栏的「记录 / 聊天」 ---------- */

function useSideTabs(room: LobbyRoomSnapshot) {
  const [tab, setTab] = useState<"log" | "chat">("log");
  const [seen, setSeen] = useState(room.chat.length);
  const unread = tab === "chat" ? 0 : Math.max(0, room.chat.length - seen);
  useEffect(() => {
    if (tab === "chat") setSeen(room.chat.length);
  }, [tab, room.chat.length]);
  return {
    tab,
    setTab: (next: "log" | "chat") => {
      setTab(next);
      if (next === "chat") setSeen(room.chat.length);
    },
    unread,
  };
}

function LogList({ lines }: { lines: Line[] }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = ref.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lines.length]);
  if (lines.length === 0) return <p className="ll-muted">还没有动作。</p>;
  return (
    <ul className="ll-log" ref={ref} data-tutorial="log">
      {lines.map((line, index) => (
        <li key={index} className={[line.secret ? "secret" : "", line.mine ? "mine" : ""].join(" ")}>
          {line.icon && <Icon name={line.icon} scale={1} />}
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- 记牌条 ---------- */

function Strip({ unseen, visible, scale, publicOnly }: { unseen: Record<Role, number>; visible: Record<Role, number>; scale: number; publicOnly: boolean }) {
  return (
    <div className="ll-strip" data-tutorial="stats">
      <span className="ll-strip-head">记牌：角标是还有几张没露面{publicOnly ? "" : "（已扣掉你手里的）"}</span>
      <ul className={`ll-strip-cells s${scale}`}>
        {ROLES.map((role) => (
          <li key={role} className={unseen[role] === 0 ? "none" : ""} tabIndex={0} data-tutorial={`stats-${role}`}>
            <Mini role={role} scale={scale} />
            <b>{unseen[role]}</b>
            <RoleTip role={role} unseen={unseen[role]} visible={visible[role]} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- 对手座位 ---------- */

function Seat({ player, member, game, layout, area, fresh, choosable, blocked, chosen, onPick }: {
  player: Player;
  member: LobbyMember | undefined;
  game: GameState;
  layout: Layout;
  area: string;
  fresh: Fresh;
  choosable: boolean;
  blocked: string;
  chosen: boolean;
  onPick: () => void;
}) {
  const active = game.phase === "playing" && game.players[game.current]?.id === player.id;
  const mobile = layout.mobile;
  const backs = Math.max(0, player.handCount);
  const seatW = mobile ? undefined : layout.seatW;
  const fanMax = seatW !== undefined ? seatW - 20 - (backs > 0 ? 56 : 0) : 200;
  const className = [
    "ll-seat",
    active ? "active" : "",
    player.out ? "out" : "",
    player.protected ? "protected" : "",
    choosable ? "choosable" : "",
    blocked ? "blocked" : "",
    chosen ? "chosen" : "",
  ].join(" ");
  return (
    <section
      className={className}
      data-tutorial={`seat-${player.id}`}
      data-area={area}
      style={{ "--seat-color": seatHex(player.seat), minWidth: seatW, maxWidth: seatW !== undefined ? Math.round(seatW * 1.35) : undefined } as CSSProperties}
      onClick={choosable || blocked ? onPick : undefined}
      role={choosable ? "button" : undefined}
      tabIndex={choosable ? 0 : undefined}
      onKeyDown={choosable ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(); } } : undefined}
      aria-label={choosable ? `选 ${player.name}` : undefined}
    >
      <SeatHead player={player} member={member} game={game} fresh={fresh} mobile={mobile} />
      <div className="ll-seat-body">
        {backs > 0 && (
          <span className="ll-backs" title={`手里 ${backs} 张`}>
            {Array.from({ length: Math.min(backs, 3) }, (_, index) => <Mini key={index} role={player.hand[index] ?? "back"} scale={1} />)}
          </span>
        )}
        <div className="ll-seat-fan" data-tutorial={`discards-${player.id}`}>
          <Fan entries={player.discards} scale={mobile ? 1 : layout.disc} mini={mobile} maxWidth={fanMax} fresh={fresh.discards[player.id] ?? 0} empty={<small>还没出牌</small>} />
        </div>
      </div>
      {blocked && <span className="ll-blocked-tag">{blocked}</span>}
      {choosable && <span className="ll-pick-tag">{chosen ? "已选" : "点这里选他"}</span>}
      {fresh.shield.has(player.id) && <Sprite name="shield" scale={2} mode="once" className="ll-shield-fx" />}
    </section>
  );
}

function SeatHead({ player, member, game, fresh, mobile, you = false }: { player: Player; member: LobbyMember | undefined; game: GameState; fresh: Fresh; mobile: boolean; you?: boolean }) {
  const offline = member ? !member.connected : false;
  return (
    <div className="ll-seat-head" data-tutorial={you ? "my-head" : undefined}>
      {!mobile && (
        player.out
          ? <Sprite name="snuff" mode={fresh.out.has(player.id) ? "once" : "still"} className="ll-candle" />
          : <Sprite name="candle" delay={-player.seat * 230} className="ll-candle" />
      )}
      <Seal seat={player.seat} />
      <strong title={player.name}>{you ? "你" : player.name}</strong>
      <span className="ll-tags">
        {member?.bot && <small className="ll-bot">人机</small>}
        {!member?.bot && member?.auto && <small className="ll-auto">托管</small>}
        {offline && !member?.bot && <small className="ll-offline">离线</small>}
      </span>
      <span className="ll-marks" data-tutorial={`marks-${player.id}`}>
        {player.protected && <Icon name="shield" scale={mobile ? 1 : 2} title="受侍女保护：到他下一回合开始，别人的牌都不能选他" />}
        {player.spy && !player.out && <Icon name="spy" scale={mobile ? 1 : 2} title="打出或弃过间谍：一小局结束时如果在局的人里只有他有，额外 +1" />}
        {player.out && <small className="ll-out-tag">出局</small>}
      </span>
      <span className="ll-tokens" data-tutorial={`tokens-${player.id}`} title={`钟情标记 ${player.tokens} 枚，攒够 ${game.config.tokensToWin} 枚赢整场`}>
        <Icon name="favor" scale={mobile ? 1 : 2} />
        <b>{player.tokens}</b><small>/{game.config.tokensToWin}</small>
      </span>
    </div>
  );
}

/* ---------- 自己：名牌、打出区、手牌、操作区 ---------- */

function MyArea({ game, me, member, spectating, layout, fresh, sel, canPlay, playable, forced, busy, targetable, chosen, onCard, onPickSelf, action }: {
  game: GameState;
  me: Player;
  member: LobbyMember | undefined;
  spectating: boolean;
  layout: Layout;
  fresh: Fresh;
  sel: Selection | null;
  canPlay: boolean;
  playable: (role: Role) => boolean;
  forced: boolean;
  busy: boolean;
  targetable: boolean;
  chosen: boolean;
  onCard: (index: number) => void;
  onPickSelf: () => void;
  action: ReactNode;
}) {
  const active = game.phase === "playing" && game.players[game.current]?.id === me.id;
  const scale = layout.mobile ? 2 : layout.hand;
  const hand: (Role | "back")[] = me.hand.length > 0 ? me.hand : Array.from({ length: me.handCount }, () => "back" as const);
  return (
    <section
      className={["ll-me", active ? "active" : "", me.out ? "out" : "", me.protected ? "protected" : "", targetable ? "choosable" : "", chosen ? "chosen" : ""].join(" ")}
      style={{ gridArea: "me", "--seat-color": seatHex(me.seat) } as CSSProperties}
      data-tutorial="seat-me"
    >
      <div className="ll-me-info" onClick={targetable ? onPickSelf : undefined}>
        <SeatHead player={me} member={member} game={game} fresh={fresh} mobile={layout.mobile} you={!spectating} />
        <div className="ll-seat-fan" data-tutorial="discards-me">
          <Fan entries={me.discards} scale={layout.mobile ? 1 : layout.myDisc} mini={layout.mobile} maxWidth={layout.mobile ? 260 : layout.myDisc === 2 ? 400 : 300} fresh={fresh.discards[me.id] ?? 0} empty={<small>打出的牌摆这里</small>} />
        </div>
        {targetable && <span className="ll-pick-tag">{chosen ? "已选自己" : "点这里选自己"}</span>}
        {fresh.shield.has(me.id) && <Sprite name="shield" scale={2} mode="once" className="ll-shield-fx" />}
      </div>
      <div className={["ll-hand", hand.length > 2 ? "three" : "", canPlay ? "live" : ""].join(" ")} style={{ "--card-w": `${72 * scale}px` } as CSSProperties} data-tutorial="hand">
        {hand.length === 0 && <span className="ll-hand-empty">{me.out ? "出局了" : ""}</span>}
        {hand.map((role, index) => {
          const ok = role !== "back" && playable(role);
          const selected = sel?.index === index;
          const dim = canPlay && !ok;
          return (
            <button
              key={index}
              type="button"
              className={["ll-hand-card", ok ? "playable" : "", selected ? "selected" : "", dim ? "blocked" : ""].join(" ")}
              data-tutorial={`hand-${index}`}
              data-role={role}
              disabled={!canPlay || busy || role === "back"}
              aria-pressed={selected}
              aria-disabled={dim || undefined}
              onClick={() => onCard(index)}
              title={role === "back" ? "手牌" : `${roleLabel(role)}：${ROLE_EFFECT[role]}`}
            >
              <Card role={role} scale={scale} />
              {dim && forced && <span className="ll-card-note">必须先打女伯爵</span>}
              {selected && <span className="ll-card-note sel">已选</span>}
              {canPlay && !selected && !dim && !layout.mobile && <kbd>{index + 1}</kbd>}
            </button>
          );
        })}
      </div>
      <div className="ll-action" data-tutorial="action-panel">{action}</div>
    </section>
  );
}

function ActionPanel({
  headline, detail, hint, notice, recent, myTurn, sel, needsTarget, choices, candidates, nameOf, myId, autoPlaying, spectating, phase, resultHidden,
  onTarget, onConfirm, onCancel, onAuto, onShowResult,
}: {
  headline: string;
  detail: string;
  hint: string;
  notice: string;
  recent: Line[];
  myTurn: boolean;
  sel: Selection | null;
  needsTarget: boolean;
  choices: string[];
  candidates: Player[];
  nameOf: (id: string) => string;
  myId: string;
  autoPlaying: boolean;
  spectating: boolean;
  phase: GameState["phase"];
  resultHidden: boolean;
  onTarget: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onAuto: (enabled: boolean) => void;
  onShowResult: () => void;
}) {
  const showRecent = phase === "playing" && !(myTurn && sel) && recent.length > 0;
  return (
    <>
      <h2 className="ll-action-title">{headline}</h2>
      {detail && <p className="ll-action-detail">{detail}</p>}
      {hint && <p className="ll-action-hint" role="alert">{hint}</p>}
      {!hint && notice && <p className="ll-action-notice" role="status">{notice}</p>}
      {myTurn && sel && needsTarget && (
        <div className="ll-targets" data-tutorial="target-picker">
          {candidates.map((player) => {
            const ok = choices.includes(player.id);
            const reason = player.out ? "出局" : player.protected ? "受保护" : "";
            return (
              <button
                key={player.id}
                type="button"
                className={["ll-target", sel.target === player.id ? "selected" : ""].join(" ")}
                data-tutorial={`target-${player.id === myId ? "me" : player.id}`}
                disabled={!ok}
                onClick={() => onTarget(player.id)}
                style={{ "--seat-color": seatHex(player.seat) } as CSSProperties}
                title={ok ? `选 ${nameOf(player.id)}` : `${nameOf(player.id)}：${reason}，选不了`}
              >
                <Seal seat={player.seat} />
                <span>{player.id === myId ? "自己" : player.name}</span>
                {!ok && <small>{reason}</small>}
              </button>
            );
          })}
        </div>
      )}
      {myTurn && sel && (
        <div className="ll-action-buttons">
          <button className="quiet-button" type="button" data-tutorial="cancel-button" onClick={onCancel}>重选</button>
          {(!needsTarget || (sel.target && sel.card !== "guard")) && (
            <button className="primary-button" type="button" data-tutorial="play-button" onClick={onConfirm}>
              {needsTarget ? `打出${ROLE_NAME[sel.card]} → ${nameOf(sel.target!)}` : ROLE_TARGET[sel.card] !== "none" ? `白打${ROLE_NAME[sel.card]}` : `打出${ROLE_NAME[sel.card]}`}
            </button>
          )}
        </div>
      )}
      {autoPlaying && (
        <div className="ll-action-buttons">
          <button className="primary-button" type="button" data-tutorial="cancel-auto" onClick={() => onAuto(false)}>取消托管</button>
        </div>
      )}
      {resultHidden && phase !== "playing" && (
        <div className="ll-action-buttons">
          <button className="primary-button" type="button" onClick={onShowResult}>{phase === "finished" ? "看整场结果" : "看结算"}</button>
        </div>
      )}
      {showRecent && (
        <ul className="ll-recent" data-tutorial="recent">
          {recent.slice(-4).map((line, index) => (
            <li key={index} className={!spectating && line.secret ? "secret" : !spectating && line.mine ? "mine" : ""}>{line.icon && <Icon name={line.icon} scale={1} />}<span>{line.text}</span></li>
          ))}
        </ul>
      )}
    </>
  );
}

export default GameBoard;
