# 跨平台 DMG 与 Windows 安装包 Delivery Summary

## Meta

- Feature: `cross-platform-packaging`
- Date: `2026-07-24`
- Related Request: `支持 Windows，并可打包 macOS DMG 与 Windows EXE 安装包。`
- Requirement Version: `v1`
- Impact Version: `v1`
- Plan Version: `v1`
- Verification Version: `v1`
- Delivery Status: `awaiting_user_acceptance`

## 本次完成

- 目标: 提供 macOS arm64 DMG 和 Windows x64 NSIS EXE 构建链。
- 实际完成: 新增 electron-builder、`package:dmg`、`package:win`、ICNS/ICO 资源复制、平台托盘图标选择、配置单测和 README 说明；旧 `package:mac` 仍保留。
- 未完成/未纳入: MSI、签名证书、公证、自动更新、远端 Release、Windows ARM64/macOS Intel。

## 关键改动

- 改动范围: 打包配置、主进程图标资源路径、图标生成、文档、Profile、测试和受控交付记录。
- 关键文件或模块: `package.json`、`scripts/build-icon.sh`、`src/main/index.ts`、`assets/icon.ico`、`tests/packaging-config.test.ts`。
- 重要取舍: Windows 采用每用户 NSIS EXE，不加入 MSI/WiX；macOS 使用 ad-hoc 签名但不公证。

## 验证结果

### 事项与影响证据矩阵

| 事项/验收 | 影响维度 | 实际修改 | 验证证据 | 结果 | 未覆盖/风险 |
| --- | --- | --- | --- | --- | --- |
| ITEM-PKG-001 | macOS 安装包 | electron-builder DMG 配置 | `npm run package:dmg`、DMG 校验/挂载/签名 | 通过 | 新 DMG 的可见启动受旧实例单实例锁阻断 |
| ITEM-PKG-002 | Windows 安装包 | NSIS x64 配置、ICO | 配置单测、electron-builder 配置解析 | 配置通过 | 缺少 Windows 原生构建/安装/卸载验证 |
| ITEM-PKG-003 | 原生外壳 | BrowserWindow/Tray 平台图标 | 打包资源目录检查、DMG 挂载 | 部分通过 | Windows Tray 和新 DMG 可见 UI 未单独验证 |
| ITEM-PKG-004 | 文档/回退 | README、Profile、规格记录 | 文档与差异审阅 | 通过 | 无 |

- 执行命令: `npm run build:icon`、`npm run verify`、`npm run package:dmg`、`hdiutil verify`、`hdiutil attach`、`codesign --verify --deep --strict`、`npm ls electron-builder --depth=0`、`git diff --check`。
- 自动验证结果: 13 个测试文件、180 个测试通过；TypeScript 和 production build 通过；electron-builder 26.15.3 生成 `release/AIZZZWatch-0.1.0-arm64.dmg`。
- 界面/交互验证: DMG 挂载后可确认应用、Applications 链接和平台图标资源；尝试隔离启动时被一个已经运行的旧版 AIZZZWatch 单实例接管，因此没有将旧窗口截图计为本次 UI 证据。
- 截图或 UI 报告: 无有效新包截图；旧实例截图已排除。
- 手动验证路径: 在无运行中 AIZZZWatch 的 Mac 上挂载 DMG，启动应用，检查状态栏、完整/紧凑/气泡三种窗口；在 Windows x64 上运行 `npm run package:win`，安装、启动、检查系统托盘、窗口模式和卸载。
- 未覆盖项: Windows 原生构建、安装、卸载、SmartScreen、系统托盘与网页登录恢复。
- 剩余风险: 两个未签名平台均可能触发系统安全提示；Windows 产物不得在完成原生验收前发布。

## 用户验收

- 当前状态: awaiting_user_acceptance
- 用户选择: 确认验收 / 继续修正 / 补充验证 / 重新打开事项
- 验收版本: v1
- 修订意见: 待用户反馈
- 重新打开事项: 无

## 用户选择与原因

1. 选择: Windows 首轮使用 NSIS EXE。
   原因: 用户允许 EXE 或 MSI，NSIS 不依赖 WiX/MSI 工具链。
2. 选择: 不引入签名、公证和远端发布。
   原因: 超出本次确认范围，且需要证书或远端权限。

## 复盘结论

- 做得好的地方: 从实际生成 DMG 中发现 `identity: null` 会跳过签名，及时修正为 ad-hoc 并重验。
- 建议改进的地方: 为 Windows 配置专用 runner，避免跨平台验收长期依赖手工设备。
- 不满意分类: verification_gap
- 支持证据: 当前 macOS 没有 Wine，且旧实例占用单实例锁，无法获得有效 Windows 或新包 UI 运行证据。

## 记忆与进化后续

- 记忆候选: Windows 安装包必须有 Windows x64 原生构建/安装验收后才可发布。
- 规则变更候选: 无；这是环境限制，不足以修改工程规则。
- 是否需要用户确认: 验收确认不等于允许发布或远端上传。

## 下一步建议

- 立即可继续: 在 Windows x64 环境执行 `npm install && npm run package:win`。
- 建议后续跟进: 添加受控的 Windows CI 构建，再单独确认签名、Release 与 MSI 需求。

## v0.7 Impact Scope Self-Check

- 设计方案版本：v1
- 任务拆解版本：v1
- 影响范围版本：v1
- 影响范围自查：通过；实际差异只涉及构建、资源、主进程图标、文档、测试和工作流记录，未扩大到站点 API、授权数据或远端发布。
- 用户验收：待确认
