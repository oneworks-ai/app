# @oneworks/client 0.1.0-beta.2

- Fix packaged Electron workspace startup so the startup overlay is dismissed even when the renderer throttles `requestAnimationFrame`; the workspace UI now becomes interactive once the chat surface is visibly ready.
