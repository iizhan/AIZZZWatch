# Sub2API v0.1.170-watch.1 发布准备验证报告 v5

状态：verified / accepted，等待独立切流授权

## 验证范围

- 已确认版本：发布准备包 v1。
- 目标仓库：`/Users/bing/Myself/Code/MacTools/Watch_Sub2Api`。
- 发布分支：`release/0.1.170-watch.1`，提交 `3d2571d7d`。
- 本轮允许备份、构建、推送分支、启动隔离绿色容器和创建临时验收管理员。
- 本轮不包含切流、停蓝、启用故障转移、退款、余额调整或数据库恢复。

## 事项与影响证据矩阵

| 事项/影响 | 证据 | 结果 |
| --- | --- | --- |
| 发布源码身份 | 功能分支与 release 分支已推送；release HEAD `3d2571d7d` | 通过 |
| 冻结依赖构建 | pnpm frozen install、前端 build、`linux/amd64` 镜像构建 | 通过 |
| 不可变镜像 | `sub2api-custom:0.1.170-watch.1-3d2571d7d`，二进制自报版本与 commit 一致 | 通过 |
| 生产备份 | 约 207 MB PostgreSQL dump；全部 `SHA256SUMS` 通过；PG18 可读 catalog | 通过 |
| 蓝绿隔离 | 蓝 `8093`、绿 `8094` 均 healthy；Nginx 仍指向 `8093` | 通过 |
| 数据迁移 | 绿色启动应用官方 `192/193` 与定制 `312/313` 等增量 migration | 通过 |
| 计费安全线 | failover setting 为 false；回滚边界后 `settled_cost > 0` 新记录为 0 | 通过 |
| 可见登录验收 | 登录页、临时管理员登录、合规承诺弹窗可见 | 通过 |
| 合规授权边界 | 未输入确认短语，未替用户接受协议；保护 API 的 423 为预期 | 通过 |
| 标签一致性 | 远端分支与 `v0.1.170-watch.1^{}` 均为 `3d2571d7d` | 通过 |

## 执行命令与结果

- Go service/repository/handler/admin 回归：通过。
- `pnpm --dir frontend exec vitest run --sequence.concurrent=false`：207 文件、1430 项通过。
- `pnpm --dir frontend exec vue-tsc --noEmit`：通过。
- `pnpm --dir frontend run build`：通过。
- Docker frozen install 与 `linux/amd64` build：通过。
- `git diff --check`：通过。
- 生产只读核对：蓝绿 health、Nginx upstream、容器 health、failover setting、异常结算增量均符合安全线。
- 备份校验：`sha256sum -c backups/20260803T0900Z-pre-0.1.170-watch.1/SHA256SUMS` 全部通过。

## 可见界面验证

- `http://127.0.0.1:8094/login` 显示 JSPIN 登录页，中文文案、邮箱/密码输入和登录按钮正常。
- 临时管理员登录成功，仪表盘、智能运营导航和强制合规承诺弹窗被实际渲染。
- 关闭首次引导并标记临时账号的公告已读后，合规正文、协议版本、逐字确认输入和禁用的“确认并继续”按钮完整可见。
- 未接受合规承诺，因此未把保护后的智能运营点击路径误报为通过，留给用户验收。

## 代码审查与影响范围自查

- 未发现新的代码阻断项；已验证升级包中的失败 attempt 不计费边界、最终成功 usage 单次计费和退款候选只读边界。
- 实际外部效果符合确认包：新增备份和隔离绿色容器；生产代理仍为蓝色，用户流量未进入绿色。
- 临时管理员仅用于绿色验收，未读取正式管理员密码；文档、日志和发布资产未记录临时密码或生产凭据。
- 未触碰退款、余额、生产用户数据修复和数据库恢复。

## 剩余风险

- 绿色尚未接真实流量，切流后的延迟、错误率和最终成功计费仍需短时 canary 观察。
- 运行日志提示 URL allowlist 未启用；PostgreSQL 5432 与 Redis 6379 绑定公网地址。这是既有生产安全风险，本包未获授权修改。

## 用户选项

- `确认切流`：将 Nginx 从蓝色 `8093` 切换到绿色 `8094`，切流后继续保留蓝色容器。
- `继续修正`：指出绿色环境中的具体问题。
- `补充验证`：指定需要追加的绿色页面或只读检查。
