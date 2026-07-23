# Skill Upgrade Backlog

- [DATE] 观察：
  - 触发证据：
  - 置信度：low | medium | high
  - 建议升级：
  - 落点：
  - 是否需要确认：
  - 处理状态：

- [2026-07-19] 观察：业务语义类 UI 文案被误判为 fast 小改，绕过了用户要求的思考确认。
  - 触发证据：用户截图质疑“建议补入什么意思啊？不对吧？？”后，助手直接按未绑定/已有组合场景修改文案并暂存；随后用户追问“你做调整之前不和我确认你的思考吗？你的skills没生效吗？”。
  - 置信度：high
  - 建议升级：在 `project-requirement-gate` 增加 Business Semantics fast disqualifier；在 AGENTS、constitution、Codex 团队说明和 spec/plan/checklist/workflow-state 模板同步“业务语义确认”门禁。
  - 落点：`AGENTS.md`、`.agents/skills/project-requirement-gate/SKILL.md`、`.specify/memory/constitution.md`、`.specify/templates/*` 中相关确认字段、`docs/Codex团队开发说明.md`。
  - 是否需要确认：用户已选择方案 3，确认保留本轮改动并补进项目流程规则。
  - 处理状态：approved_for_application

- [2026-07-17] 观察：来源钱包连续出现 UI 信息密度与过度设计返工。
  - 触发证据：用户先后指出顶部统计块浪费空间、来源详情位置不直观、展开态辨识不足、操作文字按钮占空间、临时“后续可做展开全部”文案泄露、状态点与“正常”文字重复，并明确要求“不要过度设计”。
  - 置信度：high
  - 建议升级：在前端/UI 交付检查中加入“减法检修”规则：交付前检查是否存在重复状态信号、临时占位文案、装饰性标签、非必要文字按钮、会挤占主要内容的统计块；同一信息默认只保留一个最轻量表达。
  - 落点：优先考虑 `project-frontend-standards` 或 `project-frontend-css` 的交付检查参考；也可补充到 `project-test-and-report` 的 UI 可见验证清单。
  - 是否需要确认：需要用户或维护者确认后再修改 skill。
  - 处理状态：candidate_recorded

- [2026-07-18] 观察：变化历史/真实数据路径需要交付前做“数据安全语义”检查。
  - 触发证据：用户截图反馈“历史我添加的数据怎么没有了？还有点击那个分组弹出来的是啥？？？”。本轮发现真实历史弹窗存在一键清空入口，删除分组的“清理”会移除同组全部历史事件，属于 UI 文案与数据破坏语义绑定过紧；此前 v4-8 虽改了弹窗结构和保留上限，但没有把真实数据误删路径作为显式验证项。
  - 置信度：high
  - 建议升级：在 `project-test-and-report` 或前端交付检查中加入“数据安全语义”规则：任何标为清空、清理、删除、移除、隐藏的 UI，必须在交付前列明是否会删除持久化数据、是否可恢复、是否需要二次确认，并用真实/模拟持久化路径验证重启后结果。
  - 落点：优先补充到 `project-test-and-report` 的 UI / Interaction Reporting Rules；涉及前端状态时同步补充 `project-frontend-standards` 验证清单。
  - 是否需要确认：需要用户或维护者确认后再修改 skill。
  - 处理状态：candidate_recorded
