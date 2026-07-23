# 开源发布隐私检查清单

这个清单用于把 AIZZZWatch 推到公开 Git 仓库前做最后复核。目标是保留演示数据、测试假数据和必要兼容逻辑，同时避免把真实站点、账号、令牌、Cookie、余额、用量明细或本机数据目录一起发出去。

## 必查项

- [ ] `git status --short` 中没有 `stations.json`、`ui-preferences.json`、HAR、Cookie、JWT、API Key、私有截图或临时导出文件。
- [ ] `docs/images/` 只包含演示数据截图，不包含真实站点域名、真实账号、真实余额或真实密钥。
- [ ] README 截图使用的是 `demo.sub2api.local`、主力中转站、备用线路等演示数据。
- [ ] 没有提交 `~/Library/Application Support/AIZZZWatch` 下的任何文件。
- [ ] 没有提交通过 `AIZZZWATCH_USER_DATA_DIR` 生成的临时用户数据目录。
- [ ] `.specify/memory-store/users/` 只保留 `.gitkeep`，不包含用户私有 durable memory。
- [ ] `.specify/memory-store/shared/memories.jsonl` 和 `.specify/memory-store/agent/evolution.jsonl` 不包含真实账号、令牌、Cookie、邮箱或非公开站点配置。
- [ ] specs / docs 中如需保留真实二开站兼容说明，只保留公开域名、接口路径和脱敏结论，不保留响应原文、账号、余额、用量或凭据。
- [ ] `docs/images/sponsor-qr-*.jpg` 是用户明确授权公开的收款码，也是本次唯一有意公开的支付身份信息；除此之外仍禁止提交个人身份、账号、余额、用量或凭据。
- [ ] 发布前已重新运行敏感词扫描。
- [ ] 已确认公开许可证、Release 下载说明和“未公证 macOS 应用”的首次启动提示与实际包体一致。

## 建议扫描命令

```bash
rg -n --hidden \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!out/**' \
  --glob '!release/**' \
  --glob '!package-lock.json' \
  --glob '!docs/OPEN_SOURCE_CHECKLIST.md' \
  --glob '!*.png' \
  --glob '!*.jpeg' \
  --glob '!*.jpg' \
  'Bearer eyJ|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|krill_jwt=|cf_clearance=|password|accessToken|refreshToken|adminToken|loginPassword'
```

命中代码里的字段名或测试假数据不一定是问题，但命中真实 token、Cookie、邮箱、密码、真实用户 ID 或完整响应原文时，必须先清理再发布。

## 不应进入公开仓库的内容

- Electron 真实数据目录：`~/Library/Application Support/AIZZZWatch`
- 站点配置和偏好文件：`stations.json`、`ui-preferences.json`
- 登录材料：JWT、API Key、Cookie、refresh token、网页登录账号密码
- 调试材料：HAR、完整 curl 请求、完整响应原文、浏览器 DevTools 导出
- 私有运营数据：真实余额、真实用量、真实用户列表、真实账号成本、真实上游密钥
- 私有截图：包含真实站点、账号、余额、分组策略或用量详情的截图

## 保留演示数据的规则

- 可以保留专门构造的演示站点、演示账号、演示余额和演示倍率。
- 演示域名优先使用 `.local`、`.example.com` 或明显虚构的名称。
- 测试里的 token 字符串必须是明显假值，例如 `secret`、`admin-jwt`、`cookie-token`。
- README 图片应来自隔离演示数据目录，而不是正式 userData。
