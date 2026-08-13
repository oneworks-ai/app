# Desktop 与双运行路径 Review Profile

修改 `apps/desktop`、server bundle、开发态 TS 入口、打包资源、启动状态或安装产物时加载本文件。

## RUNTIME-001 保留有意设计的开发与生产双路径

Owner：desktop maintainers。

适用条件：生产环境从源码执行切换到预构建 bundle，或修改开发启动入口。

必须：分别验证开发态直接运行源码的 DX 路径和正式版运行构建产物的路径；路径差异必须是显式设计，而不是偶然分叉。

禁止：为了统一生产路径而无依据移除开发态直接运行 TypeScript，或只验证其中一条路径。

验证：至少提供开发启动验证和正式 bundle/安装产物验证。

默认级别：破坏任一路径时 P1。

例外：某个入口明确只在开发或正式版存在时，必须在命名、构建配置和测试中显式限定环境，并证明不会被另一条运行路径调用。

## DESKTOP-001 使用稳定的打包资源根目录

Owner：desktop maintainers。

适用条件：bundle 内代码需要访问 bundle 外部的可执行文件、图标、音效或其他资源。

必须：从不会随 bundler 输出位置变化的应用根目录定位资源，并明确开发态 fallback。

禁止：仅依赖 bundle 后模块的 `__dirname` 推导外部资源位置。

验证：检查 bundle 前后解析路径，并运行真实安装产物 smoke。

默认级别：安装后资源不可用时 P1。

例外：资源已内联到 bundle，或由打包配置复制到与 bundle 绑定的稳定位置，且产物检查证明运行时不依赖外部 package 目录。

## RUNTIME-002 Ready 必须代表用户能力可用

Owner：desktop maintainers。

适用条件：启动页、loading、health check、service ready 或 degraded 状态发生变化。

必须：ready 判定覆盖用户下一步实际依赖的能力；暂态和可降级能力要显式建模。

禁止：仅以组件 mount、进程存在或端口打开代替业务能力可用。

验证：覆盖正常、暂态失败、持久失败和恢复路径；断言用户可观察状态与可执行动作一致。

默认级别：错误放行主要流程时 P1，状态提示不准确但不阻断时 P2。

例外：仅表达 transport/process 存活、不会结束用户等待或释放用户动作的低层状态，应使用 `transportReady`、`processReady` 等能力限定命名，并由上层继续判断业务能力；不得把它直接暴露为用户流程的最终 ready。

## DESKTOP-002 打包链路变更必须验证真实产物

Owner：desktop maintainers。

适用条件：修改 Electron builder、bundle entry、asar/unpack、资源复制、原生依赖或安装后启动路径。

必须：在受影响平台构建并启动真实安装产物，验证关键能力而不仅是窗口出现。

禁止：用 dev server、源码运行或仅构建成功替代 packaged smoke。

验证：记录产物类型、平台、启动结果和本次改动涉及的关键能力。

默认级别：缺失证据时为合入验证缺口；已知正式版路径失效时 P1。

例外：纯文案、元数据或能够证明不影响打包图谱和运行路径的改动，可以使用既有同 commit CI 产物证据；需要在 PR 中说明不触发真实产物验证的理由。
