import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Dropdown, SettingsGroup, Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSettings } from "../../../hooks/useSettings";
import { BUILTIN_PRESET_COUNT } from "./promptUtils";

export const PromptsPage: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();

  const allPrompts = getSetting("text_ops_prompts") || [];
  const customPrompts = allPrompts.slice(BUILTIN_PRESET_COUNT);

  const [isCreating, setIsCreating] = useState(false);
  const [selectedCustomId, setSelectedCustomId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");

  const selectedCustomPrompt =
    customPrompts.find((p) => p.id === selectedCustomId) || null;

  useEffect(() => {
    if (isCreating) return;
    if (selectedCustomPrompt) {
      setDraftName(selectedCustomPrompt.name);
      setDraftText(selectedCustomPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  }, [
    isCreating,
    selectedCustomId,
    selectedCustomPrompt?.name,
    selectedCustomPrompt?.prompt,
  ]);

  const handleCustomSelect = (value: string | null) => {
    if (!value) return;
    const prompt = customPrompts.find((candidate) => candidate.id === value);
    if (!prompt) return;
    setSelectedCustomId(value);
    setIsCreating(false);
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setDraftName("");
    setDraftText("");
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    if (selectedCustomPrompt) {
      setDraftName(selectedCustomPrompt.name);
      setDraftText(selectedCustomPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  };

  const handleCreatePrompt = async () => {
    if (!draftName.trim() || !draftText.trim()) return;
    try {
      const result = await commands.addTextOpsPrompt(
        draftName.trim(),
        draftText.trim(),
      );
      if (result.status === "ok") {
        await refreshSettings();
        setSelectedCustomId(result.data.id);
        setIsCreating(false);
      }
    } catch (error) {
      console.error("Failed to create prompt:", error);
    }
  };

  const handleUpdatePrompt = async () => {
    if (!selectedCustomId || !draftName.trim() || !draftText.trim()) return;
    try {
      await commands.updateTextOpsPrompt(
        selectedCustomId,
        draftName.trim(),
        draftText.trim(),
      );
      await refreshSettings();
    } catch (error) {
      console.error("Failed to update prompt:", error);
    }
  };

  const handleDeletePrompt = async () => {
    if (!selectedCustomId) return;
    try {
      await commands.deleteTextOpsPrompt(selectedCustomId);
      await refreshSettings();
      setSelectedCustomId(null);
      setIsCreating(false);
    } catch (error) {
      console.error("Failed to delete prompt:", error);
    }
  };

  const isDirty =
    !!selectedCustomPrompt &&
    (draftName.trim() !== selectedCustomPrompt.name ||
      draftText.trim() !== selectedCustomPrompt.prompt.trim());

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup
        title={t("textOps.prompts.libraryTitle")}
        description={t("textOps.prompts.libraryDescription")}
      >
        <div className="p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Dropdown
              selectedValue={selectedCustomId}
              options={customPrompts.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
              onSelect={handleCustomSelect}
              placeholder={
                customPrompts.length === 0
                  ? t("textOps.prompts.noPrompts")
                  : t("textOps.prompts.selectPrompt")
              }
              disabled={isCreating}
              className="min-w-0 flex-1"
            />
            <Button
              onClick={handleStartCreate}
              variant="primary"
              size="md"
              disabled={isCreating}
              className="shrink-0"
            >
              {t("textOps.prompts.createNew")}
            </Button>
          </div>

          {!isCreating && customPrompts.length > 0 && selectedCustomPrompt && (
            <div className="space-y-3">
              <div className="space-y-2 flex flex-col">
                <label className="text-sm font-semibold">
                  {t("textOps.prompts.promptLabel")}
                </label>
                <Input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder={t("textOps.prompts.promptLabelPlaceholder")}
                  variant="compact"
                />
              </div>
              <div className="space-y-2 flex flex-col">
                <label className="text-sm font-semibold">
                  {t("textOps.prompts.promptInstructions")}
                </label>
                <Textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder={t(
                    "textOps.prompts.promptInstructionsPlaceholder",
                  )}
                />
                <p className="text-xs text-mid-gray/70">
                  {t("textOps.prompts.promptTip")}
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleUpdatePrompt}
                  variant="primary"
                  size="md"
                  disabled={!draftName.trim() || !draftText.trim() || !isDirty}
                >
                  {t("textOps.prompts.updatePrompt")}
                </Button>
                <Button
                  onClick={handleDeletePrompt}
                  variant="secondary"
                  size="md"
                  disabled={!selectedCustomId}
                >
                  {t("textOps.prompts.deletePrompt")}
                </Button>
              </div>
            </div>
          )}

          {!isCreating && !selectedCustomPrompt && (
            <div className="border-t border-mid-gray/15 pt-3">
              <p className="text-sm text-mid-gray/80">
                {customPrompts.length > 0
                  ? t("textOps.prompts.selectToEdit")
                  : t("textOps.prompts.createFirst")}
              </p>
            </div>
          )}

          {isCreating && (
            <div className="space-y-3">
              <div className="space-y-2 flex flex-col">
                <label className="text-sm font-semibold text-text">
                  {t("textOps.prompts.promptLabel")}
                </label>
                <Input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder={t("textOps.prompts.promptLabelPlaceholder")}
                  variant="compact"
                />
              </div>
              <div className="space-y-2 flex flex-col">
                <label className="text-sm font-semibold">
                  {t("textOps.prompts.promptInstructions")}
                </label>
                <Textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder={t(
                    "textOps.prompts.promptInstructionsPlaceholder",
                  )}
                />
                <p className="text-xs text-mid-gray/70">
                  {t("textOps.prompts.promptTip")}
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleCreatePrompt}
                  variant="primary"
                  size="md"
                  disabled={!draftName.trim() || !draftText.trim()}
                >
                  {t("textOps.prompts.createPrompt")}
                </Button>
                <Button
                  onClick={handleCancelCreate}
                  variant="secondary"
                  size="md"
                >
                  {t("textOps.prompts.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
};
