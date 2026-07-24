# Sub2API 实时分组监控 Delivery Summary

## Meta

- Feature: `sub2api-monitor`
- Date: `2026-07-16`
- Requirement Version: `v2`
- Impact Version: `v2`
- Plan Version: `v2`
- Verification Version: `v51`
- Latest Increment: `开源发布正式实施包 v1`
- Delivery Status: `awaiting_user_acceptance`

## 本次完成

### 开源发布正式实施包 v1

- 设计方案：公开 Electron + React 源码、MIT 协议、演示截图和用户明确授权公开的赞助收款码；本机站点配置、令牌、Cookie、账号、余额、用量和私有截图始终留在 Git 追踪范围之外。
- 任务拆解：补齐 README/License/隐私检查清单，脱敏历史交付资料，复核演示素材，运行完整验证与签名打包，生成 macOS arm64 zip 与 SHA-256，再按 `feature -> release -> tag -> main` 流程发布 GitHub Release。
- 影响范围：仅文档、演示素材、测试夹具、发布工件与 Git 流程；不改变远端站点、不导出 Electron userData、不新增遥测或收集机制。
- 当前验证：`npm run verify` 通过（12 个文件 / 168 项测试）；包体为 `AIZZZWatch 0.1.0`、`arm64`，严格 `codesign` 和 zip 完整性检查通过。在线 npm 漏洞索引审计因当前环境网络审批超时未完成，发布说明会保留该风险。

- 开源准备 v1：README 已扩展为公开仓库说明，补齐功能概览、站点类型、本地数据安全边界、开发/验证/打包命令、目录结构和开源状态；README 图片改用 `docs/images/` 下的演示数据截图。
- 新增 `docs/OPEN_SOURCE_CHECKLIST.md`，覆盖发布前隐私检查、建议敏感词扫描命令、不应进入公开仓库的内容，以及演示数据保留规则。
- `.gitignore` 增强本机数据与凭据规则，阻止 `stations.json`、`ui-preferences.json`、HAR、Cookie/JWT/token/key、私有截图、临时 userData 和私有 durable memory 误入仓库。
- 安全复核：未复制真实 `~/Library/Application Support/AIZZZWatch`，没有提交真实 token、Cookie、邮箱或真实用户数据；敏感扫描仅命中测试假数据。

- 用户自用排除经营核算 正式实施包 v1：`我的站点 → 用户` 可将站内使用用户标记为“内部自用”。该标记只保存在本机，以 `站点 ID + 数字用户 ID` 为键，不修改远程用户、账号、密钥、分组或调度。
- 收益归档只从管理员用量顶层字段提取 `user_id`；内部自用用户的请求不进入收入、账号成本、实际上游成本、毛利、亏损和成本保护，收益页另行显示请求数、站内扣费参考和可追溯上游消耗。
- 缺少稳定用户 ID 的旧归档或站点明细不会被猜测归属，仍按普通经营记录核算并明确提示。收益页新增图标化“重新归档”操作，用只读请求覆盖本机同站点同日期的脱敏账本，供旧记录补齐用户 ID。
- 原“自有免计费”账号规则更名为“账号免计费”，语义仍不变；它与“内部自用用户”保持独立。

- 自有账号免计费 正式实施包 v1：账号成本档案新增 `自有免计费`。该模式保留账号、售卖分组、上游关联、用量和收入，但不参与上游成本、账号成本、亏损/接近亏损、基础倍率建议或分组最低成本比较。切回“三方按量”会恢复既有上游映射和常规计算。
- “我的站点 → 收益”新增免计费口径收入/请求计数；免计费记录的成本按 0，并计入可归因毛利，但每个汇总、时间桶和账号行都会明确标记“含免计费”，不冒充精确上游成本。
- 本地存储会接受并规范化该成本类型，自动丢弃其不适用的固定成本、周期和单位成本字段。该口径按当前账号档案应用于所有查询区间，不新增历史生效时间账本。

- 价格榜最近涨降时间 思考确认 v2：修正 v1 的双方向展示错误。最终倍率下方现在只保留“当前最新一次”真实倍率变化：涨价显示红色 `涨价 · YYYY-MM-DD HH:mm:ss`，降价显示绿色 `降价 · YYYY-MM-DD HH:mm:ss`；无涨跌历史不显示时间行。窄列会在日期和时间之间换行，但不会省略任何年月日、时分秒。

- 价格榜最近涨降时间 思考确认 v1：每条价格榜的“最终倍率”下方紧凑显示最近涨价 `↑ MM-DD HH:mm` 与最近降价 `↓ MM-DD HH:mm`。两个方向分别从持久化变化历史中取最新记录；新增、删除事件不参与。无记录显示 `--`，悬停显示完整本地观察时间及前后倍率。
- 时间语义明确为应用本地同步发现的时间边界，不等同于上游站点实际改价的审计时间。历史中无效的观察时间会在读取时过滤，不能干扰最新记录选择。

- 站点类型适配器 正式实施包 v1：添加站点时先选择 `自动检测 / Sub2API / NewAPI / 自定义兼容`，并与“站点角色”分离。类型决定读取契约，角色决定来源钱包、价格榜和管理视图的归属。
- NewAPI 使用独立只读适配器：读取用户余额、令牌记录和模型能力；不会请求 Sub2API 的管理员路径。该阶段因尚未确认当前用户分组倍率而排除价格榜；此限制已由后续 `NewAPI 兼容正式实施包 v1` 以 `/api/user/self/groups` 与 `/api/pricing` 的已验证契约替代。成本核算和分组组合管理仍不支持。
- 自动检测仅发出只读探针；识别到 NewAPI 时写入检测结果和建议路径。自定义兼容继续使用手工 API 根/路径，但数据结构仍需 Sub2API 兼容，应用不会猜测任意 JSON 的业务含义。

- 站点角色与兼容修复 正式实施包 v1：新增站点显式角色 `三方站点（上游来源）/ 我的站点（聚合平台）`。来源钱包分为两个 tab；三方站点才进入价格榜，我的站点才进入账号、成本与收益管理。历史站点未保存角色时继续沿用旧的管理员能力推断，避免已有数据突然消失。
- `aihub` 的同源嵌套 API 根地址会从旧的 `/api` 自动恢复为完整 `/api/api/v1`，因此分组请求会走正确的 `/api/api/v1/groups/available`。
- 兼容诊断会在主进程临时复用当前站点已加密保存的 Cookie、User-Agent、令牌和同源 Referer，仅执行 GET/刷新探针；聪明哥遇到 HTML 403 时会明确提示重新授权后再运行诊断，不会把凭据传给 renderer 或写入日志。

- 收益区间核算 正式实施包 v1：在“我的站点 → 收益”新增按天、按小时和自定义日期区间的管理员用量核算。收入取 `actual_cost`；站内账号成本取 `(account_stats_cost ?? total_cost) × account_rate_multiplier`；上游成本按每条请求发生时的已观察上游有效倍率计算；来源历史不完整时仅计入“待归因收入”，不伪造利润。时间边界为 `Asia/Shanghai` 的 `[start, end)`，按小时最多 7 天、按天最多 90 天。
- 区间明细只在主进程读取 `/admin/usage`，最多 20 页、2,000 条；renderer 只接收按日/小时、账号/售卖分组聚合后的脱敏报表和覆盖状态，不保存或展示原始管理员日志、密钥、JWT 或 Cookie。

- 目标：交付 macOS 优先的 Sub2API 多站实时监控 MVP。
- 实际完成：安全站点配置、多站轮询、余额/倍率/价格能力、管理员账号切组、完整/置顶/气泡/Tray 入口、演示数据和错误降级。
- v2 完成：隔离网页登录授权、access/refresh token 加密保存和自动刷新；普通账号严格使用 `/groups/available` 获取其可选择的全部分组；管理员 JWT/API Key 分别使用 Bearer/`x-api-key`。
- 验收反馈修复：浏览器预览不再允许触发网页登录授权；预览模式下手工添加站点会保存到当前页面内存并立即显示，避免继续停留在演示数据。
- 桌面授权修复：preload 改为 CommonJS `index.cjs` 并更新主窗口/气泡窗口路径，修复 sandbox 下 ESM preload 无法加载导致桌面端误回退到浏览器预览 API 的问题。
- 登录兼容修复：忽略 `did-fail-load` 的 `-3` 中断码，避免 `/login` 重定向/跳转时把授权窗口误判成失败。
- 会话兼容修复：授权窗口捕获站点 cookies 和浏览器 UA，主进程请求同步携带 `Cookie` / `User-Agent`，缓解站点的 session fingerprint 校验。
- 交互修复：详情区错误提示里的“重试”改为当前站点专用动作；当状态为 `需要授权` 时，按钮会直接变成“重新登录”并弹出授权窗口。
- v7 完成：右上角同步倒计时每秒自动刷新；中转站按 Sub2API `platform` 分类 tabs 筛选；创建/编辑站点新增站点级充值比例 `1:n`；价格接口结果升级为结构化模型价格，并增加“低价聚合”用于比较同一模型在哪个站点/分组的有效成本最低。
- v8 完成：首页信息架构改为“分类驱动的 token 比价榜”；固定分类包括 Anthropic、OpenAI、Gemini、Antigravity、Grok、其他；主表展示所有站点/分组/模型候选并按 `模型价格 × 分组倍率 ÷ 充值比例` 排序，站点余额与健康状态降级为右侧“来源钱包”辅助信息。
- v3-1 完成：站点兼容诊断器支持自动探测标准/二开/自定义 API 根，并在探测失败时保留手动录入的 `apiBaseUrl` 与 `apiPaths`；浏览器预览保留“只写当前页面内存、不执行真实登录”的安全边界。
- v3-2 完成：价格榜表头支持点击排序，`倍率 / 充值 / 有效成本` 三列可切换升降序，默认仍按有效成本从低到高；排序状态只存在 renderer 本地 UI，不进入 URL 或本地存储。
- v3-2 补充：紧凑视图新增独立排序胶囊条，compact 模式和窄屏下都能直接切换倍率、充值和有效成本；表头在这些情况下退回为纯标签，避免重复控件挤占空间。
- v4-1 完成：价格榜新增“最终倍率”列，按 `倍率 ÷ 充值比例` 计算并支持排序；`0.1 / 10` 与 `0.01 / 1` 会得到同一个 `0.010x`，同时保留原始倍率、充值比例和有效成本列。
- v4-2 完成：`我的站点` 管理台分区 tabs 不再被 overview 卡住，切到管理视角后可直接看到 `总览 / 用户 / 账号 / 分组 / 渠道 / 平台 / 用量 / 设置`；即使暂时没有可管理站点，也会先显示空态引导，不再让入口消失。
- v4-3 完成：管理台继续补齐只读复刻，`用户` 页从原始记录整理为摘要+列表，`渠道` 页补入后台渠道清单和分组价格表，`平台` 页改为按 Anthropic / OpenAI / Gemini / Antigravity / Grok 的平台卡片聚合展示，同时在站点设置里补充 `admin/channels` 与 `admin/platforms` 手动路径入口。
- v4-4 完成：账号工作台修正为“组合”语义，默认保留账号当前已绑定的多分组，再通过候选卡片增删组合；批量推荐、组合预览和成功提示都从“单分组切换”改为“组合更新”。
- v4-5 完成：账号工作台新增“当前聚焦账号”组合详情卡；默认聚焦当前站点首个账号，点击账号行可切换详情，面板集中展示当前组合最低、站点余额、当前分组数、推荐最终倍率、当前组合 chips 和“补入推荐/调整组合”操作。
- v4-6 完成：聚焦账号卡继续补充“更优候选”池，按当前筛选与策略列出最多 3 个可点候选分组，帮助快速从当前组合里挑选更低分组搭配。
- v4-7 完成：更优候选池新增“预算线”输入，默认跟随当前组合最低最终倍率，可手动放宽/收紧候选显示范围；输入以字符串态保留三位小数，避免 `0.025` 这类值在交互中被吞成 `0.03`。
- v4-8 完成：近期分组变化历史保留上限从 40 提升到 120，减少历史记录过早被顶掉；同时把“近期分组变化”弹窗里的后台总览从弹窗里移除，只保留变化列表、分组历史详情和说明文案，避免点历史却看到另一整页管理台。
- v4-9 完成：修复历史数据易被误删的问题；真实历史不再提供一键“清空”，已删除分组的“清理”只隐藏该删除提示并持久化隐藏状态，不删除该分组历史时间线；历史保留上限继续放宽到 500 条。
- v4-9 补充：通过只读摘要审计正式 userData，并关闭旧的临时测试实例，避免用户误看到临时数据；修复演示变化详情读取事件源的小回归。公开资料不保留本机文件计数或临时路径。
- v4-10 完成：新增顶部第三视角“数据中心”，只读展示本地数据目录、站点数量、授权/管理员站点计数、隐藏分组、手动标签、分组变化历史和文件更新时间/大小；主进程 IPC 只返回脱敏计数与文件元数据，不把 token、cookie、原始站点配置或账号明细暴露给 renderer。
- v4-11 完成：修复“聪明哥”这类 Cloudflare/WAF 站点在 Node `fetch` 下返回 403 HTML 的同步问题；桌面主进程 Sub2API 请求和站点诊断改用 Electron/Chromium `net.fetch` 注入，测试环境仍保留全局 `fetch`；网页登录 token 捕获同时支持常见 localStorage/cookie key。
- lcodex 授权修复 v1 完成：网页登录授权窗口现在会读取页面 `window.__APP_CONFIG__.api_base_url` 与 `sub2api_auth_client_id`，当 localStorage/cookie 没有直接 JWT 时，会用授权窗口隔离 cookie + UA 调用 `/auth/session/restore` 获取临时 access token；成功后自动保存、关闭弹窗，并把 lcodex 公开配置里的 `https://api.lcodex.cc` 作为站点 API 基址保存。
- v4-12 完成：账号工作台推荐语义修正；未绑定账号显示“推荐初始分组/选择推荐”，已有组合且候选更低才显示“可加入更低分组/加入更低分组”，不再把所有候选都叫“建议补入”。
- v4-13 完成：账号工作台“当前组合最低”增加 hover 明细，展示最低基准来自哪个当前分组以及全部当前分组倍率；推荐结果 hover 补充“候选最终 / 比较基准”，避免误解为什么会提示加入更低分组；成本页用绿色表示售卖/所在分组、蓝色表示我的账号，父卡、展开明细和摘要胶囊同步区分。
- v4-2.4 完成：新增账号成本档案，区分 `三方按量 / 赠送免费 / 自购订阅 / 手动成本` 四类成本；`我的站点 → 成本` 可编辑固定成本、周期天数、单位成本倍率和脱敏备注；赠送免费账号按 0 成本计算，自购订阅/手动成本显示固定成本与单位成本，三方按量继续沿用上游来源映射。
- v4-2.5 完成：成本页增加排序下拉，默认未设置成本优先；新增分类排序，按 Anthropic → OpenAI → Gemini → Antigravity → Grok → 其他 排列账号卡，并在卡片上显示分类标签。
- v4-2.6 完成：纠正账号成本语义，移除分组明细行里的成本设置入口；成本弹窗明确说明“账号成本，不是分组成本”，只显示账号和当前分组数量，分组仅作展示。
- v4-2.7 完成：继续收敛成本页文案，把“账号 × 我的分组 / N 个分组 / 收起分组 / 保存成本”等容易误导的表达改为“账号 × 使用明细 / N 条明细 / 收起明细 / 保存账号成本”，成功提示也明确这是账号级设置，不会为单个分组单独建成本档案。
- v4-2.8 完成：成本页默认改为“按分组”视角，按“售卖分组 → 多个账号明细”展示；保留“按账号”辅助视角；新增状态筛选、成本类型筛选，以及未设置优先、风险优先、成本类型、分类、售卖倍率、账号数量、最低利润排序。
- v4-2.9 完成：修复成本页布局展示不全；成本工具栏改为可换行 flex，统计卡/用量诊断/摘要胶囊/操作按钮都限制撑宽并允许换行，避免右侧排序和卡片操作被裁切。
- v5 完成：账号工作台信息密度继续收敛；聚焦账号卡移除站点余额，来源/成本改成紧凑 icon tag；所有被省略的关键字段补齐 hover 全量说明；分组 chip 改为单行滚动并保留逐个 `X` 移除入口。
- v6 完成：按用户截图复修聚焦账号卡；状态组件不再渲染详情正文，只保留 icon/tag 和 hover；分组 chip 从左侧小列挪到聚焦卡整行宽度，确保多分组尽量铺满一行；重新打包 mac release，避免用户继续打开旧包。
- v6.1 完成：账号详情进一步收敛为行内展开，站点标题不再自动展开首个账号；价格榜最终倍率新增涨跌图标，检测到涨价时弹出 warning toast 提醒用户查看变化。
- 成本保护安全推荐 v1 完成：二开站点分组元数据兼容 `专属/订阅/峰值` 字段并在价格榜、来源钱包、我的站点分组和切组候选中展示；管理员账号快照提取 `apiBaseUrl`；账号来源在“唯一站点 + 唯一倍率 + API Base 匹配”时自动识别；账号推荐从“找更低分组”改为“找不低于账号安全线的最低安全候选”；成本保护顶部统计卡支持点击快速筛选亏损、接近亏损、未绑定来源和基础倍率需调。
- 打包脚本修复：`package:mac` 现在会对 `.app` bundle 执行 ad-hoc `codesign --force --deep --sign -`，避免严格验签失败。
- 启动恢复修复：桌面入口/再次激活现在会把主窗口从气泡态拉回可见状态，避免用户感觉“打不开”。
- 启动钥匙串修复：应用启动只读取站点元数据，不主动解密 token；真实刷新、网页登录保存、管理员切组等需要凭证的动作才触发 macOS Safe Storage，避免主界面被钥匙串弹窗挡住。手动刷新后会恢复定时轮询。
- v3-7 完成：新增“我的站点”账号工作台，支持账号搜索、当前最终倍率、推荐更低候选、逐个确认的批量推荐队列、批量执行结果面板、失败重试/跳过，以及“当前分类优先 / 全站最低”策略模板；策略偏好保存在 renderer 本地，不新增远程批量写入接口。
- 未完成/未纳入：真实生产站点写入、macOS 签名/公证、自动更新和安装包发布。

## 关键改动

- 改动范围：Electron main/preload/renderer、Sub2API adapter、safeStorage 设置、Vitest、DESIGN.md 与工作流工件。
- 关键文件或模块：`src/main/index.ts`、`src/main/storage.ts`、`src/main/sub2api-client.ts`、`src/main/station-diagnostics.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/shared/`、`scripts/package-mac.mjs`。
- 重要取舍：不保存明文密码；价格接口失败时保留余额/倍率监控；远程切组以服务端当前分组为并发前置条件。

### 价格榜涨跌筛选、提醒与利润口径 v1

- 价格榜新增 `全部 / 涨价 / 降价` 筛选。筛选按每个分组时间最新的倍率变化判断，重复模型行不重复计数；即使用户在“近期分组变化”窗口隐藏了提示，价格榜仍保留该分组的涨跌状态。
- 启动和后续同步发现未提醒的涨跌时，显示应用内提示；系统通知已授权时同步发送 macOS 通知，未授权时由系统请求权限。已处理的最新时间仅记录在本地 UI 存储，避免同一批变化重复通知。
- 成本保护明确口径：`单位利润 = 售卖最终倍率 - 账号成本倍率`，并说明赚钱、亏损、接近亏损与金额估算的前提。

## 验证结果

### 用户自用排除经营核算 正式实施包 v1

| 事项/验收 | 影响维度 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- |
| 本地用户标记 | 偏好持久化 / IPC | `tests/storage.test.ts` 覆盖去重与非法 ID 丢弃 | 通过 | 未保存用户名称或邮箱 |
| 严格账本与收益排除 | 主进程 DTO / 时间账本 | `tests/time-cost-ledger.test.ts` 覆盖顶层 `user_id`、内部用户排除、旧记录提示 | 通过 | 站点不返回 `user_id` 时无法精确排除 |
| 兼容与构建 | Electron main/preload/renderer | `npm run verify`，11 文件 / 153 测试；生产构建 | 通过 | 真实站点字段仍需用户实测 |
| macOS 交付 | release 包 / 签名 | `npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check` | 通过 | 自动化浏览器被本地文件策略阻断 |

- 影响范围自查：实际变更符合确认包，只涉及本地内部用户档案、最小化账本字段、收益聚合、用户/收益界面、IPC、测试和交付工件；未新增远程写入、凭据读取、服务端迁移或调度变更。

### 自有账号免计费 正式实施包 v1

| 事项/验收 | 影响维度 | 实际修改 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- | --- |
| 账号档案与本地兼容 | 共享类型 / 本地偏好 | 新增 `self-owned-exempt` 并清理不适用成本字段 | `tests/storage.test.ts` | 通过 | 当前档案口径不保留历史生效时间 |
| 成本保护 | React 派生状态 / 操作建议 | 独立免计费状态；跳过来源风险、基础倍率建议与分组成本比较 | `tests/cost-protection.test.ts` | 通过 | 真实站点账号关系待用户验收 |
| 收益聚合 | 主进程 IPC / 本地账本 | 主进程按本地账号档案传入免计费集合；收入和请求保留，成本归零并单列汇总 | `tests/time-cost-ledger.test.ts` | 通过 | 免计费是用户当前会计口径，不代表供应商真实成本 |
| 构建和交付 | 类型 / 回归 / macOS 包 | 全量验证、重新打包、严格验签、差异检查 | `npm run verify`（148 项）、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` | 通过 | 浏览器自动化无法访问本机预览端口，未完成可见点击 |

- 安全范围：没有新增网络调用、远程写入、授权或凭据传输；免计费集合由主进程读取本地偏好，不接受 renderer 传入的账号名单。
- 影响范围自查：实际修改仅覆盖已确认的账号成本档案、收益聚合、成本/收益展示、测试和交付工件；未更改调度、上游映射、原始用量日志或远程站点配置。

### 站点类型适配器 正式实施包 v1

| 事项/验收 | 影响维度 | 实际修改 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- | --- |
| 类型与历史兼容 | 本地配置 / 存储 | 保存 `adapterType`、自动检测结果；旧站点保持 Sub2API 兼容 | storage 回归测试 | 通过 | 旧站点需用户按需编辑为显式类型 |
| NewAPI 只读读取 | 外部 API / 凭据边界 | 独立用户、令牌、模型适配器；令牌原文丢弃 | `tests/newapi-client.test.ts` | 通过 | 各 NewAPI 二开端点仍需真实脱敏样本联调 |
| 自动探测与手工路径 | 诊断 / 兼容性 | 只读 Sub2API/NewAPI 探针；NewAPI 同源路径可覆盖 | diagnostics 测试 | 通过 | WAF 或单端点兼容站可能需用户手选 |
| UI 类型流程 | React / 受限桌面布局 | 类型下拉、动态路径表单、能力与降级说明 | 浏览器预览切换 NewAPI；900px 无横向溢出 | 通过 | 真实桌面网页登录仍由用户完成 |
| 交付 | 构建 / macOS 包 | 全量测试、构建、重新打包和签名 | `npm run verify`（11 files / 137 tests）、`npm run package:mac`、严格 codesign、`git diff --check` | 通过 | 无远程写入 |

- 影响范围自查：实际改动符合确认包，仅新增只读适配器、配置字段、诊断分流和 UI 说明；不迁移服务端数据，不新增远程写入，不向 renderer 暴露凭据；通过。

### 站点角色与兼容修复 正式实施包 v1

| 事项/验收 | 影响维度 | 实际修改 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- | --- |
| aihub 分组 404 | 兼容 API 根 / 本地配置 | 同源 API 前缀恢复，防止 `/api` 覆盖 `/api/api/v1` | `tests/storage.test.ts` 嵌套 API 基址用例 | 通过 | 仍需用户真实 aihub 会话同步确认 |
| 聪明哥 403 诊断 | 凭据边界 / 只读网络 | 主进程诊断合并已保存 Cookie、UA、令牌、Referer；403 给出恢复动作 | `tests/station-diagnostics.test.ts`、`tests/sub2api-client.test.ts` | 通过 | WAF 规则和 Cookie 失效仍受站点控制 |
| 三方/我的站点分离 | renderer 视图 / 历史兼容 | 显式 `stationRole` 优先，旧记录继续能力推断 | `tests/storage.test.ts`、`tests/ranking-sort.test.ts`、浏览器预览 tab 检查 | 通过 | 旧站点需用户首次编辑后保存正确角色 |
| 打包与回归 | TypeScript / macOS 包 | 更新主进程、存储、诊断、适配器与 React UI | `npm run typecheck`、`npm run verify`（131 tests）、`npm run package:mac`、严格 codesign | 通过 | 未对真实站点执行远程写入 |

- 界面/交互验证：浏览器预览确认来源钱包“我的站点”仅显示聚合站账号，“三方站点”与其分离；本轮不启动新的桌面应用，避免干扰用户已运行的实例。
- 影响范围自查：实际改动仅覆盖已确认的角色路由、兼容请求和只读诊断；没有新增远程写入、没有迁移、没有把 JWT/Cookie/API Key 传入 renderer；通过。
- 代码审阅：无阻断或高风险发现。残余风险为真实二开站 API/风控规则与已保存会话寿命，需在最新版应用中只读验证。

### 收益区间核算 正式实施包 v1

| 事项/验收 | 影响维度 | 实际修改 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- | --- |
| TASK-PROFIT-01/03 严格收益口径与时点成本 | 共享领域规则 / 账本历史 | 严格提取 `actual_cost`、账号基础成本和账号倍率；按请求发生时点追溯上游倍率 | `tests/time-cost-ledger.test.ts`：左闭右开、倍率变更、未知来源、时区桶 | 通过 | 本地观察时点不是供应商审计时点 |
| TASK-PROFIT-02 主进程区间读取 | 外部只读 API / 凭据边界 | `/admin/usage` 受限分页、日期/账号/分组筛选、页数覆盖状态 | `tests/sub2api-client.test.ts`：URL、脱敏字段与完整覆盖状态 | 通过 | 非标准 fork 的明细字段仍需真实脱敏样本联调 |
| TASK-PROFIT-04/05 收益视图 | React / 响应式 UI | “我的站点 → 收益”日/小时切换、日期、账号、售卖分组筛选、收入/成本/毛利/待归因汇总 | 构建产物浏览器点击路径；900px 下 `scrollWidth === clientWidth` | 通过 | 演示模式不读取真实管理员明细；真实管理员站点需用户触发一次核算 |
| TASK-PROFIT-06/07 交付 | 测试 / macOS 产物 | 新增领域与 adapter 测试，重新打包 arm64 应用 | `npm run verify`（10 文件、126 tests）、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` | 通过 | 未对任何真实站点执行远程写入 |

### 价格榜涨跌筛选、提醒与利润口径 v1

| 事项/验收 | 影响维度 | 实际修改 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- | --- |
| 价格榜涨跌筛选、提醒与利润口径 v1 | renderer UI / 本地提醒标记 / 成本口径文案 | 筛选控件、持久化历史方向解析、通知摘要、成本保护公式说明 | `npm run verify`（100 tests）、最终 `.app` 打包与严格签名、桌面应用 AX 点击“涨价”筛选 | 通过 | 当前真实站点尚未同步到价格行，真实涨跌筛选结果和 macOS 通知权限弹窗待用户实机确认 |

### 事项与影响证据矩阵

| 事项/验收 | 影响维度 | 实际修改 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- | --- |
| ITEM-001 | 安全/配置 | safeStorage + IPC 脱敏 + auth IPC | typecheck、源码审查、凭证扫描 | 通过 | 未测试系统加密不可用的真实设备 |
| ITEM-002 | API/轮询 | adapter + per-station scheduler + `/groups/available` | 12 个测试、构建、普通分组 URL 断言 | 通过 | 真实站点版本差异待联调 |
| ITEM-003 | UI/原生窗口 | full/compact/bubble/Tray | Electron 点击路径、4 张截图、气泡恢复回归 | 通过 | Tray 最终发布包需复测 |
| ITEM-004 | 权限/远程写入 | admin read + confirmed group mutation | 确认框、无变化禁用、主进程并发校验 | 通过 | 未对生产站点发起写入 |
| ITEM-005 | 交付 | verify、doctor、audit、UI 报告 | `npm run verify`、构建、打包、签名 | 通过 | 真实网页登录路径未在用户站点联调 |
| v3-1 兼容诊断 | 站点兼容/手工补录 | station-diagnostics + settings modal + preview no-op | `tests/station-diagnostics.test.ts`、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict` | 通过 | 真实 fork 站点仍需用户站点联调样本 |
| v3-2 排序控件 | renderer 本地 UI / 价格榜 | 价格榜表头按钮排序、默认文案同步、窄屏隐藏规则适配 | `tests/ranking-sort.test.ts`、`npm run verify`、本地浏览器预览点击路径、截图 `/Users/bing/Myself/Code/MacTools/AIZZZWatch/.specify/ranking-sort-preview.png` | 通过 | 无 |
| v3-2 紧凑排序条 | renderer 本地 UI / compact 模式 | 紧凑模式独立排序胶囊条、窄屏降级为标签、充值排序仍可达 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、本地预览截图 `/Users/bing/Myself/Code/MacTools/AIZZZWatch/.specify/ranking-sort-compact.png` | 通过 | 真实站点数据下的排序偏好仍需用户确认 |
| v4-1 最终倍率 | renderer 本地 UI / 比价排序 | 新增 `effectiveMultiplier = rateMultiplier / rechargeRatio`、价格榜列、排序按钮与窄屏列优先级 | `tests/ranking-sort.test.ts`、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict` | 通过 | 真实站点样本下的采购排序偏好仍需用户确认 |
| v4-3 管理台继续复刻 | 管理台只读分区 / 兼容路径 | `用户` 页增加摘要+字段化列表，`渠道` 页增加后台渠道清单，`平台` 页增加平台卡片聚合，`adminChannels/adminPlatforms` 手动路径入口 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、Computer Use AX 树切换 `渠道` / `平台` 标签 | 通过 | 真实站点 `/admin/channels` / `/admin/platforms` 返回结构仍需用户站点联调 |
| v4-4 账号组合语义 | 账号工作台 / 组合更新 | 账号工作台默认保留当前多分组，候选项支持增删组合，批量推荐与成功提示改为组合语义 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、Computer Use AX 树切换 `账号` 标签 | 通过 | 当前仅验证空态与可见说明；真实多分组账号仍需用户样本联调 |
| v4-5 账号聚焦面板 | 账号工作台 / UI 联动 | 新增当前聚焦账号详情卡、账号行点击聚焦、默认聚焦行高亮、队列切换时同步焦点 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check`、Electron CDP 临时演示数据截图 `specs/sub2api-monitor/screenshots/account-focus-panel.png` | 通过 | 真实管理员站点账号快照为空时不会显示聚焦卡；需用户站点返回账号列表后验收真实数据 |
| v4-6 候选池补充 | 账号工作台 / UI 联动 | 聚焦卡新增更优候选池，列出最多 3 个可点候选分组并保留按策略筛选后的顺序 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check`、Electron CDP 临时演示数据截图 `specs/sub2api-monitor/screenshots/account-candidate-panel.png` | 通过 | 真实站点候选池内容仍依赖站点分组与策略过滤结果 |
| v4-7 候选预算线 | 账号工作台 / UI 联动 | 更优候选池增加预算线输入；默认跟随当前组合最低最终倍率，手动输入可放宽到 3 条或收紧到 1 条候选；输入以字符串态保留三位小数 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、隔离 CDP DOM 读数（0.068 -> 3 条，0.024 -> 1 条） | 通过 | 当前未补充截图证据，因 CDP 截图在隔离窗口上超时 |
| v4-8 历史保留与弹窗收敛 | 历史记录 / UI 布局 | 近期分组变化历史保留上限从 40 提升到 120；“近期分组变化”弹窗移除后台总览嵌入，仅保留变化历史、详情和说明 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check` | 通过（代码/测试/打包）；可见重开待用户确认 | 当前未再次打开窗口复核，需用户自己重开后确认最终观感 |
| v4-9 历史数据安全 | 历史记录 / 本地偏好 / UI 语义 | 真实历史弹窗移除一键清空；删除分组的清理只隐藏删除提示并保留历史详情；新增 `dismissedGroupChangeEventIds` 持久化；历史保留上限提升到 500；演示详情继续可点开 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check`、正式 userData 只读计数 | 通过 | 本轮未重启可见窗口，按用户要求不再代开多个实例；旧版本已经清空覆盖的数据无法凭空恢复 |
| v4-10 数据中心 v1 | 本地数据可见性 / 安全 IPC / UI 布局 | 新增只读数据中心视角；显示数据目录、站点/授权/管理员计数、偏好计数和两份本地文件元数据；禁用导出/导入/诊断后续按钮 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check` | 通过 | 未启动桌面可见验证，避免创建多个应用实例；数据中心只读，不含备份/恢复真实能力 |
| v4-11 聪明哥网络栈兼容 | 外部 API / 安全凭据 / 诊断 | `Sub2ApiClient` 支持 fetch 注入，桌面端传入 Electron `net.fetch`；站点诊断同样走 Chromium 网络栈；网页登录捕获扩展到常见 JWT/localStorage key | `npm run verify`、只读聪明哥探针、`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check` | 通过 | 聪明哥管理员接口仍返回 `Admin access required`，这是账号权限/站点权限问题；本轮未启动可见窗口 |
| lcodex 授权修复 v1 | 网页登录授权 / session restore / API 根识别 / 凭据安全 | 新增 `src/main/web-auth.ts`；授权窗口读取公开 `api_base_url` 和 `sub2api_auth_client_id`；无直接 JWT 时按候选 API 根调用 `/auth/session/restore`；只保存后续 API 请求域的 cookie；保留旧 token 别名优先级 | `npm run typecheck`、`npm test -- tests/web-auth.test.ts tests/sub2api-client.test.ts tests/storage.test.ts`、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check` | 通过；待用户实机登录确认 | 未替用户输入账号密码；真实 lcodex 登录自动关闭需用户在桌面授权窗口验证 |
| v4-12 账号推荐补入语义 | 账号工作台 / UI 文案 / 推荐动作 | 新增推荐文案分支：无当前分组为“推荐初始分组/选择推荐”，已有组合且更低为“可加入更低分组/加入更低分组”，其他为“最低候选/选择候选”；候选池标题按场景显示“可选分组/更低候选” | `npm run typecheck`、`npm test -- tests/ranking-sort.test.ts`、本地浏览器预览旧文案消失、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、release `app.asar` 文案抽查 | 通过 | 本地演示数据没有未绑定账号样本，未绑定分支通过单测覆盖；需用户真实数据确认 |
| v4-13 当前基准 hover 与成本颜色区分 | 账号工作台 / 成本页 / UI 语义 | “当前组合最低”hover 显示当前分组或多分组最低来源；推荐结果 hover 显示候选最终与比较基准；成本页父卡、嵌套明细、摘要胶囊按绿色分组/蓝色账号区分 | `npm run typecheck`、`npm test -- tests/ranking-sort.test.ts`、本地浏览器预览 DOM/CSS 读数、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、release `app.asar` 抽查 | 通过 | 浏览器预览演示数据只有单分组账号，多分组 hover 通过单测覆盖；用户真实 1for.cc 数据需重启后实机确认 |
| v4-14 账号调度筛选与最低卡片直显 | 账号工作台 / 推荐安全 / UI 可读性 | 管理员账号快照解析调度字段；账号页新增调度筛选，默认只看调度开启；调度关闭/未知账号可筛选查看但不进入候选和批量推荐；“当前组合最低”宽卡直接显示主值和来源分组 | `npm run typecheck`、`npm test -- tests/ranking-sort.test.ts tests/sub2api-client.test.ts`、浏览器预览点击 `我的站点 → 账号 → 调度关闭`、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、产物文案/CSS 抽查 | 通过 | 不同二开站点的调度字段名可能仍有差异；拿不到明确字段时显示“调度未知”且默认不参与推荐，需真实站点确认字段覆盖 |
| v4-14.1 调度字段 hotfix | Sub2API 兼容 / 账号工作台 | 追加兼容官方账号字段 `schedulable`，以及二开可能使用的 `is_schedulable` / `schedulable_enabled`；真实站点只返回 `schedulable: true` 时现在会进入“调度开启”筛选 | `npm test -- tests/sub2api-client.test.ts tests/ranking-sort.test.ts`、`npm run typecheck`、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、产物 `out/main/index.js` 字段抽查 | 通过 | 若某站点使用完全不同字段名，仍需拿一条脱敏账号响应补兼容 |
| v4-15 账号列表可读与操作增强 | 账号工作台 / UI 布局 / 筛选 / 远程确认入口 | 账号行重构为身份、来源/成本状态、所在分组、右侧倍率/推荐四块；新增渠道筛选和所在分组筛选；来源/成本状态可直接打开绑定/成本弹窗；分组 chip 完整展示并支持从账号移除分组，移除仍进入确认组合流程 | `npm run typecheck`、`npm test -- tests/ranking-sort.test.ts tests/cost-protection.test.ts`、浏览器预览 `我的站点 → 账号` DOM/CSS 检查、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、产物文案/CSS 抽查 | 通过 | 真实站点的超长账号名/大量分组仍需用户实机确认滚动手感；本轮未对生产站点提交远程移除；用户已确认接受当前交付 |
| v6 账号工作台对齐截图复修 | 账号工作台 / UI 信息密度 / hover / 交互确认 / 打包 | 聚焦账号卡确认不含站点余额；来源/成本状态只渲染 icon tag，详情进入 hover；分组 chip 独占整行宽度并带 `X`；点击 `X` 进入“确认分组组合”弹窗后取消，无远程提交 | `npm run typecheck`、`npm test -- tests/ranking-sort.test.ts tests/cost-protection.test.ts`、本地浏览器预览 DOM/CSS 检查、900px 窄屏检查、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、产物 CSS/JS 抽查、`git diff --check` | 通过；待用户实机确认 | 本轮没有对真实生产站点提交任何远程移除或切组写入；mac release 已重打包但未替用户启动桌面 App |
| 成本保护安全推荐 v1 | 二开分组元数据 / 自动来源 / 推荐安全线 / 成本卡筛选 | 分组解析兼容专属、订阅、峰值字段并渲染标签；管理员账号提取 `apiBaseUrl`；自动来源推断只在唯一匹配时生效；推荐候选只保留 `最终倍率 >= 账号安全线`；成本保护统计卡变为可点击快捷筛选 | `npm run typecheck`、`npm test -- tests/sub2api.test.ts tests/sub2api-client.test.ts tests/ranking-sort.test.ts`、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check` | 通过；待用户实机确认 | 未替用户打开桌面 App，避免再次制造多个实例；自动来源推断对多候选保持不绑定，需要用户用真实站点数据确认是否命中 |
| v4-2.4 账号成本档案 | 成本类型 / 本地偏好 / UI 弹窗 | 新增账号成本档案编辑弹窗、成本类型标签、固定成本和单位成本展示，数据中心增加成本档案计数，赠送免费账号按 0 成本计算 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、浏览器可见预览：`我的站点 → 成本 → 设置成本`，切换到 `赠送免费` 并保存后卡片即时更新 | 通过 | 订阅/手动成本仍是本地口径展示，尚未做更细的按天摊销报表 |
| v4-2.5 成本页排序增强 | 排序 / UI 识别 / 分组分类 | 成本页新增排序下拉，默认未设置成本优先；新增分类排序，账号卡展示分类标签并按主分类顺序排列 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、浏览器可见预览：`我的站点 → 成本 → 排序 = 分类排序` | 通过 | 分类排序依赖当前关键词识别，偏门分类命名后续仍需补规则 |
| v4-2.6 账号成本语义纠偏 | UI 语义 / 成本入口 / 用户理解 | 移除分组明细行成本入口，账号卡增加作用范围说明；成本弹窗说明账号成本适用于该账号全部分组，并把费用周期解释为固定成本覆盖天数 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、浏览器可见预览：成本弹窗显示账号级说明 | 通过 | 若后续做分组级收益归因，需要另建用量分摊逻辑，不应把账号成本拆成分组成本 |
| v4-2.7 账号成本文案去分组化 | UI 文案 / 保存反馈 / 用户理解 | 成本保护说明改为“账号 × 使用明细”；账号卡和展开按钮改为“条明细/使用明细”；成本入口与保存按钮改为“账号成本”；成功提示明确不会为单个分组单独建成本档案 | `npm run typecheck`、`npm test -- tests/cost-protection.test.ts`、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、包内文案抽查 | 通过 | 未替用户打开 release app 截图确认，避免再开多个实例；用户需重启最新应用验证是否仍看到旧窗口缓存 |
| v4-2.8 成本分组视角与筛选排序 | UI 结构 / 分组多账号 / 筛选排序 | 默认按售卖分组聚合多个账号明细；账号成本、来源、利润和保护动作放在账号行；保留按账号视角；新增状态筛选、成本类型筛选、售卖倍率/账号数量/最低利润排序 | `npm run typecheck`、`npm test -- tests/cost-protection.test.ts`、`npm run verify`、浏览器本地预览点击 `我的站点 → 成本`、展开分组、切换筛选排序 | 通过 | 真实站点多账号分组数据还需用户实机确认；本轮未替用户打开 release app |
| v4-2.9 成本页布局展示修复 | CSS 布局 / 窗口宽度 / 可操作性 | 成本工具栏改为 flex 换行；搜索框/下拉/计数文本限制宽度；成本统计卡 auto-fit；用量诊断条可换行；摘要胶囊和操作区不再撑爆卡片 | `npm run typecheck`、`npm test -- tests/cost-protection.test.ts`、本地浏览器预览横向溢出测量、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、release `app.asar` 样式抽查 | 通过 | 未替用户打开 release app；需用户用真实窗口确认最终手感 |
| 启动恢复 | 主窗口可见性 | activate/second-instance 统一拉起主窗口 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、桌面重启 | 通过 | 气泡模式下仍依赖菜单栏/气泡入口切回 |
| 启动钥匙串 | 安全存储/可用性 | token 延迟解密，启动空快照为“暂无数据”，手动刷新后恢复轮询 | `npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、桌面截图 `/tmp/aizzzwatch-reopen.png` | 通过 | 真实站点刷新仍需用户授权钥匙串或重新网页登录 |
| v3-7 我的站点工作台 | 账号管理/远程写入确认/UI | 我的站点视图、账号搜索、推荐候选、逐个确认队列、批量结果、失败重试/跳过、策略模板 | `tests/ranking-sort.test.ts`、`npm run verify`、浏览器可见预览、`git diff --check`、`npm run package:mac`、`codesign --verify --deep --strict`、asar 内容抽查 | 通过 | 队列不持久化；真实站点连续切组依赖管理员接口稳定性；无一键批量远程写入 |

- 执行命令：`npm run typecheck`、`npm test -- tests/web-auth.test.ts tests/sub2api-client.test.ts tests/storage.test.ts`、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app`、`git diff --check`。
- 自动验证结果：TypeScript 通过；目标测试 23 个通过；全量 9 个测试文件、86 个测试全部通过；main/preload/renderer 生产构建通过；macOS arm64 包重打并通过严格签名校验。
- 本地数据路径复核：只读检查了独立的 Electron userData 目录和文件状态；本轮不公开站点、分组、文件计数、token、cookie 或原始偏好内容。
- 界面/交互验证：桌面快捷入口启动与单实例复测通过；再次从桌面打开时能把主窗口拉回前景，不再卡在气泡态；启动后不再主动弹出钥匙串授权，旧站点显示“暂无数据”，等待用户手动刷新/重新登录；只读调试确认桌面包 `window.aizzz` 已注入且 `isBrowserPreview=false`；本地模拟站点验证 `/login` 302 重定向场景下 `auth:login` 成功保存并返回站点列表；本地 cookie-required 模拟站点验证 `Cookie Station` 登录后可得到健康快照，`Session network fingerprint changed` 不再阻断该站点；按钮语义已改为授权失效时“重新登录”、普通错误时“重试”；浏览器预览路径已验证“网页登录授权禁用、手工保存后立即显示新增站点”；v7 自动验证覆盖充值比例默认值、结构化价格解析、构建与打包签名；v8 自动验证覆盖多模型价格结构保留、分类比价首页构建与打包签名；v3-1 诊断器已在代码与单测层面确认自动探测和手工补录路径；v3-2 已通过可见预览确认表头排序按钮、默认方向和升降序切换；v3-2 紧凑模式已通过可见预览确认排序胶囊条、表头标签降级和充值排序可达；v3-7.3 可见预览确认“我的站点”策略模板、策略刷新保持、批量结果面板、逐个确认队列和最后一项跳过；v4-5 使用临时隔离 `AIZZZWATCH_USER_DATA_DIR` 演示数据和 Electron CDP 验证“我的站点”可切换、聚焦卡出现、账号行高亮、截图落盘；v4-6 继续用隔离演示数据和 Electron CDP 验证候选池出现、可点候选列表显示 3 项，截图落盘；真实站点网页登录和真实管理员连续切组仍需要用户站点联调。
- 界面/交互验证：桌面快捷入口启动与单实例复测通过；再次从桌面打开时能把主窗口拉回前景，不再卡在气泡态；启动后不再主动弹出钥匙串授权，旧站点显示“暂无数据”，等待用户手动刷新/重新登录；只读调试确认桌面包 `window.aizzz` 已注入且 `isBrowserPreview=false`；本地模拟站点验证 `/login` 302 重定向场景下 `auth:login` 成功保存并返回站点列表；本地 cookie-required 模拟站点验证 `Cookie Station` 登录后可得到健康快照，`Session network fingerprint changed` 不再阻断该站点；按钮语义已改为授权失效时“重新登录”、普通错误时“重试”；浏览器预览路径已验证“网页登录授权禁用、手工保存后立即显示新增站点”；v7 自动验证覆盖充值比例默认值、结构化价格解析、构建与打包签名；v8 自动验证覆盖多模型价格结构保留、分类比价首页构建与打包签名；v3-1 诊断器已在代码与单测层面确认自动探测和手工补录路径；v3-2 已通过可见预览确认表头排序按钮、默认方向和升降序切换；v3-2 紧凑模式已通过可见预览确认排序胶囊条、表头标签降级和充值排序可达；v3-7.3 可见预览确认“我的站点”策略模板、策略刷新保持、批量结果面板、逐个确认队列和最后一项跳过；v4-5 使用临时隔离 `AIZZZWATCH_USER_DATA_DIR` 演示数据和 Electron CDP 验证“我的站点”可切换、聚焦卡出现、账号行高亮、截图落盘；v4-6 继续用隔离演示数据和 Electron CDP 验证候选池出现、可点候选列表显示 3 项；v4-7 继续用隔离演示数据和 Electron CDP DOM 读数验证预算线可放宽到 3 项、收紧到 1 项；v5 使用本地浏览器预览验证账号聚焦卡去余额、来源/成本 icon tag、分组 chip 单行滚动、分组 `X` 打开确认组合弹窗；真实站点网页登录和真实管理员连续切组仍需要用户站点联调。
- 截图或 UI 报告：`specs/sub2api-monitor/ui-verification.md` 与 `screenshots/`。
- 未覆盖项：生产站点切组、签名公证分发、自动更新、真实站点兼容探测可见回归、安装包升级。
- 剩余风险：不同 Sub2API 版本/feature flag 的字段差异；最终发布包的 Tray 行为需复测。
- 本轮新增未覆盖项：未替用户启动桌面 App 做可见点击，原因是用户前面反馈曾打开多个实例，本轮选择只打包和校验桌面入口，留给用户直接从桌面快捷方式单实例验证。
- lcodex 授权修复未覆盖项：没有替用户输入 lcodex 账号密码，避免接触真实凭据；需用户用桌面快捷入口实测“网页登录后自动关闭弹窗并同步站点”。

## Follow-up aihub 用户资料接口兼容 正式实施包 v1

- status: awaiting_user_acceptance
- summary: aihub 保留标准 Sub2API 分组、倍率和价格接口；用户资料与余额改读其实际的 `/auth/me?timezone=Asia%2FShanghai`。仅当资料路径仍为默认 `/user/profile` 时生效，用户手动填写的非默认资料接口保持优先。
- verification: `npm run verify`（11 个测试文件、140 条测试）、`git diff --check`、`npm run package:mac`、新 release 包 `codesign --verify --deep --strict`；新包已启动，新增客户端、诊断和共享路径回归覆盖。
- security: 没有写入远端数据。认证信息继续只在主进程本机加密保存；源码、测试、错误信息和交付记录均不包含 JWT、Cookie 或 API Key。
- residual risk: 未使用用户在对话中暴露的旧会话做真实请求验证；用户应撤销旧令牌并重新授权，再从新包确认余额和分组同步。

## 用户选择与原因

1. 选择：确认需求与影响 v1。原因：锁定多站监控、窗口形态和管理员切组边界。
2. 选择：确认计划 v1。原因：同意按安全 IPC、适配器、UI、验证的顺序实现。
3. 选择：请求修订认证模型。原因：应允许提供站点登录 token 或完成站点授权登录，再按账号权限查询分组。
4. 选择：确认认证修订 v2。原因：普通账号的“全部分组”明确为 `/groups/available` 返回的全部可用分组。

## 复盘结论

- 做得好的地方：先从上游源码确认接口；真实 Electron 验证发现并修复气泡恢复和模式同步问题。
- 建议改进的地方：下一轮应尽早引入一份用户实际站点响应样本，降低版本兼容不确定性。
- 不满意分类：`requirement_miss`、`implementation_defect`、`ui_interaction`。
- 支持证据：上游源码确认普通分组由 `/groups/available` 按账号权限过滤；本地实现已加入隔离授权窗口、refresh token 和管理员 header 区分。

## 记忆与进化后续

- 记忆候选：无长期记忆候选；实现事实保留在项目 Profile 和本 feature 工件。
- 规则变更候选：无；本次发现均为实现缺陷并已修复，不需要升级 workflow。
- 是否需要用户确认：仅需要本次交付验收。

## 下一步建议

- 立即可继续：添加一个真实 Sub2API 站点做只读余额/倍率联调。
- 建议后续跟进：真实站点兼容验证通过后，再增加签名安装包与自动更新。

## 费用归档正式实施包 v1

### Meta

- 状态：`awaiting_user_acceptance`
- 目标：将管理员用量按上海自然日归档到本地脱敏账本，避免单次区间读取的 2,000 条上限掩盖历史覆盖范围。

### 本次完成

- “我的站点 → 收益”保留按天/小时区间查看，并新增“归档当前区间”。单次最多归档 7 天。
- 每日独立读取、记录覆盖状态；重归档会替换同站点同一上海自然日的旧明细，不会叠加过期行。
- 收益报告仅读取已归档的最小化字段；原始管理员日志、请求体、API Key、JWT、Cookie 不落盘也不进入 renderer。

### 验证结果

- 只读归档：按自然日覆盖状态和分页上限验证完整/部分覆盖分支；不公开本机日期、条数或用量记录。
- 自动验证：`npm run typecheck`、`npm test`（11 文件 / 141 用例）、`npm run build`、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` 均通过。
- 可见验证：新版签名包已启动，已读取本机站点与来源余额；用户正在操作窗口，未继续代点收益页以免干扰。

### 剩余风险

- 单日超过 2,000 条时仍只能得到部分覆盖，界面会明确提示，不能据此宣称完整收益。
- 固定订阅/手动成本尚未摊销进“可归因毛利”；当前毛利仅按每条用量的可精确上游成本计算。

## 价格榜使用中标记 语义确认 v1

### 本次完成

- 价格榜新增“账号使用：全部 / 使用中”筛选，使用中数按去重后的三方分组计数。
- 已精确关联的分组显示绿色链路图标与账号数；hover 展示“我的站点 / 账号”完整来源。
- 仅旧式有效分组关联和单分组 Key 跟随关系可标记；多分组 Key、失效 Key、未绑定来源都不标记也不会进入“使用中”筛选。

### 验证结果

- `npm run verify`：11 个测试文件、142 条用例通过，生产构建通过。
- `npm run package:mac` 和 `codesign --verify --deep --strict --verbose=2` 通过；新版包已启动。
- 桌面可见验证确认筛选条与链路图标可见。启动时没有可比价行，故真实行上的 hover 需待下一次同步有价格行时由用户确认。

### 影响范围自查

- 仅修改 renderer 派生状态、筛选控件、样式和价格榜测试；不新增存储、IPC、远程请求、远程写入或敏感数据暴露。

## 账号上游密钥关联 v1

- 本次完成：账号映射新增稳定的上游 `Key ID`，不保存可调用密钥原文。单分组 Key 会在同步后自动跟随当前分组并重新计算成本保护；多分组 Key 不取最低价，保留已确认口径并标为“多分组待确认”；Key 删除、未分组或当前分组缺失会标为来源失效。
- 交互：账号页入口改为“关联上游密钥”。来源站已返回 Key 列表时，必须先选 Key；单分组自动锁定口径，多分组才可选择保护口径。没有 Key 接口的旧站点仍可继续使用旧版分组绑定。
- 交付修复：生产包的 renderer 入口增加每次启动的本地 query，防止同一路径 `file://` 缓存复用旧前端壳。
- 验证：`npm run verify` 通过（9 个测试文件、107 条测试）；`npm run package:mac` 和 `codesign --verify --deep --strict` 通过；真实 Electron 窗口确认新文案、上游 Key 下拉、先选 Key 再选口径的禁用状态和来源 Key 列表。未提交任何远程写入。
- 剩余风险：真实站点需要由用户完成一次 Key 选择，之后再在上游切换该 Key 分组以验收实际自动跟随；v2 的调度关闭不计费和按日志精确核算仍未开始。

## 时间分段成本核算 v1

- 本次完成：新增主进程本地时间账本，冻结上游分组倍率、充值比例、上游 Key 分组和账号来源的本地观察值。变化时刻及之后使用新倍率，变化前保留旧倍率；不会用当前倍率回算历史。
- 精确边界：仅同时具备稳定使用记录 ID、账号 ID、发生时间和数值用量的记录才入账。Key 多分组、缺少变更前观察或仅有汇总数据时显示待观察/待确认，不猜最低价。
- 交互：成本保护卡增加时间账本成本和精确/待观察/待确认计数；该金额只代表可按时间段归因的上游成本，不伪造历史利润。
- 验证：`npm run verify` 通过（10 个测试文件、118 条测试）；`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` 通过；最终 `.app` 已实际启动并显示正常 React 界面。
- 剩余风险：当前本地“我的站点”没有返回管理员账号和逐条稳定使用明细，因此未能在真实数据下显示账本条目；provider 无审计时间时边界只能是应用观察时间。未执行任何远程写入。

## 持续分组历史、自动关联上游密钥与管理员用量明细 v1

- 本次完成：倍率变更检测迁至主进程，并以时间账本的持久化观察值作为基线。首次成功同步只建立基线；应用重启后未变化的分组不会再批量写入“新增”。历史上限提升到 50,000，旧历史不自动删除；价格榜图标、涨跌筛选和顶部计数仅使用真实 `rate-up` / `rate-down` 事件。
- 自动关联：仅当账号 API Base URL、平台、倍率及上游 Key 的单一所属分组同时唯一时自动写入稳定 Key 记录 ID；多个候选一律不自动绑定，保留选择入口。不存在 Key 列表能力的站点继续使用来源站点与来源分组的兼容映射。原始 Key/JWT/Cookie 不读取、不保存、不展示。
- 管理员用量：保留 `/admin/usage/stats` 作为汇总，新增只读 `/admin/usage` 分页路径（默认最多 5 页、每页 100 条）。完整日志只在主进程瞬时解析为稳定 ID、账号、分组、时间和数值条目；Renderer 与偏好文件只接收账本条目及覆盖计数。成本保护明确显示“覆盖完成 / 仅覆盖最近页 / 字段不完整 / 明细不可用”。
- 验证：`npm run verify` 通过（10 个测试文件、122 条测试）；`git diff --check` 通过；`npm run package:mac` 与 `codesign --verify --deep --strict --verbose=2` 通过。最终桌面包单实例启动并实际点击“我的站点 → 成本”，确认显示 `管理员用量明细：仅覆盖最近页 · 499/500 条`；点击“关联上游密钥”确认无原始密钥输入、仅有来源站点/Key 记录/兼容备注。
- 剩余风险：用量金额字段对非标准 Sub2API 二开站点仍依赖实际响应字段；超过最近 500 条的管理员日志会明确标为页数边界，不能宣称全历史精确利润。没有执行远程写入。

## 价格榜使用中筛选紧凑化 v1

- 本次完成：移除价格榜独立的“账号使用”筛选行，将“使用中”收进“倍率变动”同一行，以链路图标和紧凑滑块开关呈现。
- 业务口径：保持原有精确关联规则、hover 文案和空态逻辑；不改变站点、账号、分组或远程请求。
- 验证：`npm run verify` 通过（11 个测试文件 / 142 条）；`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` 通过；实际启动签名包，开关开启后进入使用中空态，再恢复关闭，无站点操作。
- 影响范围自查：仅 renderer 本地状态、样式、既有筛选入口和项目档案；没有新增存储、IPC、授权、API 调用或远程写入。

## 上游使用状态 v2

- 状态：`awaiting_user_acceptance`。
- 本次完成：价格榜的紧凑筛选开关在同一行明确显示“使用中”或“未使用”；开启仅保留经精确关联的上游分组，关闭仅保留未关联分组。此前唯一推断的关联未参与使用中计数的问题已修复。
- 安全自动关联：仅主进程临时读取来源 Key 和管理员账号内可能存在的直接凭据，将它们做内存 SHA-256 指纹比对；唯一命中时只把来源站点 ID 与 Key 记录 ID 写到账号快照。原始 Key、JWT、Cookie 与指纹都不会进入 renderer、IPC、偏好文件或日志。读取失败、授权失效、Key 删除、重复候选或多分组 Key 均不标记使用中。
- 验证：`npm run typecheck`、`npm test -- tests/ranking-sort.test.ts tests/sub2api-client.test.ts`（65 项）、`npm run verify`（11 个文件 / 143 项）和 `git diff --check` 均通过；源码调用点检查确认凭据访问器仅在 `src/main/index.ts` 使用。
- 可见验证前提：若自有聚合站会话失效，管理员账号快照保持空态并提示重新授权；成功同步后，应用才会用当前 Key 记录自动匹配并显示数量。

## lcodex 新版兼容正式实施包 v1

- 状态：`awaiting_user_acceptance`；确认版本：需求与影响 v1、lcodex 兼容正式实施包 v1。
- 完成：授权窗口先加载 lcodex 根页，再在 Vue 应用内进入登录路由；主进程读取新版 sessionStorage 的 access/refresh token，并保留旧 localStorage、Cookie 与 session-restore 回退。
- 接口：管理读取使用 `https://lcodex.cc` 根域；旧 `api.lcodex.cc` 自动保存值会在重新授权或保存时修正；分组/倍率走根域，价格走 `/api/v1/channels/available`。非旧版手工 API 根和自定义路径保持优先。
- 验证：`npm run verify` 通过 11 个测试文件、151 条测试；`npm run package:mac`、严格 codesign、`git diff --check` 通过。公开根域读取接口均返回规范 JSON 401，未使用用户凭据。
- 剩余风险：内置浏览器受站点访问策略阻断，真实网页登录自动关闭及已授权余额/分组/倍率/价格同步需用户在最新桌面包验收。

## 接口适配中心 正式实施包 v1

- 状态：`awaiting_user_acceptance`；用户已确认正式实施包。
- 完成：新增顶层“数据接入”工作区，集中维护二开站的余额、分组、倍率、模型价格和上游密钥读取路径与标准字段映射。站点编辑窗只保留基础站点配置与授权，并提供跳转入口。
- 安全：映射仅允许最长 12 段的点路径；预览只能对已保存站点执行，主进程复用安全存储的授权信息，以同源 HTTPS GET 读取。预览只回传路径、字段名、记录数和摘要，绝不保存/传递 Token、Cookie、UA 或原始响应。
- 兼容：无映射的旧站点继续使用既有 Sub2API 解析；显式清空映射可回到内置解析。NewAPI 继续使用已有只读适配器，不开放 Sub2API 字段映射。
- 验证：`npm run verify`、聚焦映射测试、`npm run package:mac`、严格 codesign 与 `git diff --check` 均通过。

## 上游关联诊断与自动配对 正式实施包 v1

### Meta

- 状态：`awaiting_user_acceptance`
- 目标：让多三方站点、多我的站点账号的关系可诊断、可批量确认，并避免以同倍率猜测成本来源。

### 本次完成

- Key 快照明确区分未配置、可用、过期和不可用；短暂 Key/管理员账号读取失败时保留已证实关联。
- “扫描关联”先预览唯一候选，再由用户批量确认；只保存站点 ID、Key 记录 ID、分组 ID 与脱敏标签。
- 账号状态明确说明未读取 Key、Key 列表不可用、缺 API 地址、缺基础倍率、地址不匹配或候选冲突；关闭调度账号排除使用中和上游成本。

### 验证结果

- `npm run verify`：12 个测试文件 / 162 条通过；`npm run package:mac` 完成签名；`git diff --check` 通过。
- 可见 Electron 验证：已从重新打包后的单实例启动；价格榜、来源钱包、我的站点、成本保护均可打开并读到真实数据。成本保护中已验证“已精确关联”账号显示来源、上游成本和单位利润；未唯一确认的账号保留“未关联上游来源”，没有被按同倍率自动绑定。
- 当前隔离演示数据的“扫描关联”没有产生可唯一确认候选，因此没有写入本地映射；这是预期保护行为。授权窗口可在会话失效时重新打开，未输入或提交任何真实凭据。

### 下一步建议

- 对显示“未关联上游来源”的账号，在对应三方站点的“数据接入”补齐 Key 列表路径或完成重新授权；刷新后再在“我的站点 → 成本保护”点击“扫描关联”，只确认预览出的唯一候选。

## 精确上游关联与公益核算 正式实施包 v1

- 状态：`awaiting_user_acceptance`；确认版本：`语义与影响确认 v2`、`正式实施包 v1`。
- 完成：自动关联只接受主进程中账号配置密钥与三方 Key 记录的唯一 SHA-256 指纹匹配；地址、子域名和倍率不再参与关联推断。唯一匹配只持久化站点/Key/分组 ID，并进入本地时间账本，原始密钥和指纹不跨主进程。
- 完成：成本保护分组卡新增本机“公益核算排除”和批量账号成本。公益分组整体排除经营收入、成本、利润、亏损与成本保护统计，但保留按分组参考汇总；批量默认只补未设置成本，覆盖会二次确认并提示多分组账号影响。
- 完成：首次倍率观察及旧版无前值、方向错误的涨跌事件不再进入价格榜图标、筛选、近期历史或系统通知，历史记录本身不删除。
- 验证：`npm run verify` 通过 12 个测试文件 / 165 条；`npm run package:mac`、严格 codesign 与 `git diff --check` 通过，单实例新包已启动。SVG 图标转换报错后保留既有 `.icns`，未影响打包或签名。
- 可见验证缺口：新包启动后 macOS 锁屏，自动化无法读取或点击界面。解锁后需验证公益开关、批量成本弹窗取消路径、首次观察无涨跌的界面状态。
- 影响范围自查：未涉及远端账号/分组/调度写入、登录授权、凭据明文存储、站点配置迁移或原始账本删除。

## 保存登录凭据与 Sub2API 密钥路径 正式实施包 v1

- 状态：`awaiting_user_acceptance`；用户已确认执行。
- 标准 Sub2API 站点空白的密钥列表路径会默认保存为 `/keys?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai`；NewAPI 和自定义契约不继承该路径。
- 站点编辑支持用户主动加密保存网页登录账号密码。公开站点数据只返回“已加密保存”状态，账号与密码原文不回显。
- 仅在用户点击“使用保存账号密码授权”时，应用才会向已保存站点的同源登录页、已识别的账号和密码输入框填入；不自动提交，也不绕过验证码、OAuth 或 2FA。站点地址变更后必须先保存新地址。
- 验证：`npm run typecheck`、`npm test`、`npm run verify` 均通过（12 个测试文件 / 168 条）；`npm run package:mac`、`codesign --verify --deep --strict`、`git diff --check` 通过。
- 可见验证缺口：实时轮询干扰了自动化进入编辑站点弹窗；保存、清除和同源填入已由存储测试、主进程边界复核覆盖，仍待桌面端手动点击验收。

## NewAPI 兼容正式实施包 v1

### Meta

- 状态：`awaiting_user_acceptance`；用户已确认执行 `NewAPI 兼容正式实施包 v1`。

### 本次完成

- NewAPI 现在作为三方来源站参与价格榜：读取当前用户余额、可用分组及倍率、固定模型定价、令牌所属分组。
- 网页授权可从主进程读取 HttpOnly `new_api_refresh` Cookie 恢复访问令牌；刷新轮换 Cookie 时会保存新值，避免后续续期继续使用失效会话。

### 关键改动

- 默认路径为 `/api/user/self`、`/api/user/self/groups`、`/api/pricing`、`/api/token/?p=0&size=100`、`/api/user/auth/refresh`；旧的 `/api/models` 自动迁移为定价路径，手工路径不被覆盖。
- `/api/user/self/groups` 是当前用户可用分组的权威来源；价格榜不会混入仅出现在全局定价响应中的无权限分组。动态计费表达式不伪造成固定模型价格。
- 令牌原文、JWT、Cookie、UA、密码均不通过 preload 返回 renderer；令牌快照只保留记录 ID、名称和所属分组。NewAPI 不复用管理员控制台、收益归档、分组组合管理或远程写入。

### 验证结果

- `npm run verify` 通过：12 个测试文件 / 177 条测试，且生产构建成功；`git diff --check` 通过。
- 可见验证：本地预览进入“站点设置”，切换 `NewAPI` 后显示五条明确路径、来源价格榜能力、管理员功能边界；浏览器预览未发起真实授权、刷新或远程请求。
- 安全复核：无阻断问题；新增轮换 Cookie 保存路径在主进程和 `safeStorage` 之内，测试覆盖轮换后的 Cookie 合并保存。

### 用户选择与原因

- 用户要求参照本地 NewAPI 源码接入 NewAPI 站点。实现遵循其当前用户权限模型，不将全局配置或管理员能力推断为当前账号可用能力。

### 复盘结论

- NewAPI 的 `quota` 是当前余额，`used_quota` 是累计统计，不能相减。会话刷新会轮换 refresh Cookie，因此网页登录恢复必须持久化响应返回的新 Cookie。

### 记忆与进化后续

- 无新的规则候选；二开站差异继续由明确的同源路径配置承载，不引入任意 JSON 解析。

### 下一步建议

- 在桌面应用添加一个实际 NewAPI 来源站，先用网页授权或 JWT 连接，再确认价格榜只出现该登录账号可用的分组。若二开路径不同，在站点设置中逐项覆盖五个路径。
