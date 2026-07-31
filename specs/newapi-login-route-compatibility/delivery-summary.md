# 站点智能接入与安全保活 验证报告 v5

## Meta

- Feature: `newapi-login-route-compatibility`
- Date: `2026-07-25`
- Related Request: `站点智能接入与安全保活 正式实施包 v5`
- Requirement / Impact / Plan / Verification Versions: `v5 / v5 / v5 / v5`
- Delivery Status: `awaiting_user_acceptance`

## 本次完成

- 输入站点地址后自动执行无凭据、只读识别；粘贴 `https://nihao.dog/keys` 会归一到站点根，并从 JSON `401` 信号识别为 NewAPI。HTML 登录页、风控页或反代 `200` 不会被误判。
- 添加站点默认只保留名称、角色、类型、地址、识别结果与网页授权；接口根、路径、令牌、保存密码和保活转入高级配置。手动选择类型不会再被自动识别覆盖。
- 保存账号密码并显式开启保活后，主进程才会在 HTTPS 同源登录页自动恢复会话：刷新令牌优先，后台任务单窗口 FIFO、1/5/30 分钟退避且最多三次；验证码、2FA、风控、密码失效和契约变化都会停止自动提交并转人工。
- 保活状态细分为正常、恢复中、等待网络重试、需要人工、凭据失效及应用退出中断；应用启动会把残留恢复中状态改为中断，不会假装仍在执行。
- 交付前修复了已授权详细诊断的隐私边界：不再把任意 JSON 响应前缀带回界面，只返回受限的短错误提示或通用状态。

## 关键改动

- `src/main/station-diagnostics.ts`：JSON 对象信号识别、无凭据自动探测、页面地址归一和安全诊断提示。
- `src/main/auto-reauth-queue.ts`、`src/main/index.ts`：同步预占位的单窗口队列、重试、取消、人工优先和启动恢复。
- `src/main/storage.ts`、`src/shared/types.ts`：仅本地的保活状态、加密密码凭据和旧状态兼容。
- `src/main/web-auth.ts`、`src/main/newapi-client.ts`：保留 OneAPI Cookie 会话与标准 refresh 的兼容边界。
- `src/renderer/src/App.tsx`：自动识别反馈、折叠高级配置、保活状态和立即检查入口。

## 验证结果

| 事项/验收 | 证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- |
| ITEM-007：智能识别 | `station-diagnostics` 覆盖 JSON 401、HTML 200、页面地址归一、手动选择保护；真实无凭据 `nihao.dog` 探测曾返回 JSON 401 | 通过 | 二开站的非标准路径仍可能需在高级配置调整 |
| ITEM-008：状态语义 | 存储测试覆盖 pending 重启重分类；公开 DTO 不含密码、Cookie、JWT | 通过 | 需用户观察一次实际网络中断后的文案 |
| ITEM-009：安全保活 | 队列 FIFO/取消/预占位测试、授权与存储测试 | 通过 | 不替用户处理 CAPTCHA、2FA 或风控；这些状态需真实站点验收 |
| ITEM-010：简化添加 | React 自动识别逻辑与隔离桌面路径：`nihao.dog/keys` 显示 NewAPI 且可点击网页授权，未保存站点 | 通过 | 当前已有应用实例占用开发端口，本次不强行启动第二实例干扰真实配置 |
| 安全回归 | 诊断私有 JSON 不出主进程测试；生产源码扫描仅命中开源检查清单中的检测规则，无真实 token 文件 | 通过 | 第三方错误消息仍仅作为短提示，不能替代原始诊断正文 |
| 全量构建与打包 | `npm run verify`：14 文件 / 209 项；`node scripts/package-mac.mjs`、严格签名、ZIP 完整性 | 通过 | `npm run package:mac` 的 SVG 图标重渲染受本机工具限制；现有 ICNS 打包路径已验证 |

- 已执行：`npm test -- --run tests/station-diagnostics.test.ts tests/auto-reauth-queue.test.ts tests/storage.test.ts tests/web-auth.test.ts tests/newapi-client.test.ts`、`npm run verify`、`git diff --check`、`node .specify/scripts/project-profile.mjs capture --json`、`node scripts/package-mac.mjs`、`codesign --verify --deep --strict`、`unzip -t`。
- 代码审阅：未发现阻断问题。队列先同步预占位再读取存储，避免异步读取期间重复取队；手动授权会取消同站重试和活动保活。诊断输出已限制为安全提示，不返回用户资料或原始响应。

## 用户选择与原因

- 用户确认 `站点智能接入与安全保活 正式实施包 v5`，允许在用户显式保存账号密码并开启开关时进行受限的同源自动登录。
- 演示 `nihao.dog` 只验证无凭据识别与授权入口；不会代填账号、密码、验证码、2FA，也不会保存演示站点。

## 复盘结论

- 二开站识别应依据受限 JSON 契约，而非页面是否返回 `200`；这避免把登录页当成 API。
- 自动保活必须是可取消、可解释、可停止的后台行为，而不是静默重试；密码、Cookie、JWT 和原始 profile 始终保留在主进程安全存储边界内。

## 记忆与进化后续

- 本轮没有需要提升为项目规则的新候选。诊断响应最小化属于本任务的安全修正，已记录在会话历史。

## 下一步建议

1. 在桌面端“添加三方站点”粘贴 `https://nihao.dog/keys`，预期 1 秒内显示“已识别为 NewAPI”。
2. 点击“网页授权登录”，由你在隔离授权窗完成真实登录；成功后窗口应自动关闭并开始同步。
3. 如需保活，在编辑站点的高级配置中同时保存账号和密码，再显式打开“令牌失效时自动重新登录”。遇到验证码、2FA 或风控时应转为人工处理而非自动提交。

## v0.7 Impact Scope Self-Check

- 实际改动与 v5 的识别、表单、保活状态、加密凭据、队列、测试和交付范围一致；无远端业务写入、无新增权限、无 Git 推送或发布。
- 最终状态：`verified_with_risk`，等待用户完成一次真实 `nihao.dog` 授权和可选保活验收。

## NewAPI Cookie 会话落盘 验证报告 v6

### Meta

- Date: `2026-07-26`
- Related Request: `NewAPI Cookie 会话落盘 v1`
- Requirement / Impact / Plan / Verification Versions: `v6 / v6 / v6 / v6`
- Delivery Status: `awaiting_user_acceptance`

### 本次完成

- OneAPI Cookie 会话的保存不再要求 `/api/user/auth/refresh` 必须返回 404；授权窗口在 HTTPS 同源、非登录页状态下，固定 profile 验证成功即可保存受限 Cookie 会话。
- 登录页不会被误判为“已登录但无法保存”。如果用户已进入后台但 Cookie 未能安全落盘，关闭授权窗口后会得到可行动中文提示，而非普通取消。
- 公开站点 DTO 增加不含原文的 `hasSessionCookie` 标志；设置页和成功提示能区分 `JWT 已保存`、`Cookie 会话已保存` 与 `未授权`。

### 验证结果

| 事项/影响 | 证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- |
| ITEM-011 会话捕获 | `web-auth` 同源后台/登录页/跨域/HTTPS/profile 测试 | 通过 | 真实站点 Cookie 名称与过期策略仍由站点决定 |
| Cookie 安全边界 | `storage` 测试：公开 DTO 仅返回布尔状态，不含 Cookie 或会话模式 | 通过 | 真实 macOS 安全存储仍需用户路径验收 |
| 兼容性 | `newapi-client` Cookie-only、refresh-token、错误 Cookie 回归 | 通过 | 其他二开自定义 profile 路径需在高级配置确认 |
| 全量质量门禁 | `npm run verify`：14 文件 / 211 测试、类型检查与生产构建；`git diff --check` | 通过 | 无 |
| 可见桌面路径 | 尝试以临时 userData 启动新构建 | 未覆盖 | 已安装旧包的单实例锁接管启动；未干扰真实数据，也不将旧包画面当成证据 |

### 本地测试包

- 已重新生成 `release/AIZZZWatch-0.1.1-arm64.dmg`（96 MB）。
- SHA-256：`70a27b39f823e3e64e3e308bb1b8011e0603319f7fbbe58e1fb1ec7fb2d28f1e`。
- `codesign --verify --deep --strict` 通过；DMG 为只读压缩 UDIF（UDZO）格式，未公证、未发布。

### 代码与安全审阅

- 未发现阻断问题：profile 请求固定为 HTTPS 同源路径；授权窗口仍使用隔离 partition；Cookie 继续由已有长度/格式校验和 `safeStorage` 保护；renderer、日志和错误文本不获取 Cookie/JWT/Profile 原文。
- 影响范围自查：实际改动仅覆盖授权捕获、公开安全状态、设置页反馈、测试与交付工件；无远端业务写入、数据迁移、Git 推送或发布。

### 下一步建议

1. 用新构建打开 `nihao` 的编辑页，确认会话状态为“未授权”后点击“重新授权 / 换号登录”。
2. 由你完成真实网页登录；成功时授权窗应自行关闭，随后设置页应显示“Cookie 会话已保存”，余额与分组开始同步。
3. 若仍无法保存，请不要粘贴 Cookie；保留新错误提示和站点登录后地址，我再按该站的固定、安全接口补兼容。

## NewAPI 页面会话捕获修复 验证报告 v7

### Meta

- Date: `2026-07-26`
- Related Request: `NewAPI 页面会话捕获修复 v2`
- Requirement / Impact / Plan / Verification Versions: `v7 / v7 / v7 / v7`
- Delivery Status: `awaiting_user_acceptance`

### 本次完成

- OneAPI Cookie 会话的固定 profile 验证已从主进程 `session.fetch` 改为登录成功后的同源页面 `fetch`。它使用页面本身的浏览器会话与 Cloudflare 校验上下文，且只返回成功布尔值。
- 布尔验证成功后，主进程继续复用原有的 Cookie 读取、长度/格式校验、`safeStorage` 加密保存和自动关闭窗口流程；不会读取 `localStorage`、JWT、Cookie 原文或 profile 内容。

### 关键改动

- `src/main/web-auth.ts`：`tryVerifyNewApiCookieSession` 只允许固定 HTTPS 同源 profile 在已登录页面内验证，并将返回值收窄为布尔值。
- `src/main/index.ts`：Cookie-only 授权捕获改用该页面验证，后续保存链路未改变。
- `tests/web-auth.test.ts`：覆盖固定路径、页面 Cookie 请求、无 LocalStorage/令牌读取、登录页/HTTP/跨域拒绝和失败不保存。

### 验证结果

| 事项/影响 | 证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- |
| ITEM-012 页面会话验证 | 聚焦 `web-auth`：24 项通过；覆盖同源后台页与拒绝路径 | 通过 | 真实站点 WAF/Cookie 策略仍需用户登录确认 |
| 会话安全边界 | 代码审阅与测试脚本检查：profile 脚本不含 `localStorage`、`access_token`；只返回布尔值 | 通过 | 不检查或打印真实 Cookie/JWT/Profile |
| 全量回归 | `npm run verify`：14 文件 / 211 项测试、类型检查、生产构建 | 通过 | 无 |
| 本地 DMG | `npm run package:dmg`、`codesign --verify --deep --strict` | 通过 | 未公证、未发布 |
| 可见登录路径 | 需用户在新 DMG 中自行登录 | 待验收 | 真实第三方会话不能由代理代填或读取 |

### 用户选择与原因

- 用户确认 `NewAPI 页面会话捕获修复 v2`，允许修复授权验证路径与重新生成本地 DMG；不允许读取、展示或代填认证信息。

### 复盘结论

- 对 Cloudflare 保护的 Cookie-only 二开站，登录后的验证必须使用已登录页面的同源浏览器上下文；主进程仍只应保存经过边界校验的 Cookie，不应把 profile 数据带出页面。

### 记忆与进化后续

- 这是一条认证兼容的任务级结论，尚无跨多站点的证据，不升级为全局规则。

### 下一步建议

1. 打开本次 DMG，编辑 `nihao` 后点击“重新授权 / 换号登录”。
2. 在授权窗口中自行完成登录并停留后台页面；预期窗口在约两秒内自动关闭。
3. 回到应用确认该站显示“Cookie 会话已保存”并开始同步。若仍失败，只提供登录后的页面地址和非敏感错误提示，不要粘贴 Cookie/JWT。

## 数据与刷新安全修复及自定义 API 根编辑 验证报告 v2

### Meta

- Date: `2026-07-26`
- Related Request: `数据与刷新安全修复及自定义 API 根编辑 正式实施包 v2`
- Requirement / Design / Impact / Task / Verification Versions: `v2 / v2 / v2 / v2 / v2`
- Delivery Status: `awaiting_user_acceptance`

### 本次完成

- 损坏的 `stations.json`、`ui-preferences.json` 和无效顶层偏好文档仅在成功移动到 `.corrupt-*` 后回退；备份失败会中止所有后续写入，保留原文件。
- 手动刷新及“立即检查”改为真正强制刷新。旧轮询在令牌轮换、管理员指纹、快照、来源关联、账本及事件提交前都会被 epoch 拦截。
- “数据接入 → 自定义兼容”的 API 根可直接输入，预览和保存共用 HTTPS 同源校验；显式配置的 `https://www.krill-ai.net/api` 不会再被改回默认 `/api/v1`。

### 关键改动

- `src/main/storage.ts`：严格 JSON 顶层结构、损坏备份失败阻断、显式 API 根保留。
- `src/main/index.ts`、`src/main/station-refresh-epochs.ts`：强制刷新与过期副作用保护。
- `src/shared/sub2api.ts`、共享 IPC 类型、预加载、`App.tsx` 与样式：自定义 API 根草稿、预览与保存闭环。

### 验证结果

| 事项/影响 | 证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- |
| ITEM-014 数据恢复 | 存储测试覆盖截断 JSON、`[]`/`null`/`true` 偏好与 rename 失败 | 通过 | 用户真实文件损坏后的手工恢复体验待观察 |
| ITEM-015 刷新隔离 | epoch 单测、主进程过期提交审阅、强制刷新处理路径 | 通过 | 未模拟真实网络延迟的完整 Electron IPC 竞态 |
| ITEM-016 自定义根 | URL 接受/拒绝、显式 `/api` 保存的存储测试、类型检查 | 通过 | 未对真实 `www.krill-ai.net` 发请求或保存真实站点 |
| 全量回归 | `npm run verify`：15 文件 / 237 项测试、类型检查、生产构建 | 通过 | 无 |
| 安全与差异 | `git diff --check`、凭据日志定向扫描 | 通过 | 无新增凭据读取或远端写入 |
| 可见界面 | 浏览器本地预览与隔离 Electron 尝试 | 未覆盖 | localhost 被浏览器环境拒绝；正式应用单实例锁接管窗口，未操作真实数据 |

### 用户选择与原因

- 用户已确认 v2 正式实施包，允许修复本地数据安全、刷新顺序和自定义 API 根，但未授权暴露或使用任何真实凭据。

### 复盘结论

- “显式配置”必须优先于旧的兼容性推导，否则表单显示可编辑但保存后仍回退到默认根，会造成二开站无法接入。
- 轮询与用户刷新属于不同优先级意图；仅去重请求不够，提交阶段也必须防止旧结果写回。

### 记忆与进化后续

- 本轮没有新规则候选。单实例锁和 localhost 隔离限制已作为本任务可见验证风险记录，不把它当作通过证据。

### 下一步建议

1. 在桌面端打开“数据接入”，选择你的 `krill-ai` 站点并切换到“自定义兼容”。
2. 在 API 根输入 `https://www.krill-ai.net/api`，点击“检测并预览”，确认错误会就地显示而不会泄露令牌。
3. 点击“保存适配”后重新打开该页面，确认 API 根仍是 `/api`；再点击刷新，确认只出现最新一次刷新结果。

## 接入与涨跌可见性 验证报告 v1

### Meta

- Date: `2026-07-27`
- Related Request: `接入与涨跌可见性 正式实施包 v1`
- Requirement / Design / Impact / Task / Verification Versions: `v1 / v1 / v1 / v1 / v1`
- Delivery Status: `awaiting_user_acceptance`

### 本次完成

- 真实倍率事件持久化后会立即广播给界面；价格榜和近期分组变化从同一持久化事件源读取。原生通知仅针对本次新增的有效涨价/降价事件，点击会打开对应筛选，混合涨跌不会漏项。
- Aihub 默认用户信息读取、Krill 已知余额/分组路径和 Zanzhu 固定门户/API 别名回退均纳入受控兼容范围。Krill 在余额成功而分组 404 时明确降级为“余额可用、分组不可读”。

### 关键改动

- `src/main/index.ts`、`src/main/storage.ts`：新增事件返回、偏好更新广播和原生通知点击编排。
- `src/preload/index.ts`、`src/shared/types.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/preview-api.ts`：增加最小 IPC 订阅，renderer 重新读取偏好并打开近期变化窗口。
- `src/shared/sub2api.ts`、`src/main/sub2api-client.ts`、`src/main/station-diagnostics.ts`：已知 Profile、仅 404 的受限读取根回退与部分可用快照。

### 验证结果

| 事项/影响 | 证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- |
| ITEM-017 涨跌可见性 | `storage` 新增事件测试；主进程/IPC/renderer 链路审阅 | 通过 | 原生通知权限和点击需在桌面端实机确认 |
| ITEM-018 Aihub | 默认 `/auth/me?timezone=Asia%2FShanghai` 与手工路径优先单测 | 通过 | 未对真实会话发请求 |
| ITEM-019 Krill | 已知路径、旧根 404 回退、余额可用分组降级单测 | 通过 | 实际 Cookie/WAF 和通道字段仍待已授权诊断 |
| ITEM-020 Zanzhu | 固定 `api.denxio.com` 别名、Referer 与 404 回退单测 | 通过 | 未验证真实门户会话 |
| 全量回归 | `npm run verify`：15 个测试文件、242 项通过，类型检查及生产构建通过 | 通过 | 无 |
| 差异与敏感审阅 | `git diff --check`；定向扫描无真实 JWT、密码、余额或账号资料 | 通过 | 测试假 Cookie 与检查规则命中属预期 |
| 可见界面 | 尝试隔离 Electron 与 in-app browser | 未覆盖 | macOS `MachPortRendezvous` 阻断隔离 Electron ready 前启动；`127.0.0.1:5187` 未运行开发服务器，浏览器返回 `ERR_CONNECTION_REFUSED` |

### 用户选择与原因

- 用户确认 v1 正式实施包，允许固定的只读兼容与本地事件通知，但未授权读取、保存、展示或提交任何真实凭据和响应。

### 复盘结论

- 历史状态和通知必须共享主进程的单一持久化事件源；renderer 侧水位会在重启和快照时序下产生遗漏或重复。
- 二开兼容必须是“已知主机 + 已知路径 + HTTPS + 仅 404 回退”，不能为了接入成功扩展为任意根或跨域扫描。

### 记忆与进化后续

- 结论仍停留在本任务：三方真实认证 GET 被运行时权限阻断时，只报告脱敏自动化契约证据，不把它描述成真实站点已验证成功。

### 下一步建议

1. 在最新版桌面端刷新一次有历史基线的来源站，确认“近期分组变化”和价格榜的涨跌状态立即出现；点击通知确认打开的筛选方向正确。
2. 对 Krill、Aihub、Zanzhu 分别使用现有授权状态点击“详细诊断”，只核对路径、余额/分组状态和错误摘要，不要粘贴 JWT 或 Cookie。
