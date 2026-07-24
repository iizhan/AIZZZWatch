# v0.1.1 发布准备 Delivery Summary

## 已完成

- 从 `featuew/cross-platform-packaging` 创建独立 `release/0.1.1`，固定应用版本为 `0.1.1`。
- 纳入本次正式发布范围：加密登录保活、NewAPI 来源只读兼容、macOS arm64 DMG、Windows x64 NSIS EXE 与最小权限 Windows CI。
- 已生成、校验 macOS DMG，并由 GitHub 原生 Windows Runner 生成、解压和校验同版本 EXE。
- 已完成自动化回归、差异检查、依赖漏洞审计和发布资产隐私检查。

## 当前状态

`awaiting_windows_visible_acceptance`：Windows 安装、启动、系统托盘、完整/紧凑/气泡窗口与卸载没有可访问的 Windows 桌面可完成验证。该状态是公开发布、打标签和合并主干前的阻断项，而不是构建失败。

## 下一步

1. 在 Windows x64 桌面安装 `AIZZZWatch Setup 0.1.1.exe`，验证启动、系统托盘、三种窗口形态和卸载。
2. 补充验证结论后，运行发布 doctor，创建 `v0.1.1` 标签，合并并推送 `main`。
3. 创建 GitHub Release，只上传已校验的 DMG 与 EXE，附带 SHA-256 和未签名提示。
