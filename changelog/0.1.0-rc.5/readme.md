# One Works 0.1.0-rc.5

- Fix the installed Desktop application opening to an empty gray window when the CLI loader re-executes the bundled server without preserving its Electron owner IPC channel.
- Keep Desktop manager and workspace server descendants bound to the owning Electron process, including complete process-tree cleanup on Windows.
- Align all One Works applications, runtime packages, channels, adapters, and plugins on the `rc.5` release line.
