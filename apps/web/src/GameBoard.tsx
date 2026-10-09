/**
 * 调试牌桌（引擎阶段的联调用）：把当前状态列出来，每个合法行动一个按钮。
 * 正式牌桌由界面阶段重写，props 和 App.tsx 的接法保持不变。
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ROLE_NAME,
  ROLE_VALUE,
  actorOf,
  legalActions,
  unseenCounts,
  ROLES,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyRoomSnapshot,
  type Role,
} from "@loveletter/game";
import { GameRoomMenu, roomRole, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
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
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

const card = (role: Role) => `${ROLE_NAME[role]}(${ROLE_VALUE[role]})`;

/** 调试用的事件文字（正式日志文案归界面）。 */
function describe(event: GameEvent, name: (id: string) => string): string {
  switch (event.type) {
    case "RoundStarted":
      return `第 ${event.round} 小局开始，${name(event.starter)} 先手${event.faceUp.length ? `；明牌 ${event.faceUp.map(card).join("、")}` : ""}`;
    case "TurnStarted":
      return `轮到 ${name(event.player)}${event.protectionEnded ? "（侍女保护结束）" : ""}`;
    case "Drew":
      return `${name(event.player)} ${event.source === "setAside" ? "拿走移出的那张" : "抽了一张"}${event.card ? `：${card(event.card)}` : ""}`;
    case "Played":
      return `${name(event.player)} 打出 ${card(event.card)}${event.target ? ` → ${name(event.target)}` : ""}${event.guess ? ` 猜 ${ROLE_NAME[event.guess]}` : ""}`;
    case "NoEffect":
      return `${ROLE_NAME[event.card]} 白打（${event.reason === "noTarget" ? "没人可选" : "牌堆空了"}）`;
    case "Guessed":
      return event.hit ? "猜中了！" : "没猜中";
    case "Peeked":
      return `${name(event.player)} 看了 ${name(event.target)} 的牌${event.card ? `：${card(event.card)}` : ""}`;
    case "Compared":
      return `${name(event.player)} 和 ${name(event.target)} 比牌${event.playerCard && event.targetCard ? `（${card(event.playerCard)} 对 ${card(event.targetCard)}）` : ""}：${event.loser ? `${name(event.loser)} 输` : "平手"}`;
    case "Protected":
      return `${name(event.player)} 受侍女保护`;
    case "Discarded":
      return `${name(event.player)} 弃掉 ${card(event.card)}`;
    case "ChancellorDrew":
      return `${name(event.player)} 用大臣抽了 ${event.count} 张${event.cards ? `：${event.cards.map(card).join("、")}` : ""}`;
    case "ChancellorReturned":
      return `${name(event.player)} 放回牌堆底 ${event.count} 张${event.cards ? `：${event.cards.map(card).join("、")}` : ""}`;
    case "Swapped":
      return `${name(event.player)} 和 ${name(event.target)} 换牌${event.playerGot && event.targetGot ? `（${name(event.player)} 拿到 ${card(event.playerGot)}，${name(event.target)} 拿到 ${card(event.targetGot)}）` : ""}`;
    case "Eliminated":
      return `${name(event.player)} 出局${event.revealed.length ? `，亮出 ${event.revealed.map(card).join("、")}` : ""}`;
    case "RoundEnded":
      return `本小局结束：${event.result.winners.map(name).join("、")} 赢${event.result.spyBonus ? `；${name(event.result.spyBonus)} 间谍 +1` : ""}；移出的牌是 ${event.result.setAside ? card(event.result.setAside) : "（已被拿走）"}`;
    case "Ready":
      return `${name(event.player)} 点了下一局`;
    case "GameEnded":
      return `整场结束：${event.winners.map(name).join("、")} 获胜`;
    case "TurnTimedOut":
      return `${name(event.player)} 超时，系统替他打完这一回合`;
  }
}

function commandLabel(command: GameCommand, name: (id: string) => string): string {
  switch (command.type) {
    case "PLAY":
      return `打 ${card(command.card)}${command.target ? ` → ${name(command.target)}` : ""}${command.guess ? ` 猜 ${ROLE_NAME[command.guess]}` : ""}`;
    case "CHANCELLOR":
      return `留 ${ROLE_NAME[command.keep]}，放回 ${command.bottom.map((role) => ROLE_NAME[role]).join(" → ")}（后面的在最底下）`;
    case "READY":
      return "下一局";
  }
}

function GameBoard(props: GameBoardProps) {
  const { room, busy, error, notice, onCommand } = props;
  const game = room.game as GameState;
  const { member, spectating, isHost } = roomRole(room);
  const selfId = spectating ? props.watchId : member?.playerId ?? "";
  const name = (id: string) => (id === selfId && !spectating ? "你" : game.players.find((player) => player.id === id)?.name ?? id);
  const actions = spectating ? [] : legalActions(game, selfId);
  const countdown = useCountdown(room);
  const actor = actorOf(game);
  const unseen = unseenCounts(game, selfId);
  const me = room.members.find((candidate) => candidate.id === socket.id);

  return (
    <div className="ll-debug">
      <header className="topbar">
        {props.brand}
        <div className="topbar-right">
          <GameRoomMenu room={room} />
          {props.themeToggle}
          {props.connection}
          {isHost && <button className="quiet-button danger" type="button" onClick={props.onDissolve}>解散</button>}
        </div>
      </header>
      {spectating && <SpectateBar room={room} watchId={props.watchId} onWatch={props.onWatch} onLeave={props.onLeave} />}

      <section className="ll-status">
        <strong>调试牌桌</strong>
        <span>第 {game.round} 小局 · 牌堆 {game.deckCount} 张 · 目标 {game.config.tokensToWin} 枚</span>
        <span>
          {game.phase === "playing" ? `轮到 ${name(actor ?? "")}${game.stage === "chancellor" ? "（大臣留牌）" : ""}` : game.phase === "roundEnd" ? "结算中" : "整场结束"}
          {countdown !== null ? ` · 剩 ${countdown} 秒` : ""}
        </span>
        {me?.auto && <button className="quiet-button" type="button" onClick={() => props.onAuto(false)}>取消托管</button>}
        {!me?.auto && !spectating && game.phase !== "finished" && <button className="quiet-button" type="button" onClick={() => props.onAuto(true)}>托管</button>}
      </section>

      {game.faceUp.length > 0 && <p className="ll-line">2 人局明牌：{game.faceUp.map(card).join("、")}</p>}

      <table className="ll-players">
        <thead>
          <tr><th>座位</th><th>标记</th><th>手牌</th><th>打出区</th><th>状态</th></tr>
        </thead>
        <tbody>
          {game.players.map((player) => {
            const memberInfo = room.members.find((candidate) => candidate.playerId === player.id);
            return (
              <tr key={player.id} className={player.id === actor ? "ll-active" : ""}>
                <td>{name(player.id)}{memberInfo?.bot ? " [人机]" : ""}{memberInfo?.auto ? " [托管]" : ""}{memberInfo && !memberInfo.connected ? " [离线]" : ""}</td>
                <td>{player.tokens}</td>
                <td>{player.hand.length > 0 ? player.hand.map(card).join("、") : `${player.handCount} 张`}</td>
                <td>{player.discards.map((entry) => `${ROLE_NAME[entry.card]}${entry.how === "played" ? "" : entry.how === "discarded" ? "(弃)" : "(亮)"}`).join(" ")}</td>
                <td>{player.out ? "出局" : player.protected ? "受保护" : ""}{player.spy ? " 间谍资格" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="ll-line">还没露面：{ROLES.map((role) => `${ROLE_NAME[role]}×${unseen[role]}`).join(" ")}</p>

      {game.lastRound && game.phase !== "playing" && (
        <p className="ll-line">
          结算：{game.lastRound.winners.map(name).join("、")} 赢（{game.lastRound.reason === "showdown" ? "亮牌" : "只剩一人"}）
          {Object.entries(game.lastRound.hands).map(([id, role]) => ` ${name(id)}=${card(role)}`).join("")}
          {game.lastRound.spyBonus ? ` · 间谍 +1：${name(game.lastRound.spyBonus)}` : ""}
          {` · 移出的牌：${game.lastRound.setAside ? card(game.lastRound.setAside) : "被拿走了"}`}
          {game.lastRound.nextStarter ? ` · 下一局 ${name(game.lastRound.nextStarter)} 先手` : ""}
        </p>
      )}

      <section className="ll-actions">
        {actions.map((command) => (
          <button key={JSON.stringify(command)} className="quiet-button" type="button" disabled={busy} onClick={() => onCommand(command)}>
            {commandLabel(command, name)}
          </button>
        ))}
        {game.phase === "finished" && room.rematch && !spectating && (
          <>
            <span>整场结束：{(game.winners ?? []).map(name).join("、")} 获胜。再来一局？</span>
            <button className="primary-button" type="button" onClick={() => props.onRematch(true)}>再来一局</button>
            <button className="quiet-button" type="button" onClick={() => props.onRematch(false)}>离开</button>
          </>
        )}
      </section>

      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

      <ol className="ll-log">
        {game.history.map((event, index) => <li key={index}>{describe(event, name)}</li>)}
      </ol>
      {props.chat}
    </div>
  );
}

export default GameBoard;
