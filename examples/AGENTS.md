# Examples Guide

Each child directory under `examples/` is a specific scenario. A scenario may be small and focused or grow into a complex fixture, but it should keep a clear purpose in its own README.

Testing convention:

- When testing a scenario, run its commands from that scenario directory. For example, use `workdir=examples/task-board-demo` with `pnpm test`, not a root-level `pnpm -C ...` wrapper.
- When debugging One Works source code with an example workspace, keep the source dev server command at the repository root and point `__ONEWORKS_PROJECT_WORKSPACE_FOLDER__` / `__ONEWORKS_PROJECT_LAUNCH_CWD__` to the example directory.
- When the user asks to develop this repository itself, work from the repository root unless the task explicitly targets an example scenario.

Runtime outputs should stay under the home project directory (`~/.oneworks/projects/<project-key>`) or other ignored scratch paths, not in example workspaces.
