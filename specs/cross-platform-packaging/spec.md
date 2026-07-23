# 功能规格说明：跨平台 DMG 与 Windows 安装包

**功能标识**: `cross-platform-packaging`
**功能目录**: `specs/cross-platform-packaging`
**创建日期**: 2026-07-24
**状态**: 执行中
**原始需求**: 支持 Windows，并可打包 macOS DMG 与 Windows EXE 安装包。
**任务通道**: controlled
**需求版本**: v1
**确认状态**: 用户已于 2026-07-24 确认“跨平台打包正式实施包 v1”
**业务语义确认**: not_required / pending / confirmed

## 1. 业务背景与目标

- 业务背景：现有构建脚本仅在 macOS 打包 `.app`，没有 DMG 或 Windows 安装包能力。
- 本次目标：提供 macOS arm64 DMG 与 Windows x64 NSIS EXE 的可重复构建链，并补齐原生图标和文档。
- 非目标：MSI、Windows ARM64、macOS Intel、签名、公证、自动更新、远端发布。

## 2. 用户场景与验收

### 场景 1 - 构建 macOS DMG（优先级：P1）

描述：开发者在 Apple Silicon Mac 上构建可分发的 DMG。

验收：

1. **Given** 已安装依赖，**When** 执行 `npm run package:dmg`，**Then** `release/` 生成可挂载的 arm64 DMG，应用可启动。

### 场景 2 - 构建 Windows 安装包（优先级：P1）

描述：开发者在 Windows x64 环境构建单用户安装程序。

验收：

1. **Given** Windows x64 开发环境，**When** 执行 `npm run package:win`，**Then** `release/` 生成 NSIS EXE，可安装、启动和卸载。

## 3. 事项清单

### ITEM-PKG-001：macOS DMG 构建

- 目标：通过 electron-builder 输出 arm64 DMG，同时保留旧 `.app` 脚本。
- 完成结果：新增 `package:dmg` 与 macOS 构建配置。
- 验收标准：DMG 产物可挂载且应用可启动。
- 依赖：Electron 构建依赖、原生 ICNS。
- 状态：executing

### ITEM-PKG-002：Windows x64 NSIS 构建

- 目标：在 Windows 原生环境输出单用户 NSIS EXE。
- 完成结果：新增 `package:win`、Windows构建配置与 ICO。
- 验收标准：Windows 上生成、安装、启动、卸载成功。
- 依赖：Windows runner；当前 macOS 无 Wine。
- 状态：executing

### ITEM-PKG-003：跨平台原生外壳与文档

- 目标：窗口和托盘加载可用的平台图标，并说明平台差异。
- 完成结果：Windows 系统托盘有图标，README 列出命令和未签名风险。
- 验收标准：Mac 可见状态栏图标；Windows 验收路径明确。
- 依赖：ITEM-PKG-001、ITEM-PKG-002。
- 状态：executing

## 4. 业务规则与边界

- 规则 1：Windows 用系统托盘代替 macOS 顶部状态栏；窗口关闭仍沿用现有非 macOS 退出行为。
- 规则 2：跨系统不迁移已加密的凭据，用户需重新授权。
- 边界 1：不构建 MSI，不添加签名证书、不发布 GitHub Release。
- 边界 2：当前 Mac 只验证 DMG；Windows EXE 由 Windows 设备或 runner 验收。

### 4.1 业务语义门禁

- 是否涉及 UI 文案/动作/状态/指标的业务含义：否
- 涉及术语：无业务指标语义变化。
- `语义确认 vN` / `思考确认 vN`：not_required
- 用户确认记录：不适用
- 说明：涉及账号、分组、来源站点、成本、倍率、充值比例、利润、隐藏/删除/停用等领域词时，不允许按 fast 直接修改。

## 5. 异常与边界场景

- 当 Mac 设备不是 arm64 时：不承诺 DMG 构建或运行兼容。
- 当 Windows 未签名被 SmartScreen 提示时：用户按 Windows 安全策略决定是否运行。
- 当 Windows 打包缺少原生环境时：不伪造构建成功，记录为环境未覆盖。

## 6. 功能需求

- **FR-001**：提供 `npm run package:dmg` 与 arm64 DMG 输出。
- **FR-002**：提供 `npm run package:win` 与 Windows x64 NSIS 输出。
- **FR-003**：窗口和托盘按平台加载 ICNS/ICO，并随打包资源复制。

## 7. 关键对象

- **构建配置**：package.json 内的 electron-builder 配置，是安装产物的唯一配置真值。
- **原生资源**：`assets/icon.icns` 与 `assets/icon.ico`，在安装包资源目录中供主进程读取。

## 8. 成功标准

- **SC-001**：验证命令、DMG 构建和 DMG 挂载通过。
- **SC-002**：Windows 配置由单测覆盖；Windows 原生验证步骤可重复执行。
- **SC-003**：旧 `.app` 打包链未移除，私有运行数据仍被忽略。

## 9. 假设与依赖

- 假设 1：Electron safeStorage 在 macOS 与 Windows 均由 Electron 提供受支持的本地安全存储实现。
- 假设 2：Windows 实机/runner 将在后续可用环境中完成最终安装验证。

## 10. 待澄清事项

- 无。用户已选择 EXE 而非 MSI 作为首轮 Windows 安装格式。

## 11. 确认记录

- v1：2026-07-24 已确认执行“跨平台打包正式实施包 v1”。
- fast：recorded_without_preapproval；无需执行前确认
- 业务语义变更：必须有 `语义确认 vN` / `思考确认 vN`，不适用 fast 免确认
- standard / controlled 用户选择：确认执行 / 修改事项 / 缩小范围 / 补充需求
- 变更摘要：无。
