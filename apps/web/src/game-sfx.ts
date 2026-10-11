/**
 * 情书的动作音效：按服务器（或教程）每一步下发的 game.events 配声音。gm-sound.tsx 是全站共用的音效库，这里只挑、组合、排时间。
 *
 * - 自己的动作 mine=true 响亮，别人的减半（观战时全算别人的）。「被点名」的那一下（被卫兵猜中、被比输、被换牌）也算自己的，响亮。
 * - 第一次拿到对局（进房间、重连、观战刚进来）不出声；version 一下跳了好几步（重连）不出声；
 *   version 变小 = 再来一场 / 练习局重开，只响一声开局。
 * - 一步里的几个声音按「出牌 → 效果 → 出局 → 结算 → 轮到谁」错开几百毫秒，听起来是一个动作的结果。
 *
 * 招牌声音（synth 组合）：侍女的护盾铃、男爵比牌的剑碰剑、国王换牌的一来一回、出局时蜡烛被吹灭（牌桌上出局的人蜡烛会熄）。
 */
import { useEffect, useRef } from "react";
import type { GameEvent, GameState } from "@loveletter/game";
import { sfx, synth } from "./gm-sound.js";

const { tone, noise, level, jitter } = synth;

/** 开发时把响过的声音名字记到 window.__sfxLog（自测脚本看它），线上不记。 */
function log(name: string) {
  if (import.meta.env.DEV) (window as unknown as { __sfxLog?: string[] }).__sfxLog?.push(name);
}

/** 情书自己的几种声音。 */
export const llSfx = {
  /** 侍女：护盾升起的铃声（两层泛音 + 一点亮晶晶的气声）。 */
  shield(mine: boolean) {
    const v = level(mine);
    tone(1568, { duration: 0.5, volume: 0.12 * v, type: "sine" });
    tone(2349, { at: 0.05, duration: 0.6, volume: 0.08 * v, type: "sine" });
    tone(3136, { at: 0.1, duration: 0.45, volume: 0.04 * v, type: "triangle" });
    noise({ duration: 0.4, volume: 0.06 * v, filter: "highpass", freq: 6000 });
  },
  /** 侍女保护到期：铃声往下收。 */
  shieldOff(mine: boolean) {
    const v = level(mine) * 0.7;
    tone(2349, { duration: 0.25, volume: 0.06 * v, glideTo: 1568 });
  },
  /** 男爵比牌：两把剑碰一下（不和谐的金属泛音）。tie 时再碰一下，弱一点。 */
  clash(mine: boolean, tie: boolean) {
    const v = level(mine);
    const hit = (at: number, k: number) => {
      const p = jitter(0.04);
      noise({ at, duration: 0.05, volume: 0.3 * v * k, filter: "highpass", freq: 3500 });
      tone(2637 * p, { at, duration: 0.35, volume: 0.07 * v * k, type: "square" });
      tone(3729 * p, { at, duration: 0.28, volume: 0.05 * v * k, type: "square" });
      tone(1245 * p, { at, duration: 0.4, volume: 0.08 * v * k, type: "triangle" });
    };
    hit(0, 1);
    if (tie) hit(0.22, 0.6);
  },
  /** 国王换牌：两张牌一来一回地擦过去。 */
  swap(mine: boolean) {
    const v = level(mine);
    noise({ duration: 0.16, volume: 0.22 * v, freq: 1200, freqTo: 4200, q: 0.8 });
    noise({ at: 0.18, duration: 0.16, volume: 0.22 * v, freq: 4200, freqTo: 1200, q: 0.8 });
    tone(523, { at: 0.02, duration: 0.14, volume: 0.07 * v, type: "triangle", glideTo: 784 });
    tone(784, { at: 0.2, duration: 0.16, volume: 0.07 * v, type: "triangle", glideTo: 523 });
  },
  /** 出局：蜡烛被吹灭（一口气 + 往下沉的一声）。 */
  snuff(mine: boolean) {
    const v = level(mine);
    noise({ duration: 0.32, volume: 0.22 * v, filter: "lowpass", freq: 2200, freqTo: 300 });
    tone(392, { at: 0.08, duration: 0.45, volume: 0.1 * v, type: "triangle", glideTo: 147 });
  },
  /** 卫兵猜错：空挥一下。 */
  whiff(mine: boolean) {
    const v = level(mine);
    noise({ duration: 0.18, volume: 0.16 * v, freq: 2600, freqTo: 700, q: 1.2 });
    tone(330, { at: 0.12, duration: 0.12, volume: 0.06 * v, type: "triangle" });
  },
  /** 别人在结算画面点了「下一局」。 */
  ready(mine: boolean) {
    tone(1175, { duration: 0.1, volume: 0.07 * level(mine), type: "triangle" });
  },
};

type Name = keyof typeof sfx | `ll.${keyof typeof llSfx}`;

/** 还没响的延时声音：新一小局开始时扔掉上一局结算没响完的，免得和洗牌发牌叠在一起。 */
const pending = new Set<number>();
function dropPending() {
  for (const timer of pending) window.clearTimeout(timer);
  pending.clear();
}

/** 在 at 毫秒后响一声，并记下名字。 */
function play(at: number, name: Name, run: () => void) {
  const go = () => {
    log(name);
    run();
  };
  if (at <= 0) {
    go();
    return;
  }
  const timer = window.setTimeout(() => {
    pending.delete(timer);
    go();
  }, at);
  pending.add(timer);
}

/** 选中 / 取消、点了不能点的：牌桌上的点击反馈。 */
export const pickSfx = {
  select(on = true) {
    log(on ? "select" : "unselect");
    sfx.select(on);
  },
  deny() {
    log("deny");
    sfx.deny();
  },
};

/**
 * 把一步的事件配上声音。me 是自己的座位 id（观战是空字符串）。
 */
export function playStep(events: readonly GameEvent[], me: string, state: GameState) {
  const mine = (id: string | undefined) => me !== "" && id === me;
  // 超时：先响超时（自己的），后面的动作往后挪
  let t = 0;
  const timeout = events.find((event) => event.type === "TurnTimedOut");
  if (timeout) {
    if (mine(timeout.player)) play(0, "timeout", () => sfx.timeout());
    t = mine(timeout.player) ? 450 : 0;
  }
  // 这一步出牌的人：后面「轮到谁」时，判断是不是从自己手里交出去的
  let actor: string | undefined;
  for (const event of events) {
    switch (event.type) {
      case "Played":
        actor = event.player;
        play(t, "card", () => sfx.card(mine(event.player)));
        t += 280;
        break;
      case "NoEffect":
        play(t, "pass", () => sfx.pass(mine(event.player)));
        t += 250;
        break;
      case "Guessed": {
        const loud = mine(event.player) || mine(event.target);
        if (event.hit) play(t, "hit", () => sfx.hit(loud));
        else play(t, "ll.whiff", () => llSfx.whiff(loud));
        t += 300;
        break;
      }
      case "Peeked":
        play(t, "reveal", () => sfx.reveal(mine(event.player) || mine(event.target)));
        t += 300;
        break;
      case "Compared":
        play(t, "ll.clash", () => llSfx.clash(mine(event.player) || mine(event.target), event.loser === null));
        t += event.loser === null ? 450 : 330;
        break;
      case "Protected":
        play(t, "ll.shield", () => llSfx.shield(mine(event.player)));
        t += 300;
        break;
      case "Discarded":
        play(t, "flip", () => sfx.flip(mine(event.player) || mine(event.by)));
        t += 300;
        break;
      case "Drew":
        if (event.reason === "prince") {
          play(t, "draw", () => sfx.draw(mine(event.player)));
          t += 220;
        } else if (mine(event.player)) {
          // 自己回合开始摸的那张：和「轮到你」一起响
          play(t + 80, "draw", () => sfx.draw(true));
          t += 200;
        }
        break;
      case "ChancellorDrew":
        play(t, "draw", () => sfx.draw(mine(event.player), event.count));
        t += 120 + event.count * 70;
        break;
      case "ChancellorReturned":
        actor ??= event.player;
        play(t, "card", () => sfx.card(mine(event.player), event.count));
        t += 250;
        break;
      case "Swapped":
        play(t, "ll.swap", () => llSfx.swap(mine(event.player) || mine(event.target)));
        t += 380;
        break;
      case "Eliminated":
        t += 100;
        if (mine(event.player)) {
          play(t, "bust", () => sfx.bust(true));
          play(t + 250, "ll.snuff", () => llSfx.snuff(true));
        } else play(t, "ll.snuff", () => llSfx.snuff(mine(event.by)));
        t += 450;
        break;
      case "RoundEnded": {
        const { result } = event;
        t += 200;
        if (result.reason === "showdown") {
          play(t, "reveal", () => sfx.reveal(true));
          t += 350;
        }
        const won = result.winners.includes(me);
        play(t, "score", () => sfx.score(won, won));
        t += 350;
        if (result.spyBonus !== null) {
          play(t, "sparkle", () => sfx.sparkle(mine(result.spyBonus!)));
          t += 300;
        }
        break;
      }
      case "Ready":
        if (!mine(event.player)) play(t, "ll.ready", () => llSfx.ready(false));
        break;
      case "GameEnded":
        play(t + 500, "gameOver", () => sfx.gameOver(event.winners.includes(me)));
        t += 500;
        break;
      case "RoundStarted":
        dropPending();
        play(t, "shuffle", () => sfx.shuffle());
        play(t + 350, "deal", () => sfx.deal(state.players.length));
        play(t + 350 + state.players.length * 60 + 150, "roundStart", () => sfx.roundStart());
        t += 900 + state.players.length * 60;
        break;
      case "TurnStarted":
        if (mine(event.player)) {
          if (event.protectionEnded) play(t, "ll.shieldOff", () => llSfx.shieldOff(true));
          play(t + 250, "yourTurn", () => sfx.yourTurn());
        } else if (actor !== undefined && mine(actor)) {
          play(t + 150, "turnPassed", () => sfx.turnPassed());
        }
        break;
      case "TurnTimedOut":
        break;
    }
  }
}

/**
 * 牌桌调用：game.version 每变一次，按这一步的 events 出声。me 是自己的座位 id（观战传空字符串）。
 */
export function useGameSfx(game: GameState, me: string) {
  const prev = useRef<{ version: number; me: string } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { version: game.version, me };
    if (!before || before.me !== me) return; // 第一次拿到 / 观战换了视角：不出声
    if (game.version === before.version) return;
    if (game.version < before.version) {
      // 再来一场、练习局重开
      dropPending();
      play(0, "gameStart", () => sfx.gameStart());
      return;
    }
    // 一下跳了好几步（重连）：不补放。超时一个回合可能连走两步（出牌 + 大臣留牌），算正常。
    if (game.version - before.version > 3) return;
    playStep(game.events, me, game);
  }, [game.version, me]);
}
