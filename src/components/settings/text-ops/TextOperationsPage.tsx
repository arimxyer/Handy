import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Play, Save, X } from "lucide-react";
import { commands, type LLMPrompt } from "@/bindings";
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
  const [loadedPrompt, setLoadedPrompt] = useState<LLMPrompt | null>(null);
  const [hasInitializedPrompt, setHasInitializedPrompt] = useState(false);
  const [inputText, setInputText] = useState("");
  const [instructionsText, setInstructionsText] = useState("");
  const [resultText, setResultText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // My Prompts CRUD state
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCustomId, setSelectedCustomId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");

  const selectedCustomPrompt =
    customPrompts.find((p) => p.id === selectedCustomId) || null;

  const initialPrompt = useMemo(() => {
    if (allPrompts.length === 0) return null;
    return (
      allPrompts.find((prompt) => prompt.id === savedSelectedId) ??
      presets[0] ??
      null
    );
  }, [allPrompts, presets, savedSelectedId]);

  useEffect(() => {
    if (hasInitializedPrompt || !initialPrompt) return;
    setLoadedPrompt(initialPrompt);
    setInstructionsText(initialPrompt.prompt);
    setHasInitializedPrompt(true);
  }, [hasInitializedPrompt, initialPrompt]);

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

  useEffect(() => {
    if (!showSavePrompt) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSavePrompt(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSavePrompt]);

  const loadPrompt = (prompt: LLMPrompt) => {
    setLoadedPrompt(prompt);
    setInstructionsText(prompt.prompt);
    setErrorText("");
  };

  const handleRun = async () => {
    if (!inputText.trim() || !instructionsText.trim() || isProcessing) return;
    setIsProcessing(true);
    setErrorText("");
    try {
      const promptName =
        loadedPrompt && loadedPrompt.prompt.trim() === instructionsText.trim()
          ? loadedPrompt.name
          : null;
      const result = await commands.processTextWithPrompt(
        inputText,
        instructionsText,
        promptName,
      );
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

  const handleInstructionsChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const nextValue = event.target.value;
    setInstructionsText(nextValue);
    if (loadedPrompt && loadedPrompt.prompt.trim() !== nextValue.trim()) {
      setLoadedPrompt(null);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(resultText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenSavePrompt = () => {
    const baseName =
      loadedPrompt && loadedPrompt.prompt.trim() === instructionsText.trim()
        ? loadedPrompt.name
        : "";
    setSaveName(baseName);
    setShowSavePrompt(true);
  };

  const handleSavePrompt = async () => {
    if (!saveName.trim() || !instructionsText.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const result = await commands.addTextOpsPrompt(
        saveName.trim(),
        instructionsText.trim(),
      );
      if (result.status === "ok") {
        await refreshSettings();
        setLoadedPrompt(result.data);
        setSelectedCustomId(result.data.id);
        setIsCreating(false);
        setShowSavePrompt(false);
      }
    } catch (error) {
      console.error("Failed to save prompt:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // My Prompts CRUD handlers
  const handleCustomSelect = (value: string | null) => {
    if (!value) return;
    const prompt = customPrompts.find((candidate) => candidate.id === value);
    if (!prompt) return;
    setSelectedCustomId(value);
    loadPrompt(prompt);
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
        loadPrompt(result.data);
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
      if (loadedPrompt?.id === selectedCustomId) {
        setLoadedPrompt({
          id: selectedCustomId,
          name: draftName.trim(),
          prompt: draftText.trim(),
        });
        setInstructionsText(draftText.trim());
      }
    } catch (error) {
      console.error("Failed to update prompt:", error);
    }
  };

  const handleDeletePrompt = async () => {
    if (!selectedCustomId) return;
    try {
      await commands.deleteTextOpsPrompt(selectedCustomId);
      await refreshSettings();
      if (loadedPrompt?.id === selectedCustomId) {
        setLoadedPrompt(null);
      }
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
      {/* Quick Actions */}
      <SettingsGroup title={t("textOps.presets")}>
        <div className="p-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.id}
                variant="secondary"
                size="sm"
                onClick={() => loadPrompt(preset)}
                className={
                  loadedPrompt?.id === preset.id
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

      {/* Input */}
      <SettingsGroup title={t("textOps.title")}>
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold">
              {t("textOps.inputLabel")}
            </label>
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={t("textOps.inputPlaceholder")}
              className="w-full min-h-[150px]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-semibold">
                {t("textOps.instructionsLabel")}
              </label>
              {loadedPrompt && (
                <span
                  className="min-w-0 truncate text-xs text-mid-gray/70"
                  title={loadedPrompt.name}
                >
                  {t("textOps.loadedPrompt", { name: loadedPrompt.name })}
                </span>
              )}
            </div>
            <Textarea
              value={instructionsText}
              onChange={handleInstructionsChange}
              placeholder={t("textOps.instructionsPlaceholder")}
              className="w-full min-h-[120px]"
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={handleOpenSavePrompt}
              disabled={!instructionsText.trim() || isProcessing}
              className="inline-flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {t("textOps.saveInstructions")}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleRun}
              disabled={
                !inputText.trim() || !instructionsText.trim() || isProcessing
              }
              className="inline-flex items-center gap-2"
            >
              <Play className="h-4 w-4" />
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
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopy}
                className="inline-flex items-center gap-2"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? t("textOps.copied") : t("textOps.copyResult")}
              </Button>
            </div>
          </div>
        </SettingsGroup>
      )}

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

      {showSavePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("textOps.saveDialog.title")}
          onMouseDown={() => setShowSavePrompt(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-mid-gray/20 bg-background p-4 shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {t("textOps.saveDialog.title")}
              </h2>
              <button
                type="button"
                onClick={() => setShowSavePrompt(false)}
                className="rounded-md p-1 text-text/50 transition-colors hover:bg-mid-gray/10 hover:text-text cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div className="space-y-2 flex flex-col">
                <label className="text-sm font-semibold">
                  {t("textOps.prompts.promptLabel")}
                </label>
                <Input
                  type="text"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder={t("textOps.prompts.promptLabelPlaceholder")}
                  variant="compact"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => setShowSavePrompt(false)}
                >
                  {t("textOps.prompts.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleSavePrompt}
                  disabled={
                    !saveName.trim() || !instructionsText.trim() || isSaving
                  }
                  className="inline-flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {isSaving
                    ? t("textOps.saveDialog.saving")
                    : t("textOps.saveDialog.save")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
