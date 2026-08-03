# Sub2API v0.1.170 升级验证报告 v4

状态：verified / awaiting_user_acceptance

## 验证范围

- 已确认版本：升级包 v1。
- 目标仓库：`/Users/bing/Myself/Code/MacTools/Watch_Sub2Api`。
- 分支：`feature/sub2api-operations-v0.1.170`。
- 官方基线：`v0.1.170`，提交 `c043c2477` 已是当前 HEAD 的祖先。
- 本轮不包含推送、生产部署、生产配置/数据库修改或退款。

## 事项与影响证据矩阵

| 事项/影响 | 证据 | 结果 |
| --- | --- | --- |
| 合并官方 v0.1.170 | 合并提交 `8193d393a`；祖先检查通过 | 通过 |
| 保留 Watch 定制能力 | 智能运营 8 个入口可见；6 个数据页逐页加载无 alert | 通过 |
| 保留安全故障转移 | handler/service/repository 聚焦测试；失败 attempt 固定 `not_billable` | 通过 |
| 官方利润控制兼容 | 分组创建弹窗可见“启用利润控制”；利润 veto 与 failover 合并测试通过 | 通过 |
| 官方倍率探测/同步 | 账号列表可见探测状态与立即探测入口；编辑弹窗可见自动探测和同步开关 | 通过 |
| migration 兼容 | 本地 PostgreSQL 已登记官方 `192/193` 与 Watch/故障转移 `301-313` | 通过 |
| 前端兼容 | 全量 Vitest 207 文件 / 1430 项、vue-tsc、生产 build | 通过 |
| 后端兼容 | service、repository、handler、handler/admin 回归及聚焦测试 | 通过 |
| 运行版本 | 最新 embed `index-CqfKc7JX.js`；侧栏显示 `v0.1.170 · 已是最新版本` | 通过 |
| 窄屏回归 | 1024x768 下 pricing/mappings/settings/groups/accounts 无整页横向溢出 | 通过 |
| 安全边界 | 高置信敏感扫描无命中；未读取或输出凭据；无生产外部效果 | 通过 |

## 执行命令

- `go test ./internal/service`
- `go test ./internal/repository`
- `go test ./internal/handler`
- `go test ./internal/handler/admin`
- failover 非计费、partial usage、OpenAI 429、refund、migration、profit veto 聚焦测试
- `pnpm --dir frontend exec vitest run --sequence.concurrent=false`
- `pnpm --dir frontend exec vue-tsc --noEmit`
- `pnpm --dir frontend run build`
- `docker exec sub2api-watch-local /usr/local/go/bin/go test ./cmd/server`
- `git diff --check`
- 本地 Docker health、迁移表、embed 哈希与可见浏览器验证

## 代码与安全审查

- 未发现阻断级、高优先级或需要扩大范围的问题。
- 合并冲突仅位于 `failover_loop.go`，保留动态状态码/次数配置，并合入官方利润 veto 上限与防空转逻辑。
- 失败 attempt 的服务实现只能估算 Token 并写审计，没有余额结算入口；成功请求仍使用标准 usage 幂等计费。
- refund ledger 仍只提供 dry-run/候选，不执行余额冲正。
- 官方利润控制与上游倍率自动同步默认关闭，不会因升级静默改变现有调度或倍率。
- 官方 tag 的 `VERSION` 文件误留 `0.1.169`；定制分支已用提交 `c1aa5ceb9` 修正为 `0.1.170`，避免构建后反复提示升级。

## 可见界面验证

- 智能运营：overview、sources、pricing、mappings、operations、auto-pricing、keepalive、integration 均可进入；数据页无可见 alert。
- 上游站点：列表、诊断/保活状态和操作入口正常加载。
- 系统设置：账号故障转移及上游倍率自动探测设置可见。
- 分组管理：创建弹窗中的利润控制项可见，未提交表单。
- 账号管理：上游声明倍率、立即探测、下次探测和同步配置可见，未触发探测或保存。
- 页面控制台 error/warn 为 0；1024 宽度下无整页横向溢出。

## 影响范围自查与剩余风险

- 实际差异符合升级包 v1：官方升级、冲突兼容、测试 fixture 和发布版本标识；未扩大到生产发布或退款。
- 本机 Docker Desktop 曾因编译负载失联，经用户明确授权后重启；随后仅恢复本地容器，未触碰服务器。
- 官方 `v0.1.170` 网关、流式计费和调度变更多，自动化与本地 UI 已覆盖核心路径，但生产 canary、真实流量和蓝绿切流仍需独立发布授权。
- 当前分支尚未推送，尚未创建 release 分支、tag 或部署生产。

## 用户选项

- `确认验收 v4`：接受本地 v0.1.170 升级结果。
- `继续修正`：指出升级后的具体异常。
- `补充验证`：指定需要追加的本地路径。
- 生产蓝绿发布需另行明确授权。
