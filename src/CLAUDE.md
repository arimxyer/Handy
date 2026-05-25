# Frontend (React/TypeScript)

Tauri frontend built with React, TypeScript, and Tailwind CSS v4.

## Key Files

- `App.tsx` — Root component: onboarding flow, settings panel, model selector routing
- `bindings.ts` — **Auto-generated** by tauri-specta. Do not edit manually — regenerated on `mise run dev`. Contains TypeScript types and command wrappers matching the Rust backend.
- `stores/settingsStore.ts` — Zustand store for app settings with optimistic updates
- `stores/modelStore.ts` — Zustand store for model download/status state

## Directories

- `components/settings/` — Settings UI components (60+ files, one per setting/section)
- `components/settings/insights/` — Speech insights UI (insiders)
- `components/settings/history/` — History settings, version viewer, post-process drawer (insiders)
- `components/model-selector/` — Model download/selection interface
- `components/onboarding/` — First-run experience (permissions, model download)
- `overlay/` — Separate Tauri window for recording indicator overlay
- `hooks/` — React hooks for settings, platform detection, drawer state
- `i18n/` — Internationalization (i18next, 20 locales)
- `lib/` — Constants and utility functions
- `utils/` — Shared utility helpers

## Patterns

- **Path aliases**: `@/` maps to `./src/` (configured in tsconfig)
- **i18n enforcement**: ESLint rule prevents hardcoded strings in JSX. All text must use `t('key.path')` from `useTranslation()`.
- **Settings flow**: Component calls `commands.changeSomeSetting(value)` → Rust updates state → frontend calls `refreshSettings()` to sync Zustand store.
- **Tauri commands**: Import from `@/bindings` — e.g., `import { commands } from '@/bindings'`
