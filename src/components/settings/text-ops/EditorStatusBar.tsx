import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, History, Save, Sparkles } from "lucide-react";
import { useTextOpsProviderState } from "./useTextOpsProviderState";

interface EditorStatusBarProps {
  onAIClick: () => void;
  onVersionsClick: () => void;
  onSave: () => void;
  onCopy: () => void;
  onModelClick: () => void;
  versionsOpen: boolean;
}

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({
  onAIClick,
  onVersionsClick,
  onSave,
  onCopy,
  onModelClick,
  versionsOpen,
}) => {
  const { t } = useTranslation();
  const providerState = useTextOpsProviderState();
  const [showSaved, setShowSaved] = useState(false);
  const [showCopied, setShowCopied] = useState(false);

  const providerLabel =
    providerState.selectedProvider?.label ?? providerState.selectedProviderId;
  const modelLabel = providerState.isAppleProvider
    ? providerLabel
    : providerState.model.trim()
      ? `${providerLabel} / ${providerState.model.trim()}`
      : providerLabel;

  const handleSave = () => {
    onSave();
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 1500);
  };

  const handleCopy = () => {
    onCopy();
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 1500);
  };

  return (
    <div className="flex items-center justify-between w-full px-8 py-2 border-b border-mid-gray/20">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onModelClick}
          className="inline-flex items-center gap-1 rounded-full bg-mid-gray/10 px-2.5 py-0.5 text-[11px] text-text/55 hover:text-text/70 hover:bg-mid-gray/15 transition-colors cursor-pointer"
          title={t("textOps.editor.changeModel")}
        >
          {modelLabel}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-1 rounded-full bg-mid-gray/10 px-2.5 py-1 text-[11px] font-medium text-text/55 hover:text-text/70 transition-colors cursor-pointer"
          title={t("textOps.editor.save")}
        >
          {showSaved ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : (
            <Save className="w-3 h-3" />
          )}
          <span>{showSaved ? t("textOps.editor.saved") : t("textOps.editor.save")}</span>
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-full bg-mid-gray/10 px-2.5 py-1 text-[11px] font-medium text-text/55 hover:text-text/70 transition-colors cursor-pointer"
          title={t("textOps.editor.copy")}
        >
          {showCopied ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
          <span>{showCopied ? t("textOps.editor.copied") : t("textOps.editor.copy")}</span>
        </button>

        <button
          type="button"
          onClick={onVersionsClick}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
            versionsOpen
              ? "bg-background-ui text-white"
              : "bg-mid-gray/10 text-text/55 hover:text-text/70"
          }`}
          title={t("textOps.editor.versions")}
        >
          <History className="w-3 h-3" />
          <span>{t("textOps.editor.versions")}</span>
        </button>

        <button
          type="button"
          onClick={onAIClick}
          className="inline-flex items-center gap-1 rounded-full bg-background-ui px-2.5 py-1 text-[11px] font-medium text-white shadow-sm shadow-background-ui/30 hover:brightness-110 transition-all cursor-pointer"
          title="Ctrl+K"
        >
          <Sparkles className="w-3 h-3" />
          <span>{t("textOps.editor.ai")}</span>
        </button>
      </div>
    </div>
  );
};
