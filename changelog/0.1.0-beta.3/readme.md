# One Works 0.1.0-beta.3

- Fix the chat running indicator so adapter CLI preparation is only shown while the adapter CLI check is actually active; waiting for the assistant reply now falls back to the normal thinking state.
- Clarify the adapter CLI preparation status text so users are not told a CLI will be installed when One Works is only checking an existing compatible runtime.
- Release the packaged Electron app with the chat send status fix and the matching beta bootstrap/runtime package sequence.
