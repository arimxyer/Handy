---
paths:
  - "src-tauri/src/commands/insights.rs"
  - "src-tauri/src/llm_client.rs"
  - "src/components/settings/insights/**"
  - "src/components/settings/history/**"
  - "src/hooks/usePostProcessDrawer.ts"
---

# Insiders Features

These features exist on the `insiders` branch only:

- **History post-processing** — Re-run LLM post-processing on past transcriptions with version tracking
- **Version history viewer** — Browse and restore previous versions of any transcription
- **Post-process config drawer** — Compare results across different models
- **Speech pattern insights** — Analyze speech patterns with structured LLM output, history, and prompt enhancement

## Key files

- Backend: `commands/insights.rs`, `llm_client.rs`
- Frontend: `InsightsSettings.tsx`, `useInsightsProviderState.ts`, `VersionHistory.tsx`, `PostProcessDrawer.tsx`, `usePostProcessDrawer.ts`
