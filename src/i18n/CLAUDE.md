# Internationalization (i18n)

Uses i18next with react-i18next. ESLint enforces no hardcoded strings in JSX.

## Files

- `index.ts` — i18n initialization and configuration
- `languages.ts` — Language metadata (name, native name, RTL flag)
- `locales/` — 17 translation files: ar, cs, de, en (source), es, fr, it, ja, ko, pl, pt, ru, tr, uk, vi, zh, zh-TW

## Adding Text

1. Add key to `locales/en/translation.json` (English is the source language)
2. Use in component: `const { t } = useTranslation(); t('section.key')`
3. Other locales will fall back to English until translated

## Gotchas

- Keys are nested objects (e.g., `settings.insights.history.label`)
- Variables use `{{variable}}` syntax in translation strings
- Only modify `en/translation.json` when adding features — other locales are community-maintained
