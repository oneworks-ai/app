# @oneworks/adapter-codex 1.0.0-rc.6

- Verify browser login credentials through the official Codex account and rate-limit reads before saving them, and
  preserve verified credential rotations so quota refreshes no longer fall back to expired tokens.
- Share one managed credential owner across local Codex sessions and flush session-owned rotations back to the
  portable account with race-safe revision and identity checks, including complete atomic file replacements. Live
  probes now rotate isolated copies and merge only fully verified results, without writing real-home or explicit
  auth-file credentials or allowing failed probes to affect active sessions.
- Keep chat startup on cached account/quota snapshots so it does not launch a competing live account probe, while
  settings and explicit account surfaces retain live quota refresh.
- Match same-account local credentials only with equal non-empty account IDs, while allowing unknown organization
  metadata and rejecting explicit organization conflicts; matching email or organization labels alone no longer
  adopts credentials or reuses account keys, and a colliding generated login key no longer overwrites an unrelated
  credential even when stale cached metadata still describes an auth file that changed after discovery.
- Keep login, live-probe, and pooled app-server homes alive until their spawned process actually exits, with bounded
  termination fallback; pool and broker disposal now await that terminal event, setup failures remove their isolated
  probe homes, and failed stream/shared-model acquisition also flushes its prepared credential lifecycle. Guard
  reset-credit consumption with the complete canonical and effective runtime-source snapshot captured before
  credential materialization, including canonical auth-file provenance and the exact bytes copied for the destructive
  RPC.
