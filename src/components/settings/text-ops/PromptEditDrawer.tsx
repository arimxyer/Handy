import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Pencil, X } from "lucide-react";
import { Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";

interface PromptEditDrawerProps {
  isOpen: boolean;
  close: () => void;
  editName: string;
  setEditName: (name: string) => void;
  editPromptText: string;
  setEditPromptText: (text: string) => void;
  isDirty: boolean;
  editingPromptId: string | null;
  onSave: () => Promise<void>;
}

export const PromptEditDrawer: React.FC<PromptEditDrawerProps> = ({
  isOpen,
  close,
  editName,
  setEditName,
  editPromptText,
  setEditPromptText,
  isDirty,
  editingPromptId,
  onSave,
}) => {
  const { t } = useTranslation();
  const drawerRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const drawer = drawerRef.current;
    const portal = document.getElementById("drawer-portal");

    const preventScroll = (e: Event) => {
      (e.currentTarget as HTMLElement).scrollTop = 0;
    };

    drawer?.addEventListener("scroll", preventScroll);
    portal?.addEventListener("scroll", preventScroll);

    return () => {
      drawer?.removeEventListener("scroll", preventScroll);
      portal?.removeEventListener("scroll", preventScroll);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const body = bodyScrollRef.current;
    if (!body) return;
    body.scrollTop = 0;
    requestAnimationFrame(() => {
      if (bodyScrollRef.current) {
        bodyScrollRef.current.scrollTop = 0;
      }
    });
  }, [isOpen]);

  const portalContainer = document.getElementById("drawer-portal");
  if (!isOpen || !portalContainer || !editingPromptId) return null;

  return createPortal(
    <div
      ref={drawerRef}
      className="absolute inset-0 min-h-0 border-l border-mid-gray/20 bg-background flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-mid-gray/20">
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-logo-primary" />
          <h3 className="text-sm font-semibold">
            {t("textOps.drawer.title")}
          </h3>
        </div>
        <button
          type="button"
          onClick={close}
          className="p-1 rounded text-text/50 hover:text-text transition-colors cursor-pointer"
          aria-label={t("common.close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        ref={bodyScrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4"
        style={{ overflowAnchor: "none" }}
      >
        <div className="space-y-2 flex flex-col">
          <label className="text-sm font-semibold">
            {t("textOps.prompts.promptLabel")}
          </label>
          <Input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder={t("textOps.prompts.promptLabelPlaceholder")}
            variant="compact"
          />
        </div>
        <div className="space-y-2 flex flex-col">
          <label className="text-sm font-semibold">
            {t("textOps.prompts.promptInstructions")}
          </label>
          <Textarea
            value={editPromptText}
            onChange={(e) => setEditPromptText(e.target.value)}
            placeholder={t("textOps.prompts.promptInstructionsPlaceholder")}
          />
          <p className="text-xs text-mid-gray/70">
            {t("textOps.prompts.promptTip")}
          </p>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-mid-gray/20 flex justify-end gap-2">
        <Button variant="secondary" size="md" onClick={close}>
          {t("textOps.prompts.cancel")}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={onSave}
          disabled={
            !isDirty || !editName.trim() || !editPromptText.trim()
          }
        >
          {t("textOps.prompts.updatePrompt")}
        </Button>
      </div>
    </div>,
    portalContainer,
  );
};
