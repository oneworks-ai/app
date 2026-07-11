# Team design memory schema

Use one entry per durable OneWorks team standard.

```text
ID:
Revision:
Status: ACTIVE / SUPERSEDED / PENDING_CONFLICT_RESOLUTION / SCOPED_EXCEPTION / REJECTED
Rule:
Scope: team / project / module / component / state / viewport
Applies when:
Does not apply when:
Positive example:
Negative example:
Source:
Effective date:
Supersedes:
Exceptions:
Automatic enforcement:
```

## Classification

- Persist an explicit normative statement immediately when its scope is clear and it does not conflict with an active rule.
- Keep local coordinates, temporary visual probes, and reference-specific offsets in the current Visual Brief.
- Promote repeated local feedback only after identifying a reusable cause.
- Store numeric values at the narrowest owning project scope.

## Conflict procedure

Compare the candidate with every active rule whose scope overlaps the current surface.

1. Same meaning: merge the source and examples.
2. Clear narrower scope without an active-rule conflict: add the scoped rule. If it conflicts with an active rule, ask for explicit confirmation before recording a scoped exception.
3. The user explicitly names the old rule and requests replacement: supersede the old entry without deleting its history.
4. Every other conflict: ask whether to replace the standard or create a scoped exception. Global-sounding language alone is not replacement confirmation.

Use a concrete question:

> The current standard says `<old rule>` for `<old scope>`, while the new instruction says `<new rule>`. Should the new instruction replace the previous standard, or apply only to `<current surface>` as an exception?

Do not silently choose between replacement and exception.

## Precedence during execution

Follow the current explicit user instruction for the active task. Among durable rules, apply the most specific active scope. This execution precedence does not authorize overwriting durable memory.
