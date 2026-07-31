# Sub2API Web Watch 任务拆解 v3

关联确认：需求/设计/影响/验收计划 `v3`，用户于 2026-07-27 确认开始执行。

## v3 GSD 任务

### TASK-301：迁移基础与 Repository

状态：in_progress

- 依赖：v2 底座
- 允许路径：`backend/migrations/191_watch_foundation.sql`、`backend/internal/repository/watch_*.go`、`backend/internal/service/watch_*.go`、Wire 与对应测试
- 完成条件：上游站点、加密凭据、最新观测、检测记录可持久化；Repository 集成和迁移约束通过。

### TASK-302：Connector、诊断与保活 Runner

状态：pending

- 依赖：TASK-301
- 允许路径：`backend/internal/service/watch_*.go`、`backend/internal/repository/watch_*.go`、Wire/cleanup 与测试
- 完成条件：Sub2API/NewAPI 归一化读取、URL 安全、超时/体积限制、防重入、并发上限、退避、启停和重启恢复通过。

### TASK-303：M1 管理 API 与页面

状态：pending

- 依赖：TASK-301、TASK-302
- 允许路径：Watch handler/routes/API/views、侧栏、路由、i18n 和测试
- 完成条件：上游站点、保活中心、接入诊断可完成创建、脱敏查看、手动检测、错误恢复和删除确认；响应式可见验证完成。

### TASK-304：真实排行、排价与变动

状态：pending

- 依赖：TASK-302
- 完成条件：外部观测驱动排行和候选；过期/失败/余额不足/模型不匹配冻结；涨跌事件可查询。

### TASK-305：受控自动调价

状态：pending

- 依赖：TASK-304
- 完成条件：双模式 `+0.01`、预览/人工/自动三级、官方 Service 写入、CAS、幂等、审计和回滚通过。

### TASK-306：账号关联、成本、收益和告警

状态：pending

- 依赖：TASK-304
- 完成条件：精确关联、成本档案、历史成本、内部/公益排除、覆盖状态、区间收益和任务告警可用。

### TASK-307：全量验证与交付

状态：pending

- 依赖：TASK-301..306
- 完成条件：代码/安全审查、后端与前端验证、可见 UI、Docker 和官方升级回归有证据，进入 awaiting_user_acceptance。

## v1-v2 历史任务

## TASK-001：基线与 Watch 领域骨架

状态：completed（只读预览切片）

- 依赖：无
- 允许路径：`backend/internal/watch/**`、`backend/internal/handler/handler.go`、`backend/internal/handler/wire.go`、`backend/internal/repository/wire.go`、`backend/internal/service/wire.go`
- 完成条件：领域接口、错误码、检测状态和价格模式定义完成；Wire 可生成。

## TASK-002：独立 migration 与仓储

状态：completed（migration 已加入；仓储读写仍待后续切片）

- 依赖：TASK-001
- 允许路径：`backend/migrations/191_watch_foundation.sql`、`backend/internal/repository/watch_*.go`
- 完成条件：幂等表、索引、审计字段和清理策略完成；migration runner 测试覆盖。

## TASK-003：检测、候选和冻结规则

状态：completed（当前为配置/可调度性检测；远程保活待 TASK-006）

- 依赖：TASK-001、TASK-002
- 允许路径：`backend/internal/watch/**`、对应单测
- 完成条件：健康检测、过期判断、最低价候选、`+0.01` 计算、无候选冻结和有界重试通过单测。

## TASK-004：管理员 API、确认写入、审计回滚

状态：pending

- 依赖：TASK-003
- 允许路径：`backend/internal/handler/admin/watch_handler.go`、`backend/internal/server/routes/admin.go`、对应 handler 测试
- 完成条件：只读预览和显式确认写入分离；权限、幂等、错误、回滚和脱敏契约通过。

## TASK-005：前端 Watch 页面与导航

状态：completed（v2 已改为智能运营子菜单和官方 AppLayout）

- 依赖：TASK-004
- 允许路径：`frontend/src/api/admin/watch.ts`、`frontend/src/views/admin/WatchView.vue`、`frontend/src/router/index.ts`、`frontend/src/components/layout/AppSidebar.vue`、i18n 与测试
- 完成条件：所有状态和确认路径可见；窄窗口不遮挡关键操作；页面测试通过。

## TASK-005A：补齐官方页面布局

状态：completed

- 依赖：TASK-005
- 允许路径：`frontend/src/views/admin/watch/**`、原 `WatchView.vue`
- 完成条件：智能运营页面均使用 `AppLayout`，不再以独立内容页呈现。

## TASK-005B：智能运营菜单与子路由

状态：completed

- 依赖：TASK-005A
- 允许路径：`frontend/src/components/layout/AppSidebar.vue`、`frontend/src/router/index.ts`、i18n
- 完成条件：“智能运营”可展开；“运营概览”和“聚合排价”可切换且激活状态正确；旧 `/admin/watch` 可兼容跳转。

## TASK-005C：拆分运营概览与聚合排价页面

状态：completed

- 依赖：TASK-005A、TASK-005B
- 允许路径：`frontend/src/views/admin/watch/**`、`frontend/src/api/admin/watch.ts`
- 完成条件：概览和排价状态各自归属明确，复用现有 API，不增加后端契约。

## TASK-005D：导航与可见界面验证

状态：completed_with_risk（自动检查通过；应用内浏览器无法附着可见标签页）

- 依赖：TASK-005A..005C
- 允许路径：前端相关测试、`specs/sub2api-web-watch/**`
- 完成条件：typecheck、目标测试、构建和浏览器点击路径通过，并记录宽屏/窄屏证据。

## TASK-005E：本地 Docker 预览更新

状态：completed_with_risk（容器健康；可见浏览器点击待用户验收）

- 依赖：TASK-005D
- 允许路径：本地预览镜像与隔离 Compose，不修改生产部署
- 完成条件：本地 `8091` 健康，浏览器停留在可查看的智能运营页面。

## TASK-006：保活 runner 与资源约束

状态：pending

- 依赖：TASK-003、TASK-004
- 允许路径：`backend/internal/watch/keepalive/**`、Wire、服务清理入口和测试
- 完成条件：任务去重、超时、退避、最大重试、停止和重启恢复通过。

## TASK-007：升级演练、验证与交付

状态：in_progress

- 依赖：TASK-001..006
- 允许路径：`specs/sub2api-web-watch/**`、Docker/CI 文档（仅必要变更）
- 完成条件：typecheck、lint、后端测试、前端测试、构建、secret scan、影响范围自查和中文验证报告完成。
