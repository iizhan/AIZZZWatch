# 实施方案：NewAPI 登录入口兼容

**需求/设计/影响/计划版本**: v3
**确认状态**: controlled，用户已确认 `NewAPI 页面内同源会话恢复 v3`

## 设计方案 v1

`WebAuthLaunchTarget` 增加可选的同源备用入口。显式或已检测的 NewAPI 优先加载 `/sign-in`，并以 `/login` 为一次回退；未检测类型和其它站点继续优先 `/login`，仅当当前候选页呈现明确 404 时尝试 `/sign-in`。lcodex 仍使用现有根页和客户端路由策略，不参与备用入口。

路由回退必须同时满足：授权页未销毁、当前 URL 与候选入口同源、路径仍是候选或同源 `/404`、页面出现明确 404 标志。双路径失败返回内部路由错误，renderer 翻译为中文的可行动提示；用户正常关闭窗口保留取消语义。

## 任务拆解 v1

| 事项 | 任务 | 允许修改路径 | 完成条件 | 验证 |
| --- | --- | --- | --- | --- |
| ITEM-001 | TASK-001 规格记录 | `specs/newapi-login-route-compatibility/` | 已确认范围写入规格 | 规格审查 |
| ITEM-001 | TASK-002 主进程兼容 | `src/main/web-auth.ts`, `src/main/index.ts` | 入口选择、一次回退、双路径错误完成 | 授权辅助单测 |
| ITEM-001 | TASK-003 用户反馈 | `src/renderer/src/App.tsx` | 路由错误不再显示原始/取消误导 | 类型检查、可见路径 |
| ITEM-001 | TASK-004 验证交付 | `tests/web-auth.test.ts`, `release/` | 自动/可见验证及本地测试包完成 | `npm run verify`、签名、ZIP |

## 影响范围 v1

- **等级：high**。原因是第三方网页登录、主进程会话边界和用户可见流程共同受影响。
- **直接**：授权辅助函数、Electron `BrowserWindow` 生命周期、renderer notice、授权单测。
- **间接**：所有隔离网页登录站点；正常 `/login` 站点仅在确实 404 时多一次同源页面加载。
- **数据/接口**：无迁移、无 IPC 新字段；只新增主进程内部错误前缀。
- **安全**：无新凭据读写、无日志新增；路径固定同源、最多一次、无远端写入。
- **不影响**：余额/分组/价格/账号/成本、读取 API、保存的凭据、版本号、GitHub 发布。
- **回退**：还原该功能提交；本地测试包可删除，用户数据无需恢复。

## 验收与自测计划

1. 路由选择和 404 判定的 Vitest 单测。
2. `npm run verify`、`git diff --check`。
3. 可见验证公开 `https://nihao.dog/sign-in` 显示登录表单；不提交任何账号数据。
4. 生成本地 macOS arm64 ZIP，并检查 ad-hoc 签名和 ZIP 完整性。

## 安全检查结论

未发现阻断项：修复沿用隔离 partition、主进程 token 捕获与 `safeStorage`。禁止自由 URL、跨域回退、自动提交密码和记录页面原文；真实登录、验证码、2FA 始终由用户完成。

## 设计方案 v2

NewAPI 的刷新恢复改为绑定 `aizzz-auth-*` 临时授权分区执行。该分区在用户登录后拥有 HttpOnly `new_api_refresh` Cookie；恢复请求由 Chromium 同源发送并接收轮换 Cookie，主进程只从标准响应的 `data.access_token` 提取访问令牌。成功后沿用现有 `saveStation` 加密保存路径，并销毁窗口、清理临时分区。

不读取或导出 Cookie、JWT、账号、密码或页面响应原文。若刷新响应不是可接受的标准 AuthBundle，授权保持未完成，不写入站点或部分凭据。

## 任务拆解 v2

| 事项 | 任务 | 允许修改路径 | 完成条件 | 验证 |
| --- | --- | --- | --- | --- |
| ITEM-002 | TASK-005 规格状态同步 | `specs/newapi-login-route-compatibility/` | v2 需求、计划、状态可追溯 | 规格审查 |
| ITEM-002 | TASK-006 分区会话恢复 | `src/main/index.ts`, `src/main/web-auth.ts` | NewAPI 刷新请求使用授权分区，同源且无凭据泄漏 | 授权辅助单测 |
| ITEM-002 | TASK-007 回归测试 | `tests/web-auth.test.ts` | 覆盖分区 fetch、标准 AuthBundle、拒绝非标准响应 | 定向 Vitest |
| ITEM-002 | TASK-008 验证交付 | `specs/newapi-login-route-compatibility/`, `release/` | 全量检查、可见路径和本地 macOS 测试包完成 | `npm run verify`、签名、ZIP |

## 影响范围 v2

- **等级：high**。变更位于第三方网页登录、HttpOnly Cookie、主进程会话恢复和本地加密存储的交界。
- **直接**：授权窗口 partition fetch、NewAPI AuthBundle 白名单提取、授权单测和任务交付记录。
- **间接**：明确 NewAPI 的网页登录授权；普通 Sub2API、lcodex 路由回退和已保存站点不改动。
- **数据/接口**：无迁移、无 IPC 新字段、无凭据格式变更；仅复用现有加密保存字段。
- **安全/外部效果**：用户已登录后同源 `POST /api/user/auth/refresh` 可能按站点规则轮换 Refresh Cookie；不发生业务数据或管理写入。
- **回退**：还原 v2 代码提交；临时分区始终在结束时清理，已保存站点无需迁移。

## 验收与自测计划 v2

1. 单测验证刷新请求由授权分区执行，固定同源刷新路径和令牌白名单保持不变。
2. 运行 `npm run verify`、`git diff --check` 和敏感字段扫描。
3. 以 `https://nihao.dog` 的真实授权窗口可见验证：用户自行登录后自动关闭窗口、返回主界面并开始同步；不检查或记录任何凭据值。
4. 重新生成本地 macOS arm64 ZIP，检查 ad-hoc 签名和 ZIP 完整性。

## 设计方案 v3

v2 的 `session.fromPartition(...).fetch(...)` 保持为第一优先级。仅当它未恢复标准授权结果时，授权窗口在已经登录、当前地址与固定刷新 URL 同源且为 HTTPS 的条件下，通过页面自身浏览器上下文执行 `POST /api/user/auth/refresh`，请求始终使用 `credentials: 'include'`、`redirect: 'manual'` 和固定 JSON 头。

返回值在页面内先按严格结构压缩：只接受 `success === true`、对象型 `data` 和非空 `data.access_token`。主进程再次进行类型、长度和同源校验，然后沿用现有 `saveStation`、窗口关闭和临时 partition 清理；失败保持窗口打开，既不保存半成品，也不把响应细节暴露给 renderer。

不读取网页框架状态、Cookie、账号、密码、余额、用户资料或原始响应；不接收页面提供的 URL、路径或请求头。站点自定义刷新路径仍须经过已有 HTTPS 同源 URL 校验。

## 任务拆解 v3

| 事项 | 任务 | 允许修改路径 | 完成条件 | 验证 |
| --- | --- | --- | --- | --- |
| ITEM-003 | TASK-009 记录 v3 方案 | `specs/newapi-login-route-compatibility/` | 方案、范围、状态可追溯 | 规格审查 |
| ITEM-003 | TASK-010 页面内恢复辅助函数 | `src/main/web-auth.ts` | 固定同源刷新、严格 AuthBundle 白名单、无敏感输出 | 聚焦单测 |
| ITEM-003 | TASK-011 授权捕获编排 | `src/main/index.ts` | v2 失败后才回退；成功才保存和关闭 | 类型检查、逻辑审查 |
| ITEM-003 | TASK-012 回归与交付 | `tests/web-auth.test.ts`, `specs/newapi-login-route-compatibility/`, `release/` | 失败不保存、跨域拒绝、标准响应成功、本地测试包 | 定向测试、`npm run verify`、可见登录路径、签名与 ZIP |

## 影响范围 v3

- **等级：high**。授权令牌由网页上下文返回主进程，涉及第三方登录会话、凭据边界和用户可见保存行为。
- **直接**：`src/main/web-auth.ts` 的受限会话恢复辅助函数、`src/main/index.ts` 的授权捕获分支、`tests/web-auth.test.ts`、本功能规格及测试包。
- **间接**：显式或探测为 NewAPI 的网页登录授权；Sub2API、lcodex、站点角色、余额/分组/价格读取和管理员能力不改变。
- **数据/接口**：无迁移、无 IPC 新字段、无新增持久化字段；仅复用已加密的访问令牌、会话 Cookie 和 UA 保存路径。
- **安全/权限**：固定同源 HTTPS 路径；不允许页面指定目标 URL；禁止重定向；不记录敏感返回体；站点远端唯一可能变化是该站点本来就会执行的刷新 Cookie 轮换。
- **性能/资源**：页面内回退仅在已离开登录页后启用，v2 无结果时每 2 秒最多一次；由现有 `captureInProgress` 串行化，成功/关闭后停止轮询。
- **发布/回退**：重新生成本地 macOS 测试 ZIP，不发布、不推送；回退为删除该页面内回退分支，v2 分区刷新保留；无用户数据迁移。
- **明确不影响**：登录表单自动提交、密码保存策略、第三方数据写入、普通站点授权、版本号、GitHub Release。

## 验收与自测计划 v3

1. 单测覆盖：已登录同源页面的标准响应成功；非标准响应不保存；跨域/非 HTTPS 页面拒绝；分区刷新成功时不执行页面回退。
2. `npm test -- tests/web-auth.test.ts`、`npm run typecheck`、`npm run verify`、`git diff --check` 和敏感字段扫描。
3. 安全审阅：固定路径、同源检查、无 Cookie/JWT/账号密码/响应原文日志或测试快照。
4. 在重新打包的本地 macOS 应用中，由用户自行完成 `https://nihao.dog/sign-in` 登录；检查授权窗自动关闭、主界面保存为 NewAPI 三方站点并触发同步。此步骤只确认 UI 结果，不查看凭据。
5. 用 `codesign --verify --deep --strict` 和 `unzip -t` 验证新的本地 ZIP。

## 设计方案 v4

将 NewAPI 会话恢复区分为两种已验证契约：

1. 标准 NewAPI：保留现有隔离分区 `POST /api/user/auth/refresh` 与严格 `data.access_token` 白名单回传；该路径仍是首选。
2. legacy OneAPI Cookie 会话：仅当标准刷新没有可用结果、当前授权页为 HTTPS 同源且已离开 `/login`、`/sign-in`、`/otp` 时，在同一隔离分区对固定 `/api/user/self` 发出只读验证。只接受 JSON 信封的成功状态与对象型 `data`，函数只返回“已验证”而不返回用户资料。验证成功后从同源 profile URL 读取现有 Cookie，按既有加密存储路径保存，并写入内部 `sessionAuthMode: 'cookie-session'`。

`NewApiClient` 将允许“访问令牌或 Cookie”二选一作为读取凭据。Cookie-only 模式不发送 `Authorization`，只向固定同源读取端点发送加密恢复的 Cookie/UA；轮询遇到 401 时不再调用刷新端点，而是保留既有重新授权/自动重登入口。已有 token/refresh 模式继续原样工作。

不读取 `localStorage["user"]`：该对象是登录后的用户资料，不是本次授权所需的访问令牌。授权窗口在验证期间显示无敏感信息的进度标题；失败则保持窗口打开而不保存半成品。

## 任务拆解 v4

| 事项 | 任务 | 允许修改路径 | 完成条件 | 验证 |
| --- | --- | --- | --- | --- |
| ITEM-004 | TASK-013 规格与状态同步 | `specs/newapi-login-route-compatibility/` | v4 的需求、影响、任务、回退已记录 | 规格审查 |
| ITEM-004 | TASK-014 OneAPI Cookie 验证 | `src/main/web-auth.ts`, `src/main/index.ts` | 仅固定 HTTPS 同源 profile 验证成功后保存会话 | 授权辅助单测 |
| ITEM-005 | TASK-015 Cookie-only NewAPI 读取 | `src/main/newapi-client.ts`, `src/main/index.ts`, `src/main/storage.ts`, `src/shared/types.ts` | Cookie-only 可读取且跳过不存在的 refresh 路径；旧 token 模式不变 | 客户端/存储单测 |
| ITEM-006 | TASK-016 安全验证与测试包 | `tests/web-auth.test.ts`, `tests/newapi-client.test.ts`, `tests/storage.test.ts`, `specs/newapi-login-route-compatibility/`, `release/` | 敏感边界、回归检查与本地 macOS 测试包完成 | `npm run verify`、可见授权、签名、ZIP |

## 影响范围 v4

- **等级：high**。涉及第三方网页登录、主进程 Cookie、加密本地持久化、读取适配器与会话失效恢复。
- **直接影响**：`web-auth` 授权验证、`index` 编排/轮询、`NewApiClient` 身份头、可选加密会话模式、对应单测和交付规格。
- **间接影响**：显式/探测为 NewAPI 的网页登录站点；仅刷新接口不支持且 profile 验证成功的站点进入 Cookie-only 模式。
- **数据与迁移**：新增可选的本地会话模式字段，旧记录默认保持 token/refresh 行为；无远端数据迁移、删除或写入。
- **接口与配置**：不新增 renderer IPC 字段、用户配置项或自定义远端地址；profile、groups、pricing、token 的既有固定读取契约不变。
- **安全与权限**：仅 HTTPS 同源固定 profile 验证；不读取 localStorage/user profile；Cookie/UA 加密且不记录；无远端业务写入。Cookie header 在本地使用前须有长度与格式边界。
- **兼容性/性能**：标准 NewAPI 优先刷新路径不变；Cookie 验证串行并带冷却，仅在已登录页触发。旧站点、Sub2API、lcodex 和管理员功能不变。
- **发布与回退**：只重建本地 macOS 测试包，不推送/发布。回退可移除 Cookie 会话分支与可选字段，既有 token 记录无需处理。
- **Workflow**：主 Workflow 不选用 Swagger 集成（缺少 Swagger 契约）；使用 foundation engineering governance 作为依赖流程，Loop 在验证失败且不扩展范围时最多两种根因策略。

## 验收与自测计划 v4

1. `web-auth` 单测：Cookie 验证成功、非 JSON/失败信封拒绝、登录页/跨域/HTTP 拒绝、无用户资料或 token 从辅助函数返回。
2. `NewApiClient` 单测：Cookie-only 请求不发送 `Authorization`；token 模式保留 Bearer；Cookie-only 401 不请求 `/auth/refresh`；Cookie 头边界拒绝非法值。
3. `storage` 单测：会话模式为可选加密本地元数据，公开 DTO/日志不包含 Cookie、UA 或凭据。
4. 运行 `npm run verify`、`git diff --check`、敏感字段审查与生产构建。
5. 重新打包本地 macOS arm64 ZIP，用 `codesign --verify --deep --strict` 与 `unzip -t` 验证；用户在可见授权窗自行登录 `nihao.dog` 验收自动关闭和同步。不会查看凭据。

## 设计方案 v5：站点智能接入与安全保活体验修订

**正式实施包版本**: v5（已确认并实施完成，等待用户验收）
**关联需求/影响版本**: v5（已确认）

### 需求摘要与当前实现

- 关联需求/影响：v5 草案，`ITEM-007` 至 `ITEM-010`；当前任务通道为 `controlled`。
- 复用点：`diagnoseStation` 已能按适配器并行只读探测；`saveStation` 已负责默认根路径和安全存储；`refreshStation` 已统一令牌刷新、快照刷新与保活触发；`beginWebAuth` 已处理同源授权、挑战页和 Cookie-session 捕获；设置弹窗已有本地 draft 状态与诊断反馈。
- 当前缺口：诊断不验证 2xx 的 JSON 形状、仅在用户点击时运行；保活没有状态原因/队列/退避；默认添加表单暴露了内部 API 根和完整路径配置。

### 交互与数据设计

1. **智能接入卡**：站点地址为唯一必填网络字段。地址稳定后以防抖只读诊断更新本地 `detecting / detected / unknown / error` 状态；最新请求 ID 才能写入草稿，旧响应不得覆盖新输入。识别结果直接显示“已识别为 NewAPI / Sub2API”；手动切换后锁定该选择。
2. **根地址推导**：从站点地址派生实际接口根。普通站点不显示该值；仅高级配置显示“接口根地址”，并说明它只用于二开或子路径。显示名称为空时在保存/授权前由域名生成，不再阻塞初次授权。
3. **保活状态机与队列**：扩展安全的公开状态元数据为 `pending`、`success`、`retry-scheduled`、`manual-required`、`credentials-invalid`、`interrupted`，附带安全原因码、尝试次数和下次重试时间。主进程持有单一 FIFO 队列和每站退避；手动授权优先于后台任务，应用启动会清理遗留 pending。
4. **安全恢复路径**：刷新令牌仍优先；无刷新 Cookie 会话在快照明确未授权时才排队登录。网络/超时按 1/5/30 分钟最多三次；其它风险状态停止自动操作并显示“重新授权”。“立即检查”复用同一流程，不新增密码读取 IPC。

### 任务拆解 v5

| 事项 | 任务 | 允许修改路径 | 依赖 | 完成条件 | 证据 |
| --- | --- | --- | --- | --- | --- |
| ITEM-007 | TASK-017 诊断信号与自动应用 | `src/main/station-diagnostics.ts`, `src/shared/types.ts`, `src/renderer/src/App.tsx`, `tests/station-diagnostics.test.ts` | 无 | JSON 信号判定、根地址规范化、地址输入自动识别与手动锁定 | 单测 + 可见添加路径 |
| ITEM-010 | TASK-018 简化表单与高级配置 | `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/main/storage.ts`, `tests/storage.test.ts` | TASK-017 | 只有站点地址/角色/识别/授权是默认流程；名称自动生成；高级配置保留完整能力 | 类型检查 + 窄窗 UI 验证 |
| ITEM-008 | TASK-019 保活状态机持久化 | `src/shared/types.ts`, `src/main/storage.ts`, `src/main/index.ts`, `tests/storage.test.ts` | 无 | 旧 pending 归为 interrupted；公开状态无敏感字段且可表达下一步 | 存储/状态单测 |
| ITEM-009 | TASK-020 有界队列和恢复策略 | `src/main/index.ts`, `src/main/web-auth.ts`, `tests/*auth*.test.ts` | TASK-019 | 单窗口 FIFO、退避、人工停止、成功立即刷新和手动优先 | fake timer/行为单测 |
| ITEM-007 至 ITEM-010 | TASK-021 可见验证与交付 | `specs/newapi-login-route-compatibility/`, `release/` | TASK-017 至 TASK-020 | 实际桌面路径、测试、构建、签名、ZIP 和审阅完成 | `npm run verify` + UI 报告 |

### 影响范围 v5

- **等级：high**：探测契约、主进程密码自动登录、持久化状态、前端表单和后台定时器共同改变。
- **直接影响**：`station-diagnostics`、`index` 轮询/授权编排、`web-auth` 自动流程反馈、`storage`、共享 DTO、React 设置弹窗/CSS 和相关测试。
- **间接影响**：所有设为 `auto` 的站点、开启保活的 HTTPS 站点、已有带自定义 API 根/路径的站点。
- **数据/迁移**：本地 `autoReauthStatus` 增加可选安全元数据；旧记录兼容，启动时仅重分类遗留 pending。不会导出或迁移密码、Cookie、JWT。
- **接口/IPC**：诊断结果可增加无敏感的状态/原因字段；不增加凭据读取 IPC，不改变远端 API 契约。
- **安全/权限**：自动诊断不使用保存凭据；自动登录必须已有用户显式开关、HTTPS 同源、单窗口、有界尝试和挑战停止；无远端业务写入。
- **兼容/性能**：地址输入诊断防抖、取消/忽略过期响应；保活队列有一次并发和有限重试，避免轮询放大或重复弹窗。
- **发布/回滚**：仅产出本地 macOS 测试包，不推送/发布。关闭保活开关即可停止新行为；回滚为移除新状态机和自动诊断，旧站点配置保持可读。
- **明确不影响**：价格榜、余额、分组变化、成本/收益计算、管理员写操作、Windows CI、GitHub Release。

### 安全审查 v5

- 安全范围：密码保活、Cookie/JWT 会话、用户输入的地址、主进程网络请求和跨 IPC 诊断状态。
- 阻断问题：无；前提是自动诊断绝不复用保存凭据，自动登录仍严格受已有加密存储、HTTPS 同源、显式开关和挑战停止限制。
- 建议修复：不再把任何 200 视为 API 成功；状态原因使用枚举而非页面原文；不把密码、Cookie、JWT、响应体或登录 DOM 带到 renderer/日志/测试快照。
- 剩余风险：第三方站的验证码、2FA、WAF、密码表单结构及 Cookie 过期策略仍需真实用户可见验收，应用不会试图绕过。

### Workflow 与验证/回退

- 主 Workflow：未选择场景模板。`scenario.design-to-frontend` 虽有当前设置弹窗作为参考，但本次还包含主进程认证和保活队列，不能把它误当作纯前端重构；使用 `foundation.engineering-governance` 作为受控实施依赖流程。Swagger 集成不适用。
- 增强能力：确认后使用 interactive automation，在隔离用户数据目录验证添加站点、错误回退、保活状态和窄窗口布局；不自动登录真实第三方账号。
- 验收与自测：诊断的 JSON/HTML/401/403、手动锁定、地址去路由化、保活状态迁移、队列/退避/挑战停止/手动优先的单测；`npm run verify`、`git diff --check`、敏感字段审阅、桌面可见路径、macOS 签名与 ZIP。
- 回退触发：出现跨域请求、保存凭据被自动诊断使用、自动重试超过边界、手动配置被自动结果覆盖或添加流程无法覆盖二开站时，停止交付并回退该任务的实现分支。

### 正式任务顺序、依赖与完成条件

1. **TASK-017 先于表单改造**：先把诊断响应限定为有效 JSON 信号并实现地址规范化。它输出稳定的“正在识别 / 已识别 / 未识别 / 网络失败”结果，供表单消费；不读取已有站点的凭据。完成条件是自动模式能安全地产生 NewAPI、Sub2API 或未知结果，且过期请求不会覆盖最新输入。
2. **TASK-018 依赖 TASK-017**：将现有单页设置表单分为默认接入区和折叠的高级配置。默认接入区不出现接口根/路径；高级配置在已有自定义根、路径或用户主动展开时显示。保存前才生成缺省显示名称，保留已有编辑站点与二开路径能力。
3. **TASK-019 与 TASK-017 可并行、先于队列**：扩展仅本地的保活状态 DTO 与存储清洗，兼容旧记录并在应用启动时重置遗留 `pending`。完成条件是状态只包含枚举、时间、次数和下一步，不包含凭据或页面文本。
4. **TASK-020 依赖 TASK-019**：把当前“失败后直接触发”的逻辑替换为单窗口 FIFO 队列和 1/5/30 分钟、最多三次的网络类退避。人工验证、密码失效和契约不匹配直接停止；手动授权优先于后台队列。成功只重刷本地快照，不执行远端业务写操作。
5. **TASK-021 依赖全部实现任务**：补齐单测、运行完整验证与敏感边界审阅；以隔离用户数据目录完成桌面可见验证。新包只作本地 macOS 测试用途，不推送、发布或覆盖你的历史数据。

### 验收与自测计划 v5

| 需求 | 自动证据 | 可见证据 | 回滚触发 |
| --- | --- | --- | --- |
| ITEM-007 | NewAPI JSON 401、Sub2API JSON 404、HTML 200、地址带页面路径、手动锁定与过期响应测试 | 输入 `nihao.dog` 后显示 NewAPI，无需点击诊断 | 自动识别覆盖手动选择或发送保存凭据 |
| ITEM-010 | 名称派生、默认根地址、保留自定义根/路径的存储与组件测试 | 默认区不出现 API 根；高级区可完整编辑 | 二开站不能恢复接口根/路径 |
| ITEM-008 | 旧 `pending` 重分类、状态原因/时间/公开 DTO 不泄漏测试 | 状态文本显示下一步且不永久卡在恢复中 | 状态仍显示笼统未完成或暴露敏感内容 |
| ITEM-009 | 单窗口队列、退避、人工停止、手动优先、成功重刷与次数上限测试 | 开启/关闭、立即检查、网络失败和人工验证状态路径 | 多窗口、超过上限、挑战页自动提交 |
| 全部 | `npm run verify`、`git diff --check`、代码/安全审阅、签名/ZIP | 隔离桌面端的添加、编辑、高级配置、保活状态和窄窗路径 | 任何未确认远端写入、跨域或凭据边界变化 |

## 设计方案 / 任务拆解 / 影响范围 v6

### 设计方案

保留“JWT → 授权分区刷新 → 已登录页面刷新”的现有顺序。只要 NewAPI 授权窗口已处于 HTTPS 同源、非 `/login`、`/sign-in`、`/otp` 的页面，就额外以固定 profile 路径做 Cookie 会话验证；验证成功且该 profile 路径可取得受限 Cookie 才保存 `cookie-session`。这一分支不再依赖刷新接口返回 404，因而兼容返回 403/405/非标准内容的 OneAPI 二开。

### 任务拆解

| 事项 | 任务 | 允许修改路径 | 完成条件 | 验证 |
| --- | --- | --- | --- | --- |
| ITEM-011 | TASK-022 会话捕获编排 | `src/main/index.ts`, `src/main/web-auth.ts` | Cookie 落盘独立于刷新接口状态，登录页不误判 | 授权辅助单测 |
| ITEM-011 | TASK-023 安全会话状态反馈 | `src/main/storage.ts`, `src/shared/types.ts`, `src/renderer/src/App.tsx` | renderer 仅见会话布尔状态与中文恢复文案 | 存储/类型/界面路径检查 |
| ITEM-011 | TASK-024 回归验证与交付 | `tests/web-auth.test.ts`, `tests/storage.test.ts`, `specs/newapi-login-route-compatibility/` | 固定 profile 验证、Cookie 边界、构建、审阅可追溯 | 聚焦测试 + `npm run verify` |

### 影响范围与验收

- **等级：high**：第三方网页登录、Cookie 安全存储、主进程请求与 renderer 反馈共同受影响。
- **数据/接口**：无迁移；现有加密 `sessionCookie` 字段复用；IPC 仅新增非敏感布尔 `hasSessionCookie`。
- **安全/权限**：不新增远端业务写入；新 profile 验证只访问 HTTPS 同源固定路径，Cookie 不跨 IPC/日志。
- **兼容/回退**：保留标准 refresh-token 与 Sub2API 流程。回退时用户重新授权或清除本机站点会话即可；旧站点记录不受影响。
- **验收**：授权辅助单测覆盖登录页拒绝、同源后台页、Cookie 合法性与错误文案；存储单测验证 Cookie 原文不进入公开 DTO；运行 `npm run verify` 和 `git diff --check`；真实登录仅由用户在 `nihao.dog` 完成。

## 设计方案 / 任务拆解 / 影响范围 v7

### 设计方案

保留既有的登录入口、JWT/refresh-token 恢复和 Cookie 加密保存流程。仅替换 Cookie-only OneAPI 的 profile 验证：主进程先确认当前授权页与固定 profile 都是 HTTPS 同源且非登录路由，再在该授权页内执行只读 `GET /api/user/self`。脚本只解析成功信封并返回布尔值；不返回响应体、字段、Cookie 或令牌。成功后主进程才调用既有 `session.cookies.get`、`buildBoundedCookieHeader` 与 `saveStation`。

### 任务拆解

| 事项 | 任务 | 允许修改路径 | 依赖 | 完成条件 | 证据 |
| --- | --- | --- | --- | --- | --- |
| ITEM-012 | TASK-025 记录 v7 受控修复 | `specs/newapi-login-route-compatibility/` | 用户确认 | 需求、边界、回退与验收同步 | 规格审查 |
| ITEM-012 | TASK-026 页面上下文验证 | `src/main/web-auth.ts`, `src/main/index.ts` | TASK-025 | 固定 profile 仅从已登录同源页面验证，成功可进入既有加密保存路径 | 授权辅助单测 |
| ITEM-012 | TASK-027 安全回归与交付 | `tests/web-auth.test.ts`, `specs/newapi-login-route-compatibility/`, `release/` | TASK-026 | 无敏感回传、全量验证、代码审阅、DMG 与用户可见验收路径完成 | `npm run verify`、签名检查 |

### 影响范围 v7

- **等级：high**：受影响的是第三方认证会话验证与本地加密 Cookie 落盘的前置条件。
- **直接影响**：`web-auth` 的 OneAPI Cookie 验证、`index` 授权编排、授权单测与交付文档。
- **间接影响**：使用 Cookie-only 会话的 HTTPS 同源 OneAPI/NewAPI 二开站；标准 refresh-token NewAPI 不变。
- **数据/接口**：无 schema 或迁移；复用现有 `sessionCookie`、`sessionAuthMode` 与 renderer 安全布尔状态，无 IPC 契约新增字段。
- **安全/权限**：页面验证限制为固定路径、HTTPS、同源且仅布尔回传；Cookie 仍只在主进程处理并经既有格式上限及 `safeStorage` 加密；无远端业务写入。
- **兼容/性能**：保持两秒冷却与既有捕获顺序；用户登录页、HTTP/跨域、失败或 HTML 响应都会安全保持授权窗口，不写半成品。
- **发布/回退**：本地生成 macOS DMG，不推送或发布。回退为恢复主进程 profile 验证，现有站点记录不受影响。
- **明确不影响**：余额、分组、价格、成本/收益、管理员操作、自动保活、Windows 构建与 GitHub Release。

### 验收与自测计划 v7

1. `web-auth` 单测覆盖：已登录同源页面调用固定 profile、脚本不含 `localStorage`/令牌读取、登录/HTTP/跨域不执行页面脚本、页面验证失败不落盘。
2. 执行 `npm run verify`、`git diff --check`，检查改动未引入 Cookie/JWT/profile 原文跨 IPC 或日志路径。
3. 重新生成本地 macOS arm64 DMG，运行 `codesign --verify --deep --strict`。
4. 用户在新构建中自行登录 `nihao.dog`；预期窗口关闭、会话状态保存、同步开始。不会读取或请求任何凭据。

## 设计方案 / 任务拆解 / 影响范围 v8

### 设计方案

在 `tryVerifyNewApiCookieSession` 的固定同源网页脚本中，仅访问 `localStorage.getItem('uid')`，并只接受 1–20 位数字。它不回传 profile、Cookie、JWT 或其他网页状态。验证通过后，选中用户编号与 Cookie 一样仅经主进程 `safeStorage` 加密保存；`NewApiClient` 仅在 `cookie-session` 模式附加 `New-Api-User`，JWT 模式会清除并不发送该值。

### 任务拆解

| 事项 | 任务 | 允许修改路径 | 完成条件 | 证据 |
| --- | --- | --- | --- | --- |
| ITEM-013 | TASK-028 受限网页上下文 | `src/main/web-auth.ts`, `src/main/index.ts` | 同源数字 uid 仅参与验证和主进程保存 | `web-auth` 测试 |
| ITEM-013 | TASK-029 加密保存与请求头 | `src/main/storage.ts`, `src/main/newapi-client.ts`, `src/shared/types.ts` | Cookie-only 请求发送选中用户头，JWT 模式清除 | 存储/客户端测试 |
| ITEM-013 | TASK-030 验证与可见闭环 | `tests/`, `specs/`, `release/` | 质量门禁、DMG 签名和真实登录闭环 | `npm run verify`、签名、UI |

### 影响范围 v8

- **等级：high**：第三方认证上下文、加密持久化和主进程 HTTP 请求共同受影响。
- **直接影响**：`web-auth`、授权编排、加密站点字段、NewAPI 只读适配器及对应单测。
- **数据/接口**：新增主进程私有、加密的可选选中用户编号；无 renderer IPC、远端 API 路径或业务写入新增。
- **安全/权限**：只读单一白名单 localStorage 键，数字边界校验，Cookie-only 模式限制，JWT 转换清除；不输出敏感值。
- **兼容/回退**：标准 NewAPI、Sub2API 与旧记录保持不变；删除本兼容字段和请求头即可回退。
- **验收与自测**：覆盖无效值拒绝、Cookie-only 请求头、JWT 清除、全量验证、DMG 签名和真实授权窗口自动关闭。

## 数据与刷新安全修复及自定义 API 根编辑 正式实施包 v2

### 设计方案 v2

1. **文件恢复**：使用既有原子写入；读取时将 JSON 解析和顶层类型均视作完整文档有效性的前提。解析失败后仅在 `rename` 成功时返回安全空状态，任何备份失败都抛出恢复错误并阻止读改写。
2. **刷新顺序**：每个站点维护递增 epoch。后台轮询可复用同一 in-flight 请求；来自 renderer 的刷新和保活检查强制创建新 epoch。旧 epoch 可以自然完成网络请求，但不能提交任何持久化或渲染可见副作用。
3. **自定义根**：在 `custom` 模板下让 API 根成为草稿 URL 字段。预览与保存均在主进程用站点基址验证 HTTPS、同源、无用户名密码、无 query/hash；显式输入根不再走仅供遗留配置修复的默认根推导。

### 任务拆解 v2

| 事项 | 任务 | 允许修改路径 | 依赖 | 完成条件 | 证据 |
| --- | --- | --- | --- | --- | --- |
| ITEM-014 | TASK-031 存储损坏保护 | `src/main/storage.ts`, `tests/storage.test.ts` | 无 | 备份失败阻止覆盖；无效顶层偏好也备份 | 存储回归测试 |
| ITEM-015 | TASK-032 刷新 epoch 提交保护 | `src/main/index.ts`, `src/main/station-refresh-epochs.ts`, `tests/station-refresh-epochs.test.ts` | 无 | 手动刷新强制换代，过期请求不提交 | epoch 单测 + 主进程审阅 |
| ITEM-016 | TASK-033 自定义根草稿流 | `src/shared/sub2api.ts`, `src/shared/types.ts`, `src/main/index.ts`, `src/main/storage.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/preview-api.ts`, `src/renderer/src/styles.css`, `tests/*` | TASK-031 | custom 模板中根可编辑、预览、保存且安全校验一致 | URL/存储/类型测试 |
| 全部 | TASK-034 审阅与验证 | `specs/`, `.specify/` | TASK-031 至 TASK-033 | 全量验证、差异和安全审阅，记录可见验收限制 | `npm run verify` + UI 报告 |

### 影响范围 v2

- **等级：high**：涉及本地凭据文件的恢复语义、共享刷新协调、主进程 IPC 校验和 React 接入表单。
- **数据/迁移**：无 schema 迁移。损坏文件成功备份后才产生新的空文件；备份失败时保留原文并拒绝写入。
- **接口/配置**：映射预览 IPC 接收可选 API 根草稿；已有非 custom 站点行为不变。自定义根只能为 HTTPS 同源 URL。
- **安全/权限**：不新增凭据读取 IPC 或远端写入；令牌、Cookie、密码和原始响应仍只在主进程。
- **兼容/性能**：遗留 API 根未显式修改时仍可使用兼容推导；同一站点轮询仍可去重，强制刷新仅替换过期请求的提交资格。
- **测试/回退**：存储、URL、epoch 单测和完整 `npm run verify`。回退为移除 epoch 与 custom-root 草稿流；已生成的 `.corrupt-*` 备份不删除。
- **明确不影响**：真实站点远端配置、余额/倍率计算、授权流程、发布、推送和版本号。

### 验收与自测计划 v2

| 验收项 | 自动证据 | 可见路径 | 回退触发 |
| --- | --- | --- | --- |
| ITEM-014 | 损坏 JSON、无效顶层偏好和 rename 失败测试 | 数据中心显示恢复错误但不覆盖原文件 | 任意备份失败后仍能写入空文档 |
| ITEM-015 | epoch 最新意图与移除失效测试；主进程提交点审阅 | 点击刷新时只展示最新返回快照 | 旧轮询覆盖手动刷新结果 |
| ITEM-016 | 同源 HTTPS 接受、HTTP/跨域拒绝、显式 `/api` 保存测试 | 数据接入 → 自定义兼容 → 编辑 API 根 → 检测并预览 → 保存 | 用户输入根被改回默认 `/api/v1` 或跨域请求出现 |
| 全部 | `npm run verify`、`git diff --check`、敏感日志扫描 | 约束桌面窗口与浏览器环境 | 自动化不能访问隔离窗口时按 `verified_with_risk` 报告 |

## 接入与涨跌可见性 正式实施包 v1

### 设计方案 v1

1. **唯一事件源**：`recordTimeCostLedgerSnapshot` 在串行偏好写入中返回本次新增的已验证倍率事件。主进程在 epoch 仍为最新时先广播偏好更新，再基于这批事件发原生通知；renderer 只重新读取持久化偏好，不再维护独立的通知水位。
2. **已知二开 Profile**：将 Krill 路径和 Zanzhu 固定门户/API 别名收敛在共享 URL 辅助函数；客户端与诊断只在 404 时遍历候选。Aihub 保持既有的、仅默认路径生效的 profile 特例。
3. **部分可用快照**：只有余额已成功读取时才把非授权分组失败降为可用余额快照；HTML、重定向、401/403 和网络失败不降级，避免误报。

### 任务拆解 v1

| 事项 | 任务 | 允许修改路径 | 完成条件 | 验证 |
| --- | --- | --- | --- | --- |
| ITEM-017 | TASK-035 变化记录广播与原生通知 | `src/main/index.ts`、`src/main/storage.ts`、`src/preload/index.ts`、`src/shared/types.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/preview-api.ts`、`tests/storage.test.ts` | 只通知新持久化事件；点击通知可打开正确筛选的变化窗口 | 存储/类型/变化历史测试 + 主进程审阅 |
| ITEM-018 至 ITEM-020 | TASK-036 受控兼容 Profile 与部分可用快照 | `src/shared/sub2api.ts`、`src/main/sub2api-client.ts`、`src/main/station-diagnostics.ts`、相关测试 | Krill/Aihub/Zanzhu 均只使用固定、受限读取路径；分组降级不掩盖认证错误 | 客户端/诊断契约测试 |
| ITEM-018 至 ITEM-020 | TASK-037 已保存站点认证读取诊断 | 无业务代码；只允许主进程同源已保存会话 GET 诊断 | 已授权站点可用时记录脱敏结果；不可用时不读取或输出凭据 | 运行时环境允许时的手动诊断 |
| 全部 | TASK-038 回归测试与可见验证 | `specs/newapi-login-route-compatibility/`、`.specify/` | 完整验证、差异/敏感审阅、Profile 刷新、UI 验收路径 | `npm run verify`、`git diff --check`、桌面端手工路径 |

### 影响范围 v1

- **等级：high**：主进程持久化事件、preload IPC、React 可见状态和第三方认证读取兼容同时受影响。
- **数据/接口**：复用既有 `groupChangeEvents`；新增仅是无参数的 `preferences:updated` 和受限筛选值 `preferences:open-group-changes`，不携带凭据、原始响应或用户资料。
- **安全/权限**：读取回退限定 HTTPS、已知主机和 404；诊断不使用凭据，除非用户在既有界面显式请求已保存会话的详细诊断；无远端业务写入。
- **兼容/回退**：标准 Sub2API 路径和手工 API 路径优先。移除已知 Profile 或 IPC 订阅即可回退，不需要迁移或清除历史。
- **明确不影响**：站点远端配置、管理员写操作、账号/余额存储格式、Git 推送、Release 与版本号。

### 验收与自测计划 v1

| 验收项 | 自动证据 | 可见路径 | 回退触发 |
| --- | --- | --- | --- |
| ITEM-017 | 账本新增事件测试、类型检查、完整构建 | 同步后打开“近期分组变化”；点击系统通知验证筛选 | 首次基线通知、重启丢失历史或混合通知漏方向 |
| ITEM-018 | Aihub 默认 profile 与手工路径优先测试 | 已授权 Aihub 的“详细诊断” | HTML/风控页被显示为可用或手工路径被覆盖 |
| ITEM-019 | Krill 根路径、余额与分组降级测试 | 已授权 Krill 刷新 | 404 以外错误触发回退、余额状态被误报为完整分组 |
| ITEM-020 | Zanzhu 固定别名、Referer 与 404 回退测试 | 已授权 Zanzhu 的“详细诊断” | 出现非固定跨主机请求或保存根被偷偷改写 |
| 全部 | `npm run verify`、`git diff --check`、敏感扫描、代码审阅 | 最新桌面端手工路径 | 任何真实凭据进入日志/文档/IPC 或 UI 自动化发现交互失败 |
