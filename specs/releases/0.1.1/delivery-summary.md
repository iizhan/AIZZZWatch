# v0.1.1 发布 Delivery Summary

## Meta

- 发布版本：`v0.1.1`
- 发布状态：`published_with_known_risk`
- 公开地址：[GitHub Release v0.1.1](https://github.com/iizhan/AIZZZWatch/releases/tag/v0.1.1)
- 标签提交：`f67a4edc523fe308103483db5b6569ebf5f17649`

## 已完成

- 从 `featuew/cross-platform-packaging` 创建独立 `release/0.1.1`，固定应用版本为 `0.1.1`。
- 纳入本次正式发布范围：加密登录保活、NewAPI 来源只读兼容、macOS arm64 DMG、Windows x64 NSIS EXE 与最小权限 Windows CI。
- 已生成、校验 macOS DMG，并由 GitHub 原生 Windows Runner 生成、解压和校验同版本 EXE。
- 已完成自动化回归、差异检查、依赖漏洞审计和发布资产隐私检查。
- 已创建公开 Latest Release，并上传 macOS arm64 DMG 与 Windows x64 EXE；公开页面、标签、提交、资产名称、大小与发布说明均已只读复核。

## 当前状态

`published_with_known_risk`：Windows 安装、启动、系统托盘、完整/紧凑/气泡窗口与卸载仍没有可访问的 Windows 桌面可完成验证。用户已于 `2026-07-24` 明确接受这一缺口并批准 v0.1.1 按已知风险发布；该豁免只适用于当前版本，不能将缺口表述为已验证。

## 下一步

1. 尽快在 Windows x64 桌面补做安装、启动、系统托盘、三种窗口形态和卸载验收。
2. 后续版本评估 Developer ID、macOS 公证、Windows 签名与自动更新。
