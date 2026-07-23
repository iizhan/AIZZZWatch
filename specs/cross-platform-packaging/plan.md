# 实施方案：跨平台 DMG 与 Windows 安装包

**功能标识**: `cross-platform-packaging`
**功能目录**: `specs/cross-platform-packaging`
**日期**: 2026-07-24
**关联需求版本**: v1
**影响版本**: v1
**计划版本**: v1
**确认状态**: controlled: 已确认执行
**业务语义确认**: not_required / pending / confirmed

## 1. 需求摘要

- 本次要解决的问题：现有 Electron 打包只生成 macOS `.app`，缺少 DMG 和 Windows 安装能力。
- 用户可见结果：开发者可构建 arm64 DMG；Windows x64 环境可构建 NSIS EXE；两端都有正确应用/托盘图标。
- 范围边界：不加入 MSI、签名、公证、自动更新、Release 或远端操作。

## 2. 锁定范围

- 建议范围：构建配置、图标资源、主进程原生图标选择、文档和验证记录。
- 影响等级：high；影响可分发安装包、跨操作系统运行与本地凭据迁移边界。
- 直接影响：`package.json`、锁文件、`scripts/build-icon.sh`、`assets/`、`src/main/index.ts`、README、测试、规格记录。
- 间接影响/可能联动：Electron 打包时需复制托盘资源；Windows 原生构建需要本机或 runner。
- 用户影响：Windows 用系统托盘替代顶部状态栏；首次运行可能遇到未签名安全提示。
- 数据与迁移影响：无数据格式迁移；macOS Keychain 与 Windows DPAPI 凭据不能互迁。
- 接口/配置契约影响：仅新增 npm 构建命令，不改变站点 API、IPC 或本地设置结构。
- 安全与权限影响：不接触凭据内容；维持主进程和 safeStorage 边界；安装包不签名。
- 兼容性影响：目标为 macOS arm64 与 Windows x64；不承诺 MSI、Windows ARM64 或 macOS Intel。
- 性能与资源影响：仅构建期增加 electron-builder 和产物体积，运行期只加载一个原生图标。
- 测试影响：Mac 可执行 DMG 实测；Windows 需原生环境进行安装/卸载验收。
- 发布与回滚影响：不发布远端；删除新增配置可回退，旧 package:mac 保持不变。
- Workflow/Skill 影响：已验证工程治理 Workflow；无专用打包场景 Workflow。
- 明确不影响：业务数据、站点权限、授权流程、收益计算、远端管理写入。
- 未知项与置信度：Windows 最终安装验收待 Windows 环境，置信度 confirmed for config / unknown for runtime.
- 业务语义影响：是否改变 UI 术语、动作、状态或指标的理解；若涉及账号/分组/来源站点/成本/倍率/充值比例/利润/隐藏/删除/停用，需记录 `语义确认 vN`

## 3. 技术上下文

- 技术栈：`Electron + React + TypeScript`
- 主应用目录：`.`
- 配置输出：`(none)`
- 相关模块：`scripts/package-mac.mjs`、`scripts/build-icon.sh`、`src/main/index.ts`、`package.json`。
- 复用点：保留 `package:mac`，复用现有 `assets/icon.svg` 和 Electron BrowserWindow/Tray 生命周期。

## 4. 实现策略

### 事项到子任务映射

| 事项 | 子任务 | 依赖 | 完成条件 | 影响范围 | 验证证据 |
| --- | --- | --- | --- | --- | --- |
| ITEM-PKG-001 | TASK-PKG-001 | 无 | DMG 配置和命令可运行 | package.json、锁文件 | package-config 单测、DMG 构建/挂载 |
| ITEM-PKG-002 | TASK-PKG-002 | TASK-PKG-001 | NSIS 配置和 ICO 可供 Windows 使用 | package.json、assets、icon 脚本 | package-config 单测、Windows 手动路径 |
| ITEM-PKG-003 | TASK-PKG-003 | TASK-PKG-002 | BrowserWindow/Tray 使用平台图标 | src/main/index.ts | 构建、Mac 可见路径、Windows 手动路径 |
| ITEM-PKG-004 | TASK-PKG-004 | TASK-PKG-001 | 文档与交付记录说明边界 | README、specs | 文档审阅、隐私检查 |

### Phase 0：澄清与预研

- 已完成：Profile 复用、打包模块摸底、Workflow 验证、当前 Mac 环境检查。

### Phase 1：结构与接口

- 新增 electron-builder 配置与两个脚本；不替换旧 packager 流程。

### Phase 2：实现与联调

- 生成 ICO，按 `app.isPackaged` 解析平台资源路径，更新主窗口和托盘。

### Phase 3：验证与交付

- 运行自动化检查、DMG 构建/挂载/启动、差异审阅；报告 Windows 原生验证缺口。

## 5. 测试策略

- 自动化验证：`npm run verify`、`npm run package:dmg`、打包配置单测。
- 手工验证：挂载 DMG 并启动，查看状态栏入口、主窗口、置顶和气泡。
- 不覆盖项：Windows 安装/卸载/托盘只能在 Windows 原生环境验证。

### 影响到验证映射

| 影响维度 | 验证方法 | 预期证据 | 阻断条件 |
| --- | --- | --- | --- |
| 构建配置 | package-config 单测、构建命令 | 构建产物与命令输出 | 配置不被 electron-builder 识别 |
| macOS 安装包 | DMG 构建、挂载、启动 | `release/*.dmg`、可见 UI 报告 | DMG 缺失或应用无法启动 |
| Windows 安装包 | 原生 Windows 命令/安装 | EXE、安装验收记录 | 当前环境无 Windows runner |
| 原生图标 | 打包资源检查、可见 macOS 状态栏 | 资源存在、截图/UI 报告 | 图标为空或资源丢失 |
| 隐私与回退 | Git 忽略与差异审阅 | `git diff --check`、状态 | 私有数据或生成物被纳入 |

## 6. 风险与回退

- 风险 1：未签名产物会有系统安全提示；明确记录，不绕过系统提示。
- 风险 2：当前 Mac 没有 Wine，无法假称 Windows EXE 已实测。
- 回退方式：移除 electron-builder 配置、ICO 和图标选择逻辑；旧 package:mac 独立存在。

## 7. 计划确认

- 需要确认：否，用户已经确认正式实施包 v1。
- 业务语义确认：不涉及 / 已确认版本 / 待确认（待确认时不得进入实现）
- 用户选择：确认执行
- 确认版本：跨平台打包正式实施包 v1
- 范围变化：无

## v0.7 Formal Confirmation Addendum

- 设计方案版本：v1
- 任务拆解版本：v1
- 影响范围版本：v1
- 验收与自测计划：verify、DMG 构建/挂载/启动、Windows 原生待验收路径、差异审查。
- 用户确认：2026-07-24 确认执行

standard / controlled 正式实现前必须确认上述版本；实质范围变化时更新为 vN+1。
