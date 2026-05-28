import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, Undo2 } from "lucide-react";
import { diffWords } from "diff";
import type { DiffMode } from "./DiffView";

interface AcceptRevertBarProps {
  originalText: string;
  modifiedText: string;
  onAccept: () => void;
  onRevert: () => void;
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  title?: string;
  acceptLabel?: string;
  revertLabel?: string;
}

export const AcceptRevertBar: React.FC<AcceptRevertBarProps> = ({
  originalText,
  modifiedText,
  onAccept,
  onRevert,
  mode,
  onModeChange,
  title,
  acceptLabel,
  revertLabel,
}) => {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const parts = diffWords(originalText, modifiedText);
    let added = 0;
    let removed = 0;
    for (const part of parts) {
      const wordCount = part.value.trim().split(/\s+/).filter(Boolean).length;
      if (part.added) added += wordCount;
      if (part.removed) removed += wordCount;
    }
    return { added, removed };
  }, [originalText, modifiedText]);

  return (
    <div className="flex items-center justify-between px-8 py-2 bg-logo-primary/5 border-b border-logo-primary/15">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-text/60">
          {title ?? t("textOps.editor.reviewChanges")}
        </span>
        <span className="text-xs">
          {stats.added > 0 && (
            <span className="text-green-600 dark:text-green-400 font-medium">
              +{stats.added}
            </span>
          )}
          {stats.added > 0 && stats.removed > 0 && (
            <span className="text-text/30 mx-1">/</span>
          )}
          {stats.removed > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              -{stats.removed}
            </span>
          )}
          {(stats.added > 0 || stats.removed > 0) && (
            <span className="text-text/40 ml-1">
              {t("textOps.editor.words")}
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-md border border-mid-gray/30 overflow-hidden">
          <button
            type="button"
            onClick={() => onModeChange("unified")}
            className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
              mode === "unified"
                ? "bg-mid-gray/15 text-text"
                : "text-text/55 hover:text-text/70"
            }`}
          >
            {t("textOps.editor.diffUnified")}
          </button>
          <button
            type="button"
            onClick={() => onModeChange("split")}
            className={`px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
              mode === "split"
                ? "bg-mid-gray/15 text-text"
                : "text-text/55 hover:text-text/70"
            }`}
          >
            {t("textOps.editor.diffSplit")}
          </button>
        </div>
        <button
          type="button"
          onClick={onRevert}
          className="inline-flex items-center gap-1 rounded-full bg-mid-gray/10 px-2.5 py-1 text-[11px] font-medium text-text/55 hover:text-text/70 transition-colors cursor-pointer"
        >
          <Undo2 className="w-3 h-3" />
          <span>{revertLabel ?? t("textOps.editor.revert")}</span>
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex items-center gap-1 rounded-full bg-background-ui px-2.5 py-1 text-[11px] font-medium text-white shadow-sm shadow-background-ui/30 hover:brightness-110 transition-all cursor-pointer"
        >
          <Check className="w-3 h-3" />
          <span>{acceptLabel ?? t("textOps.editor.accept")}</span>
        </button>
      </div>
    </div>
  );
};
