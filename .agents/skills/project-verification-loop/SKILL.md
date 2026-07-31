---
name: project-verification-loop
description: Run a staged, traceable project verification loop. Use after meaningful changes, before PRs, commits, or user acceptance, or when a task touches shared behavior, security, frontend layout, data, compatibility, performance, release behavior, workflow assets, or cross-module contracts and every approved item and impact must map to evidence or residual risk.
---

# Project Verification Loop

Use for changes needing more than the minimum check.

## Verification Stages

Use only repository-supported commands: Build or compile, Typecheck, lint/format, unit/integration, visible UI/layout, security/secret scan, and Diff Review as relevant. Do not invent commands.

## Traceability

Build a matrix: approved `ITEM-*`/acceptance, impact dimension, implementation, verification method, evidence/result, uncovered risk.

Build/Typecheck alone is not full verification. UI needs visible evidence when available; data/contracts need migration/compatibility evidence; security/external effects need boundary checks.

## Command Selection

- Prefer scripts from project config, CI, or docs; include `npm run verify` when relevant.
- Record unavailable checks and why. Ask before expensive or destructive checks.

## Diff Review

Review for unrelated/out-of-scope edits, missing errors/tests, misleading UI, unreviewed security changes, unwanted generated files, accepted items without evidence, and new impact.

If verification discovers unapproved impact, stop delivery, publish the scope delta, and route back through `$project-scope-impact-guard`.

## Scenario Loop Evidence

Attach results to the current conversation-initiated Scenario Loop Run in the feature's `workflow-state.yaml`. Continue only for a verified in-scope issue with a distinct root-cause strategy. Record `initiation_source: conversation`, session reference, confirmed artifact versions, score/floors/hard checks/evidence/blockers/risk/budget. A threshold score passes only with all required evidence/floors and no blockers. Stop for a scope, contract, permission, migration, external, release, budget, repeated-strategy/root-cause, or iteration-limit signal; request `vN+1` when scope changes. Repeated failure may create an evolution candidate, never a global Skill/Template/long-lived-memory edit. Desktop monitoring may display imported evidence but cannot create or advance this record.

## Result States

- `verified`: all acceptance and approved impact have evidence.
- `verified_with_risk`: core acceptance passed, but named non-blocking gaps remain.
- `failed`: one or more acceptance criteria failed.
- `blocked`: required environment, permission, data, or tool is unavailable.

Self-review gathers evidence; it is not proof. Preserve uncertainty and offer acceptance choices.

## Output Format

- `验证范围`
- `关联需求/影响/计划版本`
- `事项与影响证据矩阵`
- `执行命令` · `通过项` · `失败项` · `未执行项`
- `差异审查` · `最终状态` · `用户验收选项`

## v0.7 Impact Scope Self-Check

After checks, perform an impact-scope self-check against the confirmed design, task breakdown, and impact scope. Compare the actual diff, runtime behavior, Workflow/Skill assets, permissions, data paths, and user-visible states. Any unconfirmed material impact blocks delivery until the scope delta is confirmed.

## v0.7 Doctor Contract Alignment

After checks, perform an impact-scope self-check and 影响范围自查 against the confirmed design, task breakdown, and impact scope. Compare the actual diff, runtime behavior, Workflow/Skill assets, permissions, data paths, and user-visible states. Any unconfirmed material impact blocks delivery until the scope delta is confirmed.
