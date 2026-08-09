# Client Diagnostics

此目录负责浏览器运行时的全局异常捕获与安全传输。异常必须先通过 `@oneworks/diagnostics` 归一化，只发送稳定错误码、类型和不可逆指纹；不得发送 message、stack、URL、路径或组件内容。

- Electron 渲染层优先走 `window.oneworksDesktop.reportJavaScriptError`，写入桌面诊断日志。
- Web / PWA 走本地 `/api/diagnostics/javascript-errors`，由本地 Server 记录并按用户的系统诊断开关决定是否转发 OTLP。
- React Error Boundary、`window.error`、`unhandledrejection` 和客户端 bootstrap 共用同一个去重、限流 reporter。

修改后至少运行 `apps/client/__tests__/javascript-error-reporting.spec.ts`、客户端 typecheck 与 build。
