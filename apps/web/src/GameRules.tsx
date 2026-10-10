import { useEffect, useState } from "react";
import { ROLE_COUNT, ROLE_NAME, ROLE_VALUE, ROLES } from "@loveletter/game";
import { Icon, Mini } from "./Cards.js";
import { ROLE_EFFECT } from "./describe.js";

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，不照搬原版规则书；21 张牌配小牌图。 */
function GameRules({ className = "quiet-button" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className={`${className} ll-rules-button`} type="button" aria-expanded={open} data-tutorial="rules-button" onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop ll-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="gm-panel ll-rules" role="dialog" aria-modal="true" aria-labelledby="ll-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="ll-rules-title"><Icon name="letter" /> 情书怎么玩</h2>
            <div className="game-rules-block">
              <h3>目标</h3>
              <p>
                每人手里只拿 <b>1 张牌</b>。一小局里撑到最后一个人，或者牌堆抽完时手里点数最大，就赢下这一小局、拿 1 枚<b>钟情标记</b>。
                2 / 3 / 4 / 5 / 6 人局分别先攒到 <b>6 / 5 / 4 / 3 / 3</b> 枚的人赢整场（可以几个人一起赢）。
              </p>
            </div>
            <div className="game-rules-block">
              <h3>轮到你</h3>
              <ol>
                <li>先抽 1 张，手里变成 2 张。</li>
                <li>从 2 张里<b>打出 1 张</b>，摆到自己面前，照它的效果做（对自己不利也得做）。另一张留在手里。</li>
                <li>要选人的牌只能选还在局中、没受侍女保护的人；一个都选不了时这张就白打。</li>
              </ol>
            </div>
            <div className="game-rules-block">
              <h3>21 张牌（牌桌中央的记牌条悬停也能看）</h3>
              <ul className="ll-ref">
                {ROLES.map((role) => (
                  <li key={role}>
                    <Mini role={role} />
                    <span>
                      <b>{ROLE_VALUE[role]} {ROLE_NAME[role]}<small>×{ROLE_COUNT[role]}</small></b>
                      <em>{ROLE_EFFECT[role]}</em>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>出局和一小局结束</h3>
              <ul>
                <li>出局的人亮出手牌，这一小局不再轮到他，别人也不能选他。</li>
                <li>只剩一个人时他立刻赢；牌堆抽完的那个回合结束后，还在局的人亮牌比点数，<b>一样大就都算赢</b>，各拿 1 枚。</li>
                <li>间谍：一小局结束时，还在局中的人里<b>只有你</b>打过或弃过间谍，再多拿 1 枚（可以和赢的那枚叠加）。</li>
                <li>开局面朝下移出 1 张牌，一般谁都拿不到，结束时亮出来；只有牌堆抽空后有人被王子点到，才由他拿走这张。2 人局另外面朝上移出 3 张，谁都拿不到。</li>
                <li>下一小局由上一局的赢家先手；几个人并列赢时，在他们当中随机挑一个。</li>
              </ul>
            </div>
            <div className="game-rules-block">
              <h3>时间和托管</h3>
              <p>
                每一步限时 30 秒，超时由人机替你打完这一回合；连续两次超时转人机托管，点「取消托管」就能收回。掉线时也由人机代打，回来接着玩。
              </p>
            </div>
            <div className="gm-panel-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
