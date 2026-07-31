# 站点智能接入与安全保活 Task Reflection v5

## Meta

- Feature: `newapi-login-route-compatibility`
- Date: `2026-07-25`
- Related Request: `站点智能接入与安全保活 正式实施包 v5`
- Reflection Status: `awaiting_user_acceptance`
- Requirement / Impact / Plan / Verification Versions: `v5 / v5 / v5 / v5`
- User Acceptance: pending

## Task Outcome

- delivered: 自动识别、简化添加流程、可解释的保活状态、单窗口有界重试、人工优先取消与启动中断恢复已完成。
- delivered: `nihao.dog/keys` 的无凭据 JSON 401 可识别为 NewAPI；隔离桌面演示确认识别结果和授权入口，不保存站点。
- delivered: 详细诊断不再把原始 JSON/profile 前缀传到 renderer，避免已授权探测泄露用户资料。
- not delivered: 不代替用户输入账号、密码、验证码或 2FA；不绕过风控，不把本地测试包发布到 GitHub。

## User Choices

1. choice: 用户确认 `站点智能接入与安全保活 正式实施包 v5`。
   why it mattered: 涉及第三方登录、加密本地凭据、后台定时器和站点识别，需同时锁定安全及交互边界。
2. choice: 演示仅做隔离识别与授权入口验证。
   why it mattered: 不应读取、代填或保存真实第三方账号凭据。

## Verification Summary

- commands run: 相关 5 文件 / 71 项测试、完整 `npm run verify`、差异检查、Profile capture、macOS 打包、严格签名与 ZIP 完整性检查。
- result: 14 个测试文件 / 209 项测试、类型检查和生产构建全部通过；本地 macOS arm64 测试包通过签名与 ZIP 校验。
- visible evidence: 隔离 userData 的 Electron 渲染器输入 `https://nihao.dog/keys` 后返回 `recognizedNewApi: true`、地址输入存在、授权按钮可用，且未保存站点。
- uncovered areas: 真实 `nihao.dog` 登录后自动关闭、保存、首次同步，以及验证码/2FA/WAF 的实际状态。
- residual risks: 当前已有应用实例占用开发端口，未强行打开第二个实例；其他二开站的路径、Cookie 与登录契约需要各自的脱敏现象确认。

## What Worked Well

- 自动识别先严格验证 JSON 信号，且与保存凭据路径彻底分开；单窗口队列在异步存储读取前预占位，避免并发授权窗。

## What Should Change

- 当前环境无法以不干扰正在运行应用的方式重复启动独立开发实例；下次可在用户关闭旧实例后再补一轮完整可见回归，或继续使用独立 userData 的预打包测试环境。

## Memory Candidates

- candidate: 诊断对已授权响应只传递最小状态，不使用原始 JSON 文本回退。
  space: task
  reason: 本轮审阅发现 profile 响应可能包含资料；修复已完成，但是否提升为项目级规范需跨模块重复证据。
  status: recorded

## Rule Change Candidates

- title: 无。
  target level: session
  reason: 尚未形成跨任务重复的规则缺口。
  status: not_required

## Workflow State Sync

- 当前状态：`awaiting_user_acceptance`。
- 已更新：v5 验证报告、反思、workflow state、项目 Profile 和会话历史。

## Next Recommendation

- 用户在桌面端完成一次 `nihao.dog` 真实授权；如需要，打开已保存密码的自动保活后故意使会话失效，确认网络重试与人工验证状态的文案和入口。

## NewAPI Cookie 会话落盘 Reflection v6

- Confirmed package: `NewAPI Cookie 会话落盘 v1`（文档版本 v6）。
- Outcome: 授权捕获的 Cookie 分支已从“refresh 接口明确 404 才运行”调整为“固定 profile 在已登录 HTTPS 同源页面验证成功即可运行”；保留 JWT/refresh-token 与 Sub2API 路径。
- Verification: 聚焦 59 项、完整 211 项测试、类型检查、生产构建、差异检查通过；未发现 Cookie/JWT/Profile 原文跨 IPC 或日志的路径。
- Visible verification gap: 正在运行的已安装旧包通过单实例锁阻止隔离新构建接管。为避免影响真实用户数据，没有关闭旧包或代登录真实站点。
- User acceptance: pending。需要用户在新构建中完成一次真实 `nihao.dog` 登录，确认自动关闭、Cookie 会话状态和首次同步。
- Dissatisfaction classification: `implementation_defect`。证据是用户已使用 NewAPI 站点但仍收到“未配置 NewAPI 登录会话”；根因是 Cookie 保存条件过度依赖 refresh 路由响应。

## NewAPI 页面会话捕获修复 Reflection v7

- Confirmed package: `NewAPI 页面会话捕获修复 v2`。
- Outcome: Cookie-only OneAPI 的 profile 验证改为已登录 HTTPS 同源页面内的只读布尔校验，随后复用现有主进程加密 Cookie 保存；不读取 LocalStorage、profile 原文、Cookie/JWT 或密码。
- Verification: `web-auth` 24 项测试、完整 `npm run verify`（14 文件 / 211 项）、`git diff --check`、macOS DMG 构建和严格签名校验通过。
- User acceptance: pending。用户需要在新 DMG 中自行完成一次 `nihao.dog` 登录，确认窗口自动关闭、Cookie 会话状态与同步结果。
- Dissatisfaction classification: `implementation_defect`。用户截图表明后台已登录但窗口仍显示“等待可用会话”；根因是主进程验证路径没有使用网站实际浏览器上下文。
- Residual risk: Cloudflare/WAF、Cookie 生命周期或站点后续前端契约变更仍可能阻止落盘；应用不会绕过风控、验证码或 2FA。

## 数据与刷新安全修复及自定义 API 根编辑 Reflection v2

- Confirmed package: `数据与刷新安全修复及自定义 API 根编辑 正式实施包 v2`。
- Outcome: 读取损坏数据不再可静默覆盖原文件；强制刷新具有更高的提交优先级；自定义兼容可保存显式同源 API 根。
- Verification: 聚焦 58 项、完整 `npm run verify`（15 文件 / 237 项）、生产构建、`git diff --check`、安全日志扫描和 Profile capture 通过。
- User acceptance: pending。用户需在实际桌面端为 `krill-ai` 输入 `https://www.krill-ai.net/api` 并完成一次检测、保存、重开和刷新验证。
- Dissatisfaction classification: `implementation_defect`。证据是用户指出自定义兼容的 API 根不可编辑，导致 `www.krill-ai.net` 无法录入；审阅还发现显式根即使输入也会被旧归一化逻辑回退，已修复并加入测试。
- Visible verification gap: in-app browser 无法访问 localhost，隔离 Electron 实例被已运行正式应用的单实例锁接管。为避免影响真实配置，未操作或关闭该正式应用。

## 接入与涨跌可见性 Reflection v1

### Meta

- Feature: `newapi-login-route-compatibility`
- Date: `2026-07-27`
- Confirmed package: `接入与涨跌可见性 正式实施包 v1`
- Reflection Status: `awaiting_user_acceptance`

### Task Outcome

- delivered: 新倍率事件由主进程持久化后同时驱动界面刷新和原生通知；通知点击可进入正确的近期变化筛选。
- delivered: Aihub、Krill、Zanzhu 的兼容路径被限制在固定 HTTPS 主机/路径和仅 404 回退；Krill 允许余额可用、分组不可用的明确降级。
- not delivered: 未完成真实认证 GET 或可见桌面点击证据；没有读取、写入或记录任何真实凭据、余额、用户资料或响应。

### User Choices

1. choice: 用户确认 v1 正式实施包。
   why it mattered: 涉及第三方授权读取、主进程通知和本地历史，需要明确限制为受控只读兼容。

### Verification Summary

- commands run: `npm run verify`、`git diff --check`、定向敏感扫描、主进程/IPC/兼容路径审阅。
- result: 15 个测试文件、242 项测试、类型检查和生产构建全部通过。
- visible evidence: 未产生。隔离 Electron 在 macOS `MachPortRendezvous` 权限限制下未进入 ready；`127.0.0.1:5187` 未运行开发服务器，in-app browser 返回 `ERR_CONNECTION_REFUSED`。
- residual risks: 真实站点的 WAF、Cookie 生命周期、路径契约与通知权限仍需桌面端验收。

### What Worked Well

- 将事件“新增”判定留在 serialized storage 写入内，避免 renderer 在重启或异步快照竞争时合成重复变化。

### What Should Change

- 真实认证问题需要以用户已登录的桌面端诊断完成；不可用受限运行环境的单测替代实际会话成功结论。

### Memory Candidates

- candidate: 已授权第三方诊断只保存/展示脱敏路径和状态，真实响应始终留在主进程。
  space: task
  status: recorded

### Rule Change Candidates

- title: 无。
  target level: session
  reason: 本轮没有新的跨任务工作流缺口。
  status: not_required

### Workflow State Sync

- 当前状态：`awaiting_user_acceptance`。
- 已更新：v1 规格、计划、任务、验证报告、反思、workflow state、Project Profile 与会话历史。

### Next Recommendation

- 用户在新版桌面端验证通知点击、Krill/Aihub/Zanzhu 详细诊断。若任何站点失败，只提供路径、HTTP 状态和脱敏错误摘要。
