# Vendors Agent Guide

`vendors/` hosts external upstream projects as Git submodules. Mount each repository at `vendors/<org>/<repo>` and preserve the owner casing from its canonical GitHub URL.

- `NWYLZW/shikitor/`: the Shikitor editor project.
- `cordiverse/cordis/`: the Cordis plugin framework used by Shikitor.

Like standalone projects under `assets/`, vendor repositories keep their own dependency graph, lockfile, build commands, and release lifecycle. Do not add them to the root `pnpm-workspace.yaml`. Make source changes in the owning submodule; the app repository only records the submodule commits after those changes are committed upstream.
