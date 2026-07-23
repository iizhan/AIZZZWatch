---
name: project-requirement-gate
description: Analyze and route project requests before implementation. Use when a user describes a feature, bug, refactor, integration, or workflow update and Codex must assess clarity and complexity, investigate discoverable context, produce versioned requirements and work items, define acceptance criteria, and decide which user confirmation gates are required.
---

# Project Requirement Gate

Use before implementation unless the same scope is already confirmed.

## Task Lanes

- `fast`: one clear, low-risk, reversible outcome. Restate briefly; no separate approval unless requested.
- `standard`: multiple items or bounded shared impact. Confirm goal, items, acceptance, and impact once.
- `controlled`: cross-module, architecture, data, security, permission, migration, external/destructive effect, release, or material ambiguity. Confirm requirement/impact, then child-task plan.

Classify by uncertainty and impact, not word count. "直接做" may skip low-risk ceremony, never safety, permission, privacy, release, destructive, or irreversible confirmation.

## Fast Disqualifier: Business Semantics

Do not use `fast` when the user's feedback questions what a UI term, action, status, or metric means. Treat copy as behavior when it encodes product semantics, especially in AIZZZWatch account/group/source-station/cost/multiplier/recharge-ratio/profit flows.

Examples that require at least `standard` confirmation before editing:

- labels/actions such as “补入”, “加入”, “移除”, “隐藏”, “分组设置”, “账号成本”, “有效成本”
- changes that alter whether an account is unbound, initially selected, added to an existing group combination, removed from a group, or temporarily disabled
- cost/profit wording that changes who pays, what is free, what is subscribed, or how usage is attributed

For these cases, publish `语义确认 vN` or `思考确认 vN` first: define the term, affected UI states, non-goals, and exact acceptance wording. Edit only after the user confirms that version.

## Workflow

1. Restate the Chinese goal and visible outcome.
2. Load the fresh Project Profile and matched decisions. Inspect code/config/logs/docs before asking, limited to missing or changed context; ask only when ambiguity changes outcome, scope, data, permission, compatibility, delivery, or acceptance. Stop on material ambiguity.
3. Reassess the lane after onboarding and impact analysis; record the reason for any change. Escalate when discovered uncertainty or impact requires it.
4. Select a lane and create versioned `ITEM-*` with outcome and acceptance.
5. Record constraints, assumptions, non-goals, and dependencies.
6. For fast work, mark pre-execution gates `not_required`, record the restated item, and proceed. Final user acceptance remains separate after verification.
7. For standard/controlled work, obtain `$project-scope-impact-guard` output and publish `需求与事项 vN` with `确认执行`, `修改事项`, `缩小范围`, or `补充需求`.
8. For controlled work, require a second confirmation of child tasks, dependencies, validation, and rollback.
9. Bind approval to the artifact version. Reconfirm only changed items/impact; an earlier unscoped "可以" does not approve expansion.

## Output Format

- `需求目标`
- `任务通道与原因`
- `已知约束`
- `事项清单与验收标准`
- `待调查/待确认项` · `需求版本` · `需要的确认门禁` · `确认选项`

## v0.7 Formal Implementation Handoff

For standard and controlled work, the requirement gate must hand off a versioned 正式实现前置包: requirement, design proposal, task breakdown, impact scope, acceptance/self-test plan, and rollback. Coding is blocked until this package is explicitly confirmed. Material changes require a new package version.
