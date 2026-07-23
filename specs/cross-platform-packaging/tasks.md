# 执行任务：跨平台 DMG 与 Windows 安装包

**功能标识**: `cross-platform-packaging`
**日期**: 2026-07-24
**关联计划版本**: v1
**确认状态**: controlled: 已确认执行 v1

## 1. 准备阶段

- [x] 完成需求确认（跨平台打包正式实施包 v1）
- [x] 完成代码库摸底
- [x] 完成范围锁定
- [x] 完成技术方案

## 2. 事项与子任务

### ITEM-PKG-001：DMG、Windows EXE 与原生资源

- 验收标准：DMG 可构建/挂载/启动；Windows 命令与安装路径可在原生环境执行；旧 Mac `.app` 命令仍可用。
- 影响范围：构建配置、图标、Electron 主进程、文档、测试和规格。
- 状态：verifying

- [x] TASK-PKG-001：记录规格、影响、计划与已确认边界
  - 依赖：无
  - 完成条件：规格的版本和确认记录完整。
  - 验证证据：spec.md、plan.md 与 workflow-state.yaml。
- [x] TASK-PKG-002：配置 electron-builder 与 DMG/NSIS 命令
  - 依赖：TASK-PKG-001
  - 完成条件：新命令和产物配置被单测覆盖。
  - 验证证据：package.json、package-lock.json、package-config 测试。
- [x] TASK-PKG-003：生成 ICO 并让主窗口/托盘选择平台资源
  - 依赖：TASK-PKG-002
  - 完成条件：资源在打包后可按平台读取，Mac 状态栏不回退为空图标。
  - 验证证据：资源检查、DMG 启动和 UI 报告。
- [x] TASK-PKG-004：同步 README 与受控交付信息
  - 依赖：TASK-PKG-002
  - 完成条件：命令、平台边界、未签名风险和凭据迁移边界明确。
  - 验证证据：文档审阅。

## 3. 验证任务

- [x] 执行自动化检查
- [x] 完成关键链路手工验证（DMG 校验、挂载、签名；隔离启动被运行中旧实例阻断）
- [x] 完成代码审查
- [x] 输出测试报告

## 4. 范围变化记录

- 发现时间：
- 新增/变化影响：
- 受影响事项/子任务：
- 是否暂停：
- 重新确认版本：

## v0.7 Formal Confirmation Addendum

- 设计方案版本：v1
- 任务拆解版本：v1
- 影响范围版本：v1
- 验收与自测计划：DMG 实测；Windows 原生验收路径；自动化与差异审查。
- 用户确认：2026-07-24 确认执行
