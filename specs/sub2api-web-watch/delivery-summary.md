# Sub2API Web Watch 交付摘要

## Meta

- 需求/影响/设计/任务：v2
- 基线：Sub2API `v0.1.165`
- 交付状态：awaiting_user_acceptance
- 本地预览：`http://127.0.0.1:8091`

## 本次完成

已将原独立 Watch 页面重构为官方后台内的“智能运营”折叠菜单，现有能力拆分为“运营概览”和“聚合排价”两个子页面。旧 `/admin/watch` 地址保留兼容跳转，后续自动调价、保活检测和调价记录继续归入同一目录。

## 关键改动

- 两个智能运营页面统一使用官方 `AppLayout`，保留侧边栏、顶部栏、主题和响应式布局。
- 新增 `/admin/intelligent-ops/overview` 与 `/admin/intelligent-ops/pricing`。
- 新增“智能运营”“运营概览”“聚合排价”中英文文案。
- 删除无引用的旧独立 `WatchView.vue`。
- 新增路由、权限、菜单归属、布局和 i18n 对称测试。

## 验证结果

- Docker 前端类型检查和 Vite 生产构建通过。
- 智能运营集成测试 4/4、定向 ESLint、`git diff --check` 通过。
- Go embed 运行镜像构建成功。
- 本地 PostgreSQL、Redis、Sub2API 均 healthy；health 和两个页面路径返回 200。
- 应用内浏览器 webview 无法附着，宽屏/窄屏可见点击未完成，详见 `verification-report.md`。

## 用户选择与原因

用户指出独立页面与官方后台割裂，并确认执行正式调整包 v2；本轮按统一菜单目录和官方布局完成修订。

## 复盘结论

不满意分类为 `ui_interaction`。根因不是路由打开新窗口，而是旧 Watch 页面遗漏 `AppLayout`，且作为单一顶级入口没有形成可扩展的信息架构。

## 记忆与进化后续

本次经验保留在任务和会话级记录，不新增全局规则候选。

## 下一步建议

用户先在本地预览中验收菜单层级和两个子页面；通过后再按同一目录逐步交付自动调价、调价记录和保活检测。
