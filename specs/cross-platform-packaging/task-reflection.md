# 跨平台 DMG 与 Windows 安装包 Task Reflection

## Meta

- Feature: `cross-platform-packaging`
- Date: `2026-07-24`
- Reflection Status: `published_with_known_risk`
- Requirement / Impact / Plan / Verification Versions: `v3 / v3 / v3 / v2`
- User Acceptance: 用户于 `2026-07-24` 明确接受 v0.1.1 的 Windows 可见验收缺口并授权发布

## Task Outcome

- objective: 在不依赖本机 Windows 虚拟机的情况下，实际生成 Windows x64 NSIS EXE。
- delivered: GitHub Actions 原生 Windows 构建、7 天 EXE Artifact、`--publish never` 保护、配置测试、README 与完整验证记录。
- not delivered: Windows 安装、启动、系统托盘、窗口模式、卸载、代码签名与 MSI；公开 Release 已按用户确认的已知风险豁免完成。

## User Choices

1. choice: 选择 Windows x64 NSIS EXE 而非 MSI。
   why it mattered: 降低 WiX 依赖和跨平台构建复杂度。
2. choice: 允许使用 GitHub Windows Runner 生成 EXE Artifact。
   why it mattered: 本地 VM 路径不可访问，但仍可获得原生 Windows 构建证据。
3. choice: 在明确记录 Windows 可见验收缺口与未签名风险后发布 GitHub Release v0.1.1。
   why it mattered: 用户接受当前版本的已知风险，但该批准不适用于后续版本。

## Verification Summary

- commands run: `npm run verify`、YAML 解析、`git diff --check`。
- result: 13 个测试文件 / 181 条测试通过；GitHub Run #2 在 `windows-latest` 成功，产生 78.7 MB EXE Artifact（SHA-256 `001eb19d1e2873c7ba73234b7a87f13557547ad1b22c6c7ab6b0992be26bffe5`）。
- repair evidence: Run #1 发现 electron-builder 在 CI 内隐式发布并因没有 `GH_TOKEN` 失败；显式 `--publish never` 后成功。
- uncovered areas: Windows 安装、启动、托盘、三种窗口模式、卸载和 SmartScreen。
- residual risks: Artifact 7 天后过期，未签名安装包可能提示 SmartScreen；Actions v4 存在 Node 20 弃用警告但当前构建已在 Node 24 兼容模式成功。

## What Worked Well

- 云端原生构建将 Windows 配置从“静态通过”提升为“实际产物已生成”，并在发布边界上验证了不依赖令牌的安全策略。

## What Should Change

- 下一轮应让 Windows 实机或可访问 VM 安装 Artifact，并逐项点击托盘、窗口模式和卸载。

## User Dissatisfaction

- category: verification_gap
- evidence: 本机没有可访问的 Windows VM；已通过 GitHub Runner 完成构建，但可见 Windows 路径尚未覆盖。
- affected confirmed version: v3
- task-level correction: 使用原生云端 Runner，并禁止 electron-builder CI 隐式发布。
- repeated or high-impact workflow signal: no

## Memory Candidates

- candidate: Windows 产物发布前必须在 Windows x64 原生环境构建、安装、验证系统托盘和卸载。
  space: project-shared
  retention: pending user confirmation
  status: proposed_only

## Next Recommendation

- request confirmation from user: 下载当前 Artifact 并完成 Windows 可见安装验收，或确认本轮只验收构建链。
