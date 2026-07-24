# Feature Quickstart：NewAPI 登录入口兼容

1. 添加来源站，地址填写 `https://nihao.dog`；可明确选择 NewAPI 或先运行自动识别。
2. 点击“网页登录授权”。新版将优先打开 `/sign-in`，旧版保留 `/login`。
3. 登录表单出现后由用户自行输入账号、密码、验证码或 2FA；应用不自动提交。
4. 登录后窗口自动关闭，主进程仅在本地安全存储中保存会话材料并同步站点。

验证：`npm run verify`；在公开 `https://nihao.dog/sign-in` 观察登录页；使用新 ZIP 在桌面端完成一次真实用户登录验收。
