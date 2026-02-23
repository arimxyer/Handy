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

## Gotchas

- **PostProcessDrawer layout** — The drawer portal (`#drawer-portal` in App.tsx) and drawer (`PostProcessDrawer.tsx`) use a specific `relative`/`absolute inset-0` + `self-stretch` pattern. Do NOT change `self-stretch` to `h-full`, remove `min-h-0`, or switch away from `absolute inset-0` — all break the layout in subtle ways (clipping, dead space). See commits `264d9da` and `7c9964c` for history.
- **Dropdown in narrow containers** — The shared `Dropdown` component (`../ui/Dropdown.tsx`) needs `min-w-0` and `w-full` to avoid blowing out narrow containers. Its absolute-positioned menu renders inside the scroll container, so it can affect scroll height.
- **Post-process prompt `${output}` placeholder** — All prompts must include `${output}` for legacy (non-structured-output) providers. Structured-output providers strip it via `build_system_prompt()` in `actions.rs`, so it's always safe to include.
