# Release Notes - 0.1.1

## 基本信息

- 版本：`0.1.1`
- 发布分支：`release/0.1.1`
- 来源分支：`featuew/cross-platform-packaging`
- 目标主干：`main`
- 标签：`v0.1.1`
- 日期：`2026-07-24`

## 本次发布内容

- 新增：
  - 支持以 NewAPI 站点作为三方来源：读取当前用户余额、可用分组、模型定价和令牌分组；不把 NewAPI 管理员接口或远端写入纳入本版本。
  - 支持在本机安全存储中保存可选的网页登录账号密码；会话失效时仅在 HTTPS 原站点、限频且无验证码/二次验证时尝试恢复，遇到安全挑战会要求人工处理。
  - 新增 macOS Apple Silicon DMG 与 Windows x64 NSIS EXE 打包链，以及 Windows 原生 CI 构建。
- 修复：
  - Windows CI 打包显式禁用 electron-builder 的隐式发布，避免缺少发布令牌时构建失败。
  - 改进 NewAPI 余额与刷新 Cookie 的兼容处理；敏感 Cookie、令牌和密码保持在 Electron 主进程。
- 调整：
  - 应用元信息改为同时描述 Sub2API / NewAPI 桌面监控能力。
  - macOS 使用状态栏入口，Windows 使用系统托盘；跨系统不迁移本地加密凭据。
  - Windows CI 对本次 `release/0.1.1` 的工作流配置变更触发一次原生构建；它不会对后续普通发布分支提交自动构建。

## 验证结果

- 自动化验证：待本发布提交的 `npm run verify`、`npm run package:dmg` 和 Windows 原生 CI 完成后更新。
- 手工验证：待复核 DMG 挂载与应用元信息；Windows 安装、托盘、窗口模式和卸载需要 Windows 桌面环境的可见验收。
- 未覆盖项：不提供 MSI、Windows ARM64、macOS Intel、代码签名、公证或自动更新。

## 升级与兼容

- 是否需要迁移动作：不需要；本地站点信息和凭据仍保存在本机应用数据目录。跨操作系统或设备时请重新授权，勿复制安全存储文件。
- 对旧产物是否有影响：不影响 v0.1.0 的本地运行数据；新产物使用独立 `AIZZZWatch` 用户数据目录。
- 已知限制：两个安装包均未进行开发者代码签名；macOS 可能要求手动放行，Windows 可能显示 SmartScreen 警告。

## 风险与后续

- 剩余风险：三方站点的接口、登录流程及风控策略会变化；自动恢复不会绕过验证码、二次验证或网站限制。
- 发布后观察点：首次授权、会话恢复、NewAPI 只读快照和 Windows 安装/托盘/窗口模式。
- 后续计划：根据真实站点兼容反馈补充受控适配，并在具备签名证书后评估 macOS 公证与 Windows 签名。
