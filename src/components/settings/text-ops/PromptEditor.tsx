import React from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus } from "lucide-react";
import { Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";

interface PromptEditorProps {
  mode: "create" | "edit";
  name: string;
  onNameChange: (name: string) => void;
  text: string;
  onTextChange: (text: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  mode,
  name,
  onNameChange,
  text,
  onTextChange,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation();
  const isCreate = mode === "create";
  const Icon = isCreate ? Plus : Pencil;
  const indicatorKey = isCreate
    ? "textOps.prompts.newPrompt"
    : "textOps.prompts.editing";
  const saveLabelKey = isCreate
    ? "textOps.prompts.createPrompt"
    : "textOps.prompts.savePrompt";
  const canSave = name.trim().length > 0 && text.trim().length > 0;

  return (
    <div className="border-l-[3px] border-logo-primary bg-logo-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-background-ui" />
          <span className="text-xs font-medium text-background-ui">
            {t(indicatorKey)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("textOps.prompts.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={!canSave}
          >
            {t(saveLabelKey)}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <label className="block text-[11px] font-semibold text-text/60">
          {t("textOps.prompts.promptLabel")}
        </label>
        <Input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("textOps.prompts.promptLabelPlaceholder")}
          variant="compact"
          autoFocus={isCreate}
          className="w-full"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-[11px] font-semibold text-text/60">
          {t("textOps.prompts.promptInstructions")}
        </label>
        <Textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={t("textOps.prompts.promptInstructionsPlaceholder")}
          className="w-full"
        />
        <p className="text-[10px] text-text/60">
          {t("textOps.prompts.promptTip")}
        </p>
      </div>
    </div>
  );
};
