/**
 * 情书的新手教程：在浏览器里按剧本走（./script.ts），牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；
 * 剧本走完接着把这一整场打完（练习局），对手交给人机，可以点「提示」。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 *
 * 和欲罢不能的 TutorialMode 一样接 useTutorial；多出来的是「一步要点好几下」：
 * 每 150 毫秒看一眼界面（哪张牌选中了、选人按钮在不在、猜牌框开没开），决定这一下高亮哪里、咕噜嘎说哪句。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  botCommand,
  DEFAULT_ROOM_ACCESS,
  redactGameForViewer,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
} from "@loveletter/game";
import GameBoard from "../GameBoard.js";
import type { Theme } from "../theme.js";
import { anchorSelector, Coach, isTouchDevice, StepPips, type CoachView } from "./Coach.js";
import { GAME_ID } from "./hints.js";
import {
  createPracticeGame,
  createTutorialGame,
  resolveAnchor,
  RIVAL_1,
  RIVAL_2,
  RIVAL_NAMES,
  sameCommand,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  tutorialApply,
  type Cond,
  type SubStep,
  type TutorialStep,
} from "./script.js";
import { writeTutorial } from "./storage.js";
import { useTutorial } from "./useTutorial.js";
import "./ll-tutorial.css";

const SELF_MEMBER = "tutorial-self";
/** 房间码只用来按哈希挑背景场景。 */
const TUTORIAL_CODE = "GULU01";

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

export default function TutorialMode({ name, brand, themeToggle, theme, waitingRoom, onExit }: {
  /** 首页填过的昵称；没填叫「新玩家」。 */
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  theme: Theme;
  /** 从等候房间点进来的：那个房间的房间码。 */
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  // 剧本进行中（不是练习局）：点「下一局」换成残局。每次渲染更新，引擎的 apply 读它。
  const scriptRef = useRef(true);

  const tutorial = useTutorial<GameState, GameCommand, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName),
    restart: () => createPracticeGame(selfName, randomSeed()),
    apply: (state, playerId, command) => tutorialApply(state, playerId, command, scriptRef.current, selfName),
    same: sameCommand,
    actor: tutorialActor,
    bot: (state, playerId) => botCommand(redactGameForViewer(state, playerId), playerId),
    // 人机出牌前停一下，让人看清上一步；大臣留牌快一点
    botDelay: (state) => (state.stage === "chancellor" ? 900 : 1500),
    watchDelay: () => 1300,
  });
  const { game, step, index, practice, flash } = tutorial;
  scriptRef.current = !practice;

  // 走到最后一步就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  // ---------- 一步里的「这一下」：看界面决定 ----------
  const [sub, setSub] = useState(0);
  const untilDone = useRef<string | null>(null);
  // 讲解步骤的高亮元素在这个尺寸的界面上一直不出现（比如手机上收起来的东西）：1.2 秒后不指它，照样讲
  const [lostAnchor, setLostAnchor] = useState<string | null>(null);
  // 高亮的弹窗太高、放不下对话框时（手机、矮屏）：改指弹窗里要点的那个按钮（anchorSmall）
  const [tallAnchor, setTallAnchor] = useState<string | null>(null);
  useEffect(() => {
    setSub(0);
    setLostAnchor(null);
    setTallAnchor(null);
    if (!step) return;
    let missingSince: number | null = null;
    let lastScroll = 0;
    const check = () => {
      // 高亮的东西只露出一部分（手机上常见，比如记牌条在屏幕最下沿）：滚到能看全的地方（首发验收 I16）。
      // 共用 Coach 只在第一次找到、而且整个在屏幕外时才滚；这里每 0.8 秒最多补滚一次，不和玩家自己滑动抢。
      const want = document.querySelector("[data-tut-anchor]")?.getAttribute("data-tut-anchor");
      const target = want ? document.querySelector<HTMLElement>(anchorSelector(want)) : null;
      if (target && performance.now() - lastScroll > 800) {
        const rect = target.getBoundingClientRect();
        const fits = rect.height <= window.innerHeight - 16;
        if (fits && (rect.top < 0 || rect.bottom > window.innerHeight)) {
          lastScroll = performance.now();
          target.scrollIntoView({ block: "center" });
        }
      }
      if (step.kind === "info" && step.anchor && !step.subs && !step.until) {
        const resolved = resolveAnchor(game, step.anchor);
        const present = document.querySelector(anchorSelector(resolved));
        if (present) missingSince = null;
        else {
          missingSince ??= performance.now();
          if (performance.now() - missingSince > 1200) setLostAnchor(resolved);
        }
      }
      const subs = step.subs ?? [];
      let at = 0;
      subs.forEach((candidate, position) => {
        if (position > 0 && candidate.when && condMet(game, candidate.when)) at = position;
      });
      setSub(at);
      const current = subs[at] ?? step;
      if (current.anchor && current.anchorSmall) {
        const resolved = resolveAnchor(game, current.anchor);
        const rect = document.querySelector(anchorSelector(resolved))?.getBoundingClientRect();
        const dock = document.querySelector(".tut-dock")?.getBoundingClientRect();
        // 弹窗上面、下面都留不出对话框的高度（加上边距）就算太高
        const need = (dock?.height ?? 160) + 28;
        if (rect && Math.max(rect.top, window.innerHeight - rect.bottom) < need) setTallAnchor(resolved);
      }
      if (step.kind === "info" && step.until && untilDone.current !== step.id && condMet(game, step.until)) {
        untilDone.current = step.id;
        tutorial.next();
      }
    };
    check();
    const timer = window.setInterval(check, 150);
    return () => window.clearInterval(timer);
  }, [step?.id, game.version]);

  const members = useMemo<LobbyMember[]>(() => [
    { id: SELF_MEMBER, playerId: TUTORIAL_SELF, name: selfName, isHost: false, connected: true },
    { id: "tutorial-bot-1", playerId: RIVAL_1, name: RIVAL_NAMES[RIVAL_1]!, isHost: false, connected: true, bot: true },
    { id: "tutorial-bot-2", playerId: RIVAL_2, name: RIVAL_NAMES[RIVAL_2]!, isHost: false, connected: true, bot: true },
  ], [selfName]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: TUTORIAL_CODE,
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    capacity: 3,
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: redactGameForViewer(game, TUTORIAL_SELF),
  }), [game, members]);

  let view: CoachView | null = null;
  if (step) {
    const current: SubStep | TutorialStep = step.subs?.[Math.min(sub, step.subs.length - 1)] ?? step;
    const touchNote = isTouchDevice() && current.noteTouch ? current.noteTouch : current.note;
    const finale = step.kind === "info" && step.finale === true;
    const waiting = step.kind === "info" && step.until !== undefined;
    view = {
      key: step.subs ? `${step.id}-${sub}` : step.id,
      say: current.say,
      ...(touchNote ? { note: touchNote } : {}),
      ...(flash ? { flash } : {}),
      anchor: pickAnchor(game, current, lostAnchor, tallAnchor),
      focus: step.kind !== "watch",
      face: flash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={index} total={TUTORIAL_STEPS.length} />
          {!finale && <button className="tut-link" type="button" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" || waiting ? null : finale ? (
        <>
          <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" onClick={tutorial.startPractice}>和人机打完这一场</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  // 剧本进行中和练习局的侧栏挤法不一样（见 ll-tutorial.css 的 .tut-script / .tut-practice）
  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={
          <>
            <span className="connection-status online"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button tut-exit" type="button" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        theme={theme}
        chat={null}
        sideExtra={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} />}
        onCommand={tutorial.onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={SELF_MEMBER}
        mode={practice ? "practice" : "tutorial"}
        finalActions={
          <>
            <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
            <button className="primary-button" type="button" onClick={tutorial.newPractice}>再练一场</button>
          </>
        }
      />
      {view && <Coach view={view} />}
      {/* 给走查脚本看的：现在第几步、高亮哪里（不显示） */}
      {step && view && (
        <span hidden data-tut-step={step.id} data-tut-kind={step.kind} data-tut-anchor={view.anchor ?? ""} data-tut-lost={lostAnchor ?? ""} data-tut-wait={step.kind === "info" && step.until ? "1" : "0"} />
      )}
    </div>
  );
}

/** 这一下高亮哪里：按局面换算；在这个尺寸上找不到就不指；弹窗太高就改指 anchorSmall。 */
function pickAnchor(game: GameState, current: SubStep | TutorialStep, lost: string | null, tall: string | null): string | null {
  if (!current.anchor) return null;
  const resolved = resolveAnchor(game, current.anchor);
  if (resolved === lost) return null;
  if (resolved === tall && current.anchorSmall) return resolveAnchor(game, current.anchorSmall);
  return resolved;
}

/** 界面条件：按锚点去页面上找元素（card:… / keep:… 先按局面换算成 hand-… / chancellor-keep-…）。 */
function condMet(game: GameState, cond: Cond): boolean {
  const find = (anchor: string) => document.querySelector<HTMLElement>(anchorSelector(resolveAnchor(game, anchor)));
  const shown = (element: HTMLElement | null) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };
  if (cond.pressed && find(cond.pressed)?.getAttribute("aria-pressed") !== "true") return false;
  if (cond.present && !shown(find(cond.present))) return false;
  if (cond.enabled) {
    const element = find(cond.enabled);
    if (!shown(element) || (element as HTMLButtonElement).disabled) return false;
  }
  if (cond.absent && shown(find(cond.absent))) return false;
  return true;
}

/** 侧栏的教程进度：剧本进行中列出这次学哪几样；练习局只留一句话。 */
function Checklist({ index, practice, waitingRoom }: { index: number; practice: boolean; waitingRoom: string | undefined }) {
  const lessons = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);
  // 一课从它那一步开始，到下一课开始时算学完
  const endOf = (position: number) => lessons[position + 1]?.at ?? TUTORIAL_STEPS.length;
  const done = lessons.filter((_, position) => index >= endOf(position)).length;
  return (
    <section className="tut-checklist ll-tut-progress" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局 <small>教程学完了</small></h3>
          <p>拿不准就点操作区的「提示」（键盘 H），我告诉你我会怎么打。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{lessons.length}</small></h3>
          <ul>
            {lessons.map(({ step, at }, position) => {
              const state = index >= endOf(position) ? "done" : index >= at ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
    </section>
  );
}
