# Sub2API 实时分组监控 Task Reflection

## 2026-07-22 用户自用排除经营核算 正式实施包 v1

- 状态：`awaiting_user_acceptance`。
- Task Outcome：内部自用对象从上游账号纠正为站内使用用户。用户标记只存本机的站点 ID 与数字用户 ID；经营收益完全排除该用户请求，内部消耗单列，不修改远程资源。
- User Choices：用户先确认“使用用户而非账号”的业务口径，再确认正式实施包 v1。
- Verification Summary：`npm run verify` 11 文件 / 153 用例、生产构建、macOS 打包、严格签名和差异检查通过；本地浏览器策略阻断构建文件的可见点击验证。
- What Worked Well：严格 DTO 仅采集顶层 `user_id`，避免将用户名、邮箱或原始 usage 保留到本地账本；旧记录不猜测用户归属。
- What Should Change：获取真实管理员 `/admin/usage` 的脱敏字段样本，确认每个常用二开站均提供稳定 `user_id`；用户需验收重新归档后真实内部消耗汇总。
- Memory Candidates：无长期记忆候选。Rule Change Candidates：无，语义门禁已覆盖本类“账号/用户”混淆。
- Next Recommendation：在最新签名包中标记一个自己的用户，重归档最近一天，再检查经营收入与内部自用消耗是否按预期分离。

## 2026-07-22 lcodex 新版兼容正式实施包 v1

- 状态：`awaiting_user_acceptance`。
- Task Outcome：新版根页内登录路由、sessionStorage 令牌读取、根域管理接口和版本化价格接口均已适配；旧 `api.lcodex.cc` 只会在用户重新授权或保存时修正。
- User Choices：用户确认需求与影响 v1，并确认正式实施包 v1。
- Verification Summary：`npm run verify` 11 文件/151 用例、macOS 打包、严格签名和差异检查均通过；公开根域读取确认规范 401 鉴权契约。
- What Worked Well：站点规则收敛在共享路径和授权辅助层，凭据继续只在隔离授权窗口与主进程内处理。

## 2026-07-22 接口适配中心 正式实施包 v1

- 状态：`awaiting_user_acceptance`。
- Task Outcome：二开站的只读路径与字段映射从编辑弹窗迁移到独立数据接入工作区；标准字段固定为余额、分组、倍率、模型价格和密钥记录。
- User Choices：用户确认将抽象映射作为单独功能边界配置，并确认“接口适配中心 正式实施包 v1”。
- Verification Summary：`npm run verify`、聚焦映射/存储/客户端测试、生产构建、macOS 打包、严格签名与差异检查通过；构建文件可视自动化被浏览器策略拦截。
- What Worked Well：预览 IPC 只接受保存过的站点 ID，忽略渲染层提交的基址与令牌；字段路径与 HTTPS/同源路径在主进程存储/预览边界双重收紧。
- What Should Change：使用 lcodex 或其他二开站的真实脱敏响应完成一次字段映射可见验收；确认站点返回字段后可把成功映射固化为内置模板。
- Memory Candidates：无长期业务记忆候选。用户反馈中的“配置应有单独功能边界”已作为本次 UI 决策记录。
- What Should Change：站点改版先做公开 SPA/接口探查；真实会话验收仍需用户在桌面应用完成。
- Memory Candidates：无长期记忆候选。Rule Change Candidates：无，本次属于单站点外部契约变更。
- Next Recommendation：在最新签名包中重新授权 lcodex，检查授权窗自动关闭和来源钱包数据。

## Meta

- Feature: `sub2api-monitor`
- Date: `2026-07-16`
- Reflection Status: `awaiting_user_acceptance`
- Requirement / Impact / Plan / Verification Versions: `v2 / v2 / v2 / v2`
- User Acceptance: `awaiting_user_acceptance`

## Task Outcome

- objective: 构建基于 Sub2API 的 macOS 实时分组监控 MVP。
- delivered: Electron 应用、安全配置、API adapter、多站轮询、三种窗口形态、Tray、管理员切组确认、隔离网页登录授权、refresh token 自动刷新、管理员凭据 header 区分、测试和打包验证。
- not delivered: 生产站点写入、签名、公证、自动更新和发布包。

## User Choices

1. choice: 确认需求与影响 v1。why it mattered: 锁定 controlled 任务的外部接口与权限边界。
2. choice: 确认计划 v1。why it mattered: 授权按 TASK-001..008 进入业务实现。
3. choice: 确认认证修订 v2。why it mattered: 通过隔离站点登录获取令牌，普通账号读取 `/groups/available` 的全部可用分组。

## Verification Summary

- commands run: `npm run verify`、workflow doctor、官方 registry audit、secret scan、diff check。
- result: 12 个测试、类型检查、生产构建、打包签名和单实例检查通过；真实网页登录点击路径尚未连接用户站点。
- uncovered areas: 真实生产站点写入和 macOS 发布链路。
- residual risks: 上游版本/feature flag 差异、真实站点登录流程和最终发布包 Tray 行为。

## What Worked Well

- 先调查上游路由与 DTO，避免凭空定义 Sub2API 契约。
- main/preload/renderer 权限边界清晰，renderer 不持久化密钥。
- 可见检查发现了气泡不可恢复和主窗口模式不同步问题，并在交付前修复。

## What Should Change

- 后续兼容性工作应从真实站点的脱敏响应样本开始。
- 发布阶段需要补专门的签名、公证、Tray 和自动更新验证矩阵。

## User Dissatisfaction

- category: requirement_miss / implementation_defect
- evidence: 用户确认普通账号的“全部分组”是 `/groups/available` 返回的全部可用分组；v1 缺少网页登录授权，并未区分 JWT、网关 API Key 和管理员 API Key header。
- affected confirmed version: requirement / impact / plan v1
- task-level correction: 需求修订 v2 已实施，增加隔离授权、refresh token、管理员 header 区分，并锁定普通分组接口。
- repeated or high-impact workflow signal: no

## Memory Candidates

- candidate: 无长期候选；当前事实保留在项目 Profile 与 feature 工件。
- status: task_session_only

## Rule Change Candidates

- title: 无
- status: not_required

## Workflow State Sync

- `session_reflections` updated: yes
- `memory_candidates` updated: yes, empty
- `rule_change_candidates` updated: yes, empty
- `evolution_updates.drafted` updated: not_required
- handoff notes updated: yes

## Next Recommendation

- keep as task memory only: yes
- propose framework evolution: no
- request confirmation from user: 验证报告 v2 的最终验收

## Follow-up 费用归档正式实施包 v1

- status: awaiting_user_acceptance
- summary: 管理员用量按上海自然日归档到本地最小化账本；收益报告不再直接读取远端。单次最多归档 7 天，单日最多 2,000 行，达到上限会标记为部分覆盖；重归档替换该站点同日记录，避免收入重复累计。
- verification: `npm run typecheck`、`npm test`、`npm run build`、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check`；覆盖完整日与分页受限日的只读归档分支。
- security: 仅 GET；本地只保存稳定记录 ID、站点/账号/分组 ID、时间与数值金额。原始 usage、请求体、API Key、JWT、Cookie 不入本地账本和 renderer。
- residual risk: 单日超过 2,000 条仍部分覆盖；固定订阅/手动成本尚不进入可归因毛利。

## Follow-up 自有账号免计费 正式实施包 v1

- status: awaiting_user_acceptance
- summary: 账号可设为“自有免计费”。保留关联、用量和收入；成本保护、收益上游成本、亏损判断、基础倍率建议和分组最低成本比较均跳过。收益报告将该收入单列为免计费口径，毛利显示“含免计费”。
- verification: `npm run typecheck`、定向 39 项测试、`npm run verify`（148 项）、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` 均通过。
- security: 主进程从本地已校验的账号成本档案构造免计费集合；没有 renderer 自定义名单、没有远程写入、没有增加凭据读取或日志输出。
- residual risk: 当前口径作用于全部历史区间，不记录成本类型的历史生效时间；可见 UI 自动化因浏览器无法连接本机预览端口而未完成，需用户在新包中实测。

## Follow-up 价格榜使用中标记 语义确认 v1

- status: awaiting_user_acceptance
- summary: 价格榜按已精确解析的账号上游来源关系增加“使用中”链路图标与筛选；多分组 Key、失效和未绑定关系保持不标记，避免把待确认成本口径误报为实际使用。
- verification: `npm run verify`（11 files / 142 tests）、`npm run package:mac`、严格 codesign、桌面截图确认筛选条可见。
- security: 只读取已在 renderer 使用的账号名称和映射；不保存新数据，不读取或显示 Key/JWT/Cookie 原文。
- residual risk: 当前启动时没有可比价行，真实行 hover 仍需用户在下一次同步后验收。

## Follow-up 持续分组历史、自动关联上游密钥与管理员用量明细 v1

- status: awaiting_user_acceptance
- summary: 主进程持久化倍率基线并生成真实涨跌事件；唯一 Key 候选自动关联、歧义候选不绑定；管理员 usage 明细在主进程分页压缩成严格账本条目并向界面提供覆盖状态。
- verification: `npm run verify`（122 tests）、`git diff --check`、`npm run package:mac`、严格签名校验、单实例 Electron AX 可见路径（查价、我的站点、成本、关联弹窗）。
- security: 原始管理员日志、上游 Key、JWT 与 Cookie 均不进入 Renderer、偏好文件、错误文本或测试输出；本轮没有远程写入。
- residual risk: 非标准站点的用量字段和总页数仍需只读响应样本联调；本地观察时间不是 provider 审计时间。

## Follow-up 价格榜涨跌筛选、提醒与利润口径 v1

- status: awaiting_user_acceptance
- summary: 价格榜支持按分组最新变化筛选全部/涨价/降价；持续保留持久化历史的涨跌图标；未提醒的涨跌会触发应用内提示和已授权的 macOS 通知；成本保护展示明确的单位利润公式。
- verification: `npm run verify`（100 tests）、`git diff --check`、生产构建、`package-mac.mjs`、`codesign --verify --deep --strict`、最终桌面应用 AX 读取与“涨价”筛选点击。
- residual risk: 当前实机尚未同步出可比价行，未能用真实变化记录触发一次 macOS 通知；通知是否弹出还取决于用户的系统权限。

## Follow-up v5

- status: awaiting_user_acceptance
- summary: 账号工作台信息密度继续收敛，聚焦卡去掉站点余额，来源/成本改成紧凑 icon tag，长文本补 hover，分组 chip 改成单行滚动并保留逐个 `X` 移除入口。
- verification: `npm run verify`、`git diff --check`、本地浏览器预览 `我的站点 → 账号`
- note: 仍未对真实生产站点做远程切组或移除分组写入。

## Follow-up v6

- status: awaiting_user_acceptance
- summary: 用户截图显示运行态仍是旧 UI，本轮按截图复修并重新打包。状态组件只渲染 icon/tag，详情只进 hover；分组 chip 改为聚焦卡整行宽度，点击 `X` 已验证打开组合确认弹窗并取消。
- verification: `npm run typecheck`、`npm test -- tests/ranking-sort.test.ts tests/cost-protection.test.ts`、本地浏览器预览、900px 窄屏、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、产物 CSS/JS 抽查、`git diff --check`
- note: 本轮仍未替用户启动桌面 App，也没有对真实生产站点做远程写入。

## Follow-up 账号上游密钥关联 v1

- status: awaiting_user_acceptance
- summary: 我的站点账号现在关联三方站点的稳定 Key ID。单分组 Key 自动跟随分组变化；多分组、删除和无分组均保持保守，不会自动取低价。
- verification: `npm run verify`（107 tests）、`npm run package:mac`、严格签名校验、最终桌面包可见点击“关联上游密钥”。
- security: 只持久化 Key 记录 ID 和脱敏标签；存储层拒绝 Bearer/JWT 形态的 Key ID；未读取、保存或输出任何 Key 原文。
- residual risk: 尚未替用户在生产站点保存一次关联，更未进行远程分组写入；v2 精确计费不在本轮范围。

## Follow-up 时间分段成本核算 v1

- status: awaiting_user_acceptance
- summary: 上游倍率、充值比例、Key 分组和账号来源均按本地观察时间形成成本区间。稳定使用记录会按左闭右开边界计算上游成本；不完整记录不进入精确账。
- verification: `npm run verify`（118 tests）、`npm run package:mac`、严格签名校验、最终桌面包 AX 可见启动检查、`git diff --check`。
- security: 账本只保留最小化 ID、账号、时间和数值；不保存原始 usage 记录、Key 原文、JWT 或 Cookie。存储写入串行化以避免轮询和 renderer 偏好更新互相覆盖。
- residual risk: 真实站点返回的 usage 字段和 provider 审计时间尚待真实只读样本联调。

## Follow-up 收益区间核算 正式实施包 v1

- status: awaiting_user_acceptance
- summary: “我的站点 → 收益”已支持按天、按小时及日期区间核算。收入使用站内 `actual_cost`，账号成本和时点上游成本分开显示；缺少历史映射的请求只累计待归因收入，不假定为盈利或亏损。
- verification: `npm run verify`（126 tests）、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check`；构建产物浏览器路径点击“我的站点 → 收益”、日/小时切换、账号/售卖分组筛选，以及 900px 无横向溢出检查。
- security: 原始 `/admin/usage` 行仅在主进程短暂处理；IPC/renderer/本地偏好只接收脱敏后的收益聚合和覆盖计数；本轮仅 GET，没有远程写入。
- residual risk: 各二开站点可能不同的用量字段、分页形态和 provider 审计时间仍需真实只读响应样本验证；页数达到 2,000 条时会明确标为部分覆盖。

## Follow-up 站点角色与兼容修复 正式实施包 v1

- status: awaiting_user_acceptance
- summary: 站点增加显式 `source/own` 角色，来源钱包分开显示三方来源与用户自己的聚合站；价格榜只消费三方来源，我的站点账号工作区只消费聚合平台。aihub 的同源嵌套 API 根会恢复完整版本路径，诊断复用主进程内的加密 Cookie/UA/令牌以反映真实会话。
- verification: `npm run typecheck`、`npm run verify`（131 tests）、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check`、浏览器预览的来源钱包 tab 检查。
- security: 诊断仅发 GET/刷新探针；Cookie、User-Agent、JWT、refresh token 与管理员 token 只在主进程内临时解密，不进 renderer、日志或交付工件。
- dissatisfaction: `implementation_defect` + `ui_interaction`；用户反馈 aihub 404、聪明哥 403、来源钱包把我的站点和三方站点混在一起，说明旧的“是否有管理员能力”推断不足以表达站点角色。
- residual risk: 老站点在首次编辑并保存角色前维持兼容推断；真实站点的 WAF/会话过期仍需用户用最新版完成一次只读“自动探测”确认。

## Follow-up 站点类型适配器 正式实施包 v1

- status: awaiting_user_acceptance
- summary: 设置站点类型新增自动检测、Sub2API、NewAPI 与自定义兼容。NewAPI 是独立的能力受限只读适配器，余额、令牌记录和模型探测可用；没有可靠的分组倍率或管理员契约时不进入价格榜、切组、成本和收益。
- verification: `npm run verify`（11 files / 137 tests）、生产构建、浏览器预览 NewAPI 类型切换与 900px 宽度检查、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check`。
- security: 仅 GET；NewAPI token 返回被压缩为 ID、名称、状态，原始 token、JWT、Cookie 和 UA 不进入 renderer、偏好文件或日志。
- residual risk: NewAPI 生态的二开路径/返回结构差异大，自动检测受 WAF 和实际授权会话影响；完整 NewAPI 管理台复刻不在本次范围。

## 价格榜使用中筛选紧凑化 v1

- 状态：`awaiting_user_acceptance`。
- 完成：将“使用中”筛选从独立行压缩进“倍率变动”行，改用链路图标加滑块开关；精确上游关联规则不变。
- 验证：`npm run verify` 通过 11 个文件、142 条用例；`npm run package:mac`、严格签名与 `git diff --check` 通过；实际 Electron 窗口确认开关同排，开启与关闭均正常。
- 风险：隔离演示数据没有精确关联行，开启时展示空态；真实关联行的链路标记仍由后续同步数据决定。

## 上游使用状态 v2

### 会话摘要

- 确认版本：`上游使用状态 v2`；验收状态：`awaiting_user_acceptance`。
- 已完成：使用状态开关从图标式“全部/使用中”收敛为明确的“未使用/使用中”；自动关联改为主进程内的唯一 Key 凭据指纹匹配，匹配结果只包含安全 ID。
- 主动修复：Key 列表或管理员账号读取失败时清除上一轮指纹，避免旧快照把无法证明的关系继续标记为使用中。
- 验证：类型检查、65 项定向回归、143 项完整回归、生产构建、差异检查均通过。
- 剩余风险：自有聚合站会话失效时，无法以管理员账号验证正向匹配；不代替用户重新登录，也不使用或记录任何原始凭据。

## 价格榜最近涨降时间 思考确认 v1（已由 v2 替代）

- 状态：`awaiting_user_acceptance`。
- 完成：每条价格榜行的最终倍率下分别展示最近本地涨价和降价时间。两个方向独立取最新持久化事件，删除和新增不会污染结果；无历史显示 `--`，悬停可查看完整观察时间及倍率变化。
- 验证：`npm run typecheck`、定向 51 项测试、`npm run verify`（11 个文件 / 145 项）、`npm run package:mac`、严格签名及 `git diff --check` 通过。实际 Electron 界面确认无历史行与已有涨价历史行均无横向溢出，搜索 `A004-K12/BugTeam` 可见 `↑ 07-22 02:20`。
- 影响范围自查：仅修改 renderer 的本地历史展示、样式、回归测试及交付/Profile 记录；没有调用授权、刷新、远端写入或管理员操作，没有存储或展示任何凭据。
- 剩余风险：时间仅反映应用成功同步时发现的变化；应用离线或轮询间隔内发生的多次上游调整无法复原为精确审计记录。

## 价格榜最近涨降时间 思考确认 v2

- 状态：`awaiting_user_acceptance`。
- 完成：最终倍率下只显示当前最新一次真实涨跌。涨价显示红色 `涨价 · YYYY-MM-DD HH:mm:ss`，降价显示绿色 `降价 · YYYY-MM-DD HH:mm:ss`；没有涨跌历史时不显示时间行。
- 验证：`npm run typecheck`、定向 51 项测试、`npm test`（11 个文件 / 145 项）、`npm run package:mac`、严格签名及 `git diff --check` 通过。
- 可见验证：本地构建文件预览被浏览器安全策略拒绝，不能绕过策略改用其他浏览器路径；静态 CSS 检查确认无省略号规则，窄列允许完整日期与时间在空格处换行。待用户真机确认。
- 影响范围自查：仅 renderer、本地样式、回归测试、Profile 与交付记录；没有 API、IPC、凭据、授权、同步或远端写入影响。

## 上游关联诊断与自动配对 正式实施包 v1

- Task Outcome：完成关系诊断、候选预览确认和短暂读取失败恢复；不以同域名或同倍率伪造“使用中”。
- User Choices：用户确认思考确认与正式实施包，原因是多站点同倍率账号的成本归因不能靠猜测。
- Verification Summary：全量 162 条测试、构建、macOS 打包和签名通过；随后恢复可见自动化，已在单实例正式包验证价格榜、来源钱包、我的站点和成本保护。真实数据中的精确关联显示来源/上游成本/单位利润，未唯一匹配账号没有被自动绑定。
- What Worked Well：复用既有 Key 记录 ID、临时指纹和本地映射，敏感凭据不跨主进程边界。
- What Should Change：对尚未配置或失效的二开站 Key 接口完成重新授权/路径配置后，再验证“扫描关联”的候选预览与用户确认保存路径。
- Memory Candidates：仅保留会话级经验；无新的持久化业务记忆或规则升级候选。
- Workflow State Sync：`awaiting_user_acceptance`。

## 精确上游关联与公益核算 正式实施包 v1

- 确认版本：`语义与影响确认 v2`、`正式实施包 v1`；验收状态 `awaiting_user_acceptance`。
- 结论：自动关联只信任主进程内唯一 Key 指纹，地址和倍率退出关联判断；新增公益经营排除、分组批量账号成本和首次观察中性规则，均不写远端。
- 验证：`npm run verify` 165 项、macOS package、严格 codesign 和差异检查通过；新包单实例启动。
- 不满意分类与证据：无新增。此前用户反复要求不能以域名/倍率误配来源，本次通过收紧逻辑与回归测试固化。
- 剩余风险：macOS 锁屏阻断本轮可见点击验证，待解锁后验证公益开关、批量成本确认和无基线涨跌状态。

## 2026-07-23 保存登录凭据与 Sub2API 密钥路径 正式实施包 v1

- 状态：`awaiting_user_acceptance`。
- Task Outcome：标准 Sub2API 站点默认补齐密钥列表路径；用户可主动保存网页登录账号密码并在下一次授权时手动选择填入。
- Security Review：无阻断问题。凭据由 Electron `safeStorage` 加密；renderer 只收到存在状态；同源校验基于已保存站点地址，地址变更时拒绝填入；不自动提交。
- Verification Summary：`npm run verify` 通过 12 个测试文件 / 168 条用例；macOS 打包、严格签名和差异检查通过。
- What Should Change：真实站点输入框命名可能不同，仍需用户在桌面授权窗口确认常用站点可识别；验证码、OAuth 和 2FA 始终由用户完成。
- Memory Candidates：无。本次不扩展为自动登录规则。

## 2026-07-23 开源发布正式实施包 v1

- 确认版本：用户确认“开源准备 v1”并确认开始正式发布；验收状态 `awaiting_user_acceptance`。
- 结论：公开范围限定为源码、MIT、演示素材、发布说明和用户明确授权的赞助收款码。发布前已移除历史资料中的自有站名、账号编号、本机文件计数、余额、用量记录和会话状态；测试夹具保留语义但避免连续的凭据形态字符串。
- 验证：`npm run verify` 通过 12 个测试文件 / 168 条用例；macOS `arm64` `.app` 通过严格签名，Release zip 通过完整性检查；README 三张截图已人工确认均为演示数据，二维码无 EXIF/GPS 元数据。
- 剩余风险：在线 `npm audit` 因当前环境无法完成网络审批而未执行成功；首发应用为 ad-hoc 签名、未公证，仅支持 macOS Apple Silicon，Windows 版仍在开发。
