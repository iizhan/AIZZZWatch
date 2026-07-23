# Sub2API 实时分组监控 Rule Change Proposal

## Meta

- Feature: `sub2api-monitor`
- Date: `2026-07-19`
- Related Request: `用户确认方案 3：保留“建议补入”语义修正，并把业务语义类 UI 调整必须先确认的规则补进项目流程。`
- Candidate Status: `approved_for_application`
- Prefill Status: `[auto]`
- Confidence Summary: `[auto] 用户明确指出本轮调整前未确认思考，且该问题影响账号/分组业务语义和后续操作理解。`

Use these markers while drafting:

- `[auto]`: directly supported by task evidence
- `[inferred]`: synthesized from multiple signals
- `[needs confirmation]`: still requires user review

## Trigger Signal

Describe the repeated signal that triggered this proposal:

- repeated user choice: `[auto] 用户多次要求按版本确认后再执行；本轮选择方案 3，要求补入流程规则。`
- repeated failure or review finding: `[auto] “建议补入”被误判为 UI 小文案，实际改变账号未绑定/已有组合/更低候选的业务理解。`
- repeated workflow friction: `[auto] fast 通道没有显式拦截业务语义歧义，导致未先给出思考确认。`
- other evidence: `[auto] 用户原话：“你做调整之前不和我确认你的思考吗？你的skills没生效吗？”`

## Problem Statement

`[auto]` 当前流程允许“一 clear、低风险、可回滚”的 UI 小改走 fast，但没有明确区分“装饰性文案”和“编码业务模型的文案”。在 AIZZZWatch 中，账号、分组、来源站点、成本、倍率、充值比例、利润、隐藏/删除/停用等词会影响用户对业务关系和操作后果的理解。若用户是在质疑这些词的含义，助手必须先确认语义，而不是直接实现自认为正确的解释。

## Proposed Change

### Promotion Level

Choose one:

- `session`
- `memory_policy`
- `skill_rule`
- `workflow_rule`
- `constitution_rule`
- `template_rule`

Current draft: `[needs confirmation]`
Current draft: `workflow_rule + skill_rule + template_rule`

### Change Summary

`[auto]` 增加“业务语义确认”门禁：当用户质疑 UI 文案、动作、状态或指标的业务含义时，不得使用 fast 直接编辑。必须先发布 `语义确认 vN` 或 `思考确认 vN`，说明术语定义、影响状态、非目标和验收文案，用户确认后才执行。

### Affected Files

- `AGENTS.md`
- `.agents/skills/project-requirement-gate/SKILL.md`
- `.specify/memory/constitution.md`
- `.specify/templates/spec-template.md`
- `.specify/templates/plan-template.md`
- `.specify/templates/checklist-template.md`
- `.specify/templates/workflow-state-template.yaml`
- `.specify/memory/skill-upgrade-backlog.md`
- `docs/Codex团队开发说明.md`
- `specs/sub2api-monitor/workflow-state.yaml`
- `specs/sub2api-monitor/rule-change-proposal.md`

## Evidence

List the strongest evidence that this is not a one-off issue:

1. Session or task evidence: `[auto]` v4-12 中“建议补入”语义修正已经完成并验证，但调整前没有先向用户确认思考。
2. User feedback: `[auto]` 用户明确追问“你做调整之前不和我确认你的思考吗？你的skills没生效吗？”并选择方案 3。
3. Review or test evidence: `[auto]` 本轮是流程门禁缺口，不是代码测试失败；需要通过文档/skill/template diff 和真实任务模式复核。
4. Previous workaround or repeated manual fix: `[inferred]` 项目已有版本化确认习惯，业务语义门禁之前只散落在需求确认原则中，缺少 fast disqualifier。

## Expected Benefit

- what failure or friction should be reduced: `[auto]` 减少“我替用户解释业务含义并直接改”的返工和信任损耗。
- what quality or speed should improve: `[auto]` 业务语义先对齐，后续实现更少反复。
- who benefits: `[auto]` 用户、后续 Codex agent、项目维护者。

## Validation Plan

- `doctor`: `[inferred]` 如项目存在 workflow doctor，可后续运行。
- smoke bootstrap: `[inferred]` 本轮不改脚本生成逻辑，仅改模板字段，暂不做新 feature bootstrap。
- focused realistic task: `[auto]` 用“建议补入什么意思”这类请求复核 requirement-gate 应归为业务语义确认，而不是 fast。
- manual review path: `[auto]` 检查 AGENTS、requirement-gate、constitution、docs 和 templates 是否都包含业务语义门禁。
- unvalidated areas: `[auto]` 未验证新建 feature 脚本是否消费 `semantic_confirmation` 字段；该字段向后兼容。

## Rollback Plan

- how to revert the rule: `[auto]` 回退本提案涉及的文档/skill/template 字段即可，不影响业务代码。
- what signal means the rule should be rolled back: `[auto]` 如果该规则导致大量纯错别字/无语义文案也被强制确认，造成明显低价值摩擦，应收窄为账号/分组/成本等高风险术语。
- what can remain as memory only if rollback happens: `[auto]` 保留“用户偏好重大业务语义先确认”的会话反馈。

## User Confirmation

- decision: `[auto]` approved
- notes: `[auto]` 用户选择方案 3。
- approved scope: `[auto]` 保留本轮 v4-12 代码改动，同时补充项目流程规则，防止业务语义调整绕过确认。

## Validation Result

- status: `validated`
- evidence: `git diff --check 通过；AGENTS、project-requirement-gate、constitution、templates、docs、workflow-state 和 backlog 均可检索到业务语义门禁；workflow-state YAML 与 workflow-state-template YAML 解析通过。`
- residual risks: `规则可能略增确认成本；已通过限定账号/分组/来源站点/成本/倍率/充值比例/利润/隐藏/删除/停用等领域语义降低影响。`
