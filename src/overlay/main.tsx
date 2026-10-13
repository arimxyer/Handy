import React from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import RecordingOverlay from "./RecordingOverlay";
import {
  applyTheme,
  getStoredTheme,
  syncThemeFromSettings,
} from "@/lib/utils/theme";
import type { Theme } from "@/bindings";
import "@/i18n";

// A separate webview from the settings window, so the overlay has to set
// `data-theme` on its own document: last-known theme before render (shared
// localStorage) to avoid a flash, reconcile with the persisted setting in case
// the overlay booted first, then follow live changes.
applyTheme(getStoredTheme());
syncThemeFromSettings();
listen<Theme>("theme-changed", (event) => applyTheme(event.payload));

// Development control: fill web content while retaining native transparency.
if (
  import.meta.env.DEV &&
  import.meta.env.VITE_HANDY_DEBUG_OPAQUE_DOCUMENT === "1"
) {
  document.documentElement.style.backgroundColor = "#202020";
  document.body.style.backgroundColor = "#202020";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RecordingOverlay />
  </React.StrictMode>,
);
