# Internationalization (i18n)

Uses i18next with react-i18next. ESLint enforces no hardcoded strings in JSX.

## Files

- `index.ts` — i18n initialization and configuration
- `languages.ts` — Language metadata (name, native name, RTL flag)
- `locales/` — 20 translation files: ar, bg, cs, de, en (source), es, fr, he, it, ja, ko, pl, pt, ru, sv, tr, uk, vi, zh, zh-TW

## Adding Text

1. Add key to `locales/en/translation.json` (English is the source language)
2. Use in component: `const { t } = useTranslation(); t('section.key')`
3. Add the same key to other locale files with an English fallback if needed so `bun run check:translations` stays green

## Gotchas

- Keys are nested objects (e.g., `settings.insights.history.label`)
- Variables use `{{variable}}` syntax in translation strings
- Preserve existing non-English translations. For new feature keys, use English fallback values in other locales unless a real translation is available.
