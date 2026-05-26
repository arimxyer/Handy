import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";
import { AboutSettings } from "../settings/about/AboutSettings";
import { getForkVersionLabel } from "@/forkVersion";

const Footer: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("0.1.2");
      }
    };

    fetchVersion();
  }, []);

  useEffect(() => {
    if (!showAbout) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAbout(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showAbout]);

  return (
    <>
      <div className="w-full border-t border-mid-gray/20 pt-3">
        <div className="flex justify-between items-center text-xs px-4 pb-3 text-text/60">
          <div className="flex items-center gap-4">
            <ModelSelector />
            <button
              type="button"
              onClick={() => setShowAbout(true)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-text/70 transition-colors hover:bg-mid-gray/10 hover:text-text cursor-pointer"
              title={t("sidebar.about")}
            >
              <Info className="h-3.5 w-3.5" />
              <span>{t("sidebar.about")}</span>
            </button>
          </div>

          {/* Update Status */}
          <div className="flex items-center gap-1">
            <UpdateChecker />
            <span>•</span>
            <span title={`Handy v${version}`}>{getForkVersionLabel()}</span>
          </div>
        </div>
      </div>

      {showAbout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("settings.about.title")}
          onMouseDown={() => setShowAbout(false)}
        >
          <div
            className="relative max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-mid-gray/20 bg-background p-4 shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowAbout(false)}
              className="absolute end-3 top-3 rounded-md p-1 text-text/50 transition-colors hover:bg-mid-gray/10 hover:text-text cursor-pointer"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
            <AboutSettings />
          </div>
        </div>
      )}
    </>
  );
};

export default Footer;
