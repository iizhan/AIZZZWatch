# Release Checklist - 0.1.1

- 发布分支：`release/0.1.1`
- 来源分支：`featuew/cross-platform-packaging`
- 目标主干：`main`
- 标签：`v0.1.1`
- 日期：`2026-07-24`

## 发布范围

- 本次发布包含的 feature：`password-keepalive`、`newapi-station-compatibility`、`cross-platform-packaging`。
- 用户可见变化：可选本地加密保活、NewAPI 来源站兼容、macOS arm64 DMG、Windows x64 EXE。
- 是否包含流程/skill 变化：包含对应规格、测试和交付记录；不改变应用业务数据结构或远端站点权限。
- 是否存在 breaking change：否；NewAPI 管理员控制台、MSI、Windows ARM64、macOS Intel、代码签名/公证不在范围内。

## 验证前置

- [x] code review 已完成
- [x] 测试报告已完成
- [x] delivery summary 已更新
- [x] release notes 已更新
- [x] 打包或发布前验证已通过（Windows 可见验收例外见验证报告）
- [x] 远端 push / npm publish 已获得显式批准（如适用）
- [x] 用户已于 `2026-07-24` 明确接受 Windows 可见验收缺口，批准按已知风险发布 `v0.1.1`

## 发布动作

- [x] 创建 `release/0.1.1`
- [ ] 运行 `bash .specify/scripts/bash/release-doctor.sh 0.1.1`
- [ ] 复核版本号与发布说明
- [ ] 创建标签 `v0.1.1`
- [ ] 合并到 `main`
- [ ] 推送主干与 tag

## 发布后检查

- [ ] 关键路径抽样验证
- [ ] 记录遗留风险
- [ ] 清理已完成的临时分支
