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

For card or list-row actions that are intentionally hidden until hover or focus, also verify all of the following in the real surface:

- the default card or row has no empty action reservation and its text keeps the same available width and line wrapping;
- the hover / focus action layer covers the right edge without moving, resizing, reflowing, or clipping the normal content or the card / row itself;
- any backdrop, fade, or surface behind the overlay keeps both the action and obscured text legible in the reviewed themes;
- keyboard focus exposes the same action without a mouse-only path; touch or no-hover layouts provide a persistent reachable equivalent, such as a More menu.

An always-visible primary or semantic column action is an exception only when it is intentionally part of the record's normal information layout; reviewers must record that distinction rather than treating a reserved action slot as hover behavior.

When a collection exposes card reordering, reviewers must verify that each rendered direction has a real target in the current layout: use left / right affordances only for same-row horizontal neighbours in a multi-column grid, and up / down only for a true single-column ordered list. A row boundary is not a hidden horizontal target; cross-row reordering needs drag and drop or an explicit destination control. Do not accept an unavailable or ambiguous “move forward” action. Recheck the direction, tooltip / `aria-label`, Tab reachability, Enter / Space activation, and first / last / partial-row behavior at responsive breakpoints; do not assume arrow-key reordering unless the implementation deliberately provides a roving-grid pattern.

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
