# Desktop Control Protocol

This protocol is the agent-facing bridge between One Works Electron and automation agents. It is not a human workflow. Agents should prefer the protocol server over hand-written Electron launch flags, ad-hoc CDP discovery, or direct `events.jsonl` parsing.

## Start

```bash
pnpm --silent tools dev-service ensure desktop-control --json
```

The command acquires the target operation lease, reuses a healthy shared bridge when possible, and prints a development-service status document:

```json
{
  "protocol": "oneworks.dev-service",
  "version": 1,
  "services": [
    {
      "target": "desktop-control",
      "ready": true,
      "state": {
        "phase": "ready",
        "controlUrl": "http://127.0.0.1:12345"
      }
    }
  ]
}
```

Agents should read `services[0].state.controlUrl` and then call `GET /protocol` before running a scenario. Use `pnpm --silent tools dev-service status desktop-control --json` to recover the URL in a later session; do not start another bridge for discovery.

`pnpm tools desktop-control serve` is reserved for explicit internal foreground debugging. It is not the shared-session start path and must not be left running as an independently managed bridge.

## Minimal Agent Workflow

Use this exact flow for Electron UI verification:

1. Start the bridge:

   ```bash
   pnpm --silent tools dev-service ensure desktop-control --json
   ```

2. Parse the JSON status document and store `services[0].state.controlUrl`.

3. Read protocol metadata:

   ```http
   GET {baseUrl}/protocol
   ```

4. Create an Electron control session:

   ```http
   POST {baseUrl}/v1/electron/sessions
   content-type: application/json

   {
     "workspace": "/absolute/path/to/workspace"
   }
   ```

5. Use `data.launch.control.cdpEndpoint` and `data.launch.targets` to drive the UI through CDP.

6. Optional: record the current Electron UI surface:

   ```http
   POST {baseUrl}/v1/electron/sessions/{sessionId}/recordings
   content-type: application/json

   {
     "name": "electron-ui-smoke",
     "durationMs": 5000
   }
   ```

   This uses the reusable `demo-video` recorder against the current Electron CDP page target and returns MP4 / poster paths.

7. Send a prompt containing a unique nonce, for example:

   ```text
   Please reply exactly: OK_AGENT_1782000000
   ```

8. Wait for runtime evidence:

   ```http
   POST {baseUrl}/v1/evidence/wait-reply
   content-type: application/json

   {
     "expectedReply": "OK_AGENT_1782000000",
     "waitMs": 90000
   }
   ```

9. Report `phase`, `data.ok`, `data.sessionId`, `data.eventsPath`, and any recording `videoPath`.

The agent should not ask a human to copy session ids or inspect files manually. Session discovery by nonce is part of the bridge.

## Envelope

Every response uses this envelope:

```ts
type DesktopControlResponse<T> =
  | { ok: true; phase: string; data: T }
  | { ok: false; error: { code: string; message: string } }
```

Use `phase` for control flow. Do not parse human text.

Common success phases:

- `desktop-control.ready`: bridge process is listening.
- `protocol`: protocol metadata was returned.
- `electron.session.ready`: an isolated Electron control session is ready.
- `electron.targets`: CDP targets were refreshed.
- `electron.recording.ready`: the current Electron UI page was recorded through `demo-video`.
- `runtime.evidence.sessions`: runtime evidence sessions were listed.
- `runtime.evidence.reply.ready`: the expected assistant reply was found.

Common failure shape:

```json
{
  "ok": false,
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Unknown desktop control session: desktop-..."
  }
}
```

If `POST /v1/electron/sessions` returns `UNSUPPORTED_ELECTRON_APP`, the target app was built before the external CDP hook existed. Do not retry the same installed app. Rebuild/reinstall One Works from a build that includes `apps/desktop/src/main/external-cdp.ts`, then create a new Electron session.

## Endpoints

### `GET /health`

Checks whether the bridge is ready.

### `GET /protocol`

Returns the protocol version and endpoint catalogue.

### `POST /v1/electron/sessions`

Cold-launches an isolated Electron app instance and returns a control session.

Request body:

```json
{
  "appPath": "/Applications/One Works.app",
  "workspace": "/path/to/workspace",
  "userDataDir": "/tmp/oneworks-agent-profile",
  "allowUnsupportedApp": false,
  "port": 9333,
  "waitMs": 30000
}
```

All fields are optional. If omitted, the bridge chooses a free CDP port and a temporary isolated `userData` directory.
`allowUnsupportedApp` defaults to `false`; only set it to `true` for local Electron debugging when a maintainer explicitly wants to bypass the safety check. It may crash old installed apps.

Response data includes:

- `sessionId`: bridge session id
- `launch.control`: `{ "protocol": "cdp", "target": "electron", "cdpEndpoint": "http://127.0.0.1:9333" }`
- `launch.targets`: current CDP targets
- `agentCommands`: machine-readable follow-up hints

Example response excerpt:

```json
{
  "ok": true,
  "phase": "electron.session.ready",
  "data": {
    "sessionId": "desktop-mfl4w0qo",
    "launch": {
      "control": {
        "protocol": "cdp",
        "target": "electron",
        "cdpEndpoint": "http://127.0.0.1:9333"
      },
      "targets": [
        {
          "type": "page",
          "title": "One Works",
          "url": "http://127.0.0.1:5173/",
          "webSocketDebuggerUrl": "ws://127.0.0.1:9333/devtools/page/..."
        }
      ]
    }
  }
}
```

### `GET /v1/electron/sessions`

Lists Electron control sessions launched by this bridge process.

### `GET /v1/electron/sessions/:sessionId/targets`

Refreshes CDP targets for a launched Electron session.

### `POST /v1/electron/sessions/:sessionId/recordings`

Records the current Electron UI page using the reusable `demo-video` recorder for temporary diagnostics.

This endpoint refreshes Electron CDP targets, selects the first recordable page target, connects the existing recorder to that target's `webSocketDebuggerUrl`, and returns MP4 / poster / still paths. It is not the formal Electron release-validation or product-material path. Formal launcher-to-workspace videos must use `pnpm tools desktop-control record-batch ... --use-deskpad-display`, which uses a dedicated recording display as the macOS system capture source, verifies that the captured display frame contains the Electron app window, and crops the delivered video to the app window area.

For formal Electron evidence, do not use CDP screenshots, `system-window` capture, or fixed regions as the recording source. CDP is allowed only for automation, target discovery, DOM readiness, and debugging. The visual source must be a continuous macOS display recording of a dedicated recording display that passes app-window visibility validation, and the delivered MP4 must be cropped to the target One Works window area with padding. Do not deliver the full virtual desktop or wallpaper-only captures.

Request body:

```json
{
  "scenarioId": "current-page-tour",
  "captureSource": "system-display",
  "name": "electron-ui-smoke",
  "outDir": ".logs/demo-videos/electron-ui-smoke",
  "durationMs": 5000,
  "followCdpTargets": false,
  "width": 1440,
  "height": 900,
  "fps": 12,
  "keepFrames": false,
  "language": "zh",
  "systemDisplayId": 2,
  "targetUrl": "optional explicit URL",
  "waitForText": "输入消息",
  "waitForTextAbsent": "项目正在就位",
  "waitForTextAbsentTimeoutMs": 90000,
  "waitForTextTimeoutMs": 90000
}
```

Formal launcher transition command:

```bash
pnpm tools desktop-control record-batch launcher-open-workspace-ui-tour \
  --app "/Applications/One Works.app" \
  --workspace "/absolute/path/to/workspace" \
  --use-deskpad-display
```

`scenarioId` defaults to `current-page-tour` so ad-hoc diagnostics do not reload the renderer. `targetUrl` defaults to the current Electron page target. `language` is an optional One Works interface-language override, for example `zh`, `en`, `zh-Hans`, or `en-US`. `pageBackground: "macos-wallpaper"` and `pageBackgroundImage` are only for CDP/headless page diagnostics; they are not the formal Electron visual background. Use `waitForText` plus `waitForTextAbsent` for chat/workspace recordings so the first captured frame is the ready page, not the launch overlay. The response data includes `targetUrl`, `targets`, and `recording.videoPath` / `recording.posterPath` / `recording.stillsManifestPath`; agents should inspect the still images when they need visual evidence.

Pure Web product-material generation should use `pnpm tools demo-video batch <scenario> --url <page-url>` when the goal is to produce the default `light/dark x zh/en` four-video matrix.

For real Electron launcher-to-workspace product material, use the dedicated batch wrapper instead of `demo-video batch url-tour`:

```bash
pnpm tools desktop-control record-batch launcher-open-workspace-ui-tour \
  --app "/Applications/One Works.app" \
  --workspace "/absolute/workspace" \
  --use-deskpad-display
```

The wrapper starts a fresh isolated Electron session for each `light/dark x zh/en` variant, places the app windows on a dedicated recording display, starts a real background window with the fixed Ventura Graphic Light wallpaper, verifies that macOS system display capture includes the app window pixels, crops the output to the workspace window bounds plus padding, and then closes the app. It preserves the real launcher/workspace BrowserWindow transition and lets macOS own the window corners, shadow and traffic lights without exposing the full virtual desktop.

The app-window visibility check is pixel-based after decoding the PNG captures. Do not compare `screencapture` PNG files with `cmp`: display captures and window captures can differ in metadata, color profile, or shadow treatment even when the target window is visible. Transparent / vibrancy / glass windows also cannot require raw RGB similarity, because the standalone window capture does not contain the recording-display wallpaper while the display crop does; use structural edge-overlap metrics as an accepted visibility signal. When the visibility check fails, keep and inspect the display/window/crop probe images and the reported similarity / edge metrics before changing capture strategy.

For system display capture, `recordDuring(durationMs, action)` treats `durationMs` as the minimum capture window, not a hard action cutoff. If a launcher directory walk, workspace open, or other scenario action continues after the nominal duration, the recorder must keep capturing until the action settles; otherwise cursor events emitted after the video segment closes are compressed into a later timestamp and appear as a visible cursor jump in the final MP4. After changing this logic, inspect high-frequency frames or cursor coordinates around launcher-to-workspace transitions.

For release validation or product-facing demos, do not rely on current-wallpaper fallback. Pass `--use-deskpad-display` so the wrapper resolves `DeskPad Display`, injects launcher/workspace bounds inside that virtual display, verifies display capture visibility, and uses the fixed approved Ventura Graphic Light background by default. Only pass `videoBackgroundImage` / `--video-background-image` when the user explicitly asks to change the background. If DeskPad is unavailable or only captures the wallpaper layer, the command must fail instead of falling back to the user's current desktop.

### `DELETE /v1/electron/sessions/:sessionId`

Terminates the launched Electron process when the bridge still knows its pid and removes the session record.

### `GET /v1/evidence/sessions?limit=20&projectHome=/path`

Lists bounded runtime evidence sessions. This wraps `runtime-evidence` discovery and avoids ad-hoc filesystem scans.

### `POST /v1/evidence/wait-reply`

Waits for a completed runtime assistant reply.

Request body:

```json
{
  "expectedReply": "OK_AGENT_NONCE",
  "projectHome": "/path/to/project-home",
  "sessionId": "optional-runtime-session-id",
  "waitMs": 90000
}
```

If `sessionId` is omitted, the bridge discovers the session by `expectedReply` across bounded runtime stores.

## Agent Loop

1. Ensure the shared bridge with `pnpm --silent tools dev-service ensure desktop-control --json`.
2. `GET /protocol`.
3. `POST /v1/electron/sessions` with the target workspace.
4. Drive the returned CDP target.
5. Optionally `POST /v1/electron/sessions/:sessionId/recordings` for video evidence.
6. Send a nonce prompt through the UI.
7. `POST /v1/evidence/wait-reply` with that nonce.
8. Report the response envelope, evidence path, and recording path.

The bridge is responsible for port selection, isolated user data, target discovery, video recording handoff, and evidence discovery. Scenario tools should compose these endpoints instead of reimplementing those steps.

Stopping or restarting the shared bridge always requires explicit user authorization for the `desktop-control` target, even when it is unhealthy. When authorized, use `pnpm --silent tools dev-service stop desktop-control --json` or `pnpm --silent tools dev-service restart desktop-control --json` and hand off the resulting operation id, state, and events rather than killing the foreground process.

## Do Not Reimplement

Agents and scenario tools should not:

- Manually choose `--remote-debugging-port`.
- Launch Electron without an isolated `userData` directory for verification.
- Recursively scan home directories for `events.jsonl`.
- Ask a human to provide runtime session ids when a nonce can be used.
- Parse text output when a JSON envelope is available.

If a scenario needs a new action, add it to this bridge protocol first, then compose it from the scenario runner.
