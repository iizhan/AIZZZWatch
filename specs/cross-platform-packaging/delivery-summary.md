# 跨平台 DMG 与 Windows 安装包 Delivery Summary

## Meta

- Feature: `cross-platform-packaging`
- Date: `2026-07-24`
- Related Request: `支持 Windows，并可打包 macOS DMG 与 Windows EXE 安装包。`
- Requirement / Impact / Plan Version: `v3 / v3 / v3`
- Verification Version: `v2`
- Delivery Status: `published_with_known_risk`

## 本次完成

- 已提供 macOS arm64 DMG 与 Windows x64 NSIS EXE 构建链。
- 新增最小权限的 GitHub Actions Windows 构建：`windows-latest` 执行 `npm ci` 和 `npm run package:win`，仅上传 7 天 EXE Artifact；不创建 Release、不使用 secrets。
- `package:win` 显式加上 `--publish never`，避免 electron-builder 在 CI 中隐式尝试发布。
- 已在 GitHub 原生 Windows Runner 完成一次成功构建：Run #2，提交 `aeb59b6`，用时 1 分 45 秒。
- 未纳入：MSI、代码签名、公证、自动更新、Windows ARM64、macOS Intel。
- 发布后：用户已为 v0.1.1 明确豁免 Windows 可见验收缺口；公开 [GitHub Release v0.1.1](https://github.com/iizhan/AIZZZWatch/releases/tag/v0.1.1) 已创建并标记 Latest，包含 macOS DMG 与 Windows EXE。

## 关键改动

- `.github/workflows/windows-package.yml`：当前功能分支仅在此工作流文件变化时触发首轮构建；进入默认分支后支持 `workflow_dispatch` 手动构建。
- `package.json`：Windows NSIS 构建明确禁止发布。
- `tests/packaging-config.test.ts`：覆盖 CI 触发、最小权限、Windows Runner、EXE-only Artifact 和禁止发布配置。
- `README.md`：补充 Artifact 下载和仍需 Windows 可见验收的边界。

## 验证结果

### 事项与影响证据矩阵

| 事项/验收 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- |
| ITEM-PKG-001 macOS DMG | `npm run package:dmg`、DMG 校验/挂载、签名验证 | 通过 | 新 DMG 的独立可见启动仍受旧实例单实例锁干扰 |
| ITEM-PKG-002 Windows EXE | GitHub `windows-latest` 运行 `npm run package:win` 成功 | 构建通过 | 尚未安装运行/卸载 |
| ITEM-PKG-003 原生外壳 | 包含 ICO、打包配置与原生 Windows EXE | 部分通过 | Windows 系统托盘、完整/紧凑/气泡窗口未在可见桌面验收 |
| ITEM-PKG-004 文档与回退 | README、规格、隐私边界和差异审阅 | 通过 | 无 |
| ITEM-PKG-005 Windows CI Artifact | [Run #2](https://github.com/iizhan/AIZZZWatch/actions/runs/30065500320) 成功；1 个 Artifact | 通过 | Artifact 7 天后过期，非正式 Release |

- 本地命令：`npm run verify`、YAML 解析、`git diff --check`。
- 本地结果：13 个测试文件、181 条测试、TypeScript 检查和生产构建全部通过。
- 云端结果：Artifact `AIZZZWatch-win-x64-aeb59b69c1dfa967b32faebf4e793f4bb057269e`，78.7 MB，SHA-256 `001eb19d1e2873c7ba73234b7a87f13557547ad1b22c6c7ab6b0992be26bffe5`。
- 修复记录：Run #1 因 electron-builder 识别 CI 后尝试隐式发布、缺少 `GH_TOKEN` 失败；加 `--publish never` 后 Run #2 成功。GitHub 仍提示 v4 Actions 的 Node 20 弃用警告，但当前运行被 Runner 强制切到 Node 24 并成功；后续应留意 Actions 主版本升级。
- 可见验证：未在 Windows 桌面中安装 Artifact；不能把云端构建成功等同于托盘、窗口模式和卸载成功。

## 用户选择与原因

1. 使用 Windows x64 NSIS EXE，而非 MSI：避免 WiX 工具链。
2. 采用 GitHub 原生 Windows Runner：不依赖当前不可访问的本地虚拟机。
3. 不创建 Release、签名或远端标签：保持本轮仅构建与 Artifact 验证。

## 复盘结论

- 做得好的地方：通过真实 Windows CI 发现并修复了隐式发布行为，而不是仅做静态配置判断。
- 不满意分类：`verification_gap` 已缩小；Windows 原生构建已完成，但桌面可见安装路径未覆盖。
- 影响范围自查：实际改动限于构建脚本、工作流、测试、README、Profile 与交付记录；未触及站点 API、授权数据、收益计算或远端站点写入。

## 记忆与进化后续

- 记忆候选仍为：正式发布前必须完成 Windows x64 的安装、启动、系统托盘、三种窗口模式和卸载验证；尚未写入项目共享决策。
- 规则变更候选：无。

## 下一步建议

1. 从 [Run #2 Artifact](https://github.com/iizhan/AIZZZWatch/actions/runs/30065500320/artifacts/8586100313) 下载 ZIP，在 Windows 上解压并运行 `AIZZZWatch Setup 0.1.0.exe`。
2. 验证安装、启动、系统托盘、完整/紧凑/气泡窗口与卸载后，再确认是否进入 Release、代码签名或 MSI 方案。
