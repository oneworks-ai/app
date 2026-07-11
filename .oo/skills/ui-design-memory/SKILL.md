---
name: ui-design-memory
description: Apply, review, and continuously evolve the OneWorks team's durable UI design standards. Use for any OneWorks task that changes or reviews layout, styling, theme, spacing, responsive behavior, component appearance, visual assets, or reference-image fidelity, and whenever user visual feedback may express a reusable team standard. Require a Visual Brief, conflict-aware project memory capture, a completed independent visual consistency session with real expected-behavior validation, and experience persistence before delivery; do not promote one-off pixel nudges into lasting rules.
---

# OneWorks UI Design Memory

Use repository files as the team's revisioned, version-controlled design memory. Do not rely on a person, model, or current conversation to preserve standards.

## Start every visual task

1. Read [team-design-standards.md](references/team-design-standards.md).
2. Read `.oo/rules/frontend-standard/design-memory.md`, its registry, applicable project design rules, design tokens, shared component guidance, and the nearest `AGENTS.md`.
3. Search existing rules before proposing a new standard. Prefer `rg` over broad source scans.
4. Produce a concise Visual Brief before non-mechanical visual edits:
   - target surface and viewports;
   - reference images or existing product surfaces;
   - layout hierarchy and key geometry;
   - components and tokens to reuse;
   - interaction and responsive invariants;
   - prohibited patterns;
   - expected user behaviors;
   - required screenshots and observable checks.
5. Keep task-specific coordinates and temporary adjustments in the Visual Brief, not durable memory.

## Classify user feedback

Treat feedback as a durable-standard candidate when it uses normative language such as `all`, `always`, `default`, `must`, `ensure`, `standard`, `consistent`, `统一`, `所有`, `以后`, `默认`, `始终`, `必须`, `保证`, `规范`, or `不要再`.

Treat feedback as task-local when it only adjusts the current composition, for example `move this 2px left`, `crop this image slightly`, or `use x=278 for this reference viewport`.

If the same local correction recurs, infer and validate the underlying principle instead of memorizing the literal adjustment. For example, repeated `move the icon 2px left` feedback may indicate an optical-centering or shared-slot problem.

Use [memory-schema.md](references/memory-schema.md) for classification, scope, and persistence fields.

## Resolve standards before persisting

Search team standards, project rules, module guidance, tokens, shared components, the project design-memory registry, and current exceptions.

- If the candidate matches an active rule, add evidence or an example instead of duplicating it.
- If the user explicitly limits it to a surface, module, component, state, or viewport and it does not conflict with an active rule, record the scoped rule without changing broader standards. If it conflicts with any active rule, still ask for explicit confirmation that it is a special case.
- If the user explicitly names an existing rule and says to replace it, treat that as resolved confirmation, mark the old rule superseded, and retain the relationship.
- For every other conflict with an active rule, ask whether the new instruction replaces the previous standard or is a special case, even when the new wording sounds global. Show the old rule, new statement, and affected scopes.

Until the user resolves a conflict, follow the latest explicit instruction for the current task, keep the existing durable rule unchanged, and mark the candidate `PENDING_CONFLICT_RESOLUTION`. Ask as soon as the conflict is found rather than waiting until delivery.

Persist cross-module team principles in this skill. Persist concrete project, module, component, and token standards in the owning rule, component, or token file and register their identity, exceptions, conflicts, and supersession in `.oo/rules/frontend-standard/design-memory-registry.md`. Do not duplicate scoped numeric values across layers.

## Complete independent visual validation

Before completing any user-visible visual change, including a deterministic one-off pixel adjustment, create an independent, read-only review session with a clean context. Give it the raw Visual Brief, references, latest diff or revision, target runtime URL or application surface, expected behaviors, screenshots, and applicable design standards. Do not give it the intended verdict.

Creating the session is not completion. The parent task must:

1. wait for the independent session to finish;
2. read its actual result and evidence;
3. verify that it opened the intended current-revision surface;
4. verify that it exercised every expected behavior and required state;
5. confirm that screenshots, DOM geometry, computed styles, interactions, responsive states, themes, and console evidence are real and sufficient for the task;
6. require a revision-bound `PASS` before stopping.

Use [visual-review.md](references/visual-review.md) as the review contract.

- Route fixes back to the implementation owner; the reviewer must not become a second writer.
- A planned checklist, code-only review, created thread, or uninspected completion message does not satisfy the gate.
- Invalidate the review when related code, styles, assets, tokens, dependencies, or runtime build changes.
- If the independent session fails, stops early, omits expected behavior, or cannot inspect the real surface, continue or resume it until it completes, or report the task blocked. Do not stop as if validation passed.

Purely invisible logic changes do not need this visual gate. A deterministic one-off visual adjustment may use a reduced brief and focused evidence, but it still requires a completed independent session that checks the changed element and its surrounding consistency.

## Capture experience before delivery

Classify every visual task with exactly one experience result:

- `NO_DURABLE_LEARNING`
- `PERSISTED`
- `PERSISTED_AS_SCOPED_EXCEPTION`
- `MERGED_WITH_EXISTING_RULE`
- `PENDING_CONFLICT_RESOLUTION`

Record a durable learning only when it is stable and reusable. Include a positive example, negative example, scope, source, effective date, known exceptions, and automatic enforcement. Prefer components, tokens, lint checks, DOM assertions, or visual regression tests over prose when they can encode the standard reliably.

Do not store secrets, private account data, temporary paths, ephemeral ports, or copied conversation transcripts in design memory.

## Deliver

Report:

```text
Visual Review Session:
Visual Review: PASS / FAIL / BLOCKED
Reviewed Revision:
Expected Behaviors Exercised:
Evidence Inspected by Parent:
Experience Capture: <status>
Persisted Rule or Pending Conflict:
Remaining Visual Risk:
```
