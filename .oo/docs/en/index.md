# Use One Works in Your Project

This documentation is the user-facing entry point for integrating One Works into your own project.

## Start Here

- [Install and Prepare](./usage/install.md)
- [Data Asset Directories](./asset-directories.md)
- [Start Services](./usage/runtime.md)
- [Adapter CLI Installation and Versions](./usage/adapter-cli.md)
- [Desktop App](./usage/desktop.md)
- [VS Code Extension](./usage/vscode-extension.md)
- [Web UI and Terminal View](./usage/web.md)
- [Adapter Configuration and Multiple Accounts](./usage/adapters.md)
- [PWA and Standalone Deployment](./usage/pwa.md)
- [Channel Session Binding](./usage/channels.md)
- [CLI and Examples](./usage/cli.md)
- [Examples Directory](./usage/examples.md)
- [Skills and Dependencies](./usage/skills.md)
- [Workspace Scheduling](./usage/workspaces.md)
- [Plugins, UI Extensions, and Data Assets](./usage/plugins.md)
- [Adapter Native Plugins and Marketplaces](./usage/native-plugins.md)

## Official Links

- Website: [oneworks.cloud](https://oneworks.cloud/)
- Docs: [oneworks.cloud/docs](https://oneworks.cloud/docs/)
- GitHub: [oneworks-ai/app](https://github.com/oneworks-ai/app)
- Support: [support@oneworks.cloud](mailto:support@oneworks.cloud)

## Integration Goals

- You do not need to clone this repository. Install only the packages you need.
- Configuration and sessions are scoped to your project directory, not to the One Works repository.
- The UI, CLI, MCP server, hooks runtime, adapters, plugins, and skills can be integrated independently.
- The Web UI session page includes a standalone `terminal` view, but terminal runtimes and chat message streams are separate execution paths.
