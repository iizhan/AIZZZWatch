# Sub2API Web Watch 验证报告 v3

状态：verified_with_risk / awaiting_user_acceptance

## 验证范围

- 关联需求、设计、影响和任务版本：v2。
- 目标仓库：`/Users/bing/Myself/Code/MacTools/Watch_Sub2Api`。
- 分支：`feature/watch-web-v0.1.165`。
- 本轮仅调整智能运营前端信息架构、路由、页面布局、i18n 和测试。
- 本地预览：隔离 Compose `watch-sub2api-preview`，端口 `127.0.0.1:8091`。

## 事项与影响证据矩阵

| 事项/影响 | 证据 | 结果 |
| --- | --- | --- |
| “智能运营”一级折叠菜单 | AppSidebar 差异审查；集成测试检查 `expandOnly` 和两个子菜单 | 通过 |
| “运营概览”与“聚合排价”子路由 | 集成测试 4/4；最终构建包含两个独立页面 chunk | 通过 |
| 官方 AppLayout 一致性 | 两个页面均导入并使用 `AppLayout`；静态集成测试 | 通过 |
| 旧 `/admin/watch` 兼容 | 路由重定向测试 | 通过 |
| 管理员权限和中英文对称 | 路由 meta 与 i18n 对称测试 | 通过 |
| 类型与生产构建 | Docker `vue-tsc -b && vite build`，960 个模块转换 | 通过 |
| 定向 lint | Docker 内 ESLint 检查全部本轮前端文件 | 通过 |
| 本地运行镜像 | Go embed 构建完成；仅重建应用容器 | 通过 |
| 容器和 HTTP | PostgreSQL、Redis、Sub2API 均 healthy；health 和两个页面路径返回 200 | 通过 |
| 宽屏/窄屏可见点击 | 应用内浏览器三次创建标签页均无法附着 webview | 未覆盖 |

## 执行命令

- `git diff --check`
- Docker 前端目标构建：`vue-tsc -b && vite build`
- `vitest run src/views/admin/watch/__tests__/integrationSurface.spec.ts`
- 定向 `eslint`
- Docker Go embed 运行镜像构建
- `docker compose ... up -d --no-deps --force-recreate sub2api`
- `curl http://127.0.0.1:8091/health`
- 两个智能运营页面 HTTP 200 检查

## 代码审查与影响范围自查

- 未发现阻断级或高优先级代码问题。
- 实际差异符合 v2：菜单、路由、页面、i18n、测试和任务交付工件。
- 未新增或修改 Watch 后端 API、migration、价格规则、认证、数据库数据和生产部署。
- PostgreSQL、Redis 及其数据卷未重建；仅替换本地预览应用容器。
- 删除无路由引用的旧独立 `WatchView.vue`，避免双实现继续存在。

## 未覆盖项与剩余风险

- 应用内浏览器当前无法创建可附着的可见标签页，因此未取得宽屏/窄屏截图，也未自动点击菜单展开、子菜单切换、前进后退和侧边栏折叠。
- 用户需在 `http://127.0.0.1:8091/admin/intelligent-ops/overview` 完成最终可见验收。
- 自动调价、保活检测和调价记录仍为后续任务，本轮没有显示空菜单。

## 用户选项

- `确认验收 v3`：接受智能运营菜单重构和当前可见验证边界。
- `继续修正`：反馈页面结构或菜单交互问题后进入下一轮。
- `补充验证`：浏览器恢复后补宽屏/窄屏点击和截图证据。
