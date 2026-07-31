# Sub2API Web Watch 设计方案 v3

关联需求：v3
关联影响：v3
确认状态：用户已确认，进入执行

## 结构

- `backend/internal/watch/`：Watch 领域模型、检测器、排价规则和写入编排。
- `backend/internal/handler/admin/watch_handler.go`：管理员 DTO、鉴权后路由和错误映射。
- `backend/internal/repository/watch_*.go`：Watch 仓储；只访问 `watch_` 表。
- `backend/migrations/191_watch_foundation.sql`：独立、幂等、可回滚的基础表。
- `frontend/src/api/admin/watch.ts`：类型化 API 客户端。
- `frontend/src/views/admin/watch/WatchOverviewView.vue`：使用官方 `AppLayout` 的运营概览页面。
- `frontend/src/views/admin/watch/WatchPricingView.vue`：使用官方 `AppLayout` 的聚合排价页面。
- `frontend/src/views/admin/watch/`：后续自动调价、保活检测和调价记录页面的固定归属目录。

## v3 目标边界

```text
Vue 智能运营 -> /api/v1/admin/watch/*
  -> Watch handler/service/runner/repository
  -> watch_* 表 + 官方 GroupService/ChannelService/UsageRepository
  -> 外部 Sub2API/NewAPI/受约束兼容站
```

- 外部上游只提供观测，不自动修改外部站点。
- 当前 Sub2API 是售卖站点真值；自动调价只修改本机目标分组或目标渠道价格。
- Electron 主进程中的网络、凭据、定时器和本地账本迁入服务端；纯展示、筛选和确认流程迁入 Vue。
- 官方用户、账号、分组、渠道、平台和用量由现有模块拥有，Watch 只提供运营投影视图和跳转。

## GSD 里程碑

1. `M1 reliable-data-plane`：上游站点、加密凭据、连接器、采集/保活 Runner、诊断和基础页面。
2. `M2 pricing-observability`：真实排行、聚合排价、变动记录和候选冻结规则。
3. `M3 controlled-automation`：人工应用、自动调价、CAS、幂等、审计和回滚。
4. `M4 cost-profit-parity`：账号关联、成本档案、时间账本、收益核算、任务告警和完整 UI。
5. `M5 verification-delivery`：安全/代码审查、可见 UI、Docker/升级演练和交付。

## 状态与真值

- 上游健康真值：Watch 检测记录；检测结果带 `observed_at`、`expires_at`、状态和安全错误码。
- 当前价格真值：官方 `groups`/`channels` 服务；Watch 只在显式确认后调用现有更新能力。
- Watch 审计真值：`watch_price_audits`，保存前后数值、模式、候选来源和操作人 ID。
- 调度所有权：单实例后台 runner；每个任务有 lease/唯一键、超时和最大并发，重启后从过期状态恢复。

## API

- `GET /api/v1/admin/watch/overview`
- `POST /api/v1/admin/watch/checks/preview`
- `POST /api/v1/admin/watch/pricing/preview`
- `POST /api/v1/admin/watch/pricing/apply`（显式确认字段 + 幂等键）
- `POST /api/v1/admin/watch/pricing/:id/rollback`
- `GET /api/v1/admin/watch/audits`
- `GET|PUT /api/v1/admin/watch/settings`
- `POST /api/v1/admin/watch/keepalive/run`
- `GET|POST|PUT|DELETE /api/v1/admin/watch/sources[/:id]`
- `POST /api/v1/admin/watch/sources/:id/diagnose|refresh|keepalive`
- `GET /api/v1/admin/watch/rankings|changes|jobs|alerts`
- `GET|POST|PUT /api/v1/admin/watch/links|cost-profiles|pricing/rules`
- `GET /api/v1/admin/watch/profit`、`POST /api/v1/admin/watch/profit/archive`

所有写接口要求管理员权限、请求体校验、幂等键和审计；响应不包含令牌/密钥原文。

## 前端体验

- 侧边栏新增可折叠的“智能运营”一级菜单；当前显示“运营概览”和“聚合排价”两个可用子菜单。
- 首屏显示健康概览、最后检测时间和异常摘要。
- 排价流程为“检测 -> 预览候选 -> 显示目标值/冻结原因 -> 显式确认 -> 应用结果”。
- 自动调价开关默认关闭；未满足条件时禁用并显示原因。
- 加载、空数据、过期、授权失败、余额不足、写入成功/失败、回滚成功/失败均有可见状态。
- 复用现有表格、状态徽标、确认弹窗和 i18n 资源，不把业务规则写入低层通用组件。
- 所有智能运营页面复用官方 `AppLayout`，路由切换时保留侧边栏、顶部栏、主题和响应式行为。
- `/admin/intelligent-ops` 重定向到运营概览；旧 `/admin/watch` 保留兼容重定向，不使书签失效。

## M1 数据与安全决策

- 复用现有 AES `SecretEncryptor`，密文与公开站点配置分离；凭据只写不读。
- 远端 URL 统一解析、禁止 URL userinfo/fragment、限制协议和响应大小；私网目标默认拒绝，只有显式服务器配置允许。
- 每个 source 只允许一个 in-flight 检测；全局 worker pool 有界；失败记录稳定错误码而非远端响应正文。
- `watch_checks` 保存健康与过期时间；新增观测表保存归一化倍率/模型价格，不保存完整响应。

## v3 回退

- 前端回退：恢复原 `/admin/watch` 页面与单一侧边栏入口；不涉及 API、数据或 migration 回滚。
- 本地预览回退：重新使用上一版 `watch-sub2api:0.1.165-preview` 镜像。
- M1 回退：关闭 Watch 功能开关并停止 Runner；新增表保留但不再读写，v2 只读页面继续可用。

## 版本升级

- Watch migration 使用独立前缀和版本号，不修改既有 migration。
- 同步官方 tag 后先跑 schema/契约/前端构建测试，再构建镜像；失败时回滚到上一镜像和上一 Watch migration 兼容版本。
- Watch API 采用 additive 变更；官方升级时旧前端可继续访问原有管理页。

## 回退

- 代码回退：移除 Watch 路由、Wire provider、前端入口和独立 migration，官方核心数据不变。
- 价格回退：仅允许回滚到审计记录中的最近确认值；无审计值时冻结，不猜测。
- 发布回退：蓝绿切换失败，切回上一镜像；不得在回退过程中执行自动调价。
