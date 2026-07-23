# 执行任务：Sub2API 实时分组监控

**功能标识**: `sub2api-monitor`
**日期**: 2026-07-16
**关联计划版本**: v2
**确认状态**: controlled / confirmed

## 1. 准备阶段

- [x] 完成需求确认（需求与影响 v1）
- [x] 完成代码库摸底（空仓库；Profile 已刷新）
- [x] 完成范围锁定（影响 v1 = high）
- [x] 完成技术方案并确认（计划 v1）

## 2. 事项与子任务

### ITEM-001：多站连接与安全配置

- 验收标准：站点配置可增删改；敏感值只在主进程/安全存储；读取上下文和管理员上下文分离。
- 影响范围：本地设置、IPC、凭证生命周期。
- 状态：verifying

- [x] TASK-001：初始化 Electron + React + TypeScript 工程与验证脚本
  - 依赖：无
  - 完成条件：`npm run dev`、`npm run build`、`npm run typecheck` 入口存在且可执行。
  - 验证证据：构建日志和 typecheck 结果。
- [x] TASK-002：实现安全设置存储与最小 IPC 配置契约
  - 依赖：TASK-001
  - 完成条件：renderer 无权读取原始 token；无 safeStorage 时拒绝明文持久化。
  - 验证证据：IPC 单测、secret scan、renderer payload 检查。

### ITEM-002：实时余额、分组倍率与价格监控

- 验收标准：每站独立轮询和状态；余额/倍率/价格正确降级；支持刷新和重试。
- 影响范围：外部 HTTP、响应校验、定时器、dashboard state。
- 状态：verifying

- [x] TASK-003：实现 Sub2API 客户端、DTO 归一化与错误分类
  - 依赖：TASK-001
  - 完成条件：覆盖用户读取接口；超时、401/403、禁用价格接口和结构异常有稳定错误码。
  - 验证证据：fixture 单测和边界测试。
- [x] TASK-004：实现快照缓存、轮询调度和监控面板
  - 依赖：TASK-002, TASK-003
  - 完成条件：默认 30 秒；单站失败隔离；加载、空、成功、stale、错误、重试可见。
  - 验证证据：scheduler 测试、renderer 交互测试、可见截图。

### ITEM-003：窗口、气泡和菜单栏形态

- 验收标准：完整窗口、置顶、气泡、Tray 摘要均可进入/退出，紧凑尺寸无关键操作丢失。
- 影响范围：Electron 窗口生命周期、系统菜单栏、响应式 CSS。
- 状态：verifying

- [x] TASK-005：实现窗口模式状态机与 macOS Tray/bubble 行为
  - 依赖：TASK-004
  - 完成条件：窗口模式切换不丢快照，销毁时清理 listener/timer，焦点可恢复。
  - 验证证据：Electron smoke、窗口尺寸截图、手工键盘路径。

### ITEM-004：管理员账号分组切换

- 验收标准：管理员读取账号/分组；确认后提交 `group_ids`；成功刷新，失败可重试且不做乐观写入。
- 影响范围：权限、远程写入、确认对话框、错误恢复。
- 状态：verifying

- [x] TASK-006：实现管理员账号/分组浏览与确认切组
  - 依赖：TASK-002, TASK-003, TASK-004
  - 完成条件：无 admin 上下文不可提交；确认框展示完整变更；服务端结果覆盖本地状态。
  - 验证证据：mutation mock、权限测试、成功/失败 UI 路径。

### ITEM-005：状态反馈、测试与交付闭环

- 验收标准：自动检查、可见路径、审查和中文验证报告完成。
- 影响范围：workflow 工件、脚本、测试和交付状态。
- 状态：verifying

- [x] TASK-007：补充测试、DESIGN.md 约束和项目 Profile
  - 依赖：TASK-001..006
  - 完成条件：所有实现遵循 `DESIGN.md` 和本地 skills，测试覆盖关键边界。
  - 验证证据：`npm run verify`、Profile capture、diff review。
- [x] TASK-008：完成代码审查、验证报告和会话总结
  - 依赖：TASK-007
  - 完成条件：输出 `验证报告 v1`，标明 UI 证据、未覆盖项和用户验收选项。
  - 验证证据：`delivery-summary.md`、`task-reflection.md`、session history。

### 认证修订 v2

- [x] TASK-009：实现隔离网页登录授权与安全令牌捕获
  - 依赖：TASK-002
  - 完成条件：登录窗口使用临时 partition、sandbox、无 preload；只接收站点生成的 access/refresh token，并在关闭后清理会话。
  - 验证证据：主进程源码审查、typecheck、可见登录路径待真实站点联调。
- [x] TASK-010：实现 refresh token 轮换与管理员凭据类型
  - 依赖：TASK-003, TASK-009
  - 完成条件：access token 401 时最多刷新并重试一次；管理员 JWT 使用 Bearer，管理员 API Key 使用 `x-api-key`。
  - 验证证据：适配层测试、构建和凭证扫描。
- [x] TASK-011：更新设置页登录入口、备用令牌和认证状态
  - 依赖：TASK-009, TASK-010
  - 完成条件：用户可启动网页登录授权；手工 JWT、refresh token 和管理员凭据为备用/可选入口；renderer 不显示已保存令牌原文。
  - 验证证据：typecheck、生产构建、手工 Electron 路径。

## 3. 验证任务

- [x] 执行自动化检查
- [x] 完成关键链路手工验证
- [x] 完成代码审查
- [x] 输出测试报告

## 4. 范围变化记录

- 发现时间：
- 新增/变化影响：
- 受影响事项/子任务：
- 是否暂停：
- 重新确认版本：

- v2 变化：普通账号的“全部分组”明确为 `/groups/available` 返回的全部可用分组；不扩大为管理员全站分组。

### 上游关联诊断与自动配对 v1

- [x] TASK-012：增加上游 Key 读取状态和候选关联 DTO。
- [x] TASK-013：保留短暂 Key/管理员账号读取失败前的已证实指纹关系。
- [x] TASK-014：将自动候选改为“扫描关联 → 预览 → 确认保存”。
- [x] TASK-015：增加账号来源状态原因、Key 读取提示，并排除关闭调度账号。
- [x] TASK-016：补充客户端和候选重建回归测试，完成构建与打包。
