# Settings Components

One component per setting, composed into section pages. Each component is self-contained with its own state management.

## Structure

Settings are organized into sections via `index.ts` exports. Each component typically:
1. Gets current value from `useSettings()` hook
2. Renders a UI control (toggle, dropdown, input)
3. Calls a Tauri command on change
4. Refreshes settings after the command succeeds

## Subdirectories

- `insights/` — Speech pattern insights UI and provider state (insiders)
- `history/` — History management, version viewer, post-process drawer (insiders)
- `advanced/` — Advanced settings section
- `PostProcessingSettingsApi/` — Post-processing provider/model/prompt configuration (shared between post-process and insights)

## Shared UI Components

The `../ui/` directory contains reusable UI primitives (Dropdown, Toggle, etc.) used across settings.

## Adding a New Setting

1. Create a new component file (e.g., `MySetting.tsx`)
2. Add the Rust-side setting field and command (see `src-tauri/src/CLAUDE.md`)
3. Add i18n key to `src/i18n/locales/en/translation.json`
4. Import and place the component in the appropriate settings section
