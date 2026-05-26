---
version: alpha
name: Handy
description: Warm, approachable desktop speech-to-text app with a signature pink accent
colors:
  text: "#0f0f0f"
  background: "#fbfbfb"
  background-ui: "#da5893"
  logo-primary: "#faa2ca"
  logo-stroke: "#382731"
  text-stroke: "#f6f6f6"
  mid-gray: "#808080"
typography:
  body-md:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: 24px
  body-sm:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
  label-md:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  label-sm:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
  label-xs:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.02em
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.3
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
components:
  button-primary:
    color: "#ffffff"
    backgroundColor: "{colors.background-ui}"
    borderColor: "{colors.background-ui}"
    rounded: "{rounded.lg}"
  button-ghost:
    backgroundColor: transparent
    borderColor: transparent
    rounded: "{rounded.lg}"
  badge-primary:
    backgroundColor: "{colors.logo-primary}"
    rounded: "{rounded.full}"
  overlay:
    backgroundColor: "#000000cc"
---

# Handy Design System

## Overview

Handy is a desktop speech-to-text utility that sits in the system tray and activates via keyboard shortcut. The design is warm, compact, and unobtrusive — a tool that stays out of the way until called, then gives clear feedback during recording and transcription. The signature identity comes from a soft pink accent (Handy Pink) against neutral light or dark surfaces, giving the app a friendly, approachable character without feeling playful or childish.

The primary UI surface is a settings panel with a narrow sidebar. Information density is moderate — settings are organized into bordered groups with horizontal label-control rows. Typography is small (14–15px body, 11–12px labels) because the window is compact. The overall aesthetic is clean, utilitarian macOS/Linux system-app style with just enough color personality to be recognizable.

## Colors

The palette is intentionally restrained: neutral surfaces with a single pink accent family.

- **Text (`#0f0f0f`):** Near-black body text in light mode. Frequently used at reduced opacity (`text/60`, `text/80`) for secondary and tertiary content.
- **Background (`#fbfbfb`):** Near-white surface for the main window and settings containers.
- **Background UI / Handy Pink (`#da5893`):** The saturated pink used for primary action surfaces — buttons, active toggle tracks, active sidebar items, and slider fills. This is the app's strongest brand signal.
- **Logo Primary / Soft Pink (`#faa2ca`):** A lighter, softer pink used for hover tints (`logo-primary/10`, `logo-primary/20`), focus rings, selected states, and the Handy logo fill. The badge primary variant also uses this color at full opacity.
- **Logo Stroke (`#382731`):** Dark warm brown used for the Handy logo stroke and outlines.
- **Text Stroke (`#f6f6f6`):** Light stroke color for text outlines in branding contexts.
- **Mid Gray (`#808080`):** The workhorse neutral. Used extensively at low opacities for borders (`mid-gray/20`), subtle backgrounds (`mid-gray/10`), input borders (`mid-gray/80`), section headers, and disabled/secondary text.

### Dark mode

Dark mode activates via `prefers-color-scheme: dark` and inverts the core surface tokens:

| Token | Light | Dark |
|-------|-------|------|
| text | `#0f0f0f` | `#fbfbfb` |
| background | `#fbfbfb` | `#2c2b29` |
| logo-primary | `#faa2ca` | `#f28cbb` |
| logo-stroke | `#382731` | `#fad1ed` |

The accent colors (`background-ui`, `mid-gray`) remain unchanged across themes. The dark background is a warm charcoal (`#2c2b29`), not a cold black, matching the overall friendly tone.

## Typography

Handy uses the platform system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) throughout. No custom web fonts are loaded. This keeps the app feeling native on macOS, Windows, and Linux.

- **Body (15px / 400):** The root font size. Used for main content areas and longer text blocks. Line height is 24px for comfortable reading.
- **Body Small / `text-sm` (14px / 400):** The dominant size in the settings UI. Setting labels, descriptions, dropdown text, and most interactive elements use this size.
- **Label Medium (14px / 500):** Semi-bold variant of body-sm used for setting titles, nav items, and interactive labels where weight differentiation matters.
- **Label Small / `text-xs` (12px / 500):** Section group headers, footer text, and secondary metadata. Often paired with `uppercase tracking-wide` for section titles.
- **Label XS (11px / 600):** The smallest intentional text size, used for compact UI elements like picker headers and tight captions. Semi-bold to maintain legibility at small size.
- **Caption (10px / 400):** Sparingly used for ultra-compact metadata.

Font weights stay within 400–600. There are no bold (700+) headlines — the app's compact window doesn't call for large display text.

## Layout

The app uses a sidebar + content-area layout. The sidebar is fixed at `w-40` (160px) with a border separator. Content areas are centered with `max-w-3xl` and use `space-y-6` between top-level sections.

Spacing follows the Tailwind default scale, with these values appearing most:

| Use | Value | Tailwind |
|-----|-------|----------|
| Tight inline gaps | 4px | `gap-1` |
| Standard inline gaps | 8px | `gap-2` |
| Component padding | 8px | `p-2` / `px-2 py-1` |
| Section padding | 16px | `p-4` / `px-4` |
| Group stacking | 8–12px | `space-y-2` / `space-y-3` |
| Section stacking | 24px | `space-y-6` |

Settings rows use `flex items-center justify-between` for horizontal label/control layout. Stacked layouts place the control below the label with a `mb-2` gap.

The recording overlay is a fixed-size pill (172 x 36px) with a 3-column grid layout.

## Elevation & Depth

The design is predominantly flat. Depth is conveyed through **borders** and **tonal layering** rather than shadows.

- **Borders:** The primary depth cue. Settings groups, inputs, and dropdowns use `border border-mid-gray/20` (light mode) or `border-mid-gray/80` (inputs needing more definition). Dividers between grouped items use `divide-y divide-mid-gray/20`.
- **Shadows:** Used sparingly — `shadow-lg` on dropdown menus and `shadow-xl` on modal dialogs. No ambient shadows on cards or containers.
- **Modal overlay:** `bg-black/50` backdrop for the about dialog.
- **Recording overlay:** Uses `background: #000000cc` (80% black) for a semi-transparent dark pill that floats above all content.
- **Picker/Prompt window:** Uses `backdrop-filter: blur(20px)` with a dark semi-transparent background (`#1a1a1acc`) for a glassmorphism effect. This is the one place the app uses blur-based depth.

## Shapes

Corner radii are soft but not exaggerated. The shape language matches the friendly-but-professional tone.

- **`rounded-md` (6px):** Inputs, dropdowns, and small interactive elements.
- **`rounded-lg` (8px):** The workhorse radius. Buttons, settings groups, sidebar nav items, cards, and containers.
- **`rounded-xl` (12px):** Larger containers like the picker window and about dialog.
- **`rounded-full` (9999px):** Circular elements — toggle switch tracks and knobs, badges, the recording overlay pill, and avatar/icon circles.

Buttons consistently use `rounded-lg`. There are no sharp-cornered (0px radius) interactive elements.

## Components

### Buttons

Six variants, all sharing `font-medium rounded-lg border transition-colors`:

- **Primary:** White text on Handy Pink (`bg-background-ui`). The strongest call-to-action.
- **Primary Soft:** Default text on a light pink tint (`bg-logo-primary/20`). A gentler alternative.
- **Secondary:** Neutral background (`bg-mid-gray/10`) with subtle border. Hover reveals pink border (`hover:border-logo-primary`).
- **Ghost:** Transparent with no border. Hover shows a faint gray background.
- **Danger / Danger Ghost:** Red variants for destructive actions.

Three sizes: `sm` (px-2 py-1, text-xs), `md` (px-4 py-[5px], text-sm), `lg` (px-4 py-2, text-base).

### Settings Group

A bordered container (`border border-mid-gray/20 rounded-lg`) with internal dividers (`divide-y divide-mid-gray/20`) between child rows. Section titles sit above in `text-xs font-medium text-mid-gray uppercase tracking-wide`.

### Toggle Switch

A pill-shaped track (`w-11 h-6 rounded-full`) that transitions between `bg-mid-gray/20` (off) and `bg-background-ui` (on/Handy Pink). The knob is a white circle (`h-5 w-5 rounded-full bg-white`) that slides horizontally. Focus ring uses `ring-logo-primary`.

### Inputs & Dropdowns

Inputs use `bg-mid-gray/10 border border-mid-gray/80 rounded-md` at rest. Hover shifts to `bg-logo-primary/10 border-logo-primary`. Focus adds `bg-logo-primary/20 border-logo-primary`. Text is `text-sm font-semibold`.

Dropdown menus float below with `bg-background border border-mid-gray/80 rounded-md shadow-lg`. Selected items show `bg-logo-primary/20 font-semibold`; hover items show `bg-logo-primary/10`.

### Sidebar

Fixed-width (`w-40`) column with a mode toggle (voice/text) at the top and a stacked nav list below. Active items use `bg-logo-primary/80` with `rounded-lg`. Inactive items show `opacity-85` and reveal `bg-mid-gray/20` on hover. Icons are 24x24 from Lucide.

### Badges

Pill-shaped (`rounded-full`). Primary variant uses `bg-logo-primary`. Success uses `bg-green-500/20 text-green-400`. Secondary uses `bg-mid-gray/20 text-text/70`.

### Alerts

Four semantic variants (error, warning, info, success) using Tailwind color families at 10% opacity for backgrounds and 400/500 levels for text/icons. All use `rounded-lg` with `gap-3 p-4` and a leading icon.

### Recording Overlay

A dark floating pill (`#000000cc`, `border-radius: 18px`, 172x36px) with a 3-column grid: audio bars on the left, status text in the center, cancel button on the right. Audio bars are soft pink (`#ffe5ee`) rectangles that animate height. The transcribing state pulses text opacity.

## Do's and Don'ts

- Do use `mid-gray` at low opacity (10–20%) for backgrounds and borders to maintain subtlety.
- Don't use `mid-gray` at full opacity for backgrounds — it's too heavy. Full opacity is for text and input borders only.
- Do keep the pink accent family (`background-ui`, `logo-primary`) for interactive states and brand elements. The pink is what makes Handy feel like Handy.
- Don't introduce additional accent colors (blue, purple, orange) outside of semantic alerts. The single-accent palette is intentional.
- Do use opacity variants of `text` color (`text/50`, `text/60`, `text/80`) to create typographic hierarchy rather than introducing new gray shades.
- Don't use shadows on flat containers — prefer borders for separation. Shadows are reserved for floating elements (dropdowns, modals).
- Do maintain the compact density (text-sm default, tight padding) — Handy is a utility, not a content app.
- Don't add large headlines or hero sections. The window is small and every pixel matters.
