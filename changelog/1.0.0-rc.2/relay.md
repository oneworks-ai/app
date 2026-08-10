# @oneworks/plugin-relay 1.0.0-rc.2

- Add personal and per-team reporting policies, with team-required and member-optional modes synchronized to the client.
- Add Relay diagnostic and Model Service ingestion, retention, authorization, aggregation, filtering, and Admin OpenAPI contracts.
- Add the unified Admin data dashboard with operations, stability, JavaScript exception fingerprint, and Model Service views.
- Replace the Admin daily observed-active chart with the client usage view's GitHub-style heatmap interaction, including day tooltips, Shift range selection, Escape clearing, and retention-aware availability.
- Build shared icon and type exports before deployment; materialize both runtime workspace packages before Vercel traces the serverless function.
- Rebuild the Vercel Relay project whenever server packaging scripts or shared runtime types change.
