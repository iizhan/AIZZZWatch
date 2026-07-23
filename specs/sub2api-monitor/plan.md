# 实施方案：Sub2API 实时分组监控

**功能标识**: `sub2api-monitor`
**功能目录**: `specs/sub2api-monitor`
**日期**: 2026-07-16
**关联需求版本**: v2
**影响版本**: v2
**计划版本**: v2
**确认状态**: controlled / confirmed by user on 2026-07-16

## 1. 需求摘要

- 本次要解决的问题：多个 Sub2API 站点的余额、分组倍率、价格和账号分组状态分散在不同 Web 管理页，缺少 macOS 常驻监控入口。
- 用户可见结果：一款可运行的 Electron 桌面工具，首屏显示站点健康与余额，支持紧凑形态，并在管理员确认后切换账号分组。
- 范围边界：只做 Sub2API HTTP 适配与桌面端 MVP，不修改 Sub2API 服务端，不实现支付、自动切换、远程发布和自动更新。

## 2. 锁定范围

- 建议范围：Electron 主进程、preload IPC、React renderer、Sub2API 适配层、加密设置、内存快照、可见验证。
- 影响等级：high
- 直接影响：项目业务代码、package scripts、DESIGN.md、sub2api-monitor specs。
- 间接影响/可能联动：macOS 窗口行为、系统菜单栏、网络超时、凭证生命周期和远程账号状态。
- 用户影响：新增多站监控和管理员切组入口；不会自动发起远程写操作。
- 数据与迁移影响：无服务端迁移；本地只保存加密后的站点配置，不兼容未定义旧格式。
- 接口/配置契约影响：消费 `/api/v1/user/profile`、`/groups/available`、`/groups/rates`、`/channels/available`、`/auth/refresh` 和管理员 groups/accounts 路由；新增网页登录 IPC DTO。
- 安全与权限影响：登录窗口隔离且不挂载应用 preload；access/refresh token 只在主进程安全存储；管理员 JWT/API Key 分别使用对应 header。
- 兼容性影响：不同 Sub2API 版本或 feature flag 可能缺少价格接口，必须降级为不可用状态。
- 性能与资源影响：默认每站 30 秒轮询；限制并发、超时和响应体大小，销毁窗口时清理计时器。
- 测试影响：需要适配层单测、状态/重试测试、IPC 契约测试和可见 Electron UI 验证。
- 发布与回滚影响：仅在 feature 分支实现；可删除新业务目录和 package 变更回退，不触碰远端站点数据除显式切组请求。
- Workflow/Skill 影响：补充项目 Profile、DESIGN.md、规格与任务工件；保持附件 workflow 作为流程资产。
- 明确不影响：Sub2API 服务端代码、数据库、支付、代理、账号凭证内容、自动更新和签名发布。
- 未知项与置信度：macOS 原生签名/公证和最终 keychain 依赖未知（medium）；站点 feature flag 差异已确认存在（high）。

## 3. 技术上下文

- 技术栈：`Electron + React + TypeScript`
- 主应用目录：`.`
- 配置输出：`(none)`
- 相关模块：`src/main`、`src/preload`、`src/renderer`、`src/shared`、`src/main/sub2api`、`tests`
- 复用点：Electron `BrowserWindow` / `Tray` / `safeStorage`，原生 `fetch`，React hooks，CSS variables from `DESIGN.md`。

## 4. 实现策略

### 事项到子任务映射

| 事项 | 子任务 | 依赖 | 完成条件 | 影响范围 | 验证证据 |
| --- | --- | --- | --- | --- | --- |
| ITEM-001 | TASK-001, TASK-002 | 无 | 安全配置和 IPC 读取契约可用 | 凭证、本地设置、主进程 | secret scan、IPC 单测 |
| ITEM-002 | TASK-003, TASK-004 | TASK-001 | 多站快照、轮询和状态 UI 可用 | 网络、数据归一化、renderer | adapter 单测、状态测试、截图 |
| ITEM-003 | TASK-005 | TASK-004 | 窗口/气泡/菜单栏切换可用 | Electron 生命周期、布局 | Electron smoke、紧凑尺寸截图 |
| ITEM-004 | TASK-006 | TASK-001, TASK-003 | 确认后切组并按服务端刷新 | admin 权限、远程写入 | mutation 单测、确认失败路径 |
| ITEM-005 | TASK-007, TASK-008 | TASK-002..006 | verify、审查、报告和交付工件完整 | workflow、测试、交付 | doctor、verify、报告 |

### Phase 0：澄清与预研

- 初始化 npm/Electron 工程并确认 Electron 主进程、preload、renderer 的真实入口。
- 固化 Sub2API DTO：profile、groups、rates、channels、admin accounts/groups。
- 选择 `safeStorage` + 小型本地 JSON 设置方案；不保存明文密码。

### Phase 1：结构与接口

- 建立 `src/shared` 类型与 IPC 通道白名单。
- 建立 `src/main/sub2api` 的站点客户端、响应校验、超时/取消和错误分类。
- 建立 per-station snapshot store 与 polling scheduler。
- 增加临时 partition 的站点网页登录授权窗口；仅捕获 localStorage 中的登录 token pair。
- 增加 refresh token 轮换和管理员 `x-api-key` header 适配。

### Phase 2：实现与联调

- 实现站点设置和监控面板。
- 实现完整窗口、置顶模式、气泡入口、Tray popover。
- 实现管理员账号/分组浏览、确认对话框和刷新链路。

### Phase 3：验证与交付

- 添加单元、IPC、状态和 renderer 交互测试。
- 启动 Electron，走成功、单站失败、鉴权失败、价格不可用和切组失败路径。
- 运行 `npm run verify`、代码审查、生成中文验证报告，等待用户验收。

## 5. 测试策略

- 自动化验证：TypeScript typecheck、lint、适配层单测（登录刷新、普通分组、管理员 JWT/API Key）、IPC 契约测试、renderer 状态测试、构建。
- 手工验证：主窗口、置顶、气泡、菜单栏、窄窗口、键盘焦点、重试和确认对话框。
- 不覆盖项：真实生产站点写操作、macOS 公证/签名、自动更新、跨平台安装包。

### 影响到验证映射

| 影响维度 | 验证方法 | 预期证据 | 阻断条件 |
| --- | --- | --- | --- |
| 用户影响 | Electron visible smoke | 主窗口/紧凑窗口/菜单栏截图与点击路径 | 无桌面可见自动化时标记风险 |
| 数据/接口 | adapter fixtures + response validation | 不同 API 能力的归一化结果 | 上游响应未提供样本 |
| 安全/权限 | secret scan + IPC boundary test | token 不进入 renderer/log；无 admin 不可写 | native safeStorage 不可用 |
| 性能/资源 | timer cleanup test + bounded polling | 窗口销毁无活跃 timer；并发受限 | 未有真实多站样本 |
| 远程写入 | mutation mock + confirm path | 只在确认后提交，失败可重试 | 不连接真实站点 |

## 6. 风险与回退

- 风险 1：Sub2API 站点版本不同导致字段缺失；通过 schema 校验、能力降级和站点级错误隔离处理。
- 风险 2：macOS 菜单栏弹层与窗口焦点行为需要真实桌面验证；自动化不可用时保留精确手工路径和截图风险。
- 风险 3：本地凭证存储依赖平台能力；若 `safeStorage` 不可用，阻止保存并提示用户，不回退到明文。
- 回退方式：删除 `src/`、package 配置和 `DESIGN.md` 等 feature 变更即可回退；不需要修改 Sub2API 服务端或数据库。任何远程切组失败均以服务端原状态为准。

## 7. 计划确认

- 需要确认：是（controlled 任务）
- 用户选择：确认执行
- 确认版本：计划 v2
- 范围变化：认证模型由手工 Bearer 令牌扩展为网页登录授权、refresh token 和管理员凭据类型；普通分组仍严格使用 `/groups/available`。

## 8. 上游关联诊断与自动配对 v1

| 子任务 | 完成条件 | 证据 |
| --- | --- | --- |
| TASK-012 | 快照区分 Key 未配置、可用、过期和不可用 | Sub2API client fixture |
| TASK-013 | 指纹关联只在唯一命中时建立，短暂读取失败不清空已证实关系 | 主进程边界审阅与回归测试 |
| TASK-014 | 基址/倍率唯一候选先展示预览，确认后才持久化 | ranking helper 与 UI 路径 |
| TASK-015 | 账号状态说明阻断原因；关闭调度排除使用中 | renderer 状态审阅 |
| TASK-016 | 通过全量测试、构建、打包与可见验证 | `npm run verify`、package 结果 |
