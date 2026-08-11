# Channel Continuity Service

This service hydrates and renders short-lived conversation state for a fresh child session. It may load only the resolved state/thread, unexpired turns and owner-scoped pending intents; it never reuses a prior child runtime or full transcript.
