import { useState } from "react";
import { ROLE_COUNT, ROLE_NAME, ROLE_VALUE, ROLES, type Role } from "@loveletter/game";

/** 每种牌一句话（自己的话，不照搬原版规则书）。 */
const EFFECT: Record<Role, string> = {
  spy: "没有效果。一小局结束时，还在局中的人里只有你打出或弃掉过间谍，额外拿 1 枚标记。",
  guard: "点一个别人，猜一个角色（不能猜卫兵）；猜中他就出局。",
  priest: "偷看一个别人的手牌，只有你看得到。",
  baron: "和一个别人比手里剩下那张的点数，小的出局；一样大都没事。",
  handmaid: "到你下一回合开始前，别人的牌都不能选你。",
  prince: "点任何人（可以是自己）弃掉手牌重抽一张；弃掉公主就出局。",
  chancellor: "抽 2 张，三张里留 1 张，另外 2 张按你定的顺序放回牌堆底。",
  king: "和一个别人交换手牌。",
  countess: "没有效果；手里另一张是国王或王子时必须打她。",
  princess: "自己打出或被弃掉都立刻出局。",
};

/** 规则说明：用自己的话写，不照搬原版规则书。正式版由界面阶段排版。 */
function GameRules() {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>
              每人手里只有一张牌。轮到你时抽一张，再从两张里打出一张、照它的效果做。撑到最后一个，
              或者牌堆抽完时手里点数最大，就赢下这一小局、拿 1 枚钟情标记。2/3/4/5/6 人分别攒到 6/5/4/3/3 枚赢整场。
            </p>
          </div>
          <div className="game-rules-block">
            <h3>21 张牌</h3>
            <ul>
              {ROLES.map((role) => (
                <li key={role}><b>{ROLE_VALUE[role]} {ROLE_NAME[role]}</b>（{ROLE_COUNT[role]} 张）：{EFFECT[role]}</li>
              ))}
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>一小局结束</h3>
            <p>只剩一个人就他赢；牌堆抽完时亮牌比大小，一样大都算赢。下一小局由赢家先手。每一步限时 30 秒，超时系统替你打完这一回合；连续两次超时转人机托管。</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
