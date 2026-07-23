# Release Checklist - 0.1.0

- 发布分支：`release/0.1.0`
- 来源分支：`feature/sub2api-monitor`
- 目标主干：`main`
- 标签：`v0.1.0`
- 日期：`2026-07-23`

## 发布范围

- 本次发布包含的 feature：`sub2api-monitor` 初始公开版本。
- 用户可见变化：macOS 菜单栏/置顶/气泡窗口、来源钱包与价格榜、站点适配、聚合站管理、成本保护与收益归档。
- 是否包含流程/skill 变化：是，包含项目 Profile、发布守卫、开源隐私检查和受控工作流资产。
- 是否存在 breaking change：无历史公开版本；本次为首发。

## 验证前置

- [x] code review 已完成
- [x] 测试报告已完成
- [x] delivery summary 已更新
- [x] release notes 已更新
- [x] 打包或发布前验证已通过
- [x] 远端 push / npm publish 已获得显式批准（如适用）

## 发布动作

- [x] 创建 `release/0.1.0`
- [x] 运行 `bash .specify/scripts/bash/release-doctor.sh 0.1.0`
- [x] 复核版本号与发布说明
- [ ] 创建标签 `v0.1.0`
- [ ] 合并到 `main`
- [ ] 推送主干与 tag

## 发布后检查

- [ ] 关键路径抽样验证
- [x] 记录遗留风险
- [ ] 清理已完成的临时分支
