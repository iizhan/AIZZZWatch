# 跨平台 DMG 与 Windows 安装包 Task Reflection

## Meta

- Feature: `cross-platform-packaging`
- Date: `2026-07-24`
- Related Request: `支持 Windows，并可打包 macOS DMG 与 Windows EXE 安装包。`
- Reflection Status: `completed_awaiting_acceptance`
- Requirement / Impact / Plan / Verification Versions: v1 / v1 / v1 / v1
- User Acceptance: pending

## Task Outcome

- objective: 增加可重复的 macOS DMG 与 Windows EXE 构建能力。
- delivered: electron-builder 配置、DMG 实产物、NSIS 构建命令、ICO、原生图标选择、测试与文档。
- not delivered: Windows 原生打包/安装证据、MSI、代码签名、公证、远端发布。

## User Choices

List the important user choices made in this task:

1. choice: 选择 Windows x64 NSIS EXE 而非 MSI。
   why it mattered: 降低 WiX 依赖和跨平台构建复杂度。
2. choice: macOS 使用 ad-hoc 而非 Developer ID 签名。
   why it mattered: 没有引入用户证书或公证权限。

## Verification Summary

- commands run: `npm run build:icon`、`npm run verify`、`npm run package:dmg`、DMG 校验/挂载、codesign 验证。
- result: 13 个测试文件、180 个测试通过；DMG checksum 和 ad-hoc 签名有效。
- uncovered areas: Windows x64 构建/安装/卸载，新的 DMG 可见启动。
- residual risks: 旧实例导致单实例接管；未签名安装包存在系统提示。

## What Worked Well

- 发现 electron-builder 的 `identity: null` 会完全跳过签名后，使用其明确支持的 `identity: "-"` 与关闭 hardened runtime，恢复与旧链路一致的 ad-hoc 签名。

## What Should Change

- 需要 Windows 原生 runner 才能把 Windows 构建配置提升为可发布证据。

## User Dissatisfaction

- category: verification_gap
- evidence: 当前 Mac 无 Wine，运行中的旧 AIZZZWatch 吞掉了隔离新包的启动请求。
- affected confirmed version: v1
- task-level correction: 已明确报告阻断，不将旧实例截图作为证据。
- repeated or high-impact workflow signal: no

## Memory Candidates

- candidate: Windows 产物发布前必须在 Windows x64 原生环境构建、安装、验证系统托盘和卸载。
  space: project-shared
  reason: 这是跨平台发行的稳定质量门禁。
  retention: pending user confirmation
  status: proposed_only

## Rule Change Candidates

- title: 无
  target level: none
  reason: 单次环境限制，不修改流程规则。
  evidence summary: 无
  proposal file: 无
  status: not_required

## Workflow State Sync

- `session_reflections` updated: awaiting user acceptance
- `memory_candidates` updated: proposed only, not persisted to shared memory
- `rule_change_candidates` updated: none
- `evolution_updates.drafted` updated: none
- handoff notes updated: Windows native and new-DMG-visible validation remain required.

## Next Recommendation

- keep as task memory only: yes
- propose framework evolution: no
- request confirmation from user: 验收当前交付，或补充 Windows native 验证。
