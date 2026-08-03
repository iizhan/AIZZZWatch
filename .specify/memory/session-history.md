# Session History

# 2026-07-25 站点智能接入与安全保活 v5

- 确认版本：用户确认执行 `站点智能接入与安全保活 正式实施包 v5`；验收状态 `awaiting_user_acceptance`。
- 结论：站点地址输入后自动执行无凭据 JSON 探测，`nihao.dog/keys` 会归一到根地址并识别为 NewAPI；HTML 页面不再误判。添加站点默认收纳接口根、路径、令牌和保活；保存账号密码且显式开启后才允许 HTTPS 同源自动保活。队列单窗口 FIFO，网络/超时 1/5/30 分钟退避，验证码、2FA、风控、密码失效和契约变化转人工。
- 安全修正：详细诊断移除了原始 JSON 文本回退，已授权 profile 不会作为提示传到 renderer。密码、Cookie、JWT、用户资料和原始响应仍不离开主进程安全边界。
- 验证：相关 5 文件 / 71 项、完整 `npm run verify` 14 文件 / 209 项、差异检查和 Profile capture 均通过；本地 macOS 测试包通过严格签名与 ZIP 完整性。隔离桌面演示确认 `nihao.dog/keys` 识别 NewAPI 并启用授权按钮，未保存站点。
- 不满意分类：`verification_gap`；真实第三方授权、验证码/2FA 与真实网络中断仍只能由用户自行完成。
- 剩余风险：当前已有应用实例占用开发端口，本轮未强行启动第二实例；其他二开站的路径/Cookie/登录契约仍需脱敏现象确认。
- 下一步：用户在桌面端完成一次真实 `nihao.dog` 授权，并按需启用自动保活后观察状态。

# 2026-07-25 OneAPI Cookie 会话授权修复 v4

- 确认版本：用户确认执行 `OneAPI Cookie 会话授权修复 v4`；验收状态 `awaiting_user_acceptance`。
- 结论：`nihao.dog` 登录后以 Cookie 调用 `/api/user/self`，但不支持 `/api/user/auth/refresh`。应用现在仅在刷新接口明确 404 后，以临时隔离分区的固定 HTTPS 同源 profile 验证 Cookie 会话；成功后加密保存 Cookie/UA 和内部模式，授权窗口自动关闭。Cookie-only 读取不发送 Bearer，也不再访问不存在的刷新接口。
- 影响文件：`src/main/web-auth.ts`、`src/main/index.ts`、`src/main/newapi-client.ts`、`src/main/storage.ts`、`src/shared/types.ts`、授权/客户端/存储测试及本任务交付工件。
- 验证：聚焦 3 文件 / 57 项测试、完整 13 文件 / 201 项测试、类型检查、生产构建和差异检查均通过；macOS arm64 测试 ZIP 已通过严格签名和完整性校验。可见授权窗确认 NewAPI 路径为 `nihao.dog/sign-in`；没有输入或读取真实凭据。
- 安全边界：不读取 `localStorage["user"]`、页面资料、Cookie/JWT 原文或账号密码；Cookie/UA 仅以既有 safeStorage 存于主进程，不进入 renderer IPC 或日志。Cookie 会话成功会清除旧 Bearer 凭据；手动粘贴 JWT 会恢复标准 Bearer 模式。
- 不满意分类：`verification_gap`；自动检查不能替代用户的真实登录、验证码或 2FA。
- 剩余风险：真实成功后的自动关闭、保存与首次同步需用户验收；其他 OneAPI 二开的 Cookie 和 profile 契约可能不同。
- 下一步：用户使用新 macOS ZIP 添加 `https://nihao.dog` 并完成一次真实网页登录；若失败，仅提供脱敏截图或窗口状态。

# 2026-07-24 NewAPI 登录入口兼容 v1

- 确认版本：用户确认执行 `NewAPI 登录入口兼容 v1`；验收状态 `awaiting_user_acceptance`。
- 结论：明确或已检测为 NewAPI 的网页登录现在优先打开 `/sign-in`；旧站继续优先 `/login`。仅当当前同源候选页面明确显示 SPA 404 时，才一次回退到另一条固定入口。双入口都不存在时显示具体尝试路径，不再误报为用户取消。
- 影响文件：`src/main/web-auth.ts`、`src/main/index.ts`、`src/renderer/src/App.tsx`、`tests/web-auth.test.ts`、特性规格和项目授权链路档案。
- 验证：聚焦 12 项授权测试、完整 184 项测试、类型检查、生产构建和差异检查均通过；公开可见验证显示 `nihao.dog/sign-in` 是登录表单，`/login` 是 404 页面；本地 macOS arm64 ZIP 已通过 ad-hoc 签名和完整性校验。
- 安全边界：不代填或提交用户账号、密码、验证码或 2FA；回退仅限同源两条固定路径，页面正文、Cookie、JWT 与密码不跨主进程边界。
- 不满意分类：`verification_gap`；自动检查不能替代用户的真实第三方账号登录。
- 下一步：用户使用最新本地 ZIP 完成一次 `nihao.dog` 桌面端登录验收；若站点后续引入第三条登录路径，再单独确认兼容范围。

# 2026-07-24 跨平台 Windows CI 构建增量 v3

- 确认版本：用户确认执行 `Windows CI 打包增量 v3`；验收状态 `awaiting_user_acceptance`。
- 结论：新增最小权限的 GitHub Actions Windows 构建，`windows-latest` 已实际生成 Windows x64 NSIS EXE Artifact。首轮因 electron-builder 在 CI 中隐式发布、缺少 `GH_TOKEN` 失败；显式 `--publish never` 后 Run #2 成功。
- 影响文件：`.github/workflows/windows-package.yml`、`package.json`、`tests/packaging-config.test.ts`、README、`specs/cross-platform-packaging/`、Project Profile。
- 验证：`npm run verify` 通过（13 文件 / 181 测试、类型检查、生产构建）；YAML 与差异检查通过；GitHub Run #2 成功，上传 78.7 MB Artifact，SHA-256 `001eb19d1e2873c7ba73234b7a87f13557547ad1b22c6c7ab6b0992be26bffe5`。
- 安全边界：工作流仅 `contents: read`，不读取 secrets，只上传 `release/*.exe`，不创建 Release 或标签。
- 不满意分类：`verification_gap`；构建已覆盖，Windows 安装、托盘、窗口模式和卸载仍待真实可见验收。
- 下一步：下载 Artifact，在 Windows 验证安装、启动、系统托盘、完整/紧凑/气泡窗口和卸载。

# 2026-07-23 站点密码保活 v1

- 确认版本：用户确认执行 `密码保活 v1`；验收状态 `awaiting_user_acceptance`。
- 结论：三方站点与我的站点现在可在同一站点设置内保存本地加密登录账号密码，并显式开启“令牌失效时自动重新登录”。主进程先刷新令牌，未授权时才在 HTTPS 同源隔离页面尝试自动登录；挑战页改为人工完成。
- 影响文件：认证主进程、加密站点存储、窄 preload 状态 IPC、站点设置 UI、预览适配、存储/成本测试与 `specs/password-keepalive/` 交付工件。
- 验证：`npm run verify` 通过（12 文件 / 170 测试、类型检查、生产构建）；真实 Electron 窗口确认无凭据时开关禁用、填写草稿后启用，草稿未保存。
- 不满意分类与证据：`ui_interaction`；可见检查发现凭据区被通用诊断隐藏样式遮挡，已改为独立容器并复测。
- 剩余风险：不同二开站点的 DOM、验证码、2FA 与 WAF 不能保证自动成功；应用不会尝试绕过，需用户真实站点验收。
- 下一步：选择一个非关键 HTTPS 站点，保存凭据并启用保活，验证令牌失效后的实际恢复效果。

# 2026-07-22 用户自用排除经营核算 正式实施包 v1

- 确认版本：用户确认“用户自用排除经营核算 正式实施包 v1”；验收状态 `awaiting_user_acceptance`。
- 结论：内部自用是用户自己聚合站中的使用用户，不是上游账号。应用仅在本机保存站点 ID 与数字用户 ID；收益报告会排除精确匹配用户的经营收入、成本、毛利、亏损和成本保护，并单列内部消耗。没有稳定用户 ID 的记录不猜测归属。
- 影响文件：`src/shared/types.ts`、`src/shared/time-cost-ledger.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/preview-api.ts`、`src/renderer/src/styles.css`、相关账本/存储/客户端测试、Profile 与交付工件。
- 验证：`npm run typecheck` 通过；定向 3 个测试文件 / 57 用例通过；`npm run verify` 通过（11 文件 / 153 用例及生产构建）；macOS 打包更新 `app.asar`，`codesign --verify --deep --strict` 与 `git diff --check` 通过。安全扫描只命中测试夹具中的假密钥字段，生产源码无命中。
- 安全与边界：管理员原始用量、用户名称/邮箱、API Key、JWT 和 Cookie 不进入 renderer 或本地偏好；重归档仅发起管理员只读 GET，不做任何远端用户、账号、密钥、分组或调度写入。
- 不满意分类与证据：`requirement_miss` 已在确认阶段纠正，原先将“我自己使用的用户”误解为上游账号；本轮通过独立“内部自用用户”语义和“账号免计费”文案分开处理。
- 剩余风险：本地构建文件 URL 被浏览器安全策略阻断，未绕过策略执行可见自动化；需在已运行的最新桌面包中，以真实管理员用量和 `user_id` 完成一次点击验收。

- [2026-07-22] lcodex 新版兼容正式实施包 v1
  - 确认版本：需求与影响 v1、正式实施包 v1；验收状态 `awaiting_user_acceptance`。
  - 结论：lcodex 改版后直访 `/login` 会 404，令牌转入 sessionStorage，管理 API 应使用站点根域。应用现根页内进入登录页，读取新版 access/refresh token，并将价格路径切到 `/api/v1/channels/available`。
  - 验证：`npm run verify` 通过 151 条；macOS 打包、严格签名和差异检查通过；公开根域读取接口返回 JSON 401。
  - 剩余风险：内置浏览器被站点访问策略阻断，真实网页登录自动关闭与已授权余额/字段需要用户在最新桌面包中验收。

- [2026-07-22] 任务：价格榜使用中标记
  - 确认版本：`价格榜使用中标记 语义确认 v1`。
  - 结论：价格榜按精确账号上游映射显示绿色链路图标和账号数，并可筛选“使用中”；多分组 Key、失效 Key、未绑定来源不标记。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、交付/反思/workflow 工件。
  - 验证：`npm run verify` 通过（11 个文件、142 条测试）；macOS 包与严格签名通过；新版窗口已显示筛选条。
  - 剩余风险：启动时没有可比价行，真实行的 hover 内容待下一次同步后用户确认。
  - 下一步：用户在价格榜同步出分组后，点击“使用中”核验图标、账号数和 hover 关系。

- [DATE] 任务：
  - 结论：
  - 影响文件：
  - 关键决策：
  - 升级信号：
  - 剩余风险：
  - 下一步：

- [2026-07-17] 任务：来源钱包详情置顶
  - 确认版本：fast lane；本轮只调整来源钱包布局层级。
  - 结论：来源钱包改为顶部显示当前选中来源详情，下面显示“全部来源”列表；列表选中高亮联动保留，来源多时不再需要滚到底部找详情。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、Project Profile、`.specify/memory/session-history.md`。
  - 关键决策：保留右侧同一 panel，不引入新弹窗或新路由；只调整 DOM 顺序和轻量视觉分区。
  - 升级信号：`ui_interaction`；用户反馈来源多时详情在最底部不易使用。
  - 剩余风险：真实大量来源下列表高度和详情高度的最佳比例仍需继续观察。
  - 下一步：用户重新打开桌面 app，检查来源多时点击联动和详情位置是否顺手。

- [2026-07-17] 任务：编辑站点重新授权入口
  - 确认版本：fast lane；本轮只优化编辑弹窗授权入口文案。
  - 结论：编辑已有站点时，网页登录按钮显示为“重新授权 / 换号登录”，提示会覆盖当前站点令牌和 Cookie，同时保留站点名称、充值比例和手动接口路径。
  - 影响文件：`src/renderer/src/App.tsx`、Project Profile、`.specify/memory/session-history.md`。
  - 关键决策：复用现有隔离网页登录和 safeStorage 流程，不新增凭据存储方式，也不改远程接口。
  - 升级信号：`ui_interaction`；用户需要更明确的编辑态重授权入口。
  - 剩余风险：真实站点若撤销旧 token 后新登录失败，仍需用户在授权窗口重新完成站点登录。
  - 下一步：用户重新打开桌面 app，在来源钱包详情点击编辑，使用“重新授权 / 换号登录”测试换号。

- [2026-07-17] 任务：价格榜横向收敛与来源钱包余额强化
  - 确认版本：需求与影响 v4-3；本轮只调整价格榜信息层级和余额可见性。
  - 结论：主榜移除独立倍率、充值、余额列；来源站点单元格整合原始倍率与充值，主榜保留最终倍率和有效成本；来源钱包卡片及详情统计突出“剩余余额”。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`specs/sub2api-monitor/`、`.specify/memory/session-history.md`。
  - 关键决策：最终倍率作为主比较指标，原始倍率/充值作为来源上下文，余额只在来源钱包集中展示，减少价格榜横向列数。
  - 升级信号：`ui_interaction`；证据为用户反馈新增列后价格榜展示不全。
  - 剩余风险：真实站点余额单位仍沿用当前 USD 展示约定，Krill credits 的具体货币语义待真实样本确认。
  - 下一步：用户重新启动桌面 app，确认完整窗口和紧凑窗口的价格榜列是否足够直观。

- [2026-07-17] 任务：Krill AI 自定义接口路径适配
  - 确认版本：快速修复；用户提供 `krill-ai.com` 已知接口路径。
  - 结论：新增可配置余额路径；客户端允许缺省倍率接口并从分组字段别名中识别倍率、名称和平台，使 `https://www.krill-ai.com/api/auth/me`、`/api/credits`、`/api/my/channels` 这类非标准 Sub2API 路径可被配置和读取。
  - 影响文件：`src/shared/types.ts`、`src/shared/sub2api.ts`、`src/main/sub2api-client.ts`、`src/main/station-diagnostics.ts`、`src/renderer/src/App.tsx`、`tests/sub2api.test.ts`、`tests/sub2api-client.test.ts`、Project Profile。
  - 关键决策：Krill 先按只读站点接入；不猜测订阅接口和价格接口结构，不进行远程写入。
  - 升级信号：无；这是站点兼容适配，不改变通用流程规则。
  - 剩余风险：Krill 的 auth header、cookie/UA 要求、`/api/my/channels` 真实响应字段仍需用户登录态联调确认；`/api/subscription` 暂未映射到现有快照模型。
  - 下一步：用户打开新版桌面 app，按自定义路径添加 Krill，若刷新失败再根据诊断结果补 Cookie/网页登录或字段适配。

- [2026-07-17] 任务：价格榜最终倍率列与合并排序
  - 确认版本：需求与影响 v4-1；本轮只扩展 renderer 价格榜的计算列和排序。
  - 结论：新增“最终倍率”列，公式为 `倍率 ÷ 充值比例`；例如 `0.1 / 10 = 0.01` 与 `0.01 / 1 = 0.01` 等价，并支持按最终倍率排序。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/workflow-state.yaml`、`.specify/project-profile/profile.yaml`、`.specify/project-profile/architecture.md`、`.specify/memory/session-history.md`。
  - 关键决策：保留原始倍率、充值比例和有效成本三组信息；最终倍率单独呈现并可排序，窄屏优先保留该列。
  - 升级信号：无；这是价格榜局部计算/展示增强，不改变后端契约、存储或远程写入。
  - 剩余风险：真实站点样本下的采购排序偏好仍需用户验收。
  - 下一步：用户重新启动桌面 app，检查“最终倍率”列和排序是否符合采购直觉。

- [2026-07-17] 任务：倍率显示精度修正
  - 确认版本：延续当前 `sub2api-monitor` 已确认 UI 范围；本轮只修正倍率展示精度。
  - 结论：价格榜、来源钱包和分组选项里的倍率统一改成三位小数显示，`0.025` 现在会显示为 `0.025x`，不会再被压成 `0.03x`。
  - 影响文件：`src/renderer/src/App.tsx`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`。
  - 关键决策：倍率显示采用固定三位小数；这是展示层格式修复，不改变底层计算或排序逻辑。
  - 升级信号：无；这是一个局部 UI 精度问题，属于实现修复而非流程变更。
  - 剩余风险：如果未来还有其它倍率显示入口新增，需要复用同一格式化函数，避免再次出现精度不一致。
  - 下一步：用户打开新的桌面包，确认 0.025 这类倍率在所有入口都按三位小数显示。

- [2026-07-17] 任务：Sub2API 长期登录保活
  - 确认版本：延续 `sub2api-monitor` 的已确认 auth 范围；本轮只做长期免重复登录的保活与自动续签。
  - 结论：登录态继续由 `refresh_token`、`sessionCookie` 和 `userAgent` 共同维持；主进程会在访问令牌接近过期前主动刷新，并在 401 时走兜底刷新，不存明文账号密码。
  - 影响文件：`src/main/index.ts`、`src/main/sub2api-client.ts`、`tests/sub2api-client.test.ts`、`.specify/project-profile/profile.yaml`、`.specify/project-profile/architecture.md`、`.specify/memory/session-history.md`。
  - 关键决策：不引入账号密码持久化；保活基于现有安全存储与 refresh token 轮换，只有当站点撤销会话或刷新令牌失效时才需要用户重新授权。
  - 升级信号：无；这是 auth 续签链路的局部增强，没有暴露新的 workflow 规则需求。
  - 剩余风险：若真实站点同时失效 refresh token / session cookie / UA 绑定，仍然需要重新网页登录授权。
  - 下一步：用户在真实站点保持运行一段时间后，确认是否还会再次弹出登录。

- [2026-07-17] 任务：Sub2API 价格榜排序控件 v3-2
  - 确认版本：延续 feature `sub2api-monitor` 的已锁定范围；本次只做价格榜表头排序控件。
  - 结论：价格榜的“倍率 / 充值 / 有效成本”表头已支持点击排序，默认仍按有效成本从低到高；排序状态只存在 renderer 本地 UI，不进入 URL 或持久化。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/workflow-state.yaml`。
  - 关键决策：保留现有分类 tabs 和来源钱包结构；点击同一列切换升降序，切到新列时使用更符合比价直觉的默认方向；`充值` 列默认按高充值优先。
  - 升级信号：无；这是一个局部 UI 交互改进，不需要提升为流程规则变更。
  - 剩余风险：`package:mac` 本轮受外部 Electron 下载 `ECONNRESET` 阻塞，未重新产出 app；真实站点数据下的排序语义仍依赖用户后续联调确认。
  - 下一步：用户在本地预览或桌面端继续点表头检查排序方向是否符合习惯。

- [2026-07-17] 任务：Sub2API 紧凑视图排序条 v3-2 补充
  - 确认版本：延续 `v3-2` 排序控件；本次只补 compact / 窄屏排序可见性。
  - 结论：compact 视图和窄屏下新增独立排序胶囊条，`倍率 / 充值 / 有效成本` 都可直接切换；表头退回为静态标签，避免重复控件占位。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/workflow-state.yaml`。
  - 关键决策：只在 compact 或窄屏显示独立排序条；full 视图继续沿用表头按钮。
  - 升级信号：无；这仍是局部 UI 可见性优化。
  - 剩余风险：真实站点数据下，compact 模式的排序偏好是否足够直观仍需要用户确认。
  - 下一步：用户在 compact 模式下确认排序条是否比表头更顺手。

- [2026-07-16] 任务：Sub2API 实时分组监控 MVP
  - 确认版本：需求/影响 v1、计划 v1；验收状态 awaiting_user_acceptance
  - 结论：完成 Electron 多站监控、安全配置、倍率/价格展示、窗口/气泡/Tray 和管理员切组确认。
  - 影响文件：`src/`、`tests/`、`package.json`、`DESIGN.md`、`specs/sub2api-monitor/`、Project Profile。
  - 关键决策：凭证仅在主进程与 safeStorage；价格接口可降级；远程切组需确认并校验服务端当前分组。
  - 升级信号：无，发现的问题属于实现缺陷并已修复。
  - 剩余风险：生产站点版本差异、真实远程写入、签名/公证/自动更新未覆盖。
  - 下一步：用户验收后接入一个真实站点做只读兼容联调。
  - 用户修订：v1 认证模型不符合预期；应支持站点登录 token 或网页登录授权，并按账号权限查询全部分组。状态改为 revision_requested。
  - 进程隔离修复：固定端口 `5187`、独立 `AIZZZWatch` userData、唯一应用标识和单实例锁；已验证不影响占用 `5173` 的其他 Electron 项目。
  - 桌面入口：生成本地 ad-hoc 签名 arm64 `AIZZZWatch.app`，桌面创建快捷链接；双击启动与单实例验证通过，不占用开发端口。

- [2026-07-16] 任务修订：Sub2API 认证 v2
  - 确认版本：需求/影响 v2、计划 v2；验收状态 awaiting_user_acceptance。
  - 结论：增加隔离网页登录授权、access/refresh token 安全存储与自动刷新；普通账号使用 `/groups/available` 展示其创建/绑定 API Key 时可选择的全部分组；管理员 JWT/API Key 分别使用 Bearer/`x-api-key`。
  - 影响文件：`src/main/index.ts`、`src/main/storage.ts`、`src/main/sub2api-client.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/shared/types.ts`、`tests/sub2api-client.test.ts`、`specs/sub2api-monitor/`、`README.md`。
  - 验证：`npm run verify` 通过，12 个测试通过；macOS arm64 包已重新打包并 ad-hoc 签名；桌面快捷入口启动和单实例检查通过。
  - 未覆盖：真实站点网页登录点击路径和生产站点联调；当前环境无法通过浏览器连接 Electron 开发窗口。
  - 剩余风险：不同 Sub2API 版本/feature flag 的字段与登录页面差异；真实站点可能需要额外 OAuth/Turnstile 交互。
  - 下一步：用户通过桌面快捷入口添加真实站点并完成网页登录授权验收。

- [2026-07-16] 启动显示异常复核
  - 现象：用户反馈启动后窗口显示 CSS 文本片段。
  - 结论：生成的 `index.html`、stylesheet 资源和 asar 内路径均正确；通过 Electron 调试协议确认实际窗口 DOM 正常渲染 AIZZZWatch。重启 AIZZZWatch 自身进程后恢复，未触碰其他项目进程或 `5173` 端口。
  - 验证：桌面快捷入口重新启动成功，单实例保持 1 个主进程。
  - 剩余风险：若再次出现，需要保留当时窗口截图和当前窗口 URL，以区分旧进程窗口状态与误打开 CSS 资源。

- [2026-07-16] 验收反馈修复：浏览器预览添加站点不显示
  - 确认版本：需求/影响 v2 的验收修复；验收状态 awaiting_user_acceptance。
  - 结论：浏览器预览保持不执行网页登录授权；手工保存站点改为写入当前页面内存并立即显示，退出演示数据列表。
  - 影响文件：`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`src/preload/index.ts`、`src/shared/types.ts`、`tests/sub2api.test.ts`、`specs/sub2api-monitor/`。
  - 验证：`npm run verify` 通过；2 个测试文件、13 个测试通过；浏览器预览点击路径验证“网页登录禁用、保存后新增站点可见”；`npm run package:mac` 已重新生成桌面快捷入口指向的 app，并通过 ad-hoc 签名校验。
  - 不满意分类与证据：`ui_interaction`、`implementation_defect`；证据为预览假 API 的 `save()` 返回空数组，导致添加后仍停留演示模式。
  - 剩余风险：真实站点网页登录仍需用户在桌面端授权窗口完成联调。
  - 下一步：用户通过 `/Users/bing/Desktop/AIZZZWatch.app` 添加真实站点并验收余额、分组和授权刷新路径。

- [2026-07-16] 验收反馈修复：桌面网页登录误走浏览器预览
  - 确认版本：需求/影响 v2 的验收修复；验收状态 awaiting_user_acceptance。
  - 结论：打包后的 preload 原为 ESM `index.mjs`，Electron sandbox preload 按普通脚本执行时报 `Cannot use import statement outside a module`，导致 `window.aizzz` 未注入并误回退到浏览器预览 API。已改为 CommonJS `index.cjs`，并更新主窗口和气泡窗口 preload 路径。
  - 影响文件：`electron.vite.config.ts`、`src/main/index.ts`、`src/renderer/src/main.tsx`、`src/renderer/src/styles.css`、`specs/sub2api-monitor/`。
  - 验证：`npm run verify` 通过；2 个测试文件、13 个测试通过；`npm run package:mac` 后 ad-hoc 签名校验通过；打包桌面窗口只读调试确认 `window.aizzz` 存在且 `runtime.isBrowserPreview=false`。
  - 不满意分类与证据：`implementation_defect`、`verification_gap`；证据为用户点击桌面网页登录仍收到“浏览器预览不执行网页登录授权”，自动检查后发现 preload 加载失败。
  - 剩余风险：真实站点登录页仍需用户输入真实账号完成联调。
  - 下一步：用户在当前已打开的桌面新版窗口中重新点击“网页登录授权”。

- [2026-07-16] 验收反馈修复：网页登录页面加载失败 (-3)
  - 确认版本：需求/影响 v2 的验收修复；验收状态 awaiting_user_acceptance。
  - 结论：`did-fail-load` 的 `-3` 被识别为重定向/中断，不再中断授权流程；本地模拟站点 `/login` 302 跳转到 `/auth` 时，`auth:login` 成功保存并返回站点列表与快照。
  - 影响文件：`src/main/index.ts`、`specs/sub2api-monitor/`。
  - 验证：`npm run verify` 通过；`npm run package:mac` 后桌面包重新签名；只读调试确认 `window.aizzz` 注入正常；本地模拟站点重定向登录流程成功。
  - 不满意分类与证据：`implementation_defect`、`verification_gap`；证据为用户在桌面端点击网页登录仍报 `网页登录页面加载失败 (-3)`，随后确认这是把重定向中断当成失败。
  - 剩余风险：真实站点若有更复杂的 OAuth/2FA 跳转链路，仍需继续联调。
  - 下一步：用户在桌面新版窗口重新点击网页登录授权，验证真实站点登录页。

- [2026-07-16] 验收反馈修复：Session network fingerprint changed
  - 确认版本：需求/影响 v2 的验收修复；验收状态 awaiting_user_acceptance。
  - 结论：授权窗口现在会抓取站点 cookies 和浏览器 UA，并在主进程请求中同步携带 `Cookie` / `User-Agent`；本地 cookie-required 模拟站点在 `/login` 下发 cookie 后，`auth:login` 成功返回，且后续 `/user/profile`、`/groups/available`、`/groups/rates` 能拿到健康快照。
  - 影响文件：`src/main/index.ts`、`src/main/storage.ts`、`src/main/sub2api-client.ts`、`src/shared/types.ts`、`tests/sub2api-client.test.ts`、`specs/sub2api-monitor/`。
  - 验证：`npm run typecheck`、`npm test`、`npm run package:mac`、ad-hoc 签名校验通过；本机只读调试确认 `window.aizzz` 注入正常；cookie-required mock smoke 通过。
  - 不满意分类与证据：`implementation_defect`、`verification_gap`；证据为用户在登录后仍收到 `Session network fingerprint changed, please login again`。
  - 剩余风险：真实站点如果校验的不只是 cookie/UA，而是更深层的 TLS 或网络指纹，仍可能需要进一步对齐 Electron 请求栈。
  - 下一步：用户重新走一次真实站点网页登录授权，并观察余额和分组是否恢复正常。

- [2026-07-16] 验收反馈修复：重试按钮没反应
  - 确认版本：需求/影响 v2 的验收修复；验收状态 awaiting_user_acceptance。
  - 结论：详情区错误提示原来的“重试”只会刷新快照，不会重新弹登录窗；现在授权失效时按钮显示“重新登录”并直接拉起网页登录窗口，普通错误保留“重试当前站点”。
  - 影响文件：`src/renderer/src/App.tsx`、`specs/sub2api-monitor/`。
  - 验证：`npm run verify` 通过；按钮语义更新已落在构建产物中。
  - 不满意分类与证据：`ui_interaction`、`implementation_defect`；证据为用户点击“重试”没有任何登录弹窗，导致无法理解这不是授权动作。
  - 剩余风险：真实站点若再次判定会话失效，仍可能需要用户完成新的网页登录流程。
  - 下一步：用户在错误态下点击“重新登录”，确认弹出登录窗口。

- [2026-07-16] 功能迭代 v7：分类 tabs、充值比例与低价聚合
  - 确认版本：需求与影响 v1，用户确认执行；验收状态 awaiting_user_acceptance。
  - 结论：修复详情右上角“几秒前”不自动倒计的问题；新增 Sub2API `platform` 分类 tabs；创建/编辑站点新增站点级充值比例 `1:n`；结构化保存 `/channels/available` 模型价格并按模型、分组倍率、充值比例计算低价聚合。
  - 影响文件：`src/shared/types.ts`、`src/shared/sub2api.ts`、`src/main/storage.ts`、`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/sub2api.test.ts`、`specs/sub2api-monitor/`。
  - 验证：`npm run typecheck`、`npm test`、`npm run verify`、`npm run package:mac` 和 ad-hoc 签名校验通过；桌面 app 已重新启动为新包。
  - 关键决策：v1 充值比例按站点级处理，旧站点默认 `1:1`；低价聚合采用“价格 × 用户/分组倍率 ÷ 充值比例”的有效成本。
  - 剩余风险：真实站点需要返回可用 `/channels/available` 价格数据，低价聚合才会展示完整模型比较。
  - 下一步：用户在桌面 app 中检查 tabs、充值比例配置和真实站点模型价格聚合结果。

- [2026-07-17] 功能迭代 v8：分类驱动 token 比价首页
  - 确认版本：需求与影响 v2，用户确认执行；验收状态 awaiting_user_acceptance。
  - 结论：首页从“站点监控视图”调整为“分类比价榜”；固定分类为 Anthropic、OpenAI、Gemini、Antigravity、Grok、其他；主表展示所有站点/分组/模型候选并按有效成本排序；站点余额、充值比例、健康状态和分组详情放到右侧来源钱包。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/sub2api.test.ts`、`specs/sub2api-monitor/`。
  - 验证：`npm run verify` 通过，2 个测试文件、15 个测试通过；`npm run package:mac` 和 ad-hoc 签名校验通过；仅重启 AIZZZWatch 自身进程。
  - 关键决策：比价榜列出全部候选而不是仅每模型最便宜项；有效成本公式保持 `模型价格 × 分组倍率 ÷ 充值比例`；分类优先使用 platform，模型/分组名关键词兜底。
  - 剩余风险：真实站点价格排序效果依赖 `/channels/available` 是否返回模型价格；没有真实样本时无法确认所有站点 platform 命名是否完全命中。
  - 下一步：用户用真实站点检查 Anthropic/OpenAI/Gemini/Antigravity/Grok 分类和排序是否符合采购直觉。

- [2026-07-17] 功能迭代 v3-1：站点兼容诊断器与手工补录
  - 确认版本：用户确认 v3-1，并补充“没检测到可以手动输入”；验收状态 awaiting_user_acceptance。
  - 结论：已支持站点设置里的兼容诊断入口，自动探测标准/二开/自定义 API 根；当自动探测不完整时，允许用户手动保存 `apiBaseUrl` 和各接口 `apiPaths`，并让 Sub2API 客户端按保存路径读取快照与管理员数据。
  - 影响文件：`src/shared/types.ts`、`src/shared/sub2api.ts`、`src/main/station-diagnostics.ts`、`src/main/storage.ts`、`src/main/sub2api-client.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/preview-api.ts`、`tests/station-diagnostics.test.ts`、`scripts/package-mac.mjs`、Project Profile、`specs/sub2api-monitor/`。
  - 验证：`npm run verify` 通过，3 个测试文件、16 个测试通过；`npm run package:mac` 通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；Profile capture/status 为 fresh。
  - 关键决策：本轮只做兼容诊断和手动补录，不新增手工 Cookie/UA 输入；网页登录仍负责捕获站点 cookie 与 UA。
  - 不满意分类与证据：`requirement_miss`、`verification_gap`；证据为用户指出二开站点可能无法标准探测，必须允许手工记录。
  - 剩余风险：未用真实用户账号登录 `lcodex.cc` 或 `krill-ai.com` 做完整只读联调；设置面板新增诊断区域本轮未重新打开桌面窗口做可见回归。
  - 下一步：用户用桌面入口打开设置，添加 `https://lcodex.cc` 或 `https://www.krill-ai.com`，先自动探测；若探测不到完整接口，则手工填写 API 基址和路径后保存。
  - 追加入门修复：用户反馈“打不开”；已确认问题更像是气泡态下再次启动没有把主窗口拉回前景，因此补了 activate/second-instance 的主窗口恢复逻辑，并重打包验证。
  - 追加钥匙串修复：用户要求继续自测推进；已将站点配置读取改为只读元数据，token 延迟到真实刷新、网页登录保存或管理员切组时再解密；启动阶段不再主动弹出 macOS Safe Storage，旧站点先显示“暂无数据”，用户手动刷新后恢复定时轮询。
  - 验证补充：`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict`、Profile capture/status 均通过；桌面截图确认主窗口可见且不再弹钥匙串。

- [2026-07-17] 验收反馈修复：顶部总览压缩与站点视角
  - 确认版本：`UI-density v1` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：顶部“四个大统计块”已改为紧凑工具条；移除用户认为意义弱的“比价条目”；“最近同步”弱化为右侧小字；新增“查价视图 / 我的站点”切换入口；来源钱包改为点击当前来源后在卡片内原地展开详情。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，4 个测试文件、25 个测试通过；本地浏览器预览确认工具条高度约 52px、来源卡片默认展开、点击“我的站点”后来源钱包位于左侧主位置且详情原地展开；`npm run package:mac` 通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：“查价视图”继续以价格榜为主，“我的站点”将来源钱包放到主位置并保留右侧价格榜参考；同步时间不再作为大卡片占位。
  - 不满意分类与证据：`ui_interaction`；证据为用户明确反馈顶部四块浪费可视区、比价条目意义弱、最近同步需要弱化并希望放视角切换按钮。
  - 剩余风险：真实来源数量很多时，来源钱包内联展开的信息密度仍需用户实际数据验收；后续“我的站点”视图的聚合切组能力还可以继续深化。
  - 下一步：用户直接启动新版桌面 app，确认顶部紧凑度、视角切换和来源原地展开是否顺手。

- [2026-07-17] 验收反馈修复：来源展开态辨识与按钮收纳
  - 确认版本：`UI-density v2` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：来源钱包展开态已增强颜色区分，使用浅蓝抽屉底、蓝色左边框、边框阴影和“展开中”小标识；展开区的“刷新 / 编辑 / 移除”收纳为 icon-only 按钮，hover/focus 时显示按钮背景，保留 `title` 与 `aria-label` 方便识别与辅助访问。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，4 个测试文件、25 个测试通过；本地浏览器预览确认展开卡片 `background=#eef6ff`、左边框 3px accent、操作按钮无文字文本且保留 title/aria；`npm run package:mac` 通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：按钮默认仍可见但只保留图标，避免完全隐藏造成发现成本；hover/focus 只负责强化可点击感。
  - 不满意分类与证据：`ui_interaction`；证据为用户反馈展开颜色容易看混，且“刷新、编辑、移除”文字按钮占用空间。
  - 升级信号：记录为同一 UI 密度/可读性主题的连续反馈；暂不升级 workflow 规则，若继续出现类似“信息密度与辨识度”问题，再进入 skill-upgrade-advisor。
  - 剩余风险：真实站点数量多、不同健康状态混排时，展开态颜色强度仍需用户实际视觉验收。
  - 下一步：用户直接启动新版桌面 app，确认展开卡片是否更清楚、icon 操作是否顺手。

- [2026-07-17] 验收反馈修复：来源分组列表滚动容器
  - 确认版本：`UI-density v3` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：移除“还有 N 个分组，后续可做展开全部”的临时占位文案；来源展开区现在渲染当前分类下全部分组，并把分组区域做成独立边框滚动容器，真实 10+ 分组时在区域内滚动，不再拉长整张来源卡片。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，4 个测试文件、25 个测试通过；本地浏览器预览确认占位文案不存在、分组容器 `max-height=232px` 且 `overflow-y:auto`；代码检索确认无 `后续可做`、`mini-group-more`、`slice(0, 5)` 残留；`npm run package:mac` 通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：不再隐藏多余分组，而是在固定高度区域内完整展示可滚动列表；这是来源抽屉内部的信息分层，不引入新的展开全部按钮。
  - 不满意分类与证据：`ui_interaction`、`implementation_defect`；证据为用户指出临时文案不应出现在正式交互中，且应使用样式区分与区域内滚动。
  - 升级信号：同属 UI 信息密度/临时占位泄露问题；已连续出现，后续若再发生应进入 `project-skill-upgrade-advisor` 形成前端交付检查规则。
  - 剩余风险：演示数据只有 5 个分组，滚动行为通过 DOM 样式验证；真实 10+ 分组需要用户用实际站点确认手感。
  - 下一步：用户打开新版桌面 app，用真实来源分组数量确认滚动区域是否合适。

- [2026-07-17] 验收反馈修复：来源钱包状态信号去重
  - 确认版本：`UI-density v4` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：来源钱包列表中已移除重复的状态文字/图标列，保留左侧健康状态圆点作为唯一行级状态信号；同时移除上一版新增的“展开中”小标识，避免过度设计。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`、`.specify/memory/skill-upgrade-backlog.md`、Project Profile。
  - 验证：`npm run verify` 通过，4 个测试文件、25 个测试通过；本地浏览器预览确认来源行仅 3 个子元素（状态点、站点信息、余额），无 `.status-badge`、无 `展开中` 文案；代码检索确认无 `status-badge`、`healthIcon`、`展开中` 残留；`npm run package:mac` 通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：状态表达遵循单一信号原则，来源行不再同时显示状态点和状态文字；展开态只靠背景、边框和结构表达，不加额外徽标。
  - 不满意分类与证据：`ui_interaction`；证据为用户指出绿色“正常”文字与绿色状态点重复，并明确要求“不要过度设计”。
  - 升级信号：UI 密度、临时占位、重复信号、过度设计反馈已连续出现；已记录 skill 升级候选，建议后续在前端交付检查中加入“重复状态信号/临时文案/装饰性标签”检查项。
  - 剩余风险：真实异常状态下只靠左侧状态点可能不够显眼；错误详情仍会在展开区展示具体错误文本，需用户实际异常数据验收。
  - 下一步：用户打开新版桌面 app，确认来源钱包列表是否更干净，异常状态是否仍能看懂。

- [2026-07-17] 功能推进：价格榜本地隐藏分组
  - 确认版本：`UI-filter v1` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：价格榜新增本地隐藏分组能力；每行右侧提供轻量隐藏按钮，隐藏后默认从榜单和分类计数中移除；当当前分类存在隐藏分组时，标题区显示“已隐藏 N 组”，点击后可查看灰化隐藏项并恢复显示。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，4 个测试文件、25 个测试通过；本地浏览器预览完成“隐藏一组 -> 榜单 7 行变 6 行 -> 显示隐藏项 -> 隐藏行灰化 -> 恢复 -> 回到 7 行”点击路径；`npm run package:mac` 首次因 GitHub 连接超时失败，重试通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：隐藏偏好暂存在 renderer `localStorage`，不写远程、不改站点安全配置；隐藏粒度为 `stationId + groupId`，即隐藏某站点某分组下的全部模型行。
  - 不满意分类与证据：无新增不满意；这是响应用户此前“价格榜列表是否能支持某些分组不显示”的规划推进。
  - 剩余风险：当前隐藏偏好是本机本窗口本地偏好，尚未做主进程配置迁移；真实大量分组下的操作密度仍需用户验收。
  - 下一步：用户在真实站点价格榜隐藏几个作废分组，确认隐藏/显示/恢复是否顺手。

- [2026-07-17] 功能推进：近期分组变化消息列表
  - 确认版本：`change-log v1` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：新增当前会话内的分组变化检测与轻量消息列表；每次收到新快照时对比上一版快照，识别分组新增、删除、倍率升高（变贵）和倍率降低（变便宜）。顶部工具条新增紧凑“变化 N”入口，点开显示近期变化面板，最多保留 40 条，可清空。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、27 个测试通过；新增单测覆盖新增/删除/变贵/变便宜、忽略首次出现站点和微小倍率抖动；本地浏览器预览确认默认仅显示“变化 0”，点击后才显示空态面板；`npm run package:mac` 通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：第一版只做 renderer 当前会话内消息，不写持久历史、不发系统通知、不改主进程存储；倍率变化阈值为 `0.0005`，避免浮点/微小抖动制造噪音。
  - 不满意分类与证据：无新增不满意；这是响应用户此前“近期分组变化、消息列表、价格变高/变低图例”的规划推进。
  - 剩余风险：真实站点需要发生至少一次同步后的分组变化才能看到非空消息；删除站点或首次接入站点不会制造大量历史事件。
  - 下一步：用户用真实站点等待一次分组或倍率变化，确认消息列表的事件粒度和文案是否符合采购判断。

- [2026-07-17] 功能推进：聚合账号切组候选按最终倍率排序
  - 确认版本：`station-admin v1` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：管理员切换分组确认弹窗里的目标分组选项现在按“最终倍率 = 分组倍率 ÷ 当前站点充值比例”从低到高排序；选项展示分组名、最终倍率、原倍率和平台，帮助在我的站点视图里快速挑更便宜的目标分组。
  - 影响文件：`src/renderer/src/App.tsx`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、28 个测试通过；新增单测覆盖切组候选按最终倍率排序；本地浏览器预览点击聚合账号“切换”确认弹窗，确认选项顺序为最终倍率从低到高并显示最终/倍率/平台；`npm run package:mac` 首次在沙箱内 `sips` 转图失败，外部权限重试通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：本轮只增强远程写入前的选择信息，不改变“确认后才提交远程写入”的安全边界；原生 select 文本较长会被系统控件截断，后续如需要可升级为自定义卡片选择器。
  - 不满意分类与证据：无新增不满意；这是响应用户此前“我的站点核心是快速调整分组使用，并尽量利用查价视图”的规划推进。
  - 剩余风险：真实站点分组很多时，原生下拉的可读性有限；多选/多分组账号仍保持现有单选切组路径。
  - 下一步：用户在真实聚合账号上打开切组弹窗，确认排序和文案是否足够辅助决策。

- [2026-07-17] 功能推进：聚合账号切组卡片选择器
  - 确认版本：`station-admin v2` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：将管理员切换分组确认弹窗里的原生 select 升级为卡片式候选列表；每张卡展示分组名、平台、最终倍率和原倍率，按最终倍率从低到高排列，当前绑定分组显示“当前绑定”。分组多时列表在弹窗内滚动。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、28 个测试通过；本地浏览器预览点击聚合账号“切换”确认弹窗，确认无原生 select、5 张候选卡按最终倍率从低到高排列、点击候选后确认按钮可用；未点击“确认切换”，未触发远程写入；`npm run package:mac` 通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：保留远程写入确认边界，仅改选择控件；卡片列表不新增额外装饰标签，避免重复 UI 密度问题。
  - 不满意分类与证据：无新增不满意；这是补齐上一轮记录的“原生 select 文本长会被截断”的剩余风险。
  - 剩余风险：真实站点如果支持一个账号绑定多个分组，当前 UI 仍是单选路径；多选切组需要单独确认远程写入语义后再做。
  - 下一步：用户在真实聚合账号打开切组弹窗，确认卡片式候选是否比下拉更适合快速切组。

- [2026-07-17] 功能推进：近期分组变化持久化
  - 确认版本：`change-log v2` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：近期分组变化消息从“当前会话内”升级为本机持久化最近 40 条；启动时从 renderer `localStorage` 恢复，清空按钮会同步清空本机记录。只保存站点名、分组名、平台、倍率变化和时间，不保存 token、cookie、接口响应或远程配置。
  - 影响文件：`src/renderer/src/App.tsx`、`tests/group-change-log.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、30 个测试通过；新增单测覆盖持久化事件清洗、丢弃非法旧数据、最多保留 40 条；本地浏览器插件受只读页面作用域限制，无法直接注入 `localStorage` 做刷新恢复可视化验证；`npm run package:mac` 本轮在 packager 尾段长时间无输出后中断，但生成的 `release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 存在，且 `codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：继续使用 renderer 本地 UI 存储，不迁移到主进程安全配置，避免把非关键 UI 历史和凭证配置混在一起；读取时做字段白名单清洗，旧/脏数据不进入界面。
  - 不满意分类与证据：无新增不满意；这是补齐上一轮“变化消息只在当前会话内”的剩余能力。
  - 剩余风险：持久化仍是本机本用户偏好，不跨设备同步；可视化刷新恢复路径因工具限制未完成点击证明，但核心清洗与构建已自动验证。
  - 下一步：用户重启桌面 app 后确认历史变化条数是否保留；若需要跨重启更强的可靠性，可再迁移到主进程配置文件。

- [2026-07-17] 功能推进：来源分组行内变化徽标
  - 确认版本：`change-log visual tags v1` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：来源钱包展开后的当前分组行现在会显示最近一次非删除变化徽标：`新增`、`变贵`、`变便宜`；删除事件仍只留在变化消息列表，不在当前已不存在的分组行里显示，避免制造假行或额外面板。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、31 个测试通过；新增单测覆盖最新非删除事件选择、忽略删除事件和其它站点；本地浏览器预览确认来源钱包展开区 5 行、行高 44px、无横向溢出，并截图检查列表仍保持紧凑。`npm run package:mac` 本轮两次在 `node scripts/package-mac.mjs`/packager 阶段长时间无输出且未更新 `app.asar` 后中断；旧 `release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 的 `codesign --verify --deep --strict` 通过，但未证明最新改动已重新封包进 release app。
  - 关键决策：只做行内小徽标，不增加新面板、不扩大顶部工具条；绿色表达新增/变便宜，橙色表达变贵，符合用户“快速区分但不要过度设计”的反馈。
  - 不满意分类与证据：无新增不满意；这是响应用户此前“价格变低或者变高要用两个图例展示在分组那边，方便快速区分”的规划推进。
  - 剩余风险：demo 数据不会产生真实变化事件，因此可见验证覆盖布局，徽标出现条件由单测覆盖；最新 `.app` 重新封包在当前环境未完成，用户如要直接试桌面包需先解决 packager 卡住问题或使用开发/预览构建。
  - 下一步：优先检修 `scripts/package-mac.mjs` 卡在 packager 的原因，确保最新源码稳定产出桌面 app；随后用户用真实站点等待一次分组变化，确认行内徽标是否足够醒目。

- [2026-07-17] 交付修复：macOS 打包卡住与最新包验证
  - 确认版本：`package-mac reliability v1` standard lane；验收状态 awaiting_user_acceptance。
  - 结论：修复 `npm run package:mac` 在 packager 阶段长时间无输出/未更新 `app.asar` 的问题。打包脚本现在先创建最小 staging app，只复制 `out/` 和最小 `package.json`；再从本地 `node_modules/electron/dist/Electron.app` 生成临时 Electron zip，并通过 `electronZipDir` 禁止 packager 访问 GitHub；同时新增阶段日志（electron zip、copy、asar、complete、codesign）。
  - 影响文件：`scripts/package-mac.mjs`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run package:mac` 最终通过，完整封包和 ad-hoc `codesign` 完成；`npm run verify` 通过，5 个测试文件、31 个测试通过；最终再次运行 `npm run package:mac` 通过。`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内部检查确认桌面包包含 `group-change-badge`、`latestVisibleGroupChangeFor`、`mini-group-meta`；`Info.plist` 确认 `CFBundleExecutable=AIZZZWatch`、`CFBundleIdentifier=com.aizzzwatch.desktop`、版本 `0.1.0`。
  - 关键决策：不自研完整 app bundle 组装，继续复用 `@electron/packager` 处理 macOS Helper/Info.plist/asar；只把输入目录缩小并改用本地 Electron zip，降低扫描 devDependencies 和网络超时风险。
  - 不满意分类与证据：`verification_gap` / `process_overhead`；证据为上一轮最新 `.app` 未能证明已重新封包，且 packager 静默卡住影响交付信心。
  - 剩余风险：打包阶段仍会临时压缩本地 Electron.app，约 10–22 秒；packager 仍输出一条非阻塞 icon 扩展警告。检测到已有 `/release/AIZZZWatch.app` 实例正在运行（PID 45453，启动于 20:22），本轮未启动/终止任何 AIZZZWatch 进程；用户需要重启该 app 才能加载新 asar。
  - 下一步：用户退出当前 AIZZZWatch 后重新打开 release app，确认行内变化徽标和来源钱包 UI 是否可见；如果希望更快打包，可后续把 Electron zip 缓存到 `release/.cache` 或系统缓存。

- [2026-07-17] 交付修复：清理 macOS 打包 icon 警告
  - 确认版本：`package-mac reliability v1.1` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：`@electron/packager` 新版会尝试查找 macOS 26 Icon Composer 的 `.icon` 文件，当前项目只提供 `.icns`，因此此前会输出一条非阻塞 warning。打包脚本已设置 `quiet: true` 压掉 packager 自带 warning，同时保留自定义 `[package:mac]` 阶段日志，避免再次变成“静默卡住”。
  - 影响文件：`scripts/package-mac.mjs`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run package:mac` 通过且无 icon warning；输出包含 electron zip、copy、asar、after complete、codesign 阶段日志；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认仍包含 `group-change-badge`、`latestVisibleGroupChangeFor`、`mini-group-meta`；`Info.plist` 基础字段正常。
  - 关键决策：不伪造 `.icon` 文件，也不引入 Xcode 26 Icon Composer 依赖；项目当前继续使用已有 `.icns`，只清理非阻塞日志噪音。
  - 剩余风险：若将来要适配 macOS 26 新图标资产，可单独补正式 `.icon` 文件；当前功能和签名不受影响。
  - 下一步：用户重启 release app 试用最新桌面包。

- [2026-07-17] 功能推进：偏好持久化 v1
  - 确认版本：用户确认执行 `偏好持久化 v1`；验收状态 awaiting_user_acceptance。
  - 结论：价格榜隐藏分组和近期分组变化记录从 renderer `localStorage` 迁移到主进程本机偏好文件 `ui-preferences.json`。主进程新增 preferences IPC，preload 暴露脱敏接口，renderer 启动时优先读取主进程偏好；如果主进程偏好为空，会自动导入旧 localStorage 记录一次。浏览器预览继续用页面 localStorage 模拟同一套接口，不执行真实远程行为。
  - 影响文件：`src/shared/types.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、31 个测试通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含 `ui-preferences.json`、preferences IPC 和 renderer 迁移逻辑；`Info.plist` 基础字段正常。
  - 关键决策：偏好文件只保存 UI 偏好和变化摘要，不保存 token、cookie、接口响应原文或远程配置；变化记录继续限制最近 40 条；隐藏分组 key 做字符串白名单与去重。
  - 安全结论：未新增远程请求、未新增管理员写入、未扩大 renderer 对凭据的访问；主进程偏好写入使用 app `userData`，文件权限按 `0o600` 设置。
  - 剩余风险：未在真实桌面 UI 中点击“隐藏/恢复/清空”后直接打开 `ui-preferences.json` 做可见文件复核；该路径已由 IPC 契约、构建、包内检查和既有 UI 流程间接覆盖。旧 localStorage 迁移只在主进程偏好为空时执行，避免覆盖已存在的新偏好。
  - 下一步：用户重启新版 app 后隐藏一个价格榜分组、清空/等待一次变化记录，再重启确认偏好仍保留。

- [2026-07-17] 功能推进：删除/作废分组本地清理 v3-4.1
  - 确认版本：延续 `v3-4 近期分组变化`；验收状态 awaiting_user_acceptance。
  - 结论：近期分组变化列表里的“删除”事件现在提供本地“清理”按钮；点击后会移除该站点/分组的隐藏偏好 key，并清掉同一站点/分组的历史变化记录，避免作废分组长期占用本机偏好和消息列表。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、32 个测试通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含 `clearGroupLocalReferences`、`change-cleanup-button` 逻辑和样式。
  - 关键决策：清理仅作用于本机 UI 偏好和变化摘要，不删除站点配置、不调用远程接口、不进行管理员写入；真实站点的分组删除/作废仍以同步快照检测结果为准。
  - 不满意分类与证据：无新增不满意；这是补齐用户此前“分组被删除后要出现按钮强制删除”的规划项。
  - 剩余风险：浏览器预览默认演示数据不会自然产生删除事件，因此可见路径未能从真实 UI 中点到“清理”；清理函数和按钮渲染已由单测、构建和包内检查覆盖。真实站点需要发生删除事件后才能完整手动验收。
  - 下一步：用户重启新版 app，等待真实站点出现删除/作废分组事件后，在“变化”列表点击“清理”确认历史记录和隐藏偏好被移除。

- [2026-07-17] 功能推进：我的站点快速切组筛选 v3-5.1
  - 确认版本：`station-admin v3` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：聚合账号“确认切换分组”弹窗新增候选搜索、平台筛选 chip 和候选数量显示；候选仍按“最终倍率 = 分组倍率 ÷ 当前站点充值比例”从低到高排列，便于在大量分组中快速找到目标组。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、33 个测试通过；浏览器静态预览点击路径通过：进入“我的站点” -> 打开第一个“切换”弹窗 -> 确认 5/5 候选、平台 chip、搜索 `claude` 后变为 1/5、筛选/搜索组合可显示空态和 OpenAI 候选；未点击“确认切换”，未触发远程写入。`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含搜索占位、候选计数和筛选样式。
  - 关键决策：本轮只增强确认弹窗内的查找能力，不改变账号分组更新 IPC、不支持批量/多选、不扩大远程写入范围；关闭或切换账号时清空筛选状态，避免残留筛选误导下一次操作。
  - 不满意分类与证据：无新增不满意；这是延续用户“我的站核心是快速调整分组使用，并尽量利用查价视图”的规划推进。
  - 剩余风险：真实站点如果一个账号支持多分组组合绑定，当前仍是单选目标分组；多选/批量切换需要先确认远程写入语义和回滚策略。
  - 下一步：用户重启 release app，在真实聚合账号切组弹窗里用搜索和平台 chip 验收大量分组下的选择效率。

- [2026-07-17] 功能推进：切组候选范围切换 v3-5.2
  - 确认版本：`station-admin v4` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：聚合账号切组弹窗新增“当前分类 / 全部分组”候选范围切换。默认沿用当前查价分类；当需要跨平台切组时，可切到“全部分组”查看该站点全部可用分组，并继续沿用搜索、平台筛选和最终倍率排序。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、34 个测试通过；浏览器静态预览点击路径通过：先切到 Anthropic 分类 -> 进入“我的站点” -> 打开“切换”弹窗 -> 默认显示“当前分类：Anthropic”且 1/1 候选 -> 点击“全部分组”后显示 5/5 候选和全平台 chip；未点击“确认切换”，未触发远程写入。`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含候选范围逻辑、当前分类文案、全部分组文案和范围切换样式。
  - 关键决策：不改变远程提交接口、不新增持久偏好；切换候选范围时重置平台筛选为“全部”，避免旧平台 chip 导致误以为没有候选。
  - 不满意分类与证据：无新增不满意；这是继续降低“我的站点”切组时的查找摩擦。
  - 剩余风险：当前仍是单账号单目标分组切换；多分组/批量切组属于远程写入语义变化，需要独立 controlled 需求确认。
  - 下一步：用户重启 release app，在真实站点里先选某个查价分类，再打开聚合账号切组弹窗验证“当前分类 / 全部分组”切换是否符合操作直觉。

- [2026-07-18] 功能推进：切组前目标预览 v3-5.3
  - 确认版本：`station-admin v5` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：聚合账号切组弹窗新增“切组差异预览”，在提交前展示当前绑定分组、目标分组、最终倍率变化，并标记“目标更便宜 / 目标更贵 / 倍率基本持平 / 等待可比较目标”。多分组当前绑定只展示名称，不对差值做不可靠推断。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、35 个测试通过；浏览器静态预览点击路径通过：进入“我的站点” -> 打开切组弹窗 -> 切到“全部分组” -> 选择 OpenAI Fast，摘要显示 `当前 Claude Code Pro -> 目标 OpenAI Fast`，并标记“目标更便宜 0.068x -> 0.045x”；未点击“确认切换”，未触发远程写入。`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含预览逻辑、预览文案和样式。
  - 关键决策：只增强确认前信息，不改变账号分组更新 IPC、不改变确认按钮禁用规则、不新增持久配置；真实写入仍必须用户点击“确认切换”。
  - 不满意分类与证据：无新增不满意；这是继续强化远程写入前的可读确认。
  - 剩余风险：多分组/批量切组仍未实现；若未来支持多目标，需要先确认远程写入语义和回滚策略。
  - 下一步：用户重启 release app，在真实聚合账号切组弹窗里选择一个不同目标，确认差异预览是否能降低误操作。

- [2026-07-18] 功能推进：切组后刷新与结果回显 v3-5.4
  - 确认版本：`station-admin v6` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：聚合账号切组成功后，renderer 会使用主进程返回的最新 `StationSnapshot` 立即合并本地状态，并显示明确成功回显，例如 `claude-main 已切到 OpenAI Fast，已刷新站点状态`；演示模式走同一回显文案但不触发远程写入。
  - 影响文件：`src/renderer/src/App.tsx`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、36 个测试通过；浏览器静态预览点击路径通过：进入“我的站点” -> 打开切组弹窗 -> 选择 OpenAI Fast -> 点击“确认切换”，弹窗关闭且 toast 显示 `演示：claude-main 已切到 OpenAI Fast，已刷新站点状态`，没有出现“浏览器预览不执行远程写入”；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含 snapshot 合并逻辑和成功回显文案。
  - 关键决策：不改变远程写入 payload、不新增 IPC；复用主进程 `admin:update-account-groups` 已返回刷新后快照的契约。成功后同步更新 `previousSnapshotsRef`，避免后续轮询基线滞后。
  - 不满意分类与证据：无新增不满意；这是补齐切组成功后的可见状态闭环。
  - 剩余风险：真实站点若远程更新成功但随后的刷新失败，主进程当前会让整个操作报错；后续可单独拆分“写入成功但刷新失败”的部分成功提示与重试策略。
  - 下一步：用户重启 release app，在真实聚合账号上执行一次切组，确认成功 toast 和来源钱包账号绑定是否立即更新。

- [2026-07-18] 功能推进：切组后部分成功提示 v3-5.5
  - 确认版本：`station-admin v7` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：补齐“远程账号切组已提交，但后续刷新站点状态失败/返回非健康快照”的部分成功语义。主进程在切组写入成功后单独兜底刷新异常，返回保留旧数据的 `stale/error` 快照；renderer 根据返回快照健康状态区分成功与 warning，避免把刷新失败误报成“已刷新站点状态”。
  - 影响文件：`src/main/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、36 个测试通过；`npm run package:mac` 首次在沙箱内因 macOS `sips` 图标生成权限失败，提权重跑后通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含 `分组已提交，但刷新失败`、`已提交切组到`、`请手动刷新确认` 和 `.toast.warning`；浏览器静态预览点击路径通过：进入“我的站点” -> 打开切组弹窗 -> 选择 OpenAI Fast -> 点击“确认切换”，演示 toast 仍显示成功回显。
  - 关键决策：不改变远程写入 payload、不新增 IPC、不把部分成功伪装成失败重试；真实写入成功后若刷新不能确认，前端提示用户手动刷新确认，避免重复点击造成二次写入。
  - 安全结论：未新增凭据存储或日志输出；错误提示只使用分类后的刷新失败信息，不包含 token/cookie/password；管理员写入前的站点令牌、账号 ID、远程分组一致性和目标分组有效性校验保持不变。
  - 不满意分类与证据：无新增不满意；这是上一轮 v3-5.4 明确列出的剩余风险修复。
  - 剩余风险：静态浏览器预览无法真实触发远程写入后的刷新失败 warning；该分支由单测、主进程兜底审查、build、asar 文案检查覆盖。真实站点仍需在网络失败或接口异常时手动观察 warning toast 与手动刷新恢复路径。
  - 下一步：用户重启 release app，在真实聚合账号上执行一次切组；若站点刷新失败，应看到“已提交切组到目标分组，但刷新失败，请手动刷新确认”，随后点击刷新确认最终状态。

- [2026-07-18] 功能推进：分组能力彩色标签与标签筛选 v3-6.1
  - 确认版本：`group-tags v1` fast lane；验收状态 awaiting_user_acceptance。
  - 结论：价格榜新增能力标签筛选条，并在价格榜行、来源钱包展开分组、聚合账号切组候选中显示彩色能力标签。当前为自动识别标签：`生图`、`代码`、`视觉`、`向量`、`语音`、`视频`，无命中则显示 `对话`；`img/image/生图/midjourney/dall-e/stable diffusion/flux` 等关键词会归入 `生图`。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、37 个测试通过；浏览器静态预览通过：打开演示数据可见 `全部标签7 / 代码3 / 生图1 / 对话3`，点击 `生图` 后价格榜只剩 `Gemini Image 生图` 1 行，来源钱包同步只剩包含生图组的主力站，展开来源钱包可见分组行 `生图` 标签，打开切组弹窗候选只剩 `Gemini Image 生图` 且候选行带 `生图` 标签；`rg` 检查确认 build 产物 `out/renderer` 包含标签逻辑与样式。
  - 关键决策：本轮不新增远程接口字段、不持久化手动标签、不改变 Sub2API 数据模型；先用本地启发式从分组名、平台、模型名、价格提示中自动推导能力标签，避免要求用户额外维护配置。
  - 不满意分类与证据：无新增不满意；这是对用户“有的是 img 生图分组，需要彩色标签和标签筛选”的直接补齐。
  - 剩余风险：`npm run package:mac` 在沙箱内仍因 macOS `sips` 图标生成权限失败，提权审批连续两次超时，因此本轮未能证明 release `.app` 已重新封包；当前可确认源码、测试、生产 build 和可见浏览器预览均通过。自动标签依赖关键词，真实站点若用特殊命名可能需要后续增加“手动标签/自定义规则”持久化能力。
  - 下一步：用户可先用开发/预览构建验收标签筛选；如果要直接试桌面 release 包，需要重新允许 `npm run package:mac` 或手动在本机运行一次打包命令后重启 app。

- [2026-07-18] 交付验证：分组能力彩色标签 release 重新封包
  - 确认版本：延续 `group-tags v1`；验收状态 awaiting_user_acceptance。
  - 结论：用户要求继续后，重新执行 `npm run package:mac`，macOS 图标生成、Electron 封包、asar 和 ad-hoc codesign 均完成，release app 已包含分组彩色标签和标签筛选能力。
  - 影响文件：`.specify/memory/session-history.md`；业务代码沿用 v3-6.1 已完成改动。
  - 验证：`npm run package:mac` 通过；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认包内包含 `全部标签`、`inferGroupCapabilityTags`、`生图`、`midjourney`、`flux`、`.tag-filter-chip`、`.tag-filter-chip.tag-image`、`.capability-tag.tag-image`、`Gemini Image 生图`；`git diff --check` 通过。
  - 关键决策：不再追加功能改动，只补齐 release 封包证据，关闭上一条“release app 未重新封包”的验证缺口。
  - 剩余风险：仍未在真实桌面 release app 中手动点击验证；浏览器预览已经覆盖交互路径，release 包内容和签名已经验证。真实站点特殊命名仍可能需要后续手动标签/自定义规则。
  - 下一步：用户退出旧 AIZZZWatch 进程后打开 `/Users/bing/Myself/Code/MacTools/AIZZZWatch/release/AIZZZWatch-darwin-arm64/AIZZZWatch.app`，在价格榜点击 `生图` 标签验收。

- [2026-07-18] 功能推进：手动标签与隐藏分组 v3-6.2
  - 确认版本：`group-tags v2` standard lane；验收状态 awaiting_user_acceptance。
  - 结论：来源钱包展开后的分组行新增标签菜单按钮，并支持右键打开同一菜单。用户可以给分组手动增删能力标签、恢复自动标签、隐藏分组、恢复显示；手动标签和隐藏状态写入本机 `ui-preferences.json`。隐藏分组会从价格榜、来源分组列表和切组候选中排除；点击顶部“已隐藏 N 组”后可临时显示并恢复。
  - 影响文件：`src/shared/types.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、38 个测试通过；浏览器静态预览通过：来源钱包打开分组菜单 -> 给 `Claude Code Pro` 手动添加 `生图` 标签 -> `生图` 筛选从 1 变 2 且价格榜/来源分组同步出现 Claude -> 点击“隐藏分组”后 Claude 从价格榜和来源分组消失，切组候选也排除隐藏组 -> 点击“已隐藏 1 组”显示隐藏项 -> 菜单“恢复显示”后回到可见 -> “恢复自动标签”后 Claude 从 `生图` 筛选消失；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认包内包含 `manualGroupTags`、`恢复自动标签`、`隐藏分组`、`.group-row-menu`、`.manual-tag-badge`、`.group-menu-button` 和 `preferences:set-manual-group-tags`；`git diff --check` 通过。
  - 关键决策：隐藏分组只是本机 UI 偏好，不删除远程分组、不调用管理员接口、不改变 Sub2API 数据模型；手动标签覆盖自动识别，用户可随时恢复自动标签。
  - 安全结论：本轮仅保存分组 key 和标签 ID，不保存 token、cookie、密码、接口响应原文或远程配置；主进程对标签 ID 做白名单过滤。
  - 不满意分类与证据：无新增不满意；这是对用户“来源分组标签如何设置、无效分组如何不展示”的直接补齐。
  - 剩余风险：真实桌面 release app 尚需用户亲自试用；右键菜单在很短的滚动容器底部可能需要滚动到可视位置使用，后续如有需要可升级为 portal 浮层。
  - 下一步：用户重启 release app，在真实站点来源钱包展开分组，尝试标签菜单、右键菜单、隐藏/恢复和恢复自动标签。

- [2026-07-18] 自检修正：分组菜单与隐藏入口体验 v3-6.2a
  - 确认版本：`group-tags v2` 自检微调；验收状态 awaiting_user_acceptance。
  - 结论：分组标签菜单新增点外部关闭和 Escape 关闭；隐藏/恢复分组、恢复自动标签后会关闭菜单并显示 toast；顶部隐藏入口改为按当前已知分组全局去重计数，当前筛选无隐藏项时点击会切到“全部 / 全部标签”方便找回；价格榜文案从“有效成本”统一调整为“折算成本”，并补充公式说明。
  - 影响文件：`src/renderer/src/App.tsx`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、39 个测试通过；浏览器静态预览通过：页面无“有效成本”残留且显示“折算成本”，打开分组菜单后 Escape 可关闭，重新打开后点击价格榜区域可点外关闭，隐藏 `Claude Code Pro` 后价格榜从 7 条变 6 条、toast 显示“已隐藏 Claude Code Pro”、顶部出现“已隐藏 1 组”，点击后隐藏行显示且按钮变为“收起隐藏”，恢复后列表回到 7 条且入口消失；手动加 `生图` 标签后出现“手动”，点击“恢复自动标签”后菜单关闭、手动标记消失、toast 显示“已恢复自动标签”；浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含“折算成本”、“收起隐藏”、“恢复自动标签”和分组菜单样式。
  - 关键决策：本轮只修 UI 交互闭环和文案清晰度，不改远程接口、不改授权/凭据持久化、不新增余额阈值、不实现倍率历史或我的站管理策略；隐藏仍是本机 UI 偏好，不删除远程分组。
  - 不满意分类与证据：`ui_interaction` 与 `communication_gap` 的预防性修正；依据是用户连续强调“不要过度设计、要直观、自己检查流程和功能”，本轮补齐菜单可关闭性、操作反馈和隐藏入口可发现性。
  - 剩余风险：浏览器预览覆盖了静态交互；真实桌面 release app 的鼠标右键菜单位置、滚动容器边缘体验仍需用户实机验收。余额不足提醒、倍率变化历史、我的站快速管理仍是后续独立事项。
  - 下一步：继续推进 v3-6.3 余额不足提醒与余额颜色规则，随后再拆 v3-6.4 倍率变化历史/浮层和 v3-7 我的站管理视图设计。

- [2026-07-18] 功能推进：来源钱包余额不足提醒 v3-6.3
  - 确认版本：`source-wallet-alerts v1` standard lane；验收状态 awaiting_user_acceptance。
  - 结论：站点配置新增“余额提醒阈值”，默认 10，填 0 关闭提醒。来源钱包按站点自己的余额单位判断 `余额 <= 阈值`，不足时卡片背景弱红、余额文字变红并显示“余额不足”；展开详情后显示“余额低于提醒阈值 X，建议充值。”。
  - 影响文件：`src/shared/types.ts`、`src/main/storage.ts`、`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`tests/sub2api.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、41 个测试通过；浏览器静态预览通过：备用线路余额 `$42.10` 且阈值 `$50.00` 时来源钱包显示“余额不足”、低余额卡片数量为 1，展开后出现“余额低于提醒阈值 $50.00，建议充值。”且详情余额变红；编辑备用线路弹窗显示“余额提醒阈值”，字段值为 `50`，提示文案包含“填 0 关闭提醒”；浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含余额提醒文案、低余额样式和主进程存储字段。
  - 关键决策：余额不足提醒使用站点余额原单位，不使用充值比例折算；充值比例只用于价格/倍率比较。阈值是本地站点配置数字，不保存额外凭据、不触发远程写入、不改变轮询接口。
  - 安全结论：本轮只新增非敏感数字配置；未记录 token、cookie、密码或接口响应原文；存储仍走既有 `stations.json` 权限与凭据加密边界。
  - 不满意分类与证据：无新增不满意；这是对用户“来源钱包里面站点余额不足就提醒并且余额颜色变红”的直接补齐，同时控制重复状态文字，符合用户“不要过度设计”的偏好。
  - 剩余风险：不同站点余额单位/充值口径可能不一致，阈值需要用户按站点自行设置；当前只做页面内提醒，尚未做系统通知、菜单栏红点或余额变动消息。
  - 下一步：推进 v3-6.4 倍率变化历史与最近变化浮层/消息列表；后续如用户需要，再扩展余额不足的系统通知和提醒阈值批量管理。

- [2026-07-18] 功能推进：倍率变化视觉提示 v3-6.4
  - 确认版本：`group-change-visuals v1` standard lane；验收状态 awaiting_user_acceptance。
  - 结论：来源钱包展开分组的倍率值现在会根据最近变化显示箭头和颜色：降价/新增为绿色，涨价为红色；变化徽标和倍率值都带 hover 说明，展示“上次倍率 → 当前倍率”和变化时间。演示模式默认提供一条 `Claude Code Pro` 变便宜记录，方便预览理解；点击“清空”后演示变化也会隐藏，不写入真实偏好。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、42 个测试通过；浏览器静态预览通过：顶部显示“变化 1”，来源分组出现“变便宜”徽标，倍率显示 `↓0.680x`，hover title 为 `变便宜：0.800x → 0.680x · 时间`；打开“近期分组变化”列表可见同一条变化，点击“清空”后顶部变为“变化 0”、徽标和降价箭头消失、空态显示“等待下一次同步后对比分组变化。”；浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含演示变化、tooltip 文案、涨跌箭头和倍率颜色样式。
  - 关键决策：复用现有 `GroupChangeEvent`，不新增存储结构、不改变同步轮询、不做复杂详情页；先把用户最需要的涨跌视觉语义放到来源分组行和最近变化列表。
  - 不满意分类与证据：无新增不满意；这是对用户“倍率发生变化要记录、降绿色、涨红色、有箭头、hover 看历史变化”的第一阶段补齐。
  - 剩余风险：当前 hover 只展示最近一次可见变化，不是完整历史曲线；完整 per-group 历史明细、消息列表过滤、删除事件强制清理仍需要后续 v3-6.5/v3-6.6 拆开做。
  - 下一步：继续设计/实现更完整的分组变化历史详情和消息列表筛选，之后进入 v3-7 “我的站”快速管理视图。

- [2026-07-18] 功能推进：分组变化筛选与历史详情 v3-6.5
  - 确认版本：`group-change-history v1` standard lane；验收状态 awaiting_user_acceptance。
  - 结论：近期分组变化面板新增类型筛选 chip：全部、降价、涨价、新增、删除，并显示各自数量。变化列表整行可点击，来源分组里的变化徽标和倍率数字也可点击；点击后打开嵌入式“分组变化详情”，展示该分组当前倍率和该分组的历史变化时间线。演示模式新增降价、涨价、新增三类示例，便于直接预览。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、43 个测试通过；浏览器静态预览通过：顶部显示“变化 3”，来源分组显示 `↓0.680x`、`↑0.450x`、`+0.230x`；打开变化面板后可见 `全部3 / 降价1 / 涨价1 / 新增1 / 删除0`，点击“涨价”后列表只剩 `OpenAI Fast`；点击变化记录打开详情，显示 `OpenAI Fast`、当前倍率 `0.450x` 和历史事件；点击来源分组“变便宜”徽标打开 `Claude Code Pro` 详情，点击 `↑0.450x` 打开 `OpenAI Fast` 详情；关闭详情和清空变化均正常，浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含筛选、详情、演示事件和样式。
  - 关键决策：复用现有 `GroupChangeEvent` 和最多 40 条本地变化记录，不新增存储 schema、不改变轮询、不触发远程接口；详情先做嵌入式卡片而不是大弹窗，避免浪费可视区。
  - 不满意分类与证据：无新增不满意；这是继续补齐用户“消息列表、点击看到详细变化、变化历史”的体验诉求。
  - 剩余风险：当前历史详情受 `groupChangeEvents` 保留上限 40 条限制，不是长期归档；删除分组的详情会显示“当前不可见”，后续可继续做删除事件强制清理、按站点/分组搜索和更长历史归档。
  - 下一步：继续 v3-6.6 删除分组清理与消息列表搜索/站点筛选，或进入 v3-7 “我的站”快速管理视图设计。

- [2026-07-18] 功能推进：变化消息搜索与删除清理 v3-6.6
  - 确认版本：`group-change-history v2` standard lane；验收状态 awaiting_user_acceptance。
  - 结论：近期变化面板新增搜索框，可按站点名、分组名、平台和变化类型文案过滤消息；类型筛选数量会跟随搜索结果变化。删除分组的历史详情现在明确显示“当前列表里已不可见”，并在详情内提供“清理本地记录”按钮；清理后对应变化记录和详情会从当前 UI 隐藏，真实本地变化记录也会移除。演示模式新增一条删除分组样例，方便验证清理路径。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、43 个测试通过；浏览器静态预览通过：打开变化面板显示 `全部4 / 降价1 / 涨价1 / 新增1 / 删除1` 和搜索框；搜索 `备用` 后只剩删除记录，筛选计数变为 `全部1 / 删除1`；点击删除记录打开详情，显示 `废弃 Claude 旧组`、`当前不可见`、当前不可见原因说明和“清理本地记录”；点击详情内清理后，顶部变为“变化 3”、详情关闭、当前搜索下为空态、toast 显示“已清理 废弃 Claude 旧组 的本地记录”；搜索 `openai` 后只剩 `OpenAI Fast` 涨价记录，搜索不存在内容后出现“当前筛选下暂无变化。”；浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含搜索框、删除样例、当前不可见提示、清理按钮和对应样式。
  - 关键决策：搜索与清理继续复用现有 `GroupChangeEvent`；不新增持久 schema、不改变最多 40 条记录策略、不调用远程删除或管理员接口。演示事件的单条清理仅在当前 UI 中按 event id 隐藏，避免演示数据重新出现造成误导。
  - 不满意分类与证据：无新增不满意；这是对用户“删除分组强制清理、消息列表、详细变化”的继续补齐。
  - 剩余风险：仍不是长期历史数据库；搜索仅覆盖事件现有字段，不支持复杂组合查询或导出。真实站点删除事件清理后不可恢复，后续如需要可增加确认/撤销。
  - 下一步：进入 v3-7 “我的站”快速管理视图设计与实现，复用查价、标签、历史和切组能力。

- [2026-07-18] 功能推进：我的站点快速管理视图 v3-7.1
  - 确认版本：`my-station-workbench v1` standard lane；验收状态 accepted（用户回复“好的”）。
  - 结论：顶部“我的站点”视角现在会显示独立账号管理工作台，不再只把聚合账号藏在来源钱包展开区。工作台按站点展示管理员账号、当前绑定分组、当前最终倍率、推荐候选分组和操作按钮；“用推荐”会预选推荐目标并打开既有远程切组确认弹窗，“切换分组”仍走原有确认流程。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、44 个测试通过；浏览器静态预览通过：切到“我的站点”后可见 1 个可管理站点、2 个账号、当前最终倍率和“推荐更低”候选；点击第一行“用推荐”打开“确认切换分组”弹窗，默认范围为“全部分组”，预选 `Gemini Image 生图`，预览 `0.068x → 0.023x`，确认按钮可用；演示确认后弹窗关闭并显示成功 toast；浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含“我的站点账号”、“推荐更低”、“当前最终倍率”、“全部分组”和工作台样式。
  - 关键决策：本轮只做 UI 工作台和本地推荐逻辑，复用既有管理员账号读取、分组候选、最终倍率换算和远程确认弹窗；不新增远程接口、不新增凭据字段、不绕过确认写入。推荐候选按“分组倍率 ÷ 充值比例”的最终倍率从低到高选择，并排除当前绑定分组、本地隐藏分组和当前标签不匹配分组；管理视角下来源钱包显示全部来源，避免账号管理时被价格分类过滤掉。
  - 安全结论：真实远程写入仍只发生在用户点击确认弹窗的“确认切换”之后；演示模式确认不触发远程接口。未记录 token、cookie、密码或响应原文。
  - 不满意分类与证据：无新增不满意；这是对用户“我们的站如何放进来、通过这个应用快速管理和快速操作、尽量利用查价视图”的第一阶段落地。
  - 剩余风险：当前推荐只选站点内最低候选，不支持批量切组、跨站复制策略、账号搜索、操作历史或回滚；真实站点的管理员账号接口差异仍取决于已配置的 Sub2API/二开站接口兼容性。
  - 下一步：用户实机验收“我的站点”工作台；后续可推进 v3-7.2：按分类/标签批量推荐、账号搜索、批量确认队列、变更前后对比和我的聚合站策略模板。

- [2026-07-18] 功能推进：我的站点账号搜索与批量推荐队列 v3-7.2
  - 确认版本：`my-station-workbench v2` standard lane，用户对 v3-7.2 建议回复“好”；验收状态 accepted（用户回复“好的”）。
  - 结论：我的站点工作台新增账号搜索框，支持按账号、绑定分组、站点、平台和推荐分组过滤；顶部显示当前命中账号数/总账号数。新增“批量推荐 N”按钮，会把当前筛选下存在“更低推荐”的账号加入本地确认队列；队列仍复用原有单账号远程确认弹窗，用户每确认一个账号才会提交一次，确认后自动弹出下一个账号。取消按钮在队列中显示为“取消队列”，会清空剩余队列。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、45 个测试通过；浏览器静态预览通过：切到“我的站点”可见搜索框、`批量推荐 2`、`2/2 个账号`；搜索 `openai` 后账号行变为 1、按钮变为 `批量推荐 1`；点击筛选后的批量推荐打开确认弹窗，范围为“全部分组”、默认选中推荐分组且确认按钮可用；清空搜索后恢复 `批量推荐 2`，点击后弹窗显示“剩余 1 个账号”和“取消队列”；演示确认第一项后自动弹出第二个账号；取消第二项后弹窗关闭；浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含搜索、批量推荐、队列提示、取消队列和对应样式。
  - 关键决策：本轮不新增真实批量远程写入接口、不自动连续提交、不改变管理员 IPC；批量只是本地队列和逐个确认体验。队列只收 `cheaperThanCurrent=true` 的推荐，避免把已处于最低候选的账号加入待切换列表。
  - 安全结论：真实远程写入仍由用户逐个点击“确认切换”触发；取消队列会清掉剩余待确认项。未记录 token、cookie、密码或接口响应原文。
  - 不满意分类与证据：无新增不满意；延续用户希望“快速管理和快速操作”的诉求，同时保留远程写入确认安全边界。
  - 剩余风险：当前队列不持久化，刷新页面或关闭应用会丢失；未做批量执行结果汇总、失败重试列表、跨站策略模板或回滚。真实站点中多个账号连续确认时，每个账号仍依赖对应站点管理员接口可用性。
  - 下一步：用户实机验收；后续可做 v3-7.3：批量执行结果面板、失败重试/跳过、策略模板、跨站候选对齐。

- [2026-07-18] 功能推进：我的站点批量结果与策略模板 v3-7.3
  - 确认版本：`my-station-workbench v3` standard lane，用户持续回复“继续/好的”授权推进；验收状态 awaiting_user_acceptance。
  - 结论：我的站点工作台新增推荐策略下拉，支持“当前分类优先”和“全站最低”；策略会保存到 renderer 本地偏好，下次刷新后仍保持。批量推荐队列新增执行结果面板，记录成功、失败、跳过数量和最近 20 条结果；确认失败时弹窗保留当前账号，展示错误并把主按钮改为“重试切换”；队列执行中或失败后可“跳过当前”，最后一项也可跳过并关闭弹窗。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、`specs/sub2api-monitor/delivery-summary.md`、Project Profile。
  - 验证：`npm run verify` 通过，5 个测试文件、47 个测试通过；浏览器可见预览通过：切到“我的站点”后策略默认/切换可见，选择“全站最低”后推荐文案变为“全站最低 · 最终 0.023x”，刷新页面后策略仍保持；点击“批量推荐 2”后弹出逐个确认队列，确认第一项后结果面板显示“成功 1 / 失败 0 / 跳过 0”并自动进入第二项，第二项“跳过当前”后弹窗关闭，面板显示“成功 1 / 失败 0 / 跳过 1”，浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含策略模板、策略本地保存 key、批量结果、跳过、重试和结果/错误样式。
  - 关键决策：仍不新增真实批量远程写入接口、不自动连续提交、不新增管理员 IPC、不绕过确认弹窗；批量队列仍是本地临时队列，远程写入依旧由用户逐个点击“确认切换”触发。策略偏好采用 renderer 本地保存，避免突破本轮“不新增 IPC”的范围。
  - 安全结论：未保存 token、cookie、密码或接口响应原文；失败消息只显示本次远程切组错误文本；真实站点写入仍受原有账号切组确认与主进程管理员接口约束。
  - 不满意分类与证据：无新增不满意；本轮主动修正策略不持久的问题，回应用户之前“偏好持久化”和“自己检查流程”的偏好。
  - 剩余风险：结果面板记录的是最近执行尝试，不是长期审计日志；失败后重试成功会保留之前失败记录，便于追踪尝试但不代表最终态汇总。真实站点连续切组仍取决于站点管理员接口稳定性。
  - 下一步：等待用户实机验收 v3-7.3；后续可继续 v3-7.4：跨站策略模板/候选对齐、批量变更预览导出、或真实“我的聚合站”专属管理接口设计。

- [2026-07-18] 体验修正：来源钱包隐藏分组语义 v3-7.3a
  - 确认版本：fast lane 用户截图反馈；验收状态 awaiting_user_acceptance。
  - 结论：来源钱包分组行左侧新增小眼睛按钮，睁眼表示纳入价格榜，闭眼表示只从价格榜隐藏；隐藏后来源钱包分组行仍保留显示，不再被整行过滤掉。标签菜单移除重复的“隐藏分组/恢复显示”动作，避免把标签设置和价格榜显隐混在一起。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、47 个测试通过；浏览器可见预览通过：清理预览本地状态后，来源钱包每个分组左侧显示“从价格榜隐藏”按钮；点击 `主力中转站 / Claude Code Pro` 后，价格榜从 7 条变 6 条且不再显示该主力站 Claude 行，来源钱包仍显示 `Claude Code Pro`，左侧按钮变为“恢复到价格榜显示”，浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含新的眼睛按钮文案和样式，且标签菜单不再包含旧显隐动作。
  - 关键决策：隐藏分组的业务含义明确为“从全部/价格榜排除”，不是删除远程分组，也不是从来源钱包分组清单删除；来源钱包继续作为站点原始分组观察入口。
  - 不满意分类与证据：`implementation_defect` + `ui_interaction`；用户截图并明确指出“不是让你把整个都隐藏”，说明此前隐藏语义实现过宽且入口位置不够直观。
  - 剩余风险：隐藏状态仍是本机 UI 偏好，不是远程配置；真实站点数据较多时，小眼睛按钮的点击热区需要用户实机确认手感。
  - 下一步：用户实机验收；若手感还不够直观，可继续调整小眼睛颜色、hover 提示或在顶部隐藏 chip 增加解释。

- [2026-07-18] 功能推进：来源钱包我的站点 tab v3-7.3b
  - 确认版本：fast lane 用户直接追加；验收状态 awaiting_user_acceptance。
  - 结论：来源钱包标题下新增 tabs：`全部来源` 和 `我的站点`；切到“我的站点”后只显示当前用户可管理员管理的站点。管理员站点判断口径与“我的站点账号”工作台对齐：站点有管理员凭据，或同步快照中已有账号列表。切换到“我的站点”时如果当前选中的来源不是管理员站，会自动选中第一个管理员站，避免右侧无展开详情。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、48 个测试通过；浏览器可见预览通过：来源钱包显示 `全部来源 2 / 我的站点 1`，点击“我的站点”后只剩 `主力中转站`，`备用线路` 不再显示，展开详情仍显示 `聚合账号 / claude-main`，浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含来源钱包 tabs、管理员判断和样式。
  - 关键决策：本轮只做来源钱包 UI 过滤，不新增后端接口、不改变管理员凭据存储、不触发远程写入；“我的站点”只表示本地配置/快照可判定为管理员管理的来源。
  - 不满意分类与证据：无新增不满意；这是对用户“来源钱包那里增加一个 tabs，我的站点”的直接补齐。
  - 剩余风险：如果真实站点管理员凭据失效但本地仍标记有管理员 token，该站点仍会进入“我的站点”，后续刷新/账号区会通过已有授权错误提示暴露问题。
  - 下一步：用户实机验收；如还需要，可继续把该 tab 状态做成本地偏好持久化。

- [2026-07-18] 体验修正：近期分组变化可收起 v3-7.3c
  - 确认版本：fast lane 用户反馈“近期分组变化没办法隐藏吗？”；验收状态 awaiting_user_acceptance。
  - 结论：顶部 `变化 N` 按钮现在只在面板打开时显示 active，并带 `aria-expanded`；再次点击可收起。近期分组变化面板右上角新增 `X` 关闭按钮，关闭只收起面板，不清空变化记录；原“清空”按钮仍用于删除/隐藏变化记录。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、48 个测试通过；浏览器可见预览通过：点击 `变化 4` 后面板打开、`aria-expanded=true` 且出现“收起近期分组变化”按钮；点击 X 后面板消失、`aria-expanded=false`，chip 仍显示 `变化 4`，记录未被清空，浏览器控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含关闭文案、aria-expanded 和标题动作样式。
  - 关键决策：区分“收起”和“清空”：收起只是临时隐藏面板，不改变本地变化记录；清空仍是显式删除/隐藏变化记录。
  - 不满意分类与证据：`ui_interaction`；用户反馈说明原按钮虽然可 toggle，但 active 状态和缺少关闭按钮导致可发现性不足。
  - 剩余风险：关闭状态暂未持久化；刷新页面后仍按默认关闭状态展示。
  - 下一步：用户实机验收；如需要可继续把变化面板开关状态也做成本地偏好。

- [2026-07-18] 体验修正：近期分组变化弹窗 v3-7.3d
  - 确认版本：fast lane 用户反馈“近期分组变化你换成弹窗好了！”；验收状态 awaiting_user_acceptance。
  - 结论：近期分组变化从主页面内联面板改为覆盖式弹窗；顶部 `变化 N` 只作为入口，主界面不再被变化列表挤占。弹窗内保留搜索、类型筛选、变化列表、删除分组清理、分组历史详情、清空和关闭；关闭弹窗不清空变化记录，清空仍是显式删除/隐藏变化记录。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`.specify/memory/session-history.md`。
  - 验证：`git diff --check` 通过；`npm run verify` 通过，5 个测试文件、48 个测试通过；浏览器可见预览通过：初始态主界面不存在 `section[aria-label="近期分组变化"]`，只显示 `变化 4`；点击后出现 `role="dialog"`、`aria-modal="true"`、`aria-labelledby="change-log-title"` 的弹窗，标题为“近期分组变化”，搜索、筛选、清空、关闭和 4 条变化记录均在弹窗内；点击变化记录后“分组变化详情”在弹窗内展示当前倍率和时间线；点击“关闭近期分组变化”后弹窗消失，`变化 4` 仍保留且控制台 error 为 0。`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含 `aria-modal`、`change-log-title`、`关闭近期分组变化`、`.change-log-modal`，且不再包含旧 `.change-log-panel` 样式。
  - 关键决策：本轮只调整可见呈现层，不改分组变化记录结构、不改同步轮询、不改远程接口、不新增凭据或持久化字段；复用既有 modal/backdrop 交互模式，并清理旧内联面板死样式。
  - 不满意分类与证据：`ui_interaction`；用户明确希望变化信息改为弹窗，说明页面内联区域仍然占用查价/来源钱包主视图空间。
  - 剩余风险：弹窗关闭状态仍不做持久化；真实桌面 app 的不同窗口尺寸下仍需用户实机确认滚动手感。
  - 下一步：用户启动 release app 验收近期变化弹窗；若弹窗仍嫌大，可继续压缩弹窗宽度/高度或增加 Esc 关闭与焦点管理。

- [2026-07-18] 语义修正：我的站点管理员登录口径 v3-7.3e
  - 确认版本：fast lane 用户反馈“来源钱包添加我的站点怎么跑到全部里面去了，而且我的站点是我是管理员的账号登录的”；验收状态 awaiting_user_acceptance。
  - 结论：修正“我的站点”的核心口径：站点网页登录 JWT 如果来自管理员账号，可直接用于管理员接口探测、管理员账号拉取和后续账号分组管理；专用管理员凭据仍优先使用。来源钱包 `我的站点` tab 现在从全部站点中按管理员身份显示，不再被当前查价分类过滤；在该 tab 下添加按钮显示为“添加我的站点”，设置页提示“管理员网页登录可不填”管理员凭据。
  - 影响文件：`src/main/sub2api-client.ts`、`src/main/index.ts`、`src/main/station-diagnostics.ts`、`src/renderer/src/App.tsx`、`tests/sub2api-client.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/sub2api-client.test.ts tests/ranking-sort.test.ts` 通过，2 个测试文件、31 条测试通过；`npm run verify` 通过，5 个测试文件、50 条测试通过；浏览器可见预览通过：初始来源钱包为 `全部来源 2 / 我的站点 1`，点击 `我的站点 1` 后只剩 `主力中转站`，按钮显示“添加我的站点”，账号管理信息可见；打开添加弹窗后管理员凭据 placeholder 为 `API Key 或独立管理员 token；管理员网页登录可不填`，控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含 `hasUsableAdminCredential`、`未配置管理员登录凭据`、`添加我的站点` 和 `管理员网页登录可不填`。
  - 关键决策：不再要求用户额外粘贴一份管理员 JWT；如果管理员账号网页登录拿到的 JWT 能访问管理员接口，就自动进入“我的站点”。API Key 类型仍必须填写专用管理员凭据，不会把普通登录 JWT 当作 API Key。普通账号若没有管理员接口权限，只会探测失败并保持普通来源，不触发远程写入。
  - 安全结论：未新增明文 token 展示、日志输出或渲染端读取已保存密钥；真实账号分组变更仍必须经过原有确认弹窗。管理员接口探测失败被静默降级为普通监控快照，不暴露凭据。
  - 不满意分类与证据：`requirement_miss` + `ui_interaction`；此前把“我的站点”理解成“配置了独立管理员凭据/已有账号快照”，没有覆盖用户真实流程“我是管理员账号网页登录”。
  - 剩余风险：如果某个二开站的管理员接口路径不同，仍需要用户在兼容诊断里手动补录管理员分组/账号路径；真实站点是否进入“我的站点”以管理员接口实际可访问为准。
  - 下一步：用户用真实管理员账号对目标站点执行“网页登录授权/重新授权”，同步成功后检查来源钱包 `我的站点` tab 和顶部“我的站点账号”工作台。

- [2026-07-18] 语义修正：价格榜最终倍率优先 v3-7.3f
  - 确认版本：fast lane 用户反馈“折算成本是什么意思没数据呢？？？”；验收状态 awaiting_user_acceptance。
  - 结论：价格榜默认排序从“折算成本”改为“最终倍率”，符合用户核心比较口径：`最终倍率 = 分组倍率 ÷ 充值比例`。原“折算成本”列改名为“模型价格”，并明确只有站点提供渠道/模型价格接口时才显示；无价格数据时行内显示“未提供价格 / 看最终倍率”，避免把缺失价格数据误解成应用异常。
  - 影响文件：`src/renderer/src/App.tsx`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/ranking-sort.test.ts` 通过，19 条测试通过；`npm run verify` 通过，5 个测试文件、50 条测试通过；浏览器可见预览通过：价格榜表头为 `最终倍率↑ / 模型价格↕`，页面不再出现“折算成本”，无价格行显示“未提供价格 / 看最终倍率”，有价格行继续显示入/出价格，控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含“模型价格”“未提供价格”“看最终倍率”，且不包含旧“折算成本”文案。
  - 关键决策：不改变模型价格计算逻辑和接口读取，只修默认排序与用户可见语义；站点未提供价格接口时不再展示 `--` 造成困惑，明确引导看最终倍率。
  - 不满意分类与证据：`ui_interaction` + `communication_gap`；用户明确表示不理解“折算成本”和为什么没数据，说明旧文案把一个可选价格能力放得过于核心。
  - 剩余风险：真实站点若提供的模型价格字段不标准，仍可能显示“未提供价格”；后续可在站点诊断里增加“价格接口可用/不可用”的更细提示。
  - 下一步：用户实机查看价格榜，优先确认最终倍率排序是否符合低价聚合判断。

- [2026-07-18] 体验修正：来源钱包仅保留三方站点 / 我的站点 v3-7.3g
  - 确认版本：fast lane 用户反馈“来源钱包里面没有全部 这个分类，只有三方站点 和 我的站点”；验收状态 awaiting_user_acceptance。
  - 结论：来源钱包 tab 语义从 `全部来源 / 我的站点` 改成 `三方站点 / 我的站点`，默认停在 `三方站点`。`三方站点` 只显示非管理员站点，`我的站点` 只显示管理员站点；按钮文案随 tab 切换为 `添加三方站点` 或 `添加我的站点`，空态文案也分别对应三方/管理员来源。
  - 影响文件：`src/renderer/src/App.tsx`、`.specify/memory/session-history.md`。
  - 验证：`npm run typecheck` 通过；`npm run verify` 通过，5 个测试文件、50 条测试通过；浏览器可见预览通过：来源钱包 tab 只剩 `三方站点 1 / 我的站点 1`，默认 active 为 `三方站点 1`，页面没有 `全部来源` 文案，按钮显示 `添加三方站点`，控制台 error 为 0。`git diff --check` 通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；asar 内容检查确认 release 包内包含 `三方站点`、`添加三方站点`、`暂无三方站点`，且不再包含 `全部来源`。
  - 关键决策：来源钱包的分类按来源身份切分，而不是按“是否全部”切分；三方站点默认作为进入来源钱包的起点，方便先看外部来源，再切到自己的站点。
  - 不满意分类与证据：`ui_interaction`；用户明确指出页面上不应该再出现“全部”这个分类，说明旧语义仍不符合真实心智模型。
  - 剩余风险：`三方站点` 目前仍按现有非管理员判定显示，若某些站点管理员凭据失效，可能暂时落在三方列表里，后续仍依赖刷新/诊断修正。
  - 下一步：用户实机打开来源钱包，确认三方站点与我的站点的切换是否符合预期。

- [2026-07-18] 数据安全修正：近期分组变化历史不误删 v4-9
  - 确认版本：fast lane 用户截图反馈“历史我添加的数据怎么没有了？还有点击那个分组弹出来的是啥？？？”；验收状态 awaiting_user_acceptance。
  - 结论：近期分组变化弹窗的真实历史不再提供一键“清空”，避免误删已记录历史；删除分组的“清理”改为只隐藏该删除提示并持久化 `dismissedGroupChangeEventIds`，不会删除该分组历史时间线；历史保留上限从 120 继续放宽到 500 条。演示模式下仅保留“关闭演示数据”，不影响真实历史。
  - 影响文件：`src/shared/types.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`tests/group-change-log.test.ts`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/workflow-state.yaml`、`.specify/memory/session-history.md`、`.specify/memory/skill-upgrade-backlog.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、51 条测试通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；`git diff --check` 通过。图标脚本仍出现已知 `sips` SVG 转换错误，但按 fallback 保留现有 `assets/icon.icns`，不影响打包与签名校验。
  - 关键决策：历史是本地审计/对比记录，默认应保守保留；“清理”只处理已删除分组在列表中的噪声提示，不再承担删除历史的含义。真实历史删除能力后续如需要，应做成更明确的二次确认入口，而不是放在弹窗头部。
  - 不满意分类与证据：`implementation_defect` + `ui_interaction` + `verification_gap`；用户截图说明历史数据消失和点击分组后的弹出内容仍不符合预期，旧实现中“清空/清理”语义过危险，且此前未在用户真实数据路径上做可见复核。
  - 升级信号：已在 `.specify/memory/skill-upgrade-backlog.md` 记录候选规则，建议后续给交付验证补“清空/清理/删除/隐藏的数据安全语义检查”。
  - 剩余风险：本轮按用户要求没有重新启动桌面 app，避免再次产生多个实例；真实旧记录如果已经在此前版本被“清空”写入覆盖，应用无法凭空恢复，需要从系统备份或旧 userData 文件恢复。
  - 下一步：用户打开 release app 验收近期分组变化弹窗；若仍觉得弹窗不直观，下一步优先改成更窄的历史抽屉或增加“只看当前分组历史”的筛选。

- [2026-07-18] 补充审计：历史数据路径与临时实例干扰 v4-9.1
  - 确认版本：fast lane 用户继续要求；验收状态 awaiting_user_acceptance。
  - 结论：通过只读摘要确认正式数据文件存在；发现并关闭一个旧测试实例，避免用户看到临时数据或历史不一致的错觉。另修复 v4-9 引入的演示变化详情事件源小回归，确保演示和真实历史详情都能从当前 base 事件源读取。
  - 影响文件：`src/renderer/src/App.tsx`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/workflow-state.yaml`、`.specify/project-profile/profile.yaml`、`.specify/project-profile/architecture.md`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、51 条测试通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；正式 userData 只输出计数，不打印站点、分组、token、cookie 或原始配置；`pgrep` 复核后已无 AIZZZWatch 正式/测试实例，仅剩无关 workflow-skills Electron dev 进程。
  - 关键决策：继续不启动桌面 app 做可见验证，避免再次生成多实例；本轮只做本地文件计数、进程核对和自动验证。
  - 不满意分类与证据：延续 `verification_gap`；此前没有及时核对是否存在临时 userData 实例，可能加剧“历史数据消失”的感知。
  - 剩余风险：历史保留受旧版本上限或清理行为影响；新版会继续保留到 500 条，但不能恢复已经被覆盖掉的旧条目。
  - 下一步：用户自己启动正式 release app 验收；如果仍显示空历史，优先检查是否启动了带 `AIZZZWATCH_USER_DATA_DIR` 的临时包或旧包。

- [2026-07-18] 功能推进：只读数据中心 v4-10
  - 确认版本：fast lane 用户确认“好”；验收状态 awaiting_user_acceptance。
  - 结论：新增顶部第三视角 `数据中心`，用于查看本地数据可信状态：正式 userData 路径、是否自定义数据目录、站点数量、授权站点数量、管理员站点数量、隐藏分组数、手动标签数、分组变化历史数、已隐藏变化提示数，以及 `stations.json` / `ui-preferences.json` 的存在状态、大小和更新时间。切到该视角后隐藏来源钱包侧栏，给只读检查页完整宽度。
  - 影响文件：`src/shared/types.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/workflow-state.yaml`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，5 个测试文件、51 条测试通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；`git diff --check` 通过。图标脚本仍出现已知 `sips` SVG 转换错误，但按 fallback 保留现有 `assets/icon.icns`，不影响打包与签名校验。
  - 关键决策：数据中心 v1 只读，不实现导出/导入/恢复/删除；主进程 IPC 只返回脱敏计数和文件元数据，不把 token、cookie、原始站点配置、账号明细或偏好 JSON 原文暴露到 renderer。
  - 不满意分类与证据：回应此前 `verification_gap` 与“历史数据怎么没有了”的担忧；用可见数据目录和计数减少用户误看临时 userData 或旧包的概率。
  - 剩余风险：本轮按用户偏好不主动打开桌面 app，因此可见点击路径待用户自己启动后验收；数据中心只是观测页，不能恢复旧版本已经覆盖掉的历史。
  - 下一步：用户打开正式 release app，切换顶部 `数据中心` 检查数据目录和历史计数；若确认有用，再进入 v4-12 设计导出/导入备份，但必须先做差异预览和二次确认。

- [2026-07-18] 兼容修复：聪明哥 WAF 网络栈 v4-11
  - 确认版本：fast lane 用户确认“好的”；验收状态 awaiting_user_acceptance。
  - 结论：聪明哥站点已保存在正式 userData，且本地 access/refresh/cookie/UA 存在、JWT 未过期；失败根因不是添加丢失，而是 Node `fetch` 请求该站普通 API 时被 Cloudflare/WAF 返回 `403 text/html`。已将桌面主进程的 `Sub2ApiClient` 请求和站点诊断改为注入 Electron/Chromium `net.fetch`，测试环境仍默认全局 `fetch`，避免 Vitest 依赖 Electron。网页登录 token 捕获扩展到常见 localStorage/cookie key。
  - 影响文件：`src/main/index.ts`、`src/main/sub2api-client.ts`、`src/main/station-diagnostics.ts`、`tests/sub2api-client.test.ts`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/workflow-state.yaml`、`.specify/memory/session-history.md`。
  - 验证：`npm test -- tests/sub2api-client.test.ts tests/station-diagnostics.test.ts` 通过，2 个测试文件、15 条测试通过；`npm run verify` 通过，5 个测试文件、52 条测试通过；无窗口 Electron 只读探针确认聪明哥普通接口在 Node `fetch` 下仍为 403 HTML，在 Chromium `net.fetch` 下 `/user/profile`、`/groups/available`、`/groups/rates`、`/channels/available` 返回 200 JSON；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；`git diff --check` 通过。
  - 关键决策：只修网络传输层，不新增凭据展示、不写站点配置、不触发远程切组；管理员接口仍按站点权限返回 `Admin access required`，不尝试绕过权限。
  - 安全结论：探针与报告只输出状态码、content-type、脱敏 message、是否有凭据等摘要，不打印 token、cookie、原始响应或站点原始配置；桌面端仍只在主进程使用凭据。
  - 不满意分类与证据：`implementation_defect` + `compatibility_gap`；用户反馈“聪明哥不行”，探针证明该站对 Node 网络栈拦截，而对 Chromium 网络栈放行。
  - 剩余风险：聪明哥管理员接口需要管理员账号或正确管理员路径；当前登录身份对管理员端点仍 403。真实 UI 未打开复测，需用户启动 release app 后点击刷新验证列表是否恢复。
  - 下一步：用户打开正式 release app，刷新 `聪明哥`，确认普通分组/倍率/价格是否出现；若还无法进入“我的站点”，需要用管理员账号重新授权或补录该站管理员接口路径。

- [2026-07-18] 回归修复：登录后非 JSON 响应诊断与 fork 配置保留 v4-11.1
  - 确认版本：fast lane 用户反馈“之前是好的，现在登录后提示接口返回不是 JSON 对象”；验收状态 awaiting_user_acceptance。
  - 结论：修复两处登录后易误导的问题：`Sub2ApiClient` 不再用 `response.json().catch(() => null)` 吞掉响应细节，而是读文本后显式区分 JSON、空内容、HTML 和普通文本，并在错误中带上接口路径、HTTP 状态、content-type 与登录页/风控页提示；网页登录令牌选择优先 JWT-like 候选，降低把 CSRF/指纹 `token` 当 Bearer 的概率。另修复前端网页登录只传 `id/name/baseUrl` 的遗漏，现在会把设置表单中的 `apiBaseUrl/apiPaths/rechargeRatio/lowBalanceThreshold/pollingIntervalMs/adminCredentialType` 一并传给主进程保存，避免新添加 Krill 这类二开站时手动路径被授权流程绕开。
  - 影响文件：`src/main/sub2api-client.ts`、`tests/sub2api-client.test.ts`、`src/main/index.ts`、`src/renderer/src/App.tsx`、`src/shared/types.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm test -- tests/sub2api-client.test.ts` 通过，16 条测试通过；`npm run verify` 通过，5 个测试文件、54 条测试通过；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；`git diff --check` 通过。无窗口 Electron 只读探针确认 `聪明哥`、`lcodex` 核心接口为 200 JSON；`Krill AI` 的 `/api/auth/me`、`/api/credits`、`/api/my/channels` 为 200 JSON，默认增强接口 `/groups/rates`、`/channels/available` 返回 200 text/html，符合 fork 站点需降级处理的判断。
  - 关键决策：不打印 token/cookie/raw body；错误只暴露路径、状态、content-type 和安全提示。未新增远程写入，探针只做已授权 GET。
  - 不满意分类与证据：`implementation_defect` + `verification_gap`；旧错误缺少端点上下文，且网页登录路径没有携带用户手动填写的 fork 配置。
  - 剩余风险：真实网页登录完整流程仍需用户在桌面 App 中输入账号密码验证；如果某站点本身返回 HTML 风控页，新错误会更容易定位，但仍可能需要该站点的 cookie/UA 或手动路径。
  - 下一步：用户启动新打包的 release App，对刚才报错的站点执行重新授权/刷新；若仍报错，直接看错误里的接口 path 和 content-type 即可定位是路径、登录页还是站点拦截。

- [2026-07-19] 功能推进：账号成本映射与成本保护 v4-2
  - 确认版本：需求与影响 v4-2、计划 v4-2，用户确认“确认执行 v4-2”；验收状态 awaiting_user_acceptance。
  - 结论：新增“我的站点 → 成本”分区，按“我的账号 × 我的分组”展示上游映射、上游折算成本、我的分组售价、单位利润、建议基础倍率、亏损/接近亏损/未绑定/来源失效状态；账号页也提供“绑定来源”入口。上游映射持久化到 UI 偏好，只保存来源站点、来源分组和脱敏备注，不保存三方密钥原文；备注若明显像 JWT/Bearer/sk 密钥会被前端拒绝、主进程兜底丢弃。
  - 影响文件：`src/shared/types.ts`、`src/shared/sub2api.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/main/sub2api-client.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/preview-api.ts`、`src/renderer/src/styles.css`、`tests/cost-protection.test.ts`、`.specify/project-profile/profile.yaml`、`.specify/project-profile/architecture.md`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，6 个测试文件、59 条测试通过；`npm run package:mac` 通过并完成 ad-hoc codesign；Profile capture 后状态 fresh。浏览器可见预览通过：进入 `我的站点 → 成本` 后显示 2 条演示账号关系且无卡片/指标溢出；绑定第一个账号到三方来源后亏损关系实时变为 1，显示上游成本、单位利润和来源；单分组亏损账号的保护按钮显示“调整组合”，点击后打开原有确认分组组合弹窗且未提交远程写入。
  - 关键决策：默认不自动改我的账号基础倍率、不自动移出/禁用账号；v4-2 只做映射、建议、单位利润和确认式保护入口。账号如果存在多个我的分组，不会把账号总用量重复估算到每个分组；只有接口未来能精确提供账号×分组用量，才展示真实收益估算。
  - 安全结论：未新增静默远程写入；成本保护动作仍复用已有 `admin:update-account-groups` 确认弹窗。新增本地偏好只保存脱敏映射，不保存 token、cookie 或密钥原文；数据中心只显示映射数量。
  - 不满意分类与证据：无新的用户不满意；自审发现并修正单分组亏损账号“移出亏损分组”会被安全校验拦截的问题，改为“调整组合”。
  - 剩余风险：不同 sub2api 二开版本的账号基础倍率字段名可能不一致，目前只兼容常见字段；用量接口尚未确认能按账号×分组拆分，所以收益估算默认保守显示“用量不足”。真实桌面端远程写入未提交验证，仅验证到确认弹窗打开。
  - 下一步：用户实机启动 release app，给一个我的账号绑定三方来源，检查成本 tab 是否按真实站点显示亏损/未绑定状态；若确认 UI 口径正确，再进入 v4-3 做“半自动保护/审计记录”。

- [2026-07-19] 功能推进：用量能力诊断 v4-2.1
  - 确认版本：用户在 v4-2 后确认继续分析“自己的站点可拿完整用量、三方可能只有一天”；验收状态 awaiting_user_acceptance。
  - 结论：新增 shared 用量能力诊断器，按接口返回字段识别账号、分组、密钥、用户、模型、时间维度，以及费用、Tokens、请求、额度、用量等消耗字段；成本页和用量页新增紧凑诊断条，分级显示 `精确利润`、`账号级利润`、`汇总参考`、`仅单位利润`、`不可计算`，并提供“查看字段”弹窗。
  - 影响文件：`src/shared/usage-diagnostics.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/usage-diagnostics.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过，7 个测试文件、64 条测试通过；浏览器可见预览通过：进入 `我的站点 → 成本` 可看到 `用量能力诊断` 和 `查看字段`，点击弹窗显示字段/脱敏样例空态；进入 `我的站点 → 用量` 可看到 `接口可用性` 诊断条，布局未挤乱来源钱包。
  - 关键决策：不假设所有站点都能精确计算利润；只有检测到账号维度、分组维度和消耗字段时才标为精确利润。只有账号/密钥维度时仅做账号级估算；只有总量或当天统计时标为汇总参考；没有用量明细时仍只展示倍率和单位利润。
  - 安全结论：弹窗只展示字段名和脱敏后的值类型，不展示真实 token、cookie、JWT、API Key、邮箱或完整 usage 明细；没有新增远程写入。
  - 不满意分类与证据：回应用户对“我提供了账号是否能拿精确用量”和“三方可能只有一天”的准确性担忧，避免把接口能力不足误展示成精确收益。
  - 剩余风险：真实 Sub2API 二开站点字段名可能继续扩展，后续若用户提供真实 admin usage 字段形态，可继续补别名；当前版本只是能力诊断，还没有新增自动禁用亏损账号或精确利润报表。
  - 下一步：用户用自己的管理员站点刷新后查看 `我的站点 → 成本/用量 → 查看字段`；如果诊断显示精确利润，再进入 v4-2.2 把收益估算升级为账号×分组精确利润。

- [2026-07-19] 体验修正：成本搜索重复辨识 v4-2.2
  - 确认版本：fast lane 用户截图反馈“搜索为什么有的会有重复的内容啊？”；验收状态 awaiting_user_acceptance。
  - 结论：成本保护列表本质按“账号 × 我的分组”展示，同一个账号存在多个我的分组时会出现多张关系卡；截图中的两条卡片售价和分组上下文不同，不是搜索重复渲染。但旧标题把账号名放得过重、分组信息放在弱小字里，导致看起来像复制内容。本轮将成本卡标题拆成账号主标题，并新增 `我的分组 #ID · 分组名 · 售价` 强上下文；同时在成本行构造时对账号返回的重复 `groupIds` 去重，避免接口重复 ID 造成真实重复卡片。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/cost-protection.test.ts`、`.specify/project-profile/profile.yaml`、`.specify/project-profile/architecture.md`、`.specify/memory/session-history.md`。
  - 验证：`npm test -- tests/cost-protection.test.ts` 通过，3 条测试通过；`npm run verify` 通过，7 个测试文件、65 条测试通过；浏览器可见预览通过：进入 `我的站点 → 成本` 后成本卡显示 `我的分组 #101 · Claude Code Pro · 售价 0.068x`；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：保留“同账号不同分组”的多关系展示，因为用户需要判断一个账号在不同我的售价分组中是否亏损；只去除同账号同分组 ID 的重复，且增强显示避免误读。
  - 不满意分类与证据：`ui_interaction`；用户截图指出搜索结果像重复内容，说明成本关系维度没有被 UI 强表达。
  - 剩余风险：如果真实站点存在不同分组但名称完全相同，仍会出现相同分组名；现在用分组 ID 和售价区分，后续如还不够可加“按账号折叠”模式。
  - 下一步：用户启动 release app 搜索 `congm`，检查两条关系是否能通过 `我的分组 #ID / 售价 / 来源` 看出差异；若希望更少卡片，下一步做“按账号折叠，展开看分组关系”。

- [2026-07-19] 体验修正：成本列表按账号折叠 v4-2.3
  - 确认版本：fast lane 用户确认“可以的”，接受 v4-2.2 提出的“按账号折叠，展开看分组关系”；验收状态 awaiting_user_acceptance。
  - 结论：成本保护列表从默认“关系卡片列表”改为默认“账号卡片列表”。每个账号卡显示账号名、站点、分组数量、最低/最高我的售价、亏损分组数、来源、账号基础倍率和建议基础倍率；点击 `展开 N 个分组` 后才显示每个我的分组的售价、上游成本、单位利润、收益估算和保护操作。搜索计数改为 `显示 N 个账号 / M 条关系`，减少同账号多分组时被误读为重复内容。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/cost-protection.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm test -- tests/cost-protection.test.ts` 通过，4 条测试通过；`npm run typecheck` 通过；`npm run verify` 通过，7 个测试文件、66 条测试通过；浏览器可见预览通过：进入 `我的站点 → 成本` 后默认显示账号折叠卡，计数为 `显示 2 个账号 / 2 条关系`，点击 `展开 1 个分组` 后显示分组明细和操作按钮；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：账号为管理主对象，分组关系作为可展开明细；保留所有分组级成本判断和保护按钮，不把同账号不同分组的数据合并掉，避免损失亏损判断能力。
  - 不满意分类与证据：`ui_interaction`；用户已认可按账号折叠方案，直接修复搜索结果“重复感”。
  - 剩余风险：真实数据中如果一个账号有很多分组，展开后仍可能很长；后续可在展开区内增加“只看亏损/接近亏损/未绑定”筛选。
  - 下一步：用户启动 release app，在成本页搜索 `congm`，确认默认只出现账号卡，展开后再检查两个分组关系是否清楚。

- [2026-07-19] 功能推进：账号成本档案 v4-2.4
  - 确认版本：用户接受“可以的”；验收状态 awaiting_user_acceptance。
  - 结论：新增账号成本档案，区分 `三方按量 / 赠送免费 / 自购订阅 / 手动成本` 四类成本。`我的站点 → 成本` 里可为账号设置成本类型、固定成本、周期天数、单位成本倍率和脱敏备注；赠送免费账号按 0 成本计算，自购订阅和手动成本会显示固定成本和单位成本，三方按量继续沿用上游来源分组映射。账号卡与明细卡都展示成本来源、建议基础倍率、单位利润和收益估算，数据中心新增账号成本档案计数。
  - 影响文件：`src/shared/types.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/cost-protection.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm test -- tests/cost-protection.test.ts` 通过，6 条测试通过；`npm run typecheck` 通过；`npm run verify` 通过，7 个测试文件、68 条测试通过；浏览器可见预览通过：在 `我的站点 → 成本` 打开 `设置成本` 弹窗，将 claude-main 切到 `赠送免费` 并保存后，卡片即时变为“赠送免费”，来源/成本显示为 `赠送免费 · 单位 0.000x · 朋友赠送`，控制台无 error；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：成本类型切换不应悄悄清掉已有上游映射；切回“三方按量”时原映射继续保留。`赠送免费` 只改变成本口径，不触发任何远程停用或写操作。
  - 不满意分类与证据：无新增用户不满意；自审时修正了“切换成本类型时误清上游映射”的过激行为。
  - 剩余风险：自购订阅/手动成本目前只做本地档案和分摊口径展示，尚未做更细的按天摊销或盈利报表；真实站点字段名如果和演示数据不同，还需继续补齐显示别名。
  - 下一步：用户在实机 release app 里分别给“赠送 / 订阅 / 手动”账号设置成本档案，确认卡片标签、收益估算和保存恢复逻辑是否符合预期。

- [2026-07-19] 体验修正：成本页排序增强 v4-2.5
  - 确认版本：用户追加“成本增加一个排序，未设置成本优先最前面，然后增加一个分类排序”；验收状态 awaiting_user_acceptance。
  - 结论：成本页新增排序下拉，支持 `未设置优先 / 风险优先 / 成本类型 / 分类排序`；默认未设置成本的账号排最前，分类排序按 Anthropic → OpenAI → Gemini → Antigravity → Grok → 其他 的顺序排列账号卡。账号卡额外展示分类标签，避免用户只看顺序看不出原因。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/cost-protection.test.ts`、`.specify/memory/session-history.md`。
  - 验证：`npm test -- tests/cost-protection.test.ts` 通过，8 条测试通过；`npm run typecheck` 通过；`npm run verify` 通过，7 个测试文件、70 条测试通过；浏览器可见预览通过：成本页出现“排序”下拉，切到“分类排序”后账号卡按 OpenAI / Anthropic 的分类顺序排好；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过。
  - 关键决策：默认顺序始终把“未设置成本”放在前面；成本类型排序只影响已设置档案的相对顺序，不改变成本计算结果。
  - 不满意分类与证据：无新增用户不满意；本轮主要是用户追加的顺序偏好调整。
  - 剩余风险：分类排序目前按你前面约定的主分类关键词识别，真实站点若分类命名很偏门，后续可能还需要补关键字。
  - 下一步：用户实机确认成本页排序顺序是否符合直觉；若还不够直观，可以再加“仅看未设置 / 仅看订阅 / 仅看免费”的筛选。

- [2026-07-19] 体验修正：账号成本语义纠偏 v4-2.6
  - 确认版本：用户截图反馈“成本设置不对吧？为什么放在分组上面，倍率是每个账号的”；验收状态 awaiting_user_acceptance。
  - 结论：成本档案明确改回账号级语义。分组明细行不再提供“设置成本”入口，只保留账号卡上的设置成本；账号卡新增作用范围说明“该账号下的全部分组共用同一份成本档案”。成本弹窗顶部不再列出一串分组名，只显示账号和当前分组数量，并明确说明“账号成本，不是分组成本”。
  - 影响文件：`src/renderer/src/App.tsx`、`.specify/memory/session-history.md`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/cost-protection.test.ts` 通过，8 条测试通过；`npm run verify` 通过，7 个测试文件、70 条测试通过；浏览器可见预览通过：弹窗显示账号级说明，费用周期说明更新；`npm run package:mac` 和 `codesign --verify --deep --strict` 通过。
  - 关键决策：账号倍率/成本属于账号级属性；分组只用来展示这个账号在哪些我的分组中被使用，不单独保存分组成本。
  - 不满意分类与证据：`ui_interaction`；原 UI 在分组明细行也放了成本入口，且弹窗顶部列出分组名，容易让用户误认为成本按分组设置。
  - 剩余风险：后续如果要做“账号在不同分组的收入分摊”，应单独设计用量/收益归因，不要把账号成本拆成分组成本。
  - 下一步：用户实机确认成本弹窗语义是否清晰；若需要，可继续把“账号基础倍率”编辑也合并到同一个账号档案弹窗。

- [2026-07-19] 体验修正：账号成本文案去分组化 v4-2.7
  - 确认版本：用户截图反馈“不对吧，为什么这里还是分组设置成功啊”；验收状态 awaiting_user_acceptance。
  - 结论：源码没有字面量“分组设置成功”，但成本页仍残留“账号 × 我的分组 / N 个分组 / 收起分组 / 当前分组”等主文案，导致用户误以为成本仍按分组设置。本轮将成本保护主语统一为“账号 × 使用明细”，账号卡改为“设置账号成本 / N 条明细 / 展开使用明细”，保存按钮改为“保存账号成本”，成功提示明确这是账号级设置且不会为单个分组单独建成本档案。
  - 影响文件：`src/renderer/src/App.tsx`、`.specify/memory/session-history.md`、`specs/sub2api-monitor/delivery-summary.md`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/cost-protection.test.ts` 通过，8 条测试通过；`npm run verify` 通过，7 个测试文件、70 条测试通过，生产构建成功；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；包内 `out/renderer` 文案抽查确认包含“账号 × 使用明细 / 设置账号成本 / 保存账号成本”。
  - 关键决策：成本档案文案必须以账号为主语；分组只作为“售卖分组/使用明细”的上下文出现，不作为成本设置对象。
  - 不满意分类与证据：`ui_interaction` + `communication_gap`；v4-2.6 虽移除了错误入口，但文案仍让用户感觉保存动作落在分组上。
  - 剩余风险：本轮未替用户打开 release app 做可见截图，避免再开出多个实例；需用户实机启动后确认旧窗口是否已退出并加载最新包。
  - 下一步：用户实机重新打开应用，进入 `我的站点 → 成本 → 设置账号成本`，确认页面不再把成本动作表达为“分组设置”。

- [2026-07-19] 功能推进：成本分组视角与筛选排序 v4-2.8
  - 确认版本：用户确认“好的可以，还有记得有筛选排序方便我操作”；验收状态 awaiting_user_acceptance。
  - 结论：成本页默认改为“按分组”视角，按“售卖分组 → 多个账号明细”展示风险；一个分组下多个账号会分别展示账号成本、来源、单位利润、建议基础倍率和保护操作。保留“按账号”辅助视角用于查看某账号被哪些分组使用。新增状态筛选、成本类型筛选和排序项：未设置优先、风险优先、成本类型、分类排序、售卖倍率、账号数量、最低利润。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/cost-protection.test.ts`、`.specify/memory/session-history.md`、`specs/sub2api-monitor/delivery-summary.md`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/cost-protection.test.ts` 通过，10 条测试通过；`npm run verify` 通过，7 个测试文件、72 条测试通过，生产构建成功；浏览器本地预览通过：进入 `我的站点 → 成本` 后默认显示“按分组”，可见“显示 N 个分组 / M 个账号明细”，展开分组后账号行显示“设置账号成本 / 绑定来源 / 查看账号”；状态筛选切到 `loss`、排序切到 `margin` 后控件值同步。
  - 关键决策：成本设置对象仍然是账号；分组视角只负责承载多个账号并展示风险聚合，所有写入入口都落在账号明细行或账号卡上。
  - 不满意分类与证据：`requirement_miss` + `ui_interaction`；前一版没有充分表达“一个分组下多个账号”的主场景，导致用户认为仍是在分组上设置成本。
  - 剩余风险：本轮用本地浏览器预览验证 UI，尚未替用户打开 release app；真实站点多账号分组数据仍需用户实机确认。
  - 下一步：用户重新打开应用，在 `我的站点 → 成本` 用真实分组检查“按分组”默认视角、筛选排序和账号行操作是否符合工作流。

- [2026-07-19] 体验修正：成本页布局展示不全 v4-2.9
  - 确认版本：用户截图反馈“布局展示不全了”；验收状态 awaiting_user_acceptance。
  - 结论：v4-2.8 把视角、搜索、状态、成本和排序控件都放在同一条 grid 工具栏里，真实窗口宽度不足时会把右侧排序和卡片操作挤出可视区。本轮将成本工具栏改为 flex 换行布局，搜索框和下拉设置合理宽度；成本统计卡改为 auto-fit；用量诊断条允许换行；分组卡摘要胶囊限制最大宽度；卡片操作区限制最大宽度并允许换行，避免长账号名、成本区间或按钮把内容横向撑爆。
  - 影响文件：`src/renderer/src/styles.css`、`.specify/memory/session-history.md`、`specs/sub2api-monitor/delivery-summary.md`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/cost-protection.test.ts` 通过，10 条测试通过；本地浏览器预览进入 `我的站点 → 成本` 后测得 `body/app/toolbar/list` 横向溢出均为 0，工具栏高度约 94px 且 `按分组/按账号/全部状态/全部成本/最低利润` 控件均可见；`npm run verify` 通过，7 个测试文件、72 条测试通过，生产构建成功；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；release `app.asar` 样式抽查确认包含 flex 工具栏、auto-fit 统计卡、可换行用量诊断、操作区宽度限制和摘要胶囊宽度限制。
  - 关键决策：成本页新增控件不再强行单行展示；优先保证可操作和不横向溢出，必要时让工具栏自然换成两行。
  - 不满意分类与证据：`ui_interaction`；用户截图显示右侧内容被裁切，说明 v4-2.8 的控件密度没有按真实窗口宽度验证充分。
  - 剩余风险：本轮仍未替用户打开 release app，避免影响用户当前实例；已用本地 renderer 预览验证同类布局。
  - 下一步：用户重启最新应用后复查 `我的站点 → 成本`，确认右侧排序/操作按钮不再被裁切。

- [2026-07-19] 体验修正：账号推荐补入语义 v4-12
  - 确认版本：用户截图反馈“这个建议补入什么意思啊？不对吧？？”；验收状态 awaiting_user_acceptance。
  - 结论：账号工作台原逻辑把“未绑定分组”的账号也当成 `cheaperThanCurrent`，导致 UI 显示“建议补入/补入推荐”，语义像是在已有组合里追加分组。实际未绑定账号应该是“推荐初始分组/选择推荐”；已有组合且候选更低时才显示“可加入更低分组/加入更低分组”；已有组合但非更低时显示“最低候选/选择候选”。候选池标题也按场景改为“可选分组”或“更低候选”，未绑定场景不再套绿色“更低”强调。
  - 影响文件：`src/renderer/src/App.tsx`、`tests/ranking-sort.test.ts`、`.specify/memory/session-history.md`、`specs/sub2api-monitor/delivery-summary.md`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/ranking-sort.test.ts` 通过，21 条测试通过；本地浏览器预览进入 `我的站点 → 账号`，确认旧文案 `建议补入/补入推荐` 不再出现，已有组合场景显示“可加入更低分组/加入更低分组”；`npm run verify` 通过，7 个测试文件、73 条测试通过，生产构建成功；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；release `app.asar` 文案抽查确认包含“推荐初始分组/选择推荐/可加入更低分组/加入更低分组/最低候选/选择候选”，且不包含旧“建议补入/补入推荐”。
  - 关键决策：推荐动作按账号当前组合数量区分；“补入/加入”只用于已有组合，未绑定账号只能表达为初始选择，避免用户误以为系统要把分组硬塞进已有组合。
  - 不满意分类与证据：`ui_interaction` + `communication_gap`；旧文案没有解释“补入”的前提条件，截图里未绑定账号显示该词明显误导。
  - 剩余风险：本地演示数据没有未绑定账号可见样本，本轮通过单测覆盖未绑定文案分支；用户真实数据需重启最新应用后确认。
  - 下一步：用户复查截图中的未绑定账号行，应看到“推荐初始分组”和“选择推荐”，不再看到“建议补入”。

- [2026-07-19] 流程修复：业务语义确认门禁
  - 确认版本：用户追问“你做调整之前不和我确认你的思考吗？你的skills没生效吗？”后选择方案 3：保留本轮业务改动，并把规则补进项目流程。
  - 结论：此前 fast 通道没有显式拦截“业务语义类 UI 文案”，导致账号/分组语义调整先实现后解释。已新增规则：当用户质疑 UI 文案、动作、状态或指标的业务含义，尤其涉及账号、分组、来源站点、成本、倍率、充值比例、利润、隐藏/删除/停用时，必须先发布 `语义确认 vN` 或 `思考确认 vN`，用户确认后才能编辑。
  - 影响文件：`AGENTS.md`、`.agents/skills/project-requirement-gate/SKILL.md`、`.specify/memory/constitution.md`、`.specify/templates/spec-template.md`、`.specify/templates/plan-template.md`、`.specify/templates/checklist-template.md`、`.specify/templates/workflow-state-template.yaml`、`.specify/memory/skill-upgrade-backlog.md`、`docs/Codex团队开发说明.md`、`specs/sub2api-monitor/rule-change-proposal.md`、`specs/sub2api-monitor/workflow-state.yaml`。
  - 验证：`git diff --check` 通过；文本检索确认业务语义门禁同步到 AGENTS、requirement-gate、constitution、templates、docs、workflow-state 和 backlog；Ruby YAML 解析确认 `specs/sub2api-monitor/workflow-state.yaml` 与 `.specify/templates/workflow-state-template.yaml` 可解析。
  - 剩余风险：该规则会略微增加确认成本；已限制在业务语义和高风险领域词，避免普通错别字也被强制多轮确认。

- [2026-07-19] 体验修正：当前基准 hover 与成本颜色区分 v4-13
  - 确认版本：用户提出“当前组合最低没显示全能不能 hover 可以显示”“1for.cc 的分组是 0.03 为什么推荐加入分组”“成本里面我的账号和所在分组能不能用颜色差异区分”；按新业务语义门禁先发布思考确认，用户回复“好的”；验收状态 awaiting_user_acceptance。
  - 结论：本轮不改变推荐算法口径，推荐仍按“当前组合最低最终倍率 vs 候选最终倍率”判断；为避免误解，在“当前组合最低”加 hover 明细，多分组时显示最低来自哪个当前分组以及全部当前分组倍率；推荐结果 hover 补充“候选最终 / 比较基准”。成本页用绿色表示售卖/所在分组，蓝色表示我的账号，父卡、嵌套明细和摘要胶囊同步区分。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`.specify/project-profile/local-state.json`、`.specify/memory/session-history.md`、`specs/sub2api-monitor/delivery-summary.md`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/ranking-sort.test.ts` 通过，22 条测试通过；本地浏览器预览进入 `我的站点 → 账号`，DOM 读数确认聚焦卡和列表行的 `title` 为当前分组/组合明细，推荐说明含“候选最终”和“比较基准”；进入 `我的站点 → 成本` 并展开分组，CSS 读数确认分组为绿色边线/标题/胶囊，账号明细为蓝色边线/标题/胶囊；`npm run verify` 通过，7 个测试文件、74 条测试通过，生产构建成功；`npm run package:mac` 通过并完成 ad-hoc codesign；`codesign --verify --deep --strict release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 通过；release `app.asar` 抽查确认 hover 文案和颜色类已进入产物。
  - 关键决策：不把推荐基准从“当前组合最低”偷偷改成“某个单分组倍率”；先解释比较基准，等用户真实数据确认后再决定是否需要新增另一种策略。
  - 不满意分类与证据：`ui_interaction` + `business_semantics`；截图中 `最低 0.0...` 被截断，成本页账号/分组层级视觉相近，容易让用户误判系统在操作哪个对象。
  - 剩余风险：浏览器演示数据只有单分组账号，多分组 hover 分支通过单测覆盖；用户截图中的真实 1for.cc 多分组场景需重启最新应用后确认。

- [2026-07-19] 验收确认：账号列表可读与操作增强 v4-15
  - 确认版本：用户回复“好的确认”，确认当前 v4-15 结果；验收状态 accepted。
  - 结论：账号工作台已按身份、来源/成本状态、所在分组和右侧倍率/推荐分块展示；新增渠道筛选和所在分组筛选；分组 chip 保持完整可见，并支持从账号移除分组且仍走确认组合流程。
  - 影响文件：`src/main/sub2api-client.ts`、`src/shared/sub2api.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/ranking-sort.test.ts`、`tests/sub2api-client.test.ts`、`.specify/memory/session-history.md`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`。
  - 验证：承接 v4-15 已完成的 `npm run typecheck`、`npm test -- tests/ranking-sort.test.ts tests/cost-protection.test.ts`、浏览器预览 `我的站点 → 账号` DOM/CSS 检查、`npm run verify`、`npm run package:mac`、`codesign --verify --deep --strict` 结果；本次用户已确认接受，无新增回归。
  - 关键决策：将账号列表的可读性、筛选和分组 chip 操作视为当前可交付形态，不再继续改动语义。
  - 不满意分类与证据：无新增；当前为用户主动确认通过。
  - 剩余风险：真实站点超长账号名和大量分组的滚动手感仍需用户在实机窗口继续观察。
  - 下一步：等待用户下一个新需求。

- [2026-07-20] 体验修正：账号工作台信息密度与分组移除交互 v5
  - 确认版本：用户继续确认“确认”，接受本轮账号工作台信息密度收敛方向；验收状态 awaiting_user_acceptance。
  - 结论：聚焦账号卡去掉站点余额，来源/成本改成紧凑 icon tag；所有被省略的关键字段补充 hover；当前分组 chip 改为单行滚动，保留逐个 `X` 移除入口，且移除仍走确认组合弹窗，至少保留一个分组时禁用。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/task-reflection.md`、`specs/sub2api-monitor/workflow-state.yaml`、`.specify/memory/session-history.md`。
  - 验证：`npm run verify` 通过；`git diff --check` 通过；本地浏览器预览 `我的站点 → 账号` 确认去余额、icon tag、hover、单行 chip、X 触发确认弹窗与窄屏无横向溢出。
  - 关键决策：不把余额混回账号卡，不把分组移除改成直接写入，先保留二次确认与单行展示。
  - 不满意分类与证据：`ui_interaction`；用户明确要求“不要把整个都隐藏”“来源钱包添加我的站点怎么跑到全部里面去了”“布局要更直观”。
  - 剩余风险：真实站点多分组账号的长列表仍需用户在实机窗口继续确认滚动手感；本轮未重开桌面 App。
  - 下一步：等待用户实机验收最新应用窗口。

- [2026-07-20] 体验修正：账号工作台对齐截图复修 v6
  - 确认版本：用户截图反馈“你完全没按照我的来”，随后确认 `思考确认 v6`；验收状态 awaiting_user_acceptance。
  - 结论：截图中的运行态仍显示旧 UI，因此本轮按截图复修并重新打包。状态组件不再渲染详情正文，只保留 icon/tag 和 hover；聚焦账号分组条挪到卡片整行宽度，chip 铺满一行并带 `X`；点击 `X` 打开“确认分组组合”后取消，未提交远程。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`specs/sub2api-monitor/delivery-summary.md`、`specs/sub2api-monitor/ui-verification.md`、`specs/sub2api-monitor/task-reflection.md`、`specs/sub2api-monitor/workflow-state.yaml`、`.specify/memory/session-history.md`、`release/AIZZZWatch-darwin-arm64/AIZZZWatch.app`。
  - 验证：`npm run typecheck` 通过；`npm test -- tests/ranking-sort.test.ts tests/cost-protection.test.ts` 通过；本地浏览器预览确认聚焦卡不含站点余额、状态 tag 为 24px pill、分组条整行显示、点击 X 出确认弹窗并取消；900px 窄屏无页面横向溢出；`npm run verify`、`npm run package:mac` 与严格签名校验通过；产物 CSS/JS 抽查包含新类。
  - 关键决策：这类 UI 反馈必须以用户截图和运行态为准，不只看源码；交付必须说明是否重打 release 包。
  - 不满意分类与证据：`verification_gap` + `ui_interaction`；v5 虽有源码变更，但用户截图证明实机运行态仍未满足四条要求。
  - 剩余风险：本轮未替用户启动桌面 App；真实数据下 3+ 分组的手感仍等用户实机验收。
  - 下一步：用户从 `release/AIZZZWatch-darwin-arm64/AIZZZWatch.app` 或桌面快捷入口重开最新包验证。

- [2026-07-21] 价格榜涨跌筛选、提醒与利润口径 v1
  - 确认版本：用户确认执行 v1；验收状态 awaiting_user_acceptance。
  - 结论：价格榜按每个分组按时间最新的倍率变化提供全部、涨价、降价筛选，重复模型行不重复计数；近期变化窗口的提示隐藏不再让价格榜涨跌图标消失。未提醒的涨跌会显示应用内提示，并在 macOS 已授权时发送系统通知；成本页明确单位利润、接近亏损和金额估算的计算边界。
  - 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、交付/会话工件。
  - 验证：`npm run verify` 通过（9 文件、100 tests）；最终 macOS 包重新打包并通过 `codesign --verify --deep --strict`；真实 Electron 窗口确认筛选控件存在，点击“涨价”后选中态正确。
  - 关键决策：价格榜读取完整持久化历史而非仅读取近期窗口未隐藏的事件；最新方向按 `occurredAt` 判定，避免重启或旧记录排序导致方向错误。
  - 不满意分类与证据：`verification_gap`；可见窗口当前没有同步到价格行，未能以真实涨跌样本触发系统通知，系统通知权限也由 macOS 控制。
  - 下一步：用户在真实数据同步后点击“涨价/降价”复核列表，并确认 macOS 通知权限。

- [2026-07-21] 账号上游密钥关联 v1
  - 确认版本：用户确认正式实施包；验收状态 awaiting_user_acceptance。
  - 结论：账号映射从“来源站点 + 来源分组”升级为可选的“来源站点 + 上游 Key ID + 保护口径”。单分组 Key 随上游自动跟随；多分组不自动取低价，保留旧口径并提示确认；旧映射可继续使用。
  - 影响文件：`src/shared/types.ts`、`src/main/storage.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/preview-api.ts`、`src/main/index.ts`、三个相关测试文件及本交付工件。
  - 验证：`npm run verify` 通过（107 tests）；`npm run package:mac` 与严格签名校验通过；实际 Electron 包确认 Key 下拉、口径禁用/提示和新文案。生产包 renderer 的稳定文件 URL 缓存问题已用启动 query 修复。
  - 不满意分类与证据：`verification_gap`；可见检查发现包内新代码曾被旧 renderer 缓存遮蔽，现已修复并实机复验。
  - 剩余风险：未替用户在真实站点保存 Key 关联或切换上游分组；v2 的调度关闭不计费和精确用量核算尚未开始。

- [2026-07-21] 时间分段成本核算 v1
  - 确认版本：用户确认正式实施；验收状态 awaiting_user_acceptance。
  - 会话摘要：实现本地时间账本，将上游倍率、充值比例、Key 分组和账号来源映射按观察时间冻结。成本只计算具有稳定记录 ID、账号 ID、发生时间与数值用量的条目；Key 多分组和历史缺口保持未知/待确认，不用当前倍率回算。
  - 影响文件：`src/shared/time-cost-ledger.ts`、`src/shared/types.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/preview-api.ts`、`tests/time-cost-ledger.test.ts`、`tests/storage.test.ts` 和 feature 交付工件。
  - 验证：`npm run verify` 通过，10 个测试文件、118 条测试；`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` 通过；最终 desktop app 真实启动并确认加载 React shell。
  - 关键决策：provider 没有审计时间时明确标记为应用观察时间；账本只存最小化脱敏字段，写入队列避免轮询与 renderer 偏好保存覆盖。
  - 不满意分类与证据：无新增。代码审阅中主动发现嵌套 `user.id` 可能被误判为 usage ID，已收紧规则并加入测试。
  - 剩余风险：当前真实管理员站点没有返回可入账的逐条稳定用量记录，尚不能以真实条目展示账本成本；需用户授权站点返回对应字段后完成实机验收。

- [2026-07-21] 持续分组历史、自动关联上游密钥与管理员用量明细 v1
  - 确认版本：正式实施包 v1；验收状态 awaiting_user_acceptance。
  - 结论：倍率事件改由主进程根据持久化账本基线记录，避免重启空快照产生“新增”噪音；旧历史保留但价格榜只显示真实涨跌。自动来源关联仅在 API Base、平台、倍率和单一 Key 分组唯一时执行。管理员明细只在主进程读取、分页受限、严格压缩，界面显示覆盖边界而不伪造全量精确成本。
  - 影响文件：`src/shared/types.ts`、`src/shared/sub2api.ts`、`src/shared/time-cost-ledger.ts`、`src/main/storage.ts`、`src/main/sub2api-client.ts`、`src/main/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/preview-api.ts`、相关 Vitest 与 feature 工件。
  - 验证：`npm run verify` 通过 122 条；`npm run package:mac`、严格签名与 `git diff --check` 通过；单实例 release app 实际启动，成本页显示管理员明细覆盖状态，关联弹窗确认没有原始密钥输入。
  - 关键决策：保留旧历史而不自动清除；把旧“新增”事件排除出价格榜状态与涨跌计数。管理员日志保留最小字段，不能因明细页受限而把利润标成精确。
  - 不满意分类与证据：无新增；本轮按用户确认的三项受控实现包完成。
  - 剩余风险：不同 fork 的 usage 数值字段仍需真实只读样本确认；本地观察时间仅代表应用发现变化的边界。

- [2026-07-21] 收益区间核算 正式实施包 v1
  - 确认版本：用户确认“确认执行 收益区间核算 正式实施包 v1”；验收状态 `awaiting_user_acceptance`。
  - 结论：新增“我的站点 → 收益”。主进程以最大 20 页读取管理员 `/admin/usage`，严格压缩为收入、基础成本和账号倍率；按 `Asia/Shanghai` 的 `[start, end)` 区间，以请求发生时的来源映射、Key 分组与倍率观察记录计算上游成本。无精确来源的记录仅显示待归因收入。
  - 影响文件：`src/shared/types.ts`、`src/shared/time-cost-ledger.ts`、`src/main/sub2api-client.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/preview-api.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、两份相关测试及交付工件。
  - 验证：`npm run verify` 通过，10 个测试文件、126 条测试；`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` 通过；构建产物浏览器验证“我的站点 → 收益”、按天/按小时、筛选与 900px 无横向溢出。
  - 安全/边界：只使用管理员 GET；原始 usage 行、JWT、Cookie、API Key 不进 renderer、IPC 返回或本地偏好；无远程写入。
  - 剩余风险：不同 fork 的 usage 字段与 provider 审计时间需真实只读样本联调；超过 2,000 条时报告会明确标记页数上限。

- [2026-07-21] 站点角色与兼容修复 正式实施包 v1
  - 确认版本：用户确认“确认执行”；验收状态 `awaiting_user_acceptance`。
  - 结论：站点增加显式 `source/own` 角色。三方来源进入来源钱包与价格榜；用户自己的聚合站进入账号、成本和收益管理。旧记录没有角色时保留既有能力推断，用户编辑保存后转换为显式角色。aihub 保存过短 API 根时恢复为完整 `/api/api/v1`；聪明哥诊断复用保存的 Cookie、UA、令牌和 Referer，并在 HTML 403 时引导重新授权。
  - 影响文件：`src/shared/types.ts`、`src/main/storage.ts`、`src/main/index.ts`、`src/main/station-diagnostics.ts`、`src/main/sub2api-client.ts`、`src/renderer/src/App.tsx`、四份相关测试、Profile 与 feature 交付工件。
  - 验证：`npm run typecheck`、`npm run verify`（131 tests）、`npm run package:mac`、`codesign --verify --deep --strict --verbose=2`、`git diff --check` 都通过；浏览器预览确认“来源钱包 → 我的站点”只显示聚合站，三方站点独立展示。
  - 关键决策：角色是本地展示与管理路由元数据，不改变远程权限；兼容诊断只执行读取/刷新探针，敏感会话只在主进程内临时使用。
  - 不满意分类与证据：`implementation_defect` + `ui_interaction`；用户报告 aihub 的默认分组路径 404、聪明哥 403，以及来源钱包混合展示两类站点。
  - 剩余风险：真实 WAF 规则、Cookie/会话寿命、二开 API 返回仍依赖用户在最新版中点击一次“编辑站点 → 自动探测”验证；没有执行远程写入。
  - 下一步：用户为已有站点确认角色后，在 aihub 刷新分组；聪明哥若仍 403，重新授权后运行自动探测。

- [2026-07-21] 站点类型适配器 正式实施包 v1
  - 确认版本：用户确认“确认执行”；验收状态 `awaiting_user_acceptance`。
  - 结论：站点新增 `auto/sub2api/newapi/custom` 类型，与 `source/own` 角色独立。此阶段 NewAPI 只读取用户、令牌记录和模型能力；不把令牌/模型误解为分组，不进入价格榜或 Sub2API 管理功能。后续 `NewAPI 兼容正式实施包 v1` 已确认用户分组/定价契约并开放来源价格榜，管理员能力仍不复用。自定义兼容仍要求选择已知数据结构，不解析任意 JSON。
  - 影响文件：共享类型/URL 规范化、storage、main adapter/diagnostics/IPC、React 设置表单与来源详情、预览 API、适配器与回归测试、Profile 和 feature 工件。
  - 验证：`npm run verify` 通过（11 个测试文件、137 条测试），生产构建通过；浏览器预览确认 NewAPI 动态字段、能力说明和 900px 无横向溢出；`npm run package:mac`、严格 codesign 与 `git diff --check` 通过。
  - 不满意分类与证据：`requirement_miss`；用户指出“不同站点配置和读取接口不同”，现有手工路径无法表达不同数据契约。
  - 剩余风险：真实 NewAPI 二开路径和完整管理员功能需要具体站点的脱敏样本；本轮未执行远程写入。

- [2026-07-21] aihub 用户资料接口兼容 正式实施包 v1
  - 确认版本：用户确认“确认执行 正式实施包 v1”；验收状态 `awaiting_user_acceptance`。
  - 结论：aihub 实际用户资料接口为 `/api/v1/auth/me?timezone=Asia%2FShanghai`，与默认 `/user/profile` 不同。共享路径解析仅为 `aihub.top` 的默认资料路径切换到该端点；用户手动配置的非默认资料路径不会被覆盖。主进程轮询和兼容诊断复用同一规则。
  - 影响文件：`src/shared/sub2api.ts`、`src/main/sub2api-client.ts`、`src/main/station-diagnostics.ts`、三个相关测试和交付记录。
  - 验证：`npm run verify` 通过，11 个测试文件、140 条测试；`git diff --check` 通过；`npm run package:mac` 重打新 release 并通过严格签名校验，随后已单实例启动。
  - 安全边界：没有使用或记录用户在对话中暴露的 JWT/Cookie，也没有远程写入；用户需撤销该会话并重新授权。
  - 剩余风险：真实 aihub 只读同步仍需用户撤销已暴露的旧会话并重新授权后验收。

- [2026-07-22] 自有聚合站角色与历史关联安全迁移 v1
  - 确认版本：用户确认自有聚合站角色与安全迁移方案；验收状态 `awaiting_user_acceptance`。
  - 结论：将自有聚合站显式设为 `own`，从三方来源移至“我的站点”。只读匹配后仅迁入可唯一确认的上游来源关联；旧站点记录与未匹配账号未删除。
  - 验证：原子写入后检查角色、关联去重和成本档案去重；AIZZZWatch 新实例正常启动。
  - 安全边界：只修改本机加密配置旁的偏好数据，不读取或输出凭据，不发起远端读取/写入，不改远端分组或调度。
  - 剩余风险：其余未匹配的旧账号不自动迁移；固定订阅/手动成本尚未纳入区间报告的净利润分摊。
# 2026-07-22 费用归档正式实施包 v1

- 状态：`awaiting_user_acceptance`。
- 完成：收益用量按上海自然日归档；单日覆盖状态持久化；重归档替换同日记录，防止旧条目叠加；收益报告改读本地脱敏归档。
  - 验证：`npm test`、类型检查、生产构建、macOS 包、严格签名和差异检查通过；完整日与分页受限日的只读归档分支均已验证，不公开本机用量条数。
- 风险：单日 2,000 条分页上限和固定成本未摊销仍需明确展示；没有远程写入。

# 2026-07-22 价格榜使用中筛选紧凑化 v1

- 确认版本：延续“价格榜使用中标记 语义确认 v1”；验收状态 `awaiting_user_acceptance`。
- 结论：将独立“账号使用”行收进“倍率变动”行，改为紧凑链路滑块；只改变控件位置与呈现，不改变精确上游关联和“使用中”筛选规则。
- 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、项目 Profile 和交付工件。
- 验证：`npm run verify` 通过（11 个测试文件 / 142 条）；`npm run package:mac`、严格签名、`git diff --check` 通过；实际 Electron 应用确认控制项同排，开关打开后进入预期空态，随后恢复关闭。
- 不满意分类与证据：`ui_interaction`；用户反馈独立行浪费纵向空间，明确要求放入倍率变动行并使用 switch button。
  - 剩余风险：隔离演示数据当前没有精确关联行，真实使用中行的标记数量需在同步到精确关联后由用户验收。

# 2026-07-22 上游使用状态 v2

- 确认版本：用户确认“确认执行 上游使用状态 v2”；验收状态 `awaiting_user_acceptance`。
- 结论：价格榜紧凑开关现在直接显示 `未使用`/`使用中`。唯一推断映射进入使用中计数；主进程可以在不传递原始凭据的情况下，按唯一 Key 凭据指纹自动确认账号来源。
- 安全：Key、JWT、Cookie、凭据指纹均不进入 renderer、IPC、偏好文件或日志；读取失败会清除旧匹配，避免旧状态误标。
- 验证：`npm run typecheck`，定向 65 项测试，`npm run verify`（143 项）和 `git diff --check` 通过。
  - 剩余风险：自有聚合站会话失效时，正向真实匹配需要用户重新授权后才能验收；没有执行远程写入或代登录。

# 2026-07-22 价格榜最近涨降时间 v1（已由 v2 替代）

- 确认版本：用户确认“确认执行 思考确认 v1”；验收状态 `awaiting_user_acceptance`。
- 结论：价格榜的最终倍率下增加两条紧凑本地历史状态，分别保留该分组最近涨价和最近降价的观察时间。新增/删除事件不作为涨跌，异常时间在历史读取时过滤。
- 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、Profile 与 feature 交付工件。
- 验证：`npm run typecheck`、目标 51 项测试、`npm run verify`（11 文件 / 145 项）、`npm run package:mac`、严格签名和 `git diff --check` 通过；实际 Electron 界面确认无历史与真实涨价历史的显示/悬停状态。
- 关键决策：明确展示的是本地观察时间，不能表示未被应用捕捉的上游审计时间。
- 不满意分类与证据：无新增；按已确认的紧凑展示方案实现。
- 剩余风险：离线期间的多次改价不可从本地观察历史中精确还原。

# 2026-07-22 价格榜最近涨降时间 v2

- 确认版本：用户确认“是的，必须显示完整哦”；验收状态 `awaiting_user_acceptance`。
- 结论：v1 的双方向时间展示被撤回。价格榜仅显示每个分组当前最新的 `rate-up` 或 `rate-down`，并以完整 `YYYY-MM-DD HH:mm:ss` 文字标明；没有变化事件不显示占位。
- 影响文件：`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`tests/group-change-log.test.ts`、Profile 与 feature 交付工件。
- 验证：类型检查、定向 51 项、完整 145 项测试、构建、macOS 打包、严格签名与差异检查通过。
- 不满意分类与证据：`requirement_miss`；v1 将“当前最新变化”误解为“分别保存两种方向最后一次”，用户明确纠正。
- 剩余风险：浏览器安全策略阻止本地构建文件可见自动化，真机像素布局待用户打开最新签名包确认；离线多次变化仍不能被观察历史精确还原。

# 2026-07-22 自有账号免计费 正式实施包 v1

- 确认版本：用户确认“自有账号免计费 正式实施包 v1”；验收状态 `awaiting_user_acceptance`。
- 结论：新增独立的自有免计费账号档案，保留来源映射、用量与收入，跳过成本保护、基础倍率建议和分组最低成本比较；主进程收益聚合将其成本归零，并明确单列免计费口径收入。
- 影响文件：`src/shared/types.ts`、`src/shared/time-cost-ledger.ts`、`src/main/index.ts`、`src/main/storage.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/styles.css`、`src/renderer/src/preview-api.ts`、成本/账本/存储测试与交付工件。
- 验证：定向 39 项测试、`npm run verify`（148 项）、`npm run package:mac`、严格签名和 `git diff --check` 通过。
- 剩余风险：当前档案按用户确认的口径作用于所有历史查询区间，不记录成本类型生效历史；浏览器无法访问本机预览端口，待用户在新包中完成可见验收。无规则升级候选。

# 2026-07-22 接口适配中心 正式实施包 v1

- 确认版本：用户确认“接口适配中心 正式实施包 v1”；验收状态 `awaiting_user_acceptance`。
- 结论：二开站接入改为独立的“数据接入”工作区。标准字段映射仅允许 profile/groups/rates/channels/keys 的受限点路径；主进程读取、同源 HTTPS、无远端写入，旧站无映射时保持原解析。
- 影响文件：`src/shared/station-read-mapping.ts`、共享类型、storage、Sub2API client、主进程预览 IPC、preload、React/CSS、映射与存储/客户端测试、Profile 和交付资料。
- 验证：`npm run verify`、聚焦映射测试、macOS 打包、严格签名和差异检查通过；本地构建文件的浏览器可见自动化被平台策略拒绝，未尝试绕过。
- 不满意分类与证据：`ui_interaction`；用户要求把响应映射放入独立区域，避免继续堆入编辑站点弹窗。
- 剩余风险：需用户在最新版桌面应用中用真实二开站数据点击“检测并预览”，确认实际路径和字段名。

# 2026-07-23 上游关联诊断与自动配对 正式实施包 v1

- 确认版本：用户确认思考确认与正式实施包；验收状态 `awaiting_user_acceptance`。
- 结论：多三方站点/多聚合账号的“已使用”关系现在可诊断、可预览确认。Key 未配置、不可用、地址不匹配、倍率缺失和候选冲突都有可见原因；短暂读取失败不清除已证实关系。
- 影响文件：`src/main/index.ts`、`src/main/sub2api-client.ts`、`src/shared/types.ts`、`src/renderer/src/App.tsx`、样式、相关测试与交付工件。
- 验证：`npm run verify` 通过 12 个文件 / 162 条；`npm run package:mac` 签名完成；`git diff --check` 通过。
- 不满意分类与证据：`implementation_defect`。用户反馈所有已使用关系未关联；根因是默认未读 Key 接口、一次异常会清空内存关联、歧义关系没有解释。
- 剩余风险：真实二开站的 Key 接口仍需在数据接入中配置并完成一次扫描确认；macOS 辅助功能自动化超时，缺少本轮点击截图。

# 2026-07-23 精确上游关联与公益核算 正式实施包 v1

- 确认版本：`语义与影响确认 v2`、`正式实施包 v1`；状态：`awaiting_user_acceptance`。
- 完成：自动关联仅保留唯一 Key 指纹匹配并持久化安全 ID；公益分组整体排除经营核算但保留参考汇总；分组内可批量设置账号成本；首条倍率观察及无效旧涨跌不进入展示/通知。
- 验证：`npm run verify` 165 项、macOS package、严格 codesign、diff 检查均通过；桌面新包单实例启动。
- 风险：macOS 锁屏阻断可见点击验证，待解锁后验证公益开关、批量成本弹窗和无基线涨跌界面。

# 2026-07-23 保存登录凭据与 Sub2API 密钥路径 正式实施包 v1

- 状态：`awaiting_user_acceptance`。
- 完成：Sub2API 站点默认密钥列表路径已补齐；网页登录账号密码可由用户主动选择用 `safeStorage` 加密保存，并在下一次用户主动授权时仅对已保存站点同源登录页填入，不自动提交。
- 验证：`npm run verify` 通过 12 个测试文件 / 168 条用例；macOS 打包、严格签名与差异检查通过。
- 安全复核：公开 DTO 不返回账号或密码；未发现凭据日志；站点地址变更时拒绝使用已保存凭据，避免跨站填入。
- 剩余风险：实时轮询扰动了本轮自动化，编辑站点弹窗的真实点击路径待用户桌面端验收；验证码、OAuth 和 2FA 保持人工完成。

# 2026-07-23 开源准备 v1

- 状态：`awaiting_user_acceptance`。
- 完成：补齐公开 README、演示截图引用、开源发布隐私检查清单，并增强 `.gitignore` 的本机数据、凭据导出、私有截图和 durable memory 规则。
- 影响文件：`README.md`、`.gitignore`、`docs/OPEN_SOURCE_CHECKLIST.md`、`docs/images/`、`specs/sub2api-monitor/delivery-summary.md`。
- 验证：`npm run verify` 通过 12 个测试文件 / 168 条；`git diff --check` 通过；真实 token 片段复扫为 0；敏感扫描仅命中测试假数据。
- 安全结论：未复制正式 userData，未新增真实站点、账号、余额、用量、token、Cookie 或邮箱；README 截图均为演示数据。
- 剩余风险：当前暂存区仍包含大量前序功能与 workflow 改动，公开发布前需按 `docs/OPEN_SOURCE_CHECKLIST.md` 逐项复核并决定哪些 specs / memory 资料适合公开。

# 2026-07-23 NewAPI 兼容正式实施包 v1

- 确认版本：用户确认“确认执行 NewAPI 兼容正式实施包 v1”；验收状态 `awaiting_user_acceptance`。
- 结论：NewAPI 可作为三方来源站读取当前用户余额、可用分组倍率、固定模型定价与令牌所属分组，并进入价格榜；当前用户无权限的全局分组被过滤。
- 安全：原始令牌、JWT、Cookie、UA 和密码不进入 renderer；网页登录恢复及后续刷新均在主进程加密保存轮换后的 `new_api_refresh` Cookie。
- 验证：`npm run verify` 通过（12 个测试文件、177 条测试），`git diff --check` 通过，浏览器预览确认 NewAPI 五路径和能力边界。
- 剩余风险：不同 NewAPI 二开可能变更路径或字段，需要脱敏响应样本后用明确的同源路径配置联调；管理员功能、收益归档和远程写入不在本轮范围。

# 2026-07-24 跨平台 DMG 与 Windows 安装包 正式实施包 v1

- 确认版本：用户确认“确认执行 跨平台打包正式实施包 v1”；验收状态 `awaiting_user_acceptance`。
- 完成：引入 electron-builder，新增 `package:dmg`（macOS arm64 DMG）和 `package:win`（Windows x64 NSIS EXE），保留 `package:mac`；生成受版本控制的 ICO，主窗口与托盘按平台加载 ICNS/ICO；README 明确未签名风险与跨系统凭据不可迁移。
- 验证：`npm run verify` 通过（13 个文件、180 条）；`npm run package:dmg` 生成 `release/AIZZZWatch-0.1.0-arm64.dmg`；DMG checksum、挂载内容、平台图标资源和严格 ad-hoc 签名均通过；`git diff --check` 通过。
- 不满意分类与证据：`verification_gap`；Mac 无 Wine，Windows EXE 尚未原生构建/安装验证；尝试隔离启动 DMG 时，被运行中的旧实例通过单实例机制接管，旧窗口截图未被计入新包证据。
- 剩余风险：Windows 产物不得在 Windows x64 完成构建、安装、系统托盘、窗口模式和卸载验证前发布；两个平台均未配置正式代码签名或公证。

# 2026-07-24 v0.1.1 风险豁免发布

- 确认版本：用户确认“确认按已知风险发布 v0.1.1”；验收状态 `awaiting_user_acceptance`。
- 完成：发布分支已合并至 `main`，推送 `v0.1.1` 标签，并创建公开 Latest [GitHub Release](https://github.com/iizhan/AIZZZWatch/releases/tag/v0.1.1)。发布资产为 macOS arm64 DMG 与 Windows x64 NSIS EXE；Release 页面、标签提交 `f67a4ed`、说明、公开资产名称和大小均已核验。
- 验证：此前 `npm run verify`（13 个测试文件、181 条）及 DMG/Windows CI 验证均通过；发布后通过 GitHub 页面与 Releases API 复核公开状态 `draft: false`、`prerelease: false`、Latest 和两项二进制资产。GitHub 将 EXE 资产文件名规范化为 `AIZZZWatch.Setup.0.1.1.exe`，公开说明已同步。
- 不满意分类与证据：`verification_gap`；Windows 安装、启动、系统托盘、完整/紧凑/气泡窗口和卸载仍没有可见桌面验收，已在公开 Release 中明确披露，且用户仅对 v0.1.1 作出了风险豁免。
- 剩余风险：两平台安装包未正式签名；不得将当前风险豁免或 GitHub Windows CI 构建结果当作后续版本或 Windows 可见验收的替代品。

# 2026-07-25 NewAPI 页面内同源会话恢复 v3

- 状态：`awaiting_user_acceptance`；用户以“ok”确认紧接的 v3 正式实施包。
- 完成：保留隔离授权分区刷新；仅在它未恢复令牌且授权页已进入登录后 HTTPS 同源路由时，通过固定 `/api/user/auth/refresh` 页面请求恢复标准令牌。返回仅接受受限 `access_token`，随后复用既有加密保存和临时分区清理。
- 验证：`npm run verify` 通过（13 个测试文件、190 条）；授权聚焦 18 条、`git diff --check`、macOS 打包、严格签名与 ZIP 完整性均通过。
- 不满意分类与证据：`implementation_defect`；用户登录 `nihao.dog` 后窗口没有自动关闭，v2 的分区刷新未覆盖页面会话上下文。
- 剩余风险：真实 Electron 登录、验证码/2FA、站点端刷新 Cookie 策略仍需用户在新包中可见验收；未代填或记录任何凭据。

# 2026-07-26 NewAPI Cookie 会话落盘 v1

- 确认版本：用户确认“确认执行 NewAPI Cookie 会话落盘 v1”；验收状态 `awaiting_user_acceptance`。
- 完成：对 OneAPI Cookie-only 站点，固定 profile 的 HTTPS 同源验证成功即可落盘受限 Cookie，不再依赖刷新接口的特定 404；新增非敏感 Cookie 会话状态和明确失败提示。
- 验证：聚焦 59 项、`npm run verify`（14 文件 / 211 项）、生产构建和 `git diff --check` 通过；审阅未发现 Cookie/JWT/Profile 原文跨 IPC、日志或公开 DTO。
- 不满意分类与证据：`implementation_defect`；用户已登录 NewAPI 站点仍报“未配置 NewAPI 登录会话”，根因为旧 Cookie 保存前置条件过窄。
- 剩余风险：当前旧安装包的单实例锁阻止隔离新构建做真实点击验收；用户仍需在新构建中自行完成登录，验证码/2FA/WAF 不会自动处理。

# 2026-07-26 NewAPI 页面会话捕获修复 v2

- 确认版本：用户确认“确认执行 NewAPI 页面会话捕获修复 v2”；验收状态 `awaiting_user_acceptance`。
- 结论：OneAPI Cookie profile 验证从主进程分区请求移到已登录 HTTPS 同源页面执行，页面仅把有效性布尔值交回主进程；成功后仍由主进程校验、加密保存 Cookie 并关闭授权窗口。
- 影响文件：`src/main/web-auth.ts`、`src/main/index.ts`、`tests/web-auth.test.ts`、NewAPI feature 工件与 Profile。
- 验证：`web-auth` 24 项、`npm run verify`（14 文件 / 211 项）、生产构建、`git diff --check`、`npm run package:dmg` 与严格 codesign 通过。DMG SHA-256：`a7a2b7cd580572ee8e8f960e82b0cd541558419db2dd3806ff068ba786a6a359`。
- 不满意分类与证据：`implementation_defect`；用户已看到 `nihao` 后台但授权窗未关闭，确认原验证通道未复用页面 Cookie/WAF 上下文。
- 剩余风险：真实网页登录、Cloudflare、验证码、2FA 和 Cookie 生命周期仅能由用户在新 DMG 中验收；没有读取、打印或保存任何真实认证数据。

# 2026-07-26 数据与刷新安全修复及自定义 API 根编辑 v2

- 确认版本：用户确认“确认执行 数据与刷新安全修复及自定义 API 根编辑 正式实施包 v2”；验收状态 `awaiting_user_acceptance`。
- 完成：损坏站点/偏好文件只有成功备份原件后才会回退；手动刷新与保活检查可淘汰旧轮询提交；自定义兼容 API 根可编辑并安全保存同源 HTTPS `/api` 根。
- 验证：聚焦 58 项、`npm run verify`（15 文件 / 237 项）、生产构建、`git diff --check`、凭据日志审阅和 Profile capture 通过。
- 不满意分类与证据：`implementation_defect`；用户反馈自定义兼容 API 根不可修改导致 `www.krill-ai.net` 无法录入，审阅确认显式根还会被默认归一化覆盖。
- 剩余风险：浏览器环境无法访问 localhost，隔离桌面窗口被已运行正式应用单实例锁接管；未对真实站点或真实本地数据执行 UI 操作，待用户完成可见验收。

# 2026-07-27 接入与涨跌可见性 正式实施包 v1

- 确认版本：用户确认“确认执行 接入与涨跌可见性 正式实施包 v1”；验收状态 `awaiting_user_acceptance`。
- 完成：倍率涨跌事件由主进程持久化写入后驱动偏好更新和原生通知；通知点击按涨价、降价或混合的正确筛选打开近期分组变化。Aihub 默认 profile、Krill 已知余额/分组路径与余额可用降级、Zanzhu 固定 API 别名 404 回退均已实现。
- 验证：`npm run verify` 通过（15 个测试文件、242 项）；TypeScript、生产构建和 `git diff --check` 通过；定向敏感扫描没有真实 JWT、密码、余额或账号资料。
- 不满意分类与证据：`implementation_defect`；用户反馈已发现的涨价不显示、Aihub/Krill/Zanzhu 无法添加，根因是持久化事件无独立界面刷新链路以及二开站仍使用默认 Sub2API 根/路径。
- 剩余风险：真实站点认证 GET、macOS 通知点击、WAF/Cookie 生命周期和二开字段需在最新版桌面端验收。隔离 Electron 受 `MachPortRendezvous` 权限限制，且 `127.0.0.1:5187` 未运行开发服务器导致 in-app browser 返回 `ERR_CONNECTION_REFUSED`；未读取或修改真实凭据和数据。

# 2026-07-27 Sub2API Web Watch 只读垂直切片 v1

- 确认版本：用户确认 Sub2API 官方 `v0.1.165` 下游集成方案；验收状态 `awaiting_user_acceptance`。
- 完成：在 `/Users/bing/Myself/Code/MacTools/Watch_Sub2Api` 的 `feature/watch-web-v0.1.165` 增加 Watch 服务、管理员概览/排价预览 API、独立 `watch_` migration、Vue 管理页面、路由、导航和中英文文案。
- 规则：分组倍率与模型渠道价格均选当前可调度/可解析候选的最低值并加 `0.01`；无合格候选冻结；本阶段只读，不写入价格。
- 验证：`git diff --check` 通过；未运行 Go 检查（本机无 `go`/`gofmt`）；前端依赖安装因缓存缺少 `@vue/compiler-core@3.5.40` 且联网安装无进展而停止，未运行 typecheck/build。
- 剩余风险：当前健康判断为账号配置/可调度性，不等同真实 HTTP 保活；自动写价、审计回滚、令牌保活和官方升级演练仍待后续确认切片。

# 2026-07-27 Sub2API Web Watch Docker 验证与安全修正 v2

- 确认版本：需求/影响/设计/任务/验收计划 v1；验收状态 `awaiting_user_acceptance`。
- 完成：在服务器 Docker 临时树完成后端生产构建、Watch 价格规则定向单测、前端 typecheck；修正概览错误文案泄露和不合格候选显示为 0 的问题；生产容器保持 healthy，未执行生产写入或切换。
- 验证：后端 `go build -p 1 -tags embed` 通过；Watch 两组定向测试通过；前端 `pnpm run typecheck` 通过；修正前同一基线 Vite build 通过；Wire 文件 SHA 与本地一致。
- 不满意分类与证据：`verification_gap`；服务器 3.5GiB 内存不足以稳定完成全量 Go/Wire 和修正后组合 Vite 重跑，记录为资源阻塞而非代码通过。
- 剩余风险：全量 service 测试存在既有 Ollama 用例失败；真实 HTTP 保活、自动调价、审计回滚、生产 migration/升级和可见 Web 点击仍未覆盖。

# 2026-07-27 Sub2API Web Watch 智能运营菜单重构 v3

- 确认版本：需求/影响/设计/任务/验收计划 v2；验收状态 `awaiting_user_acceptance`。
- 完成：将独立 Watch 页面改为“智能运营”折叠菜单；拆分“运营概览”和“聚合排价”子页面；统一复用官方 AppLayout；旧 `/admin/watch` 兼容跳转。
- 验证：Docker `vue-tsc + Vite` 构建通过；集成测试 4/4、定向 ESLint、`git diff --check` 通过；Go embed 镜像构建成功；本地三个容器 healthy，health 与两个页面路径均返回 200。
- 不满意分类与证据：`ui_interaction`；用户指出原页面独立显示、缺少统一菜单目录，根因是 WatchView 遗漏 AppLayout 且信息架构只有单一顶级入口。
- 剩余风险：应用内浏览器 webview 三次无法附着，未完成宽屏/窄屏菜单点击和截图；需用户在本地预览完成可见验收。

# 2026-08-03 Sub2API v0.1.170 升级包 v1

- 确认版本：用户确认“确认执行升级包 v1”；验收状态 `awaiting_user_acceptance`。
- 完成：在 `feature/sub2api-operations-v0.1.170` 固定定制基线并合并官方 `v0.1.170`；手工解决 failover 与官方利润控制冲突；保留失败 attempt 永不扣费、最终成功 usage 单次计费和退款仅候选/dry-run 的安全边界；修正定制分支版本显示为 `0.1.170`。
- 影响文件：目标仓库官方升级差异、`backend/internal/handler/failover_loop.go`、三份前端兼容测试、`backend/cmd/server/VERSION`；本仓库交付报告与 workflow state。
- 验证：后端四组包级回归及计费/退款/利润控制/迁移聚焦测试通过；前端 207 文件 / 1430 项、vue-tsc、生产 build、`git diff --check` 通过；本地 Docker 最新 embed、migration、health 和可见 UI/1024 布局通过，控制台无 error/warn。
- 不满意分类与证据：`verification_gap`；Docker Desktop 在重编译后失联，用户授权重启后恢复，并完成此前阻断的运行态与 UI 验证。
- 剩余风险：当前分支未推送、未部署生产；生产 canary、蓝绿切流、生产配置/数据库和退款均需独立授权。

# 2026-08-03 Sub2API v0.1.170-watch.1 发布准备包 v1

- 确认版本：用户确认“确认执行发布准备包 v1”并完成绿色验收；验收状态 `accepted`，等待独立切流授权。
- 完成：创建并推送 `release/0.1.170-watch.1`，构建 `linux/amd64` 不可变镜像，完成生产数据库/配置备份与校验，启动不接流量的绿色 `8094`；蓝色 `8093` 和 Nginx 流量保持不变。
- 验证：后端四组回归、前端 207 文件/1430 项、vue-tsc、build、frozen install、镜像版本、蓝绿 health、迁移、备份 SHA256、临时管理员登录与合规入口均通过。
- 安全边界：failover 保持关闭；回滚边界后没有新增正数失败-attempt 结算；未切流、未停蓝、未退款、未改余额、未恢复数据库，未读取现有管理员密码。
- 不满意分类与证据：`release_hygiene`；发布标签在 pnpm lockfile 修复前创建。用户单独授权后已通过带旧对象 lease 的受保护强制推送纠正，远端 tag 和 release 分支现均指向 `3d2571d7d`。
- 剩余风险：绿色尚未接真实流量；Nginx 切流、停止蓝色、启用故障转移、退款和数据库恢复仍需独立授权；URL allowlist 和数据库/Redis 公网监听是既有安全风险，不在本包授权范围。
