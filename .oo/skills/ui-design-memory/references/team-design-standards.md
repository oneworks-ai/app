# OneWorks team visual standards

These revisioned standards come from repeated explicit UI feedback summarized on 2026-07-12 and are owned by the OneWorks project. More specific module rules and registered exceptions remain authoritative for their surfaces.

## UDM-T001 — Prefer product-native interfaces

- Revision: 1
- Status: ACTIVE
- Rule: Build the actual product experience and its native visual language; avoid generic marketing, dashboard, or template styling unless explicitly requested.
- Scope: OneWorks team / all product surfaces
- Applies when: Creating or revising a product, tool, workspace, application, or interactive page.
- Does not apply when: The task explicitly requires a marketing or campaign surface.
- Positive example: A tool opens directly into its usable workspace with controls integrated into product chrome.
- Negative example: The primary experience is a decorative preview inside a generic card or hero.
- Source: Repeated team UI feedback, summarized 2026-07-12.
- Effective date: 2026-07-12
- Supersedes: none
- Exceptions: Explicit marketing or presentation requirements.
- Automatic enforcement: Visual Brief and completed independent whole-surface review.

## UDM-T002 — Use functional surface boundaries

- Revision: 1
- Status: ACTIVE
- Rule: Add cards, slabs, panels, and borders only when they communicate a real functional boundary. Avoid cards inside cards and large decorative backing surfaces.
- Scope: OneWorks team / all product surfaces
- Applies when: Choosing containers, grouping, panel chrome, cards, and decorative surfaces.
- Does not apply when: A modal, editor viewport, table, device frame, or other functional boundary requires a container.
- Positive example: A modal, editor viewport, table, or device frame has a clear functional boundary.
- Negative example: A large colored slab only decorates content that already has a boundary.
- Source: Repeated team UI feedback, summarized 2026-07-12.
- Effective date: 2026-07-12
- Supersedes: none
- Exceptions: Reference fidelity may require a scoped decorative surface.
- Automatic enforcement: Container hierarchy review and candidate DOM/CSS lint.

## UDM-T003 — Keep geometry stable

- Revision: 1
- Status: ACTIVE
- Rule: Preserve stable dimensions, alignment, and clipping across content and state changes. Prevent layout shift, overlap, holes, jitter, and competing geometry definitions.
- Scope: OneWorks team / all product surfaces
- Applies when: Components change content, state, selection, hover, loading, viewport, or theme.
- Does not apply when: The interaction intentionally animates layout with documented geometry.
- Positive example: Button, image, overlay, and active outline share one geometry source.
- Negative example: Separate clipping or sizing rules cause outline and content drift.
- Source: Repeated team UI feedback, summarized 2026-07-12.
- Effective date: 2026-07-12
- Supersedes: none
- Exceptions: Intentional layout animation with stable start/end states.
- Automatic enforcement: DOM geometry, overflow checks, state screenshots, and completed independent behavior validation.

## UDM-T004 — Give each boundary one spacing owner

- Revision: 1
- Status: ACTIVE
- Rule: A shared boundary between adjacent elements has one spacing owner. If both sides retain internal spacing, use a visible structural separator.
- Scope: OneWorks team; numeric values remain in owning project tokens and rules
- Applies when: Adjacent components, fields, sections, rows, headers, or content regions share an edge.
- Does not apply when: Independent internal padding is separated by an explicit structural boundary.
- Positive example: Parent gap or one side's padding owns the separation using the project's token.
- Negative example: Parent gap, bottom padding, and top padding accumulate into unexplained whitespace.
- Source: Repeated team UI feedback; OneWorks numeric form exists in project `styles.md`.
- Effective date: 2026-07-12
- Supersedes: none
- Exceptions: Independently padded structures separated by a visible divider.
- Automatic enforcement: Computed box-model inspection and module visual regression.

## UDM-T005 — Verify the whole affected surface

- Revision: 1
- Status: ACTIVE
- Rule: Inspect the complete affected page or application surface at target viewports and states after every visual change, not only the selector or region that changed.
- Scope: OneWorks team / all product surfaces
- Applies when: Any user-visible visual implementation changes.
- Does not apply when: The task changes no user-visible output.
- Positive example: Review hierarchy, surrounding chrome, interactions, overflow, responsive behavior, and themes together.
- Negative example: Fix one reported corner while introducing inconsistency elsewhere on the screen.
- Source: Repeated team UI feedback, summarized 2026-07-12.
- Effective date: 2026-07-12
- Supersedes: none
- Exceptions: None; deterministic one-off changes may use focused evidence but still require completed independent review.
- Automatic enforcement: Require independent session PASS and parent-inspected revision-bound evidence.

## UDM-T006 — Use authentic assets and established primitives

- Revision: 1
- Status: ACTIVE
- Rule: Prefer real assets, existing design-system components, and proven libraries over approximate substitutes or newly invented local primitives.
- Scope: OneWorks team / all product surfaces
- Applies when: A canonical asset, shared component, or established library already owns the visual behavior.
- Does not apply when: No suitable primitive exists and a scoped new implementation is justified.
- Positive example: Reuse the product icon system, component library, or canonical asset.
- Negative example: Replace a real rank icon with styled text or recreate an existing shared control locally.
- Source: Repeated team UI feedback, summarized 2026-07-12.
- Effective date: 2026-07-12
- Supersedes: none
- Exceptions: New primitives with an explicit abstraction decision.
- Automatic enforcement: Component and asset search in the Visual Brief; reviewer checks duplication.

## UDM-T007 — Measure reference fidelity before improvising

- Revision: 1
- Status: ACTIVE
- Rule: When reproducing a reference, map viewport, hierarchy, position, proportion, spacing, clipping, and state behavior before applying creative interpretation.
- Scope: OneWorks team / reference-driven visual work
- Applies when: The task provides or names a reference that should guide fidelity.
- Does not apply when: The reference is inspirational only and the task explicitly permits a new direction.
- Positive example: Record the reference coordinate system and key relationships in the Visual Brief.
- Negative example: Produce a thematically similar interface whose geometry and behavior differ substantially from the reference.
- Source: Repeated team reference-reproduction feedback, summarized 2026-07-12.
- Effective date: 2026-07-12
- Supersedes: none
- Exceptions: Explicitly approved creative interpretation.
- Automatic enforcement: Matched reference/actual screenshots and completed independent visual review.
