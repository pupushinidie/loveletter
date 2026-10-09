/**
 * 牌桌上的像素弹窗：卫兵猜牌、大臣留牌、秘密结果（牧师看牌、男爵比牌、国王换牌）、一小局结算、整场结束。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  GUARD_GUESSES,
  ROLE_NAME,
  ROLE_VALUE,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type Role,
} from "@loveletter/game";
import { art, seatHex as seatColor } from "./art.js";
import { Card, Icon, Mini, Seal, Sprite } from "./Cards.js";
import { ROLE_EFFECT, ROLE_SHORT, roleLabel } from "./describe.js";
import { socket } from "./socket.js";

function Modal({ className, label, children, onClose, anchor }: { className: string; label: string; children: ReactNode; onClose?: () => void; anchor?: string }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="gm-modal-backdrop ll-backdrop" role="presentation" onMouseDown={(event) => { if (onClose && event.target === event.currentTarget) onClose(); }}>
      <section className={`gm-panel ll-dialog ${className}`} role="dialog" aria-modal="true" aria-label={label} data-tutorial={anchor}>
        {children}
      </section>
    </div>
  );
}

/* ---------- 卫兵猜牌 ---------- */

export function GuessDialog({ targetName, unseen, scale, compact = false, onPick, onCancel }: {
  targetName: string;
  unseen: Record<Role, number>;
  scale: number;
  compact?: boolean;
  onPick: (guess: Role) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<Role | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "Enter" || event.key === " ") && choice) { event.preventDefault(); onPick(choice); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choice, onPick]);
  return (
    <Modal className={compact ? "ll-guess compact" : "ll-guess"} label="卫兵猜牌" onClose={onCancel}>
      <h2 data-tutorial="guess-title"><Icon name="target" /> 猜 {targetName} 手里是什么？</h2>
      <p className="ll-dialog-note">猜中他就出局。不能猜卫兵；数字是还有几张没露面（在牌堆、移出的牌或别人手里）。</p>
      <div className="ll-guess-grid" data-tutorial="guess-picker">
        {GUARD_GUESSES.map((role) => (
          <button
            key={role}
            type="button"
            className={["ll-guess-option", choice === role ? "selected" : "", unseen[role] === 0 ? "none" : ""].join(" ")}
            aria-pressed={choice === role}
            data-tutorial={`guess-${role}`}
            onClick={() => setChoice(role)}
            onDoubleClick={() => onPick(role)}
            title={ROLE_EFFECT[role]}
          >
            <Mini role={role} scale={scale} />
            <b>{ROLE_NAME[role]}</b>
            <small>{unseen[role] === 0 ? "都露面了" : `还剩 ${unseen[role]}`}</small>
          </button>
        ))}
      </div>
      <div className="gm-panel-actions">
        <button className="quiet-button" type="button" onClick={onCancel}>换个人</button>
        <button className="primary-button" type="button" disabled={!choice} data-tutorial="guess-confirm" onClick={() => choice && onPick(choice)}>
          {choice ? `指认 ${targetName} 是${ROLE_NAME[choice]}` : "先选一种牌"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- 大臣留牌 ---------- */

export function ChancellorDialog({ hand, scale, onSubmit }: { hand: readonly Role[]; scale: number; onSubmit: (command: GameCommand) => void }) {
  const [keep, setKeep] = useState<number | null>(null);
  const [flip, setFlip] = useState(false);
  const rest = hand.map((role, index) => ({ role, index })).filter((card) => card.index !== keep);
  const order = keep === null ? [] : flip ? [...rest].reverse() : rest;
  const submit = () => {
    if (keep === null) return;
    onSubmit({ type: "CHANCELLOR", keep: hand[keep]!, bottom: order.map((card) => card.role) });
  };
  return (
    <Modal className="ll-chancellor" label="大臣留牌" anchor="chancellor-dialog">
      <h2>大臣：留 1 张，{hand.length - 1} 张放回牌堆底</h2>
      <p className="ll-dialog-note">放回去的牌不发动、不算弃牌（公主放回去也不会出局）。手里 3 张时不用管女伯爵。</p>
      <div className="ll-chancellor-cards" data-tutorial="chancellor-panel">
        {hand.map((role, index) => (
          <button
            key={index}
            type="button"
            className={["ll-pick-card", keep === index ? "kept" : keep !== null ? "returned" : ""].join(" ")}
            aria-pressed={keep === index}
            data-tutorial={`chancellor-keep-${index}`}
            onClick={() => { setKeep(index); setFlip(false); }}
          >
            <Card role={role} scale={scale} />
            <span className="ll-pick-label">{keep === index ? "留下" : keep !== null ? `放回 · ${order.findIndex((card) => card.index === index) === order.length - 1 ? "最底下" : "上面"}` : "点它留下"}</span>
          </button>
        ))}
      </div>
      {keep !== null && order.length === 2 && (
        <div className="ll-order">
          <span>放回顺序（从上到下）：<b>{ROLE_NAME[order[0]!.role]}</b> → <b>{ROLE_NAME[order[1]!.role]}</b>（最底下）</span>
          <button className="quiet-button" type="button" data-tutorial="chancellor-swap" onClick={() => setFlip(!flip)}>换顺序</button>
        </div>
      )}
      <div className="gm-panel-actions">
        <button className="primary-button" type="button" disabled={keep === null} data-tutorial="chancellor-confirm" onClick={submit}>
          {keep === null ? "先点要留下的那张" : `留下${ROLE_NAME[hand[keep]!]}，放回${order.map((card) => ROLE_NAME[card.role]).join("、")}`}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- 秘密结果：只有当事人看到 ---------- */

export type Reveal =
  | { kind: "peek"; target: string; card: Role }
  | { kind: "compare"; player: string; target: string; playerCard: Role; targetCard: Role; loser: string | null }
  | { kind: "swap"; player: string; target: string; playerGot: Role; targetGot: Role };

export function RevealDialog({ reveal, me, name, seatOf, scale, onClose }: {
  reveal: Reveal;
  me: string;
  name: (id: string) => string;
  seatOf: (id: string) => number;
  scale: number;
  onClose: () => void;
}) {
  let title: string;
  let body: ReactNode;
  let note: string;
  if (reveal.kind === "peek") {
    title = `${name(reveal.target)} 的手牌`;
    note = "只有你看到了。记住它，等会儿用卫兵猜、或者决定要不要和他比牌。";
    body = (
      <div className="ll-reveal-cards">
        <figure><Card role={reveal.card} scale={scale} /><figcaption><Seal seat={seatOf(reveal.target)} /> {name(reveal.target)}</figcaption></figure>
      </div>
    );
  } else if (reveal.kind === "compare") {
    const result = reveal.loser ? `${name(reveal.loser)} 点数小，出局` : "一样大，谁都不出局";
    title = `比牌：${result}`;
    note = "比的是手里剩下的那张。只有你们俩看到对方的牌，别人只看到结果。";
    body = (
      <div className="ll-reveal-cards duel">
        <figure className={reveal.loser === reveal.player ? "lost" : ""}><Card role={reveal.playerCard} scale={scale} /><figcaption><Seal seat={seatOf(reveal.player)} /> {name(reveal.player)}</figcaption></figure>
        <Sprite name="duel" scale={2} mode="once" className="ll-duel-fx" />
        <figure className={reveal.loser === reveal.target ? "lost" : ""}><Card role={reveal.targetCard} scale={scale} /><figcaption><Seal seat={seatOf(reveal.target)} /> {name(reveal.target)}</figcaption></figure>
      </div>
    );
  } else {
    const iAmPlayer = reveal.player === me;
    const got = iAmPlayer ? reveal.playerGot : reveal.targetGot;
    const gave = iAmPlayer ? reveal.targetGot : reveal.playerGot;
    const other = iAmPlayer ? reveal.target : reveal.player;
    title = iAmPlayer ? `你和 ${name(other)} 换了手牌` : `${name(other)} 用国王和你换了手牌`;
    note = `现在你拿着${ROLE_NAME[got]}，${name(other)} 拿着你原来的${ROLE_NAME[gave]}——你们俩都知道对方的牌。`;
    body = (
      <div className="ll-reveal-cards">
        <figure><Card role={gave} scale={scale} /><figcaption>给了 {name(other)}</figcaption></figure>
        <Icon name="swap" scale={3} className="ll-swap-icon" />
        <figure className="got"><Card role={got} scale={scale} /><figcaption>你拿到</figcaption></figure>
      </div>
    );
  }
  return (
    <Modal className="ll-reveal" label={title} onClose={onClose} anchor="reveal-dialog">
      <h2 data-tutorial="reveal"><Icon name={reveal.kind === "peek" ? "eye" : reveal.kind === "compare" ? "duel" : "swap"} /> {title}</h2>
      {body}
      <p className="ll-dialog-note">{note}</p>
      <div className="gm-panel-actions">
        <button className="primary-button" type="button" autoFocus data-tutorial="reveal-ok" onClick={onClose}>知道了</button>
      </div>
    </Modal>
  );
}

/* ---------- 一小局结算 ---------- */

export function RoundResultDialog({ game, room, me, name, seconds, compact = false, onReady, onHide, onCancelAuto }: {
  game: GameState;
  /** 托管中：弹窗里放一个「取消托管」（弹窗盖住了牌桌上那个）。 */
  onCancelAuto?: () => void;
  /** 手机：亮牌用小牌。 */
  compact?: boolean;
  room: LobbyRoomSnapshot;
  me: string;
  name: (id: string) => string;
  seconds: number | null;
  onReady: () => void;
  onHide: () => void;
}) {
  const result = game.lastRound!;
  const target = game.config.tokensToWin;
  const winners = result.winners;
  const iWon = winners.includes(me);
  const title = winners.length > 1 ? `平局：${winners.map(name).join("、")} 都赢` : `${name(winners[0]!)} 赢下第 ${result.round} 小局`;
  const humans = room.members.filter((member) => !member.bot && member.connected && !member.auto);
  const readyCount = humans.filter((member) => game.ready.includes(member.playerId)).length;
  const iAmReady = game.ready.includes(me);
  const canReady = me !== "" && game.phase === "roundEnd" && !iAmReady;
  const order = [...game.players].sort((a, b) => Number(winners.includes(b.id)) - Number(winners.includes(a.id)) || b.tokens - a.tokens);
  return (
    <Modal className="ll-result" label="一小局结算" anchor="result-dialog">
      <div className="ll-banner" style={{ backgroundImage: `url(${art.banner})` }} data-tutorial="round-result">
        <span>{iWon ? "你赢了这一小局" : `第 ${result.round} 小局结束`}</span>
      </div>
      <h2>{title}</h2>
      <p className="ll-dialog-note">{result.reason === "showdown" ? "牌堆抽完了，还在局中的人亮牌比点数。" : "其他人都出局了，最后留下的人直接赢。"}</p>
      {Object.keys(result.hands).length > 0 && (
        <div className="ll-showdown" data-tutorial="showdown">
          {game.players.filter((player) => result.hands[player.id]).map((player) => {
            const role = result.hands[player.id]!;
            return (
              <figure key={player.id} className={winners.includes(player.id) ? "winner" : ""}>
                {winners.includes(player.id) && <Icon name="crown" className="ll-crown" />}
                {compact ? <Mini role={role} scale={1} /> : <Card role={role} scale={1} title={roleLabel(role)} />}
                <figcaption><Seal seat={player.seat} /><span>{name(player.id)}</span></figcaption>
              </figure>
            );
          })}
        </div>
      )}
      <ul className="ll-result-list" data-tutorial="round-tokens">
        {order.map((player) => {
          const award = result.awards[player.id] ?? 0;
          const winner = winners.includes(player.id);
          return (
            <li key={player.id} className={[winner ? "winner" : "", player.out ? "out" : ""].join(" ")} style={{ "--seat-color": seatColor(player.seat) } as CSSProperties}>
              <Seal seat={player.seat} />
              <span className="ll-result-name">
                <strong>{name(player.id)}</strong>
                <small>
                  {winner && <><Icon name="crown" scale={1} /> 赢 +1</>}
                  {result.spyBonus === player.id && <><Icon name="spy" scale={1} /> 间谍 +1</>}
                  {player.out && !winner && <><Icon name="out" scale={1} /> 出局</>}
                  {!winner && !player.out && result.reason === "showdown" && "点数小了"}
                </small>
              </span>
              <span className="ll-result-tokens">
                <Icon name="favor" />
                <b>{player.tokens}<small>/{target}</small></b>
                {award > 0 && <em className="ll-plus">+{award}</em>}
                {award > 0 && <Sprite name="favor" scale={1} mode="once" className="ll-favor-fx" />}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ll-result-aside" data-tutorial="round-aside">
        <Icon name="sealed" />
        {result.setAside ? (
          <><span>开局移出的那张是</span><Mini role={result.setAside} scale={1} /><b>{ROLE_NAME[result.setAside]}</b></>
        ) : (
          <span>开局移出的那张被王子点到的人拿走了（亮牌里能看到）</span>
        )}
      </div>
      {game.phase === "roundEnd" && (
        <div className="ll-result-next">
          <span data-tutorial="next-starter">
            {onCancelAuto ? "托管中：人机替你出牌 · " : ""}
            {result.nextStarter ? `下一局 ${name(result.nextStarter)} 先手` : ""}
            {humans.length > 0 ? ` · 已准备 ${readyCount}/${humans.length}` : ""}
          </span>
          <div className="gm-panel-actions">
            <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
            {onCancelAuto && (
              <button className="primary-button" type="button" data-tutorial="cancel-auto-dialog" onClick={onCancelAuto}>取消托管</button>
            )}
            {me !== "" && !onCancelAuto && (
              <button className="primary-button" type="button" disabled={!canReady} data-tutorial="next-round-button" onClick={onReady}>
                {iAmReady ? `等其他人${seconds !== null ? `（${seconds}s）` : ""}` : `下一局${seconds !== null ? `（${seconds}s）` : ""}`}
              </button>
            )}
          </div>
        </div>
      )}
      {game.phase === "finished" && (
        <div className="gm-panel-actions">
          {onCancelAuto && <button className="quiet-button" type="button" data-tutorial="cancel-auto-dialog" onClick={onCancelAuto}>取消托管</button>}
          <button className="primary-button" type="button" onClick={onHide}>看整场结果</button>
        </div>
      )}
    </Modal>
  );
}

/* ---------- 整场结束 ---------- */

export function FinalDialog({ game, room, me, spectating, name, onRematch, onLeave, onHide, onCancelAuto, actions }: {
  game: GameState;
  /** 有就用它代替「再来一局」那一段（新手教程的练习局：结束教程 / 再练一场）。 */
  actions?: ReactNode;
  onCancelAuto?: () => void;
  room: LobbyRoomSnapshot;
  me: string;
  spectating: boolean;
  name: (id: string) => string;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
  onHide: () => void;
}) {
  const winners = game.winners ?? [];
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const standings = [...game.players].sort((a, b) => b.tokens - a.tokens || a.seat - b.seat);
  const iWon = winners.includes(me);
  return (
    <Modal className="ll-final" label="整场结束" anchor="final-dialog">
      <div className="ll-petals" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index} style={{ "--i": index } as CSSProperties}><Sprite name="petal" scale={2} delay={-index * 150} /></span>
        ))}
      </div>
      <div className="ll-banner big" style={{ backgroundImage: `url(${art.banner})` }} data-tutorial="final-result"><span>{iWon ? "情书送达" : "整场结束"}</span></div>
      <img className="ll-letter-win" src={art.letterWin} width={128} height={96} alt="" />
      <h2>{winners.length > 1 ? `${winners.map(name).join("、")} 一起赢了` : `${name(winners[0] ?? "")} 赢得了公主的心`}</h2>
      <ol className="ll-standings">
        {standings.map((player, index) => (
          <li key={player.id} className={winners.includes(player.id) ? "winner" : ""} style={{ "--seat-color": seatColor(player.seat) } as CSSProperties}>
            <span className="ll-rank">{winners.includes(player.id) ? <Icon name="crown" /> : index + 1}</span>
            <Seal seat={player.seat} />
            <strong>{name(player.id)}</strong>
            <span className="ll-result-tokens"><Icon name="favor" /><b>{player.tokens}<small>/{game.config.tokensToWin}</small></b></span>
          </li>
        ))}
      </ol>
      {actions && !spectating ? (
        <div className="gm-panel-actions ll-final-actions">
          <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
          {actions}
        </div>
      ) : spectating ? (
        <div className="ll-rematch">
          <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
          <div className="gm-panel-actions">
            <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
            <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
          </div>
        </div>
      ) : room.rematch ? (
        <div className="ll-rematch">
          <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
          <div className="gm-panel-actions">
            <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
            <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
            <button className="primary-button" type="button" disabled={accepted} data-tutorial="rematch-button" onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
          </div>
        </div>
      ) : (
        <div className="gm-panel-actions">
          <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
        </div>
      )}
      {onCancelAuto && (
        <div className="ll-dialog-auto" role="status">
          <span>托管中：人机替你出牌</span>
          <button className="quiet-button" type="button" data-tutorial="cancel-auto-dialog" onClick={onCancelAuto}>取消托管</button>
        </div>
      )}
    </Modal>
  );
}

/** 牌的一行说明（操作区、手牌悬浮）。 */
export function roleHint(role: Role): string {
  return `${ROLE_VALUE[role]} ${ROLE_NAME[role]}：${ROLE_SHORT[role]}`;
}
