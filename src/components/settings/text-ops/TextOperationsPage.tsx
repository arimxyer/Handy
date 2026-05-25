import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { Alert } from "../../ui/Alert";
import { Dropdown, SettingsGroup, Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSettings } from "../../../hooks/useSettings";

const BUILTIN_PRESET_COUNT = 8;

export const TextOperationsPage: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();

  const allPrompts = getSetting("text_ops_prompts") || [];
  const savedSelectedId = getSetting("text_ops_selected_prompt_id") || null;

  const presets = allPrompts.slice(0, BUILTIN_PRESET_COUNT);
  const customPrompts = allPrompts.slice(BUILTIN_PRESET_COUNT);

  // Run state
  const [selectedPromptId, setSelectedPromptId] = useState<string>(
    savedSelectedId || "",
  );
  const [inputText, setInputText] = useState("");
  const [resultText, setResultText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorText, setErrorText] = useState("");

  // My Prompts CRUD state
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

  const handlePresetClick = (promptId: string) => {
    setSelectedPromptId(promptId);
  };

  const handleRunPromptSelect = (value: string) => {
    setSelectedPromptId(value);
  };

  const handleRun = async () => {
    if (!inputText.trim() || !selectedPromptId || isProcessing) return;
    setIsProcessing(true);
    setErrorText("");
    try {
      const result = await commands.processText(inputText, selectedPromptId);
      if (result.status === "ok") {
        setResultText(result.data);
      } else {
        setErrorText(result.error || t("textOps.error"));
      }
    } catch {
      setErrorText(t("textOps.error"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // My Prompts CRUD handlers
  const handleCustomSelect = (value: string | null) => {
    if (!value) return;
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
        setSelectedPromptId(result.data.id);
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

  const allPromptOptions = allPrompts.map((p) => ({
    value: p.id,
    label: p.name,
  }));

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      {/* Quick Actions */}
      <SettingsGroup title={t("textOps.presets")}>
        <div className="p-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.id}
                variant="secondary"
                size="sm"
                onClick={() => handlePresetClick(preset.id)}
                className={
                  selectedPromptId === preset.id
                    ? "ring-2 ring-logo-primary bg-logo-primary/20"
                    : ""
                }
              >
                {preset.name}
              </Button>
            ))}
          </div>
        </div>
      </SettingsGroup>

      {/* My Prompts */}
      <SettingsGroup title={t("textOps.customPrompts")}>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
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
              className="flex-1"
            />
            <Button
              onClick={handleStartCreate}
              variant="primary"
              size="md"
              disabled={isCreating}
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
                  disabled={!selectedCustomId || customPrompts.length <= 1}
                >
                  {t("textOps.prompts.deletePrompt")}
                </Button>
              </div>
            </div>
          )}

          {!isCreating && !selectedCustomPrompt && (
            <div className="p-3 bg-mid-gray/5 rounded-md border border-mid-gray/20">
              <p className="text-sm text-mid-gray">
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

      {/* Input */}
      <SettingsGroup title={t("textOps.title")}>
        <div className="p-4 space-y-3">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t("textOps.inputPlaceholder")}
            className="w-full min-h-[150px]"
          />

          {/* Run bar */}
          <div className="flex gap-2 items-center">
            <Dropdown
              selectedValue={selectedPromptId || null}
              options={allPromptOptions}
              onSelect={handleRunPromptSelect}
              placeholder={t("textOps.noPrompt")}
              className="flex-1"
            />
            <Button
              variant="primary"
              size="md"
              onClick={handleRun}
              disabled={!inputText.trim() || !selectedPromptId || isProcessing}
            >
              {isProcessing ? t("textOps.processing") : t("textOps.run")}
            </Button>
          </div>

          {errorText && <Alert variant="error">{errorText}</Alert>}
        </div>
      </SettingsGroup>

      {/* Result */}
      {resultText && (
        <SettingsGroup title={t("textOps.result")}>
          <div className="p-4 space-y-3">
            <Textarea
              value={resultText}
              readOnly
              className="w-full min-h-[150px]"
            />
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={handleCopy}>
                {copied ? t("textOps.copied") : t("textOps.copyResult")}
              </Button>
            </div>
          </div>
        </SettingsGroup>
      )}
    </div>
  );
};
