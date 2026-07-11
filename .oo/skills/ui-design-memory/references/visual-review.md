# Independent visual validation contract

Review the latest implementation as a read-only independent session. Do not modify files.

## Required inputs

- Visual Brief and original user request
- applicable team, project, and module standards
- reference images or existing product surfaces
- latest diff and commit or tree hash
- current-revision runtime URL or application surface
- expected user behaviors and required states
- target viewports and themes

## Perform real validation

Open the intended current-revision surface and actually exercise every expected behavior. Inspect visible results, screenshots, DOM geometry, computed styles, interactions, responsive layouts, themes, overflow, clipping, scrolling, accessibility-visible states, and relevant console output.

Do not return `PASS` from a plan, code inspection, existing screenshots of uncertain provenance, or an inability to operate the real surface.

## Review the complete affected surface

Check:

1. product-native visual language and hierarchy;
2. component and token reuse;
3. spacing ownership, alignment, density, typography, color, radius, and borders;
4. stable geometry across hover, focus, selected, loading, empty, error, and disabled states;
5. responsive layouts, themes, overflow, clipping, and scrolling;
6. fidelity to references without unapproved creative substitution;
7. expected behavior and interaction preservation;
8. known team and project anti-patterns;
9. evidence provenance and revision identity.

## Output

```text
Verdict: PASS / FAIL / BLOCKED
Reviewed revision:
Runtime surface opened:
Expected behaviors exercised:
Evidence produced:
Must-fix findings:
Optional refinements:
Standards applied:
Potential durable learning:
Remaining risk:
```

Return `FAIL` when a must-fix inconsistency exists. Return `BLOCKED` when the current-revision surface or a required expected behavior cannot be exercised. The parent task must read this output, inspect the evidence, and confirm that expected-behavior validation really completed before it stops.
