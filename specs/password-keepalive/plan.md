# 实施方案：站点密码保活

**计划版本**: v1
**确认状态**: controlled 已确认执行
**影响等级**: high（本地凭据、远程认证与 Electron 主进程边界）

## 设计方案 v1

1. 复用 `StoredStation.loginAccount/loginPassword` 的 Electron `safeStorage` 加密存储，不建立第二套密码库。
2. 新增每站点、默认关闭的 `autoReauthEnabled` 与无敏感数据的 `autoReauthStatus`。公开模型只包含开关、状态和时间。
3. `refreshStation()` 继续优先调用现有刷新令牌接口。快照仍未授权，且站点已显式开启保活时，主进程异步启动隔离授权窗口。
4. 自动模式先隐藏窗口、同源填入凭据、仅点击明确的登录提交控件；安全挑战或不确定表单会显示窗口交给用户完成。
5. 自动失败冷却五分钟，并限制每站点一次、全局一个授权窗口。成功后重刷快照；失败不删除密码或现有令牌。

## 任务拆解 v1

| 子任务 | 对应事项 | 允许路径 | 完成条件 | 验证 |
| --- | --- | --- | --- | --- |
| `TASK-001` | ITEM-001 | `src/shared/types.ts`, `src/main/storage.ts` | 加密配置与安全公开状态可持久化 | 存储单测 |
| `TASK-002` | ITEM-002/003 | `src/main/index.ts` | 令牌刷新回退、同源登录、挑战移交、冷却与并发保护 | 类型检查、人工链路 |
| `TASK-003` | ITEM-001/004 | `src/preload/index.ts`, `src/renderer/src/*` | 窄 IPC 状态通知与可操作设置 UI | 构建、受限窗口检查 |
| `TASK-004` | ITEM-004 | `tests/storage.test.ts` | 覆盖加密、开关前置条件和清除行为 | Vitest |
| `TASK-005` | 交付 | `specs/password-keepalive/*` | 自测、审阅和报告 | `npm run verify` |

## 影响范围 v1

- 直接：站点本地存储、主进程授权/轮询、preload IPC、站点编辑 UI、预览 API、相关测试。
- 间接：站点失效时会出现保活状态更新；不会改变现有远程 API 的读写范围。
- 数据：现有 `stations.json` 增加可选开关和状态字段，无迁移；旧数据默认关闭。
- 安全：凭据仅在主进程解密；自动提交有 HTTPS、同源、表单识别、挑战降级和冷却限制。
- 兼容：Sub2API、NewAPI 与自定义兼容站均可启用，但只有可识别的网页登录流程可自动成功。
- 回退：关闭开关或清除凭据即可立即停止；代码回退不会破坏既有令牌读取。
- 明确不影响：分组管理、上游 Key 映射、价格榜、成本保护、收益账本、远程管理写入。

## 验收与自测计划

- 自动：`npm run typecheck`、`npm test`、`npm run build`。
- 安全：检查 renderer/public IPC 中无账号、密码、JWT 或 Cookie 字段；检查状态只含枚举与时间。
- 可见路径：在桌面端编辑一个 HTTPS 站点，保存账号密码，开启保活；检查开关、状态、人工挑战窗口、清除凭据和手动重授权。
- 回退触发：出现自动提交越过同源/HTTPS 边界、敏感信息暴露，或重复授权循环时立即关闭开关并回退本功能。
