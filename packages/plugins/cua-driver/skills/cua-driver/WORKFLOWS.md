# CUA Workflows

Use one workflow call for predictable serial work. Keep individual CUA calls for interface discovery and recovery.

Use `execute_workflows` when two or more workflows target independent apps. The runtime derives resource ownership from each workflow's declared `contexts` and `launch_app` steps. Workflows sharing a bundle id remain serial across MCP sessions; different apps may overlap waits, observations, and non-conflicting actions. Pointer actions always pass through the global style/start/action transaction, so concurrency cannot cross cursor colors or starting positions. Batch results return compact `run_id` and step-id references for each workflow.

## Compose a workflow

Declare named app contexts and semantic steps. Prefer stable accessibility `id`; otherwise combine `role` with `description`, `title`, or `text`.

Specify `window_id` or `window_title` when the task targets a particular window. Otherwise the runtime selects the window matching the app name, then falls back to the largest visible window on the current Space; it never trusts upstream list order as a primary-window signal.

```json
{
  "workflow_id": "calculator-four-plus-five",
  "cursor_color": "#625BF6",
  "cursor_start": { "x": 756, "y": 491 },
  "contexts": {
    "calculator": {
      "bundle_id": "com.apple.calculator",
      "window_title": "计算器"
    }
  },
  "steps": [
    {
      "node_id": "clear",
      "op": "click",
      "context": "calculator",
      "target": { "any_of": [{ "id": "AllClear" }, { "id": "Clear" }] }
    },
    {
      "node_id": "four",
      "op": "click",
      "context": "calculator",
      "target": { "id": "Four" }
    },
    {
      "node_id": "add",
      "op": "click",
      "context": "calculator",
      "target": { "id": "Add" }
    },
    {
      "node_id": "five",
      "op": "click",
      "context": "calculator",
      "target": { "id": "Five" }
    },
    {
      "node_id": "equals",
      "op": "click",
      "context": "calculator",
      "target": { "id": "Equals" }
    },
    {
      "node_id": "verify",
      "op": "assert",
      "context": "calculator",
      "target": { "role": "AXStaticText", "text": "4+5" }
    }
  ]
}
```

`cursor_color` is optional. Omit it to use the color automatically assigned to this OneWorks session,
or set any `#RGB` / `#RRGGBB` value when the user wants a specific session identity. The runtime
selects the color and serializes style application with each pointer action; the shared
`@oneworks/cursor` runtime owns the reusable SVG design.

`cursor_start` is optional and uses logical points on the main display. When omitted, each workflow
starts from the main-display center. When the user requests an explicit start, use `get_screen_size`
to choose in-bounds `x` and `y`; the runtime applies style, start position, and the first pointer action
inside one cross-process transaction without moving the physical mouse. For low-level recovery calls,
`set_session_cursor_start` configures the next pointer action without exposing raw pointer movement.

Every native action refreshes `get_window_state` and resolves its target at execution time. Never put a prior `element_index` into a workflow.

When the same logical control has state-dependent semantics, use ordered `target.any_of` alternatives. The runtime selects the first alternative with exactly one match and still fails on ambiguity.

The runtime pins workflow observation to the upstream AX capture mode once per MCP session. This is a procedural guarantee, not a prompt convention. Keep screenshots outside workflows and request one only when visual evidence or pixel-level recovery is needed.

## Atomic operations

- Native actions: `launch_app`, `click`, `double_click`, `right_click`, `type_text`, `press_key`, `set_value`, `scroll`.
- Timing and state: `sleep`, `wait_for`, `assert`.
- Control: `checkpoint`, `exit`.

Use `sleep` only for animation or an unobservable delay. Prefer `wait_for` with `state: "exists"` or `state: "not_exists"`, bounded by `timeout_ms` and `poll_ms`.

For missing targets and timed-out waits, set `on_missing` or `on_timeout` to `fail`, `skip`, `exit_success`, or `pause`. Use `exit_success` for optional UI that ends the workflow when absent. Use `pause` only when an Agent decision is genuinely required.

Use `checkpoint` with `kind: "agent_decision"` or `kind: "user_confirmation"`. Resume only with the returned `run_id` and `checkpoint_id`.

## Read results progressively

Workflows with up to three small steps return all step results inline. Longer workflows return `steps.ids`. Fetch only necessary details:

```json
{
  "run_id": "run_xxx",
  "step_ids": ["step_xxx"],
  "select": ["node_id", "status", "output", "error"]
}
```

Do not fetch every step after a successful workflow. Query failed, paused, or explicitly requested steps only.
