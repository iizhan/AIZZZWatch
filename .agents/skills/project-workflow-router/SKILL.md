---
name: project-workflow-router
description: Select and validate one project-local Workflow Template for standard or controlled development work. Use after the task lane and project Profile are known when a request may match a declared role, scenario, or integration Workflow, or when Workflow compatibility, binding, Loop Engineering, or routing evidence must be explained.
---

# Project Workflow Router

Select a declared Workflow without replacing requirement, impact, confirmation, verification, or acceptance gates.

## Routing Rules

1. Run `$project-profile-router` first; use only fresh, source-backed facts.
2. Reuse `$project-requirement-gate` lane: `fast` uses the lightweight route; `standard`/`controlled` inspect `.skill-os/workflows/` and choose at most one primary scenario or integration Workflow.
3. Validate before recommendation:

   ```bash
   npx @workflow-skills/project-engineering-workflow workflow-validate \
     --output-dir "<project-root>" \
     --json
   ```

4. Foundation and role Templates are dependencies, not additional primaries. Select only when task, inputs, Profile, dependencies, Skills, permissions, and compatibility match.
5. For missing inputs, incompatible versions, or weak confidence, explain and use the governed route. Never fabricate activation.

## Loop Engineering Boundary

- Apply Loops only after formal design, task, impact, and acceptance confirmation; repair verified issues only in approved scope.
- A scope change, contract/permission/migration/external/release change, repeated strategy, or exhausted budget stops for a user decision.
- `90` never bypasses hard checks, evidence, or final acceptance.

## Scenario Loop Record

After confirmation, create one `Scenario Loop Run` for the bound Template. It is execution evidence, never Harness permission or a replacement for `workflow-state.yaml`.

Per iteration record number/Workflow evidence, root cause and strategy, score/floors/checks/blockers/evidence/risk, budget usage, material-change signals, and stop reason. Continue only in approved scope with budget, a new strategy, and iteration capacity; otherwise stop for decision or mark repeated failure as an evolution candidate.

## Required Output

- `主 Workflow`：Template、版本、状态、原因；`依赖 Workflow`：基础/角色依赖与版本；`不选择候选`：阻塞原因；
- `Loop 策略`：轮次、同根因上限、质量门禁、停止条件；`确认边界`：是否允许实施；
- `证据`：Profile、Manifest、Skill、版本、验证；`Loop 运行引用`：ID、轮次、质量/预算、停止或继续条件。

Read [references/workflow-manifest-contract.md](references/workflow-manifest-contract.md) only when you need schema, compatibility, binding, or migration detail.
