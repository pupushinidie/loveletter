# 情书（Love Letter）

2–6 人的宫廷推理卡牌游戏，网页联机版。整副只有 21 张角色牌，每人手里永远只有一张：轮到你时抽一张，再从两张里打出一张、照它的效果做。撑到最后一个、或者牌堆抽完时手里点数最大，就赢下这一小局，拿一枚钟情标记；先攒够标记的人赢整场。界面文案、规则说明和美术都是自己的（2019 六人版的规则，21 张、10 种角色，不做经典版变体）。

线上地址（上线后）：<https://gulugagame.com/loveletter/>

## 本地运行

```bash
npm install
npm run dev          # 服务器 :3017，网页 :5190
npm test             # 139 项：规则书用例 90、2–6 人各 300 整场随机对局、隐藏信息、预览局面、服务器 19
npm run typecheck    # 规则包、测试、服务器、网页
BASE_PATH=/loveletter/ npm run build
```

端口从环境变量读：`WEB_PORT`（网页，默认 5190）、`SERVER_PORT`（服务器，默认 3017；线上 pm2 用 `PORT`）。另起一套服务时 `WEB_PORT=5290 SERVER_PORT=3117 npm run dev`，vite 的代理和服务器允许的开发来源会一起跟着变。

改了 `packages/game` 要先 `npm run build:game` 再跑服务器测试（服务器读的是 `packages/game/dist`）。

### 一个人怎么测

- `node scripts/test-bot.mjs host 3 1`：陪玩脚本建一个 3 人房、自己坐一个座位，打印房间码；你在网页里用房间码加入，凑满后自动开局。`host 4 4` 是四个脚本自己打完一整场。
- `node scripts/test-bot.mjs join <房间码> [昵称]`：以一个脚本玩家的身份加入别人的房间。
- `BOT_DELAY_MS` 调思考时间（默认 1200），`BOT_IDLE=1` 只挂着不动（等超时），`SERVER_URL` 换服务器地址。
- `node scripts/spy.mjs [人数] [场数]`：抓包。两个 socket 当玩家、一个观战，连上 dev 服务器打完整场，逐条检查发给 B 和观战的数据里有没有牌堆、种子、别人的手牌、不该给的私密事件，有问题退出码 1。
- 网页上的牌桌现在是**调试牌桌**（把状态列出来，每个合法行动一个按钮），正式牌桌由界面阶段来做。

## 规则（用自己的话说）

**牌**：21 张角色牌，左边是点数。

| 点数 | 角色 | 张数 | 打出时 |
|---|---|---|---|
| 0 | 间谍 | 2 | 本身没效果。一小局结束时，还在局中的人里如果只有你打出或弃掉过间谍，你额外拿 1 枚标记 |
| 1 | 卫兵 | 6 | 点一个别人，猜一个角色（不能猜卫兵）。他手里正是这个角色就出局 |
| 2 | 牧师 | 2 | 偷看一个别人的手牌，只有你看得到 |
| 3 | 男爵 | 2 | 和一个别人比手里**剩下那张**的点数，小的出局，一样大都不出局 |
| 4 | 侍女 | 2 | 到你下一回合开始前，别人的牌都不能选你 |
| 5 | 王子 | 2 | 点任何人（可以是自己），他把手牌弃掉（不发动效果）再抽一张；弃掉的是公主就出局 |
| 6 | 大臣 | 2 | 抽 2 张，三张里留 1 张，另外 2 张按你定的顺序放回牌堆底 |
| 7 | 国王 | 1 | 和一个别人交换手牌 |
| 8 | 女伯爵 | 1 | 本身没效果；但手里另一张是国王或王子时**必须**打她 |
| 9 | 公主 | 1 | 不管是自己打出还是被弃掉，立刻出局 |

**开局**：洗牌，面朝下移出 1 张谁也不看；2 人局再面朝上移出 3 张（所有人都看得到，这一小局里不会再进任何人手里）。每人发 1 张。

**回合**：抽 1 张，从 2 张里打 1 张，照它的效果做（对自己不利也得做），手里永远剩 1 张。打出的牌摆在自己面前，人人都看得到。
- 指着别人的牌（卫兵、牧师、男爵、国王）只能选还在局中、没被侍女保护的人；一个能选的都没有，这张牌就白打。王子没有别人可选时只能选自己。
- 牌堆空了还有人被王子点到，他拿走开局面朝下移出的那张（只有他自己看到是什么）。
- 大臣抽牌时牌堆只剩 1 张就抽 1 放 1；牌堆空了大臣白打。放回牌堆底不算弃牌：公主放回去不出局，间谍放回去不算打过。
- 出局的人亮出手牌弃掉（不发动效果），这一小局不再轮到他，也不能被选。

**一小局结束**：
- 只剩一个人在局中：他立刻赢，不用亮牌。
- 某个回合结束时牌堆空了：还在局中的人亮牌，点数最大的赢；一样大就都算赢，各拿 1 枚。
- 赢的人各拿 1 枚标记；间谍那 1 枚另算，可以和赢的那枚叠加（一小局最多拿 2 枚）。
- 结算时亮出开局面朝下移出的那张。

**整场结束**：有人攒够标记就结束，攒够的人都算赢（可以几个人一起赢）。2/3/4/5/6 人要 6/5/4/3/3 枚。下一小局由上一小局的赢家先手；几个人并列赢时，从他们当中随机选一个。

## 默认规则表（规则书没写死的地方、开工拍板、全站约定）

| 情况 | 现在的做法 | 依据 |
|---|---|---|
| 牌的数量 | 2019 六人版 21 张、10 种角色；不做经典版 16 张变体 | 开工拍板 |
| 人数 | 2–6 人都能开（界面上写一句「3 人以上更好玩」） | 开工拍板 |
| 亮牌平局 | 并列的人都赢这一小局，各 +1（不比打出牌的点数总和） | 开工拍板（2019 官方） |
| 第一小局先手 | 随机 | 开工拍板 |
| 之后的先手 | 上一小局赢家；并列赢时在并列赢家里随机（不是所有人里随机） | 开工拍板、勘误 3.2 #2 |
| 间谍 +1 和赢家 +1 | 可以叠加，一小局最多 2 枚；只看结算时还在局中的人，出局的人打过的间谍不算、也不挡别人 | 开工拍板 |
| 被王子弃掉的间谍 | 算「弃过间谍」 | 规则书原文 |
| 大臣把公主放回牌堆底 | 不出局（放回不算弃牌）；放回的间谍也不算打过 | 开工拍板 |
| 国王把公主换给别人 | 谁都不出局 | 规则书字面 |
| 一小局结束 | 亮出开局面朝下移出的那张（结算画面公开） | 开工拍板 |
| 钟情标记上限 | 不按实物 13 枚封顶 | 开工拍板 |
| 间谍资格 | 公开（从打出区就能看出来），界面可以直接标 | 勘误 3.3 #3 |
| 王子在牌堆空时拿走的那张 | 只有拿牌的人看得到，别人只知道「他拿走了移出的牌」 | 勘误 3.2 #3（规则书 §8.3 原文写错） |
| 牧师看到的牌 | 只发给出牧师的人（被看的人本来就知道自己的牌） | 开工拍板 |
| 男爵比牌的牌面 | 只发给比牌的两人；别人只看到谁输（输家的牌随出局公开）或平手 | 开工拍板 |
| 国王换牌 | 两人都知道对方换走了什么；别人只知道谁和谁换了 | 规则书 |
| 女伯爵 | 打出时不亮另一张，事件里也没有「是不是被迫」 | 规则书 |
| 打的是刚抽的还是原来那张 | 不公开（实体游戏里可以看出来，但很多人会混着拿；不公开更不容易漏信息） | 自定 |
| 同名的牌 | 状态里只记角色名，不给每张牌编号：编号会让人认出「这张卫兵是不是我看过的那张」，比实体游戏多出信息 | 自定 |
| 牌堆、移出的牌 | 只在服务器上；观战「看手牌」也看不到牌堆和放回牌堆底的牌 | 全站约定 |
| 一小局结束后 | 结算画面最多停 15 秒；在线、没托管的真人都点了「下一局」就提前开 | 自定 |
| 2 人局的 3 张明牌 | 所有人可见的公开字段 `faceUp`；永远不进任何人手里，不算谁的弃牌，和间谍无关 | 勘误 3.2 #6 |

## 超时、托管和离线

- **每一步限时 30 秒**：出牌（打哪张 + 选谁 + 猜什么是一个命令）是一步；打出大臣后留牌是另一步，重新计 30 秒。没有轮外操作，计时只在换人或换步骤时重置。
- **超时**：由**人机**替他把**这一回合走完**（出牌、选人、猜牌，打出大臣还要留牌；服务器调 `timeoutTurn(game, botCommand)`，人机只拿他的裁剪视角），整个回合只记 1 次超时，事件里第一条是 `TurnTimedOut`。人机给不出合法命令时（不应该发生）退回补充文件第四节的固定动作（`timeoutCommand`）：不打公主；被女伯爵强制就打女伯爵，否则打点数小的；卫兵、牧师、男爵、国王选下家开始第一个能选的人；卫兵猜「还没露面最多」的角色（一样多猜点数大的）；王子选下家开始第一个能选的对手，没有对手才选自己；大臣留点数最大的，另外的从大到小放回（最小的在最底下）。
- **连续 2 次超时转托管**（全站约定）：托管就是人机代打，直到他自己动一下或点「取消托管」。
- **离线**：轮到离线的人时先等 3 秒，然后由人机代打（不算超时）；用原昵称加房间码回来就交还座位。
- 结算画面到点就开下一局，不算谁超时。
- 人机：房主在等候房间点「加人机」（咕噜一号到五号），只有「普通」一档：记牌（还没露面的牌、牧师看到的、国王换到的、男爵平手、大臣放回去的牌被谁抽到）、给每个打法算分、最后一回合直接算比牌胜率，不打公主、女伯爵被迫就打。策略和强度见 `packages/game/src/bot.ts` 开头的注释和 `scripts/sim-loveletter.ts`。

## 对外接口（`packages/game`，界面、人机、教程、验收都用）

从 `@loveletter/game` 导入（网页、服务器）；规则包自己的测试从 `../src/index.js` 导入（不用先构建）。验收测试放 `packages/game/test/acceptance/*.test.ts`，写法同 `packages/game/test/rules.test.ts`（从 `../../src/index.js` 导入）。

### 牌（`cards.ts`）

- `Role`：`"spy" | "guard" | "priest" | "baron" | "handmaid" | "prince" | "chancellor" | "king" | "countess" | "princess"`。状态里的牌都是角色名，没有实例编号。
- `ROLES`（按点数排）、`ROLE_VALUE`、`ROLE_COUNT`、`ROLE_NAME`（中文名）、`ROLE_TARGET`（`"other" | "any" | "none"`）、`GUARD_GUESSES`（除卫兵外 9 种）、`FULL_DECK`（21 张）、`TOKENS_TO_WIN`、`isRole`、`countRoles`。

### 状态（`GameState`，见 `types.ts` 的注释）

| 字段 | 说明 | 谁能看 |
|---|---|---|
| `phase` | `"playing"` 一小局进行中 / `"roundEnd"` 结算画面 / `"finished"` 整场结束 | 公开 |
| `stage` | playing 时 `"play"` 出牌 / `"chancellor"` 大臣留牌 | 公开 |
| `players[]` | `id`、`name`、`seat`、`tokens` 标记数、`hand` 手牌、`handCount`、`discards` 打出区（`{card, how: "played"/"discarded"/"eliminated"}`）、`out` 出局、`protected` 侍女保护、`spy` 间谍资格 | `hand` 只有自己（观战「看手牌」看全部），其余公开 |
| `current` | 轮到谁（players 下标） | 公开 |
| `round` / `turn` | 第几小局 / 整场第几个回合 | 公开 |
| `deckCount` | 牌堆剩几张 | 公开 |
| `faceUp` | 2 人局的 3 张明牌（3 人以上是空数组） | 公开 |
| `setAsideTaken` | 移出的那张已被王子拿走 | 公开 |
| `ready` | 结算画面点了「下一局」的人 | 公开 |
| `lastRound` | 最近一小局的结算 `RoundResult`：`reason`、`winners`、`spyBonus`、`awards`（每人这局拿了几枚）、`hands`（亮牌）、`setAside`（亮出的移出牌）、`nextStarter` | 公开 |
| `winners` | 整场赢家（finished 才有） | 公开 |
| `history` | 本小局的全部事件（新一小局清空） | 按事件裁剪 |
| `events` | 最近一步的事件 | 按事件裁剪 |
| `version` | 每一步 +1，网页靠它触发动画 | 公开 |
| `deck`、`setAside`、`seed`、`rngState`、`actions` | 牌堆（顶在前）、移出的牌、种子、随机数状态、动作序列 | **只在服务器** |

### 命令（`GameCommand`）

```ts
{ type: "PLAY", card: Role, target?: string, guess?: Role }   // 打哪张 + 选谁 + 猜什么，一次发
{ type: "CHANCELLOR", keep: Role, bottom: Role[] }            // 大臣留 1 张；bottom 从上到下，最后一个在最底下
{ type: "READY" }                                             // 结算画面点「下一局」
```

- 卫兵、牧师、男爵、国王：有能选的人时必须带 `target`；一个都没有时**不带** `target`（白打）。王子必须带 `target`（可以是自己）。其他牌不带。
- 卫兵带了 `target` 就必须带 `guess`（不能是 `"guard"`），其他情况不带。
- 不合法的命令一律抛错，错误信息是给玩家看的中文。

### 事件（`GameEvent`）

`RoundStarted`、`TurnStarted{protectionEnded}`、`Drew{reason: "turn"|"prince", source: "deck"|"setAside", card?}`、`Played{card, target?, guess?}`、`NoEffect{reason: "noTarget"|"emptyDeck"}`、`Guessed{guess, hit}`、`Peeked{card?}`、`Compared{loser, playerCard?, targetCard?}`、`Protected`、`Discarded{card, by}`、`ChancellorDrew{count, cards?}`、`ChancellorReturned{count, cards?}`、`Swapped{playerGot?, targetGot?}`、`Eliminated{reason, by, revealed}`、`RoundEnded{result}`、`Ready`、`GameEnded{winners}`、`TurnTimedOut{stage}`。

带问号的是私密内容，`redactGameForViewer` 只留给有权看的人：抽到的牌和大臣抽的牌只给本人；牧师看到的牌只给出牧师的人；男爵、国王的牌面只给那两个人；放回牌堆底的牌只给出大臣的人（观战「看手牌」也看不到）。其余字段都公开，就是补充文件 3.3 #6 要的公开事件清单：卫兵点了谁、猜什么、中没中；牧师看了谁；男爵谁和谁比、谁输或平手；国王谁和谁换；王子点了谁、弃掉什么；大臣放回几张；王子在牌堆空时让人拿走了移出的牌。

一个回合的事件顺序：`Played` → 效果（`Guessed`/`Peeked`/`Compared`/`Protected`/`Discarded`+`Drew`/`ChancellorDrew`/`Swapped`/`NoEffect`）→ 可能的 `Eliminated` → 一小局结束时 `RoundEnded`（整场结束再加 `GameEnded`），否则下一位的 `TurnStarted` + `Drew`。打出大臣时停在 `ChancellorDrew`，留牌后是 `ChancellorReturned` 再往下走。超时的回合最前面加一条 `TurnTimedOut`。

### 函数（`engine.ts`）

| 函数 | 说明 |
|---|---|
| `createGame(players, seed?, { config?, starter?, deal? })` | 开一场。`deal: { setAside, faceUp?, hands, deck }` 指定第一小局怎么发（deck 顶在前，四部分正好 21 张）；`starter` 指定先手座位 |
| `apply(state, playerId, command, rng) → { state, events }` | 纯函数，不改输入；只能用在完整状态上。rng 只在小局结束（并列抽先手）和开新一局（洗牌）时用 |
| `applyCommand(state, playerId, command)` | 服务器用：随机数接着 `state.rngState`，命令记进 `actions` |
| `legalActions(state, playerId)` | 现在能发的所有命令（同名牌只列一次）；裁剪过的视角也能用 |
| `redactGameForViewer(state, viewerId, { seeAllHands? })` | 某个座位看到的状态；观战传 `""`，房主开了「观战看手牌」再加 `{ seeAllHands: true }` |
| `timeoutTurn(state, choose?)` | 超时：替当前玩家走完整个回合；`choose(view, playerId)` 默认是 `timeoutCommand`，只拿到裁剪后的视角，给出不合法的命令时退回固定动作。结算画面超时就开下一局 |
| `timeoutCommand(view, playerId)` | 固定动作（见上面「超时」） |
| `actorOf(state)` | 此刻要做决定的人（结算画面、整场结束时是 null） |
| `timerKey(state)` / `timerSeconds(state)` | 服务器计时用：每个回合的每一步一个 key；结算画面一小局一个 |
| `targetChoices(state, actorId, card)` | 打这张牌能选谁（下家开始的座位顺序；王子把自己放最后） |
| `mustPlayCountess(hand)` | 女伯爵强制 |
| `visibleCounts(state)` / `unseenCounts(state, viewerId)` | 本小局公开的牌各几张 / 从某座位看还没露面的各几张（界面的剩余张数统计、人机记牌） |
| `botCommand(view, playerId, random?)` | 人机这一步的命令，只吃裁剪后的视角（给完整状态会报错） |
| `botHint(view, playerId, random?)` / `botDecision` | 返回 `{ command, reason }`：人机会怎么打、一句第二人称的理由（教程「提示」按钮用）。理由会提到牧师看到的牌，**只在本人浏览器里算、只给本人看**，不要发到服务器、聊天或日志 |

**人机怎么接的**：服务器的人机座位、托管、离线代打都调 `botCommand(redactGameForViewer(game, 座位), 座位)`；超时调 `timeoutTurn(room.game, botCommand)`。

### 预览局面工厂（`scenes.ts`）

造出来的都是**服务器上的完整状态**，可以接着 `applyCommand` 往下走；给网页显示前用 `redactGameForViewer` 或 `previewRoom` 裁剪。座位 id 是 `p1`、`p2`…（和服务器一样），`seatId(0) === "p1"`。

```ts
createScene(spec?: SceneSpec): GameState   // 按参数造任意精确局面
scene(name: SceneName, { players?, seed? }?): GameState   // 按名字造常见局面，视角默认 p1（座位 0）
previewRoom(game | undefined, options?): LobbyRoomSnapshot // 包成网页收到的房间快照
playSteps(state, [[playerId, command], ...]): GameState
```

`SceneSpec`（全部可选）：

| 字段 | 说明 |
|---|---|
| `players` | 人数（默认 3）或 `[{ id, name }]` |
| `hands` | 每个座位的手牌（按座位顺序，可以只写前几个）。轮到的人出牌前 2 张、大臣留牌时 2–3 张，别人 1 张，出局的人空 |
| `discards` | 每个座位的打出区（写角色名就当「打出」，也可以写 `{ card, how }`） |
| `out` / `protected` | 出局的座位、受侍女保护的座位（下标） |
| `tokens` | 每个座位的标记数 |
| `deck` | 牌堆，**顶在前** |
| `setAside` | 面朝下移出的那张；`null` 表示已被王子拿走 |
| `faceUp` | 2 人局 3 张明牌 |
| `current` / `stage` / `round` / `turn` | 轮到谁（默认 0）、`"play"`/`"chancellor"`、第几小局、第几回合 |
| `leftovers` | 21 张里没写到的牌放哪：`"deck"`（默认，接在牌堆底）、`"discards"`（分进打出区；公主只放出局的人那里或当移出的牌；间谍优先放出局的人那里）、`"error"`（必须写全 21 张） |
| `seed`、`config` | 补牌顺序的种子；`config` 覆盖 `tokensToWin` 等 |

自相矛盾的写法（牌数超出、手牌张数和步骤对不上、出局的人有手牌、在局的人打出区有公主……）直接抛错。

例子：「乙受侍女保护，轮到甲，甲手里卫兵 + 男爵，牌堆顶是公主」：

```ts
createScene({ hands: [["guard", "baron"]], protected: [1], discards: [[], ["handmaid"]], deck: ["princess"] })
```

`SCENES` 里的名字（说明见 `SCENE_NOTES`，预览页下拉框可以直接用）：

- 开局：`opening`（按 players 人数）、`two-player`、`six-player`
- 每种牌打出前：`my-turn-spy`、`my-turn-guard`、`my-turn-priest`、`my-turn-baron`、`my-turn-handmaid`、`my-turn-prince`、`my-turn-chancellor`、`my-turn-king`、`my-turn-countess`、`my-turn-princess`
- 特殊选择：`countess-forced`、`chancellor-choose`（3 张选 1、排 2 张的顺序）、`chancellor-last-card`、`all-protected`（卫兵白打、王子只能选自己）、`prince-princess-trap`（补9 死局）、`prince-empty-deck`
- 别人回合、刚发生的事：`others-turn`、`after-guard-miss`、`after-guard-hit`、`after-priest`、`after-baron-win`、`after-baron-tie`、`after-king`、`after-prince`、`after-chancellor`、`i-am-out`
- 超时：`timeout`（`events[0]` 是 `TurnTimedOut`）
- 结算：`round-end-showdown`、`round-end-tie`、`round-end-last-standing`、`round-end-spy`、`round-end-spy-double`、`round-start-next`
- 整场结束：`game-over`、`game-over-tie`
- 教程：`tutorial-start`、`tutorial-endgame`

`previewRoom(game, options)` 的 `options`：`viewer`（默认 `"p1"`）、`spectator: { name?, seeAllHands? }`（观战视角）、`offline`（离线的座位 id，「对手离线」用这个）、`bots`、`auto`（托管）、`turnRemainingMs`（倒计时；`null` 表示没有；不填时轮到在线真人就给满）、`access`、`code`。预览页冒充自己：`Object.defineProperty(socket, "id", { value: previewSocketId("p1") })`。

### 教程剧本（补充文件 2.2）

- `TUTORIAL_PLAYERS`：`p1` 你、`p2` 咕噜一号、`p3` 咕噜二号。
- `TUTORIAL_DEAL`：第一段的固定发牌；`scene("tutorial-start")` 就是 `createGame(TUTORIAL_PLAYERS, seed, { starter: 0, deal: TUTORIAL_DEAL })`。
- `TUTORIAL_SCRIPT`：12 条 `{ player, command, note }`（11 个回合，第 9 回合大臣多一步留牌），按顺序 `applyCommand` 走完你以「只剩一人」赢下这一小局。小局里不用随机数，浏览器里直接跑 `apply` 就行。
- `tutorialEndgame()`（= `scene("tutorial-endgame")`）：第二段残局，轮到你、手里王子 + 侍女、牌堆已空；打侍女后亮牌你和一号都是王子，平局各 +1，你再拿间谍 +1。

## 服务器（`apps/server`）

继承欲罢不能的全站房间功能：建房、房间码、自由入座、断线用原昵称回座、踢人、解散、再来一局、聊天、语音信令、观战和公开房间（`room:access`，观战默认只看公开信息，房主可以打开「观战看手牌」）、管理员列表和解散（`lobby:get`、`admin:dissolve`）、挤登录（`admin:kick-session`）、加人机和托管（`room:add-bot`、`room:auto`）。每场的种子和动作序列写进 `logs/games.jsonl`。

测试用的环境变量：`TURN_MS`（每一步的限时，毫秒）、`BOT_DELAY_SCALE=0`（人机立刻行动）。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game/src/cards.ts` | 10 种角色的点数、张数、中文名、选人方式 |
| `packages/game/src/types.ts` | 状态、命令、事件、结算的类型（字段注释写了谁能看） |
| `packages/game/src/engine.ts` | 规则引擎、合法行动、超时、隐藏信息裁剪、开局 |
| `packages/game/src/scenes.ts` | 预览局面工厂、教程剧本、`previewRoom` |
| `packages/game/src/bot.ts`、`bot-knowledge.ts` | 人机策略（打分、理由）和记牌；`bot-baselines.ts` 是测强度用的随机和「保守打低」基线 |
| `scripts/sim-loveletter.ts` | 人机强度模拟：`npx tsx scripts/sim-loveletter.ts [局数]` |
| `packages/game/test/` | 规则书用例、随机对局、隐藏信息、预览局面的测试；`acceptance/` 归规则核对，引擎不改 |
| `apps/server` | Socket.IO 房间服务器和测试 |
| `apps/web` | 网页：首页、等候房间、牌桌（见下面「界面」） |
| `scripts/test-bot.mjs` | 陪玩脚本 |
| `scripts/spy.mjs` | 抓包脚本：两个 socket 连真实服务器，查发给别人的数据里有没有不该有的东西 |
| `art/` | 美术（归美术阶段） |

## 界面（`apps/web`）

| 文件 | 内容 |
|---|---|
| `src/GameBoard.tsx` | 牌桌：一圈座位（自己在最下面，对手按出牌顺序从左中绕到上排再到右中）、中央牌堆 / 移出区 / 记牌条、自己的手牌和操作区、侧栏的「记录 / 聊天」 |
| `src/Dialogs.tsx` | 卫兵猜牌、大臣留牌、秘密结果（牧师看牌、男爵比牌、国王换牌只弹给当事人）、一小局结算、整场结束 |
| `src/layout.ts` | 按牌桌实测尺寸挑摆法：手牌 2×/3×、打出区 1×/2×、记牌条 1×/2×、侧栏放不放得下；手机（<700）单独上下排 |
| `src/Cards.tsx`、`src/art.ts` | 牌、小牌、图标、印章、精灵图和打出区扇形；美术文件地址（`public/art/`，尺寸见 `art/spec.md`） |
| `src/describe.ts` | 事件文字（记录、「刚才」）和每张牌的效果说明 |
| `src/GameRules.tsx` | 规则说明弹窗（自己的话 + 21 张牌参考） |
| `src/App.tsx` | 首页（`HomeScreen`）、等候房间（`RoomScreen`）、连 socket |
| `src/ll.css` | 牌桌、首页、等候房间的样式；`app-pixel.css` 是全站共用的像素皮肤（深红配色） |
| `preview.html` + `src/preview.tsx` | 预览页（提交进仓库，不进生产构建）：`/preview.html?s=<场景>&n=<人数>`，场景是规则包 `SCENES` 的名字，外加 `crowded`、`home`、`home-rooms`、`waiting-1/full/bots/guest/2p`；参数 `v` 视角、`bots`/`auto`/`offline` 座位、`spec=1`（`all=1`）观战、`t` 倒计时、`chat=1`、`live=1` 别人的回合由人机自动走。教程和验收可以往里加场景，不要删别人的 |

打一张牌：点手牌选中 → 要选人的牌点座位或名字按钮 → 卫兵在弹窗里猜牌 → 确认，三样收齐才发一条 `PLAY`。键盘 1 / 2 选牌、空格确认、Esc 取消。公主打出前弹像素确认框。女伯爵强制时国王 / 王子变暗并说明原因；不能选的座位变暗并写「侍女保护中」「已出局」。

## 画面：白天版和夜间版

只有像素风一种画面，配色分夜间（深色，默认）和白天（白底）。夜间配色写在 `app-pixel.css` 和牌桌的样式里；白天版由 `apps/web/day-theme.ts`（Vite 插件）按 `apps/web/day-palette.ts` 的调色表在构建时生成，机械换色不合适的地方在 `src/theme-day.css` 里手写。选择记在浏览器的 `gm-pixel-theme` 里，全站共用。

## 部署

服务器上 `~/loveletter`，pm2 进程 `loveletter`（端口 3017），网页在 `/var/www/loveletter`，Caddy `handle_path /loveletter/*`（在付费网关 `@games` 里）。pm2 按根目录的 `ecosystem.config.cjs` 启动；端口和密钥存在 pm2 里，不进仓库。
