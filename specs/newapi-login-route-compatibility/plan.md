# 实施方案：NewAPI 登录入口兼容

**需求/设计/影响/计划版本**: v1
**确认状态**: controlled，用户已确认 `NewAPI 登录入口兼容 v1`

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
