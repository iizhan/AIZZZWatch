# 验证报告 v1：v0.1.1 发布准备

## 关联版本

- 正式实施包：`v0.1.1 发布正式实施包 v1`
- 发布分支：`release/0.1.1`
- 校验提交：`22ea9d79b5f68860834f55f99e99d2f36e124853`
- 结果状态：`verified_with_risk`

## 事项与影响证据矩阵

| 事项 | 影响 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- |
| 版本与发布范围 | 包元数据、发布说明 | `package.json` / `package-lock.json` 均为 `0.1.1`；发布分支独立 | 通过 | 无 |
| 应用回归 | Electron 主进程、NewAPI、保活、打包配置 | `npm run verify`：13 个测试文件、181 条测试、类型检查、生产构建均通过 | 通过 | 真实三方站点登录不作为发布自测的一部分 |
| macOS arm64 DMG | 可分发安装镜像 | `npm run package:dmg`；`hdiutil verify`；挂载；`codesign --verify --deep --strict` | 通过 | `spctl` 因未公证/未签名而拒绝，属已声明限制 |
| Windows x64 NSIS EXE | 可分发 Windows 安装包 | GitHub [Run #3](https://github.com/iizhan/AIZZZWatch/actions/runs/30080595570) 成功；Artifact 解压得到单个 EXE，`file` 识别为 NSIS installer | 构建通过 | 未在 Windows 可见桌面完成安装、托盘、窗口模式与卸载 |
| 隐私与安全 | 凭据、发布资产、依赖 | 令牌模式扫描无命中；Git 忽略规则覆盖运行数据；`npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org` 为 0 漏洞 | 通过 | 默认 npm 镜像不支持审计端点，改用 npm 官方只读审计端点 |

## 安装包哈希

- `AIZZZWatch-0.1.1-arm64.dmg`：`34d687f7494f6b56b423418eafd9bad299fa2b183364f96bb099deb7bc9ebd99`
- `AIZZZWatch Setup 0.1.1.exe`：`23e3e157d69f1f1530897f777944363d764c136311c59dd485fc8a1f6bb974d1`

## 差异与安全自查

- `git diff --check main...release/0.1.1` 通过。
- 发布范围只含加密保活、NewAPI 只读兼容、macOS DMG / Windows NSIS 及其规格与发布文档。
- 不包含 `stations.json`、`ui-preferences.json`、用户数据目录、Cookie、JWT、API Key、HAR、私有截图、`release/` 或 `out/`。
- 本次仅新增受限 `release/0.1.1` 的一次 Windows CI 触发，普通发布分支不会自动构建。

## 残余风险与发布豁免

Windows CI 的构建成功不能替代可见桌面验收。按照项目 Profile，Windows 安装、系统托盘、完整/紧凑/气泡窗口与卸载仍未完成，不能表述为已验证。

用户已于 `2026-07-24` 以“确认按已知风险发布 v0.1.1”明确豁免上述当前版本的发布阻断项。因此，本次允许创建公开 GitHub Release、标签并合并 `main`，但 Release Notes 必须继续保留 Windows 可见验收缺口与未签名提示；该豁免不构成后续版本的通用发布批准。
