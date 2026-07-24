# NewAPI 登录入口兼容 Delivery Summary

## Meta

- Feature: `newapi-login-route-compatibility`
- Date: `2026-07-24`
- Related Request: `确认执行 NewAPI 登录入口兼容 v1`
- Requirement Version: `v1`
- Impact Version: `v1`
- Plan Version: `v1`
- Verification Version: `v1`
- Delivery Status: `awaiting_user_acceptance`

## 本次完成

- 目标: 兼容新版 NewAPI 的 `/sign-in` 登录页，避免将入口 404 误报为用户取消。
- 实际完成: NewAPI 优先 `/sign-in`，旧版/未知站仍优先 `/login`；当前候选页明确为同源 SPA 404 时才一次性回退；双路径失败提供中文可行动提示。
- 未完成/未纳入: 未支持任意自定义登录路径，未修改余额、分组、定价、远端写入、凭据存储、版本号或 GitHub Release。

## 关键改动

- 改动范围: 授权入口解析、隔离 BrowserWindow 生命周期、renderer 授权错误提示和对应测试。
- 关键文件或模块: `src/main/web-auth.ts`、`src/main/index.ts`、`src/renderer/src/App.tsx`、`tests/web-auth.test.ts`。
- 重要取舍: 只在固定同源 `/login` 与 `/sign-in` 间切换，最多一次；不根据页面任意链接或重定向猜测登录入口。

## 验证结果

### 事项与影响证据矩阵

| 事项/验收 | 影响维度 | 实际修改 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- | --- |
| ITEM-001：NewAPI 登录入口兼容 | 授权链路、兼容性、安全边界、用户反馈 | 固定入口选择、SPA 404 一次回退、中文错误提示 | 12 项授权聚焦单测；完整 184 项测试；公开页面可见验证 | 通过 | 未用真实账号完成 Electron 登录 |

- 执行命令: `npm test -- tests/web-auth.test.ts`、`npm run typecheck`、`npm run verify`、`git diff --check`、`node scripts/package-mac.mjs`、`codesign --verify --deep --strict --verbose=2`、`unzip -t`。
- 自动验证结果: 13 个测试文件、184 项测试，类型检查及生产构建均通过；差异格式检查通过。
- 界面/交互验证: 公开访问 `https://nihao.dog/sign-in` 显示“用户名或电子邮件”、密码框与“登录”按钮；`https://nihao.dog/login` 显示“404 / 页面未找到”。
- 截图或 UI 报告: 已完成可见 DOM/UI 报告；未保存或输出登录页面中的任何用户输入。
- 手动验证路径: 使用本地 ZIP 启动应用，添加/编辑 `https://nihao.dog` 并选择 NewAPI，点击“网页登录授权”，由用户自行输入账号、验证码或 2FA。
- 未覆盖项: 真实账号登录后的 Cookie/JWT 捕获与站点端验证码流程。
- 剩余风险: NewAPI 二开若未来同时弃用两个固定入口，应用会明确报告路径不存在，但不会自动猜测任意新路径。

## 用户验收

- 当前状态: awaiting_user_acceptance
- 用户选择: 确认验收 / 继续修正 / 补充验证 / 重新打开事项
- 验收版本: v1（待用户确认）
- 修订意见: 待用户桌面端实际登录反馈。
- 重新打开事项: 无。

## 用户选择与原因

1. 选择: 不代填、不提交账号、密码、验证码或 2FA。
   原因: 凭据和最终登录操作必须由用户控制。
2. 选择: 固定两条同源入口，而非开放任意登录路径。
   原因: 保持兼容边界可审计，避免错误跳转和会话风险。

## 复盘结论

- 做得好的地方: 将“用户取消”与“站点入口不存在”拆分为可见、可操作的错误状态，并有路由与同源边界测试。
- 建议改进的地方: 后续如遇第三种正式登录路径，另行确认并扩展兼容矩阵，不在运行时无限猜测。
- 不满意分类: 无新增。
- 支持证据: `nihao.dog` 两条公开路由的可见结果与 184 项完整自动测试。

## 记忆与进化后续

- 记忆候选: 无；该站点路由差异属于任务级兼容事实，不提升为项目通用业务决策。
- 规则变更候选: 无。
- 是否需要用户确认: 不需要。

## 下一步建议

- 立即可继续: 用户使用本地 macOS 测试 ZIP 自行完成一次 `nihao.dog` 登录。
- 建议后续跟进: 若登录后未自动回到应用，提供不含凭据的错误文本和站点类型选择信息即可继续诊断。

## v0.7 Impact Scope Self-Check

- 设计方案版本：v1
- 任务拆解版本：v1
- 影响范围版本：v1
- 影响范围自查：通过；实际差异仅包含已确认的主进程授权入口、renderer 错误提示、测试和跟踪文档，无数据、IPC、远端写入或凭据存储扩展。
- 用户验收：待确认验收。
