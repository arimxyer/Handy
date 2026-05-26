import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Pencil, Play, RefreshCcw, Save, X } from "lucide-react";
import { commands, type LLMPrompt } from "@/bindings";
import { Alert } from "../../ui/Alert";
import {
  Dropdown,
  SettingContainer,
  SettingsGroup,
  Textarea,
} from "@/components/ui";
import type { DropdownItem } from "@/components/ui/Dropdown";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSettings } from "../../../hooks/useSettings";
import { ResetButton } from "../../ui/ResetButton";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import { useTextOpsProviderState } from "./useTextOpsProviderState";
import { usePromptEditDrawer } from "../../../hooks/usePromptEditDrawer";
import { PromptEditDrawer } from "./PromptEditDrawer";
import { BUILTIN_PRESET_COUNT, isBuiltInPrompt } from "./promptUtils";

export const TextOperationsPage: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const providerState = useTextOpsProviderState();
  const drawer = usePromptEditDrawer();

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
  const [lastRunModelLabel, setLastRunModelLabel] = useState<string | null>(
    null,
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const unifiedPromptOptions: DropdownItem[] = useMemo(() => {
    const builtInOptions = presets.map((p) => ({
      value: p.id,
      label: p.name,
    }));
    if (customPrompts.length === 0) return builtInOptions;
    return [
      { kind: "header" as const, label: t("textOps.prompts.builtInGroup") },
      ...builtInOptions,
      { kind: "separator" as const },
      { kind: "header" as const, label: t("textOps.prompts.customGroup") },
      ...customPrompts.map((p) => ({ value: p.id, label: p.name })),
    ];
  }, [presets, customPrompts, t]);

  const providerLabel =
    providerState.selectedProvider?.label ?? providerState.selectedProviderId;
  const currentModelLabel = providerState.isAppleProvider
    ? providerLabel
    : providerState.model.trim()
      ? `${providerLabel} / ${providerState.model.trim()}`
      : providerLabel;
  const selectedPromptId = loadedPrompt ? loadedPrompt.id : null;

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

  // Clear loaded prompt if it was deleted from PromptsPage
  useEffect(() => {
    if (!loadedPrompt) return;
    const stillExists = allPrompts.some((p) => p.id === loadedPrompt.id);
    if (!stillExists) {
      setLoadedPrompt(null);
      setInstructionsText("");
    }
  }, [allPrompts, loadedPrompt]);

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

  const handlePromptSelect = (value: string) => {
    const prompt = allPrompts.find((candidate) => candidate.id === value);
    if (prompt) {
      loadPrompt(prompt);
      void commands.setTextOpsSelectedPrompt(prompt.id);
      drawer.close();
    }
  };

  const handleRun = async () => {
    if (!inputText.trim() || !instructionsText.trim() || isProcessing) return;
    const runModelLabel = currentModelLabel;
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
        setLastRunModelLabel(runModelLabel);
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
        setShowSavePrompt(false);
      }
    } catch (error) {
      console.error("Failed to save prompt:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDrawerSave = async () => {
    if (!drawer.editingPromptId || !drawer.editName.trim() || !drawer.editPromptText.trim())
      return;
    try {
      await commands.updateTextOpsPrompt(
        drawer.editingPromptId,
        drawer.editName.trim(),
        drawer.editPromptText.trim(),
      );
      await refreshSettings();
      if (loadedPrompt?.id === drawer.editingPromptId) {
        setLoadedPrompt({
          id: drawer.editingPromptId,
          name: drawer.editName.trim(),
          prompt: drawer.editPromptText.trim(),
        });
        setInstructionsText(drawer.editPromptText.trim());
      }
      drawer.close();
    } catch (error) {
      console.error("Failed to update prompt:", error);
    }
  };

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("textOps.settings.provider")}>
        <SettingContainer
          title={t("settings.postProcessing.api.provider.title")}
          description={t("settings.postProcessing.api.provider.description")}
          descriptionMode="tooltip"
          layout="horizontal"
          grouped={true}
        >
          <div className="flex min-w-0 items-center gap-2">
            <ProviderSelect
              options={providerState.providerOptions}
              value={providerState.selectedProviderId}
              onChange={providerState.handleProviderSelect}
            />
          </div>
        </SettingContainer>

        {providerState.appleIntelligenceUnavailable && (
          <Alert variant="error" contained>
            {t("settings.postProcessing.api.appleIntelligence.unavailable")}
          </Alert>
        )}

        {!providerState.isAppleProvider && (
          <SettingContainer
            title={t("settings.postProcessing.api.model.title")}
            description={
              providerState.isCustomProvider
                ? t("settings.postProcessing.api.model.descriptionCustom")
                : t("settings.postProcessing.api.model.descriptionDefault")
            }
            descriptionMode="tooltip"
            layout="stacked"
            grouped={true}
          >
            <div className="flex min-w-0 items-center gap-2">
              <ModelSelect
                value={providerState.model}
                options={providerState.modelOptions}
                disabled={providerState.isModelUpdating}
                isLoading={providerState.isFetchingModels}
                placeholder={
                  providerState.modelOptions.length > 0
                    ? t(
                        "settings.postProcessing.api.model.placeholderWithOptions",
                      )
                    : t(
                        "settings.postProcessing.api.model.placeholderNoOptions",
                      )
                }
                onSelect={providerState.handleModelSelect}
                onCreate={providerState.handleModelCreate}
                onBlur={() => {}}
                className="min-w-0 flex-1"
              />
              <ResetButton
                onClick={providerState.handleRefreshModels}
                disabled={providerState.isFetchingModels}
                ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
                className="flex h-10 w-10 shrink-0 items-center justify-center"
              >
                <RefreshCcw
                  className={`h-4 w-4 ${providerState.isFetchingModels ? "animate-spin" : ""}`}
                />
              </ResetButton>
            </div>
          </SettingContainer>
        )}
      </SettingsGroup>

      {/* Editor */}
      <SettingsGroup title={t("textOps.title")}>
        <div className="p-4 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold">
              {t("textOps.inputLabel")}
            </label>
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={t("textOps.inputPlaceholder")}
              className="w-full min-h-[220px] leading-relaxed"
            />
          </div>

          <div className="space-y-2 rounded-md border border-mid-gray/20 bg-mid-gray/5 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 space-y-1">
                <label className="text-sm font-semibold">
                  {t("textOps.instructionsLabel")}
                </label>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {loadedPrompt && (
                    <span
                      className="max-w-full truncate rounded-full bg-logo-primary/10 px-2 py-0.5 text-[11px] font-medium text-logo-primary"
                      title={loadedPrompt.name}
                    >
                      {t("textOps.loadedPrompt", { name: loadedPrompt.name })}
                    </span>
                  )}
                  <span
                    className="max-w-full truncate rounded-full bg-mid-gray/10 px-2 py-0.5 text-[11px] text-text/55"
                    title={currentModelLabel}
                  >
                    {currentModelLabel}
                  </span>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="w-full min-w-0 sm:w-64">
                  <Dropdown
                    selectedValue={selectedPromptId}
                    options={unifiedPromptOptions}
                    onSelect={handlePromptSelect}
                    placeholder={t("textOps.presets")}
                    className="w-full"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (loadedPrompt) drawer.loadPromptForEdit(loadedPrompt);
                  }}
                  disabled={
                    !loadedPrompt ||
                    isBuiltInPrompt(loadedPrompt.id, allPrompts)
                  }
                  className="p-1.5 rounded-md text-text/50 transition-colors hover:bg-mid-gray/10 hover:text-text disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shrink-0"
                  title={
                    loadedPrompt &&
                    isBuiltInPrompt(loadedPrompt.id, allPrompts)
                      ? t("textOps.drawer.builtInReadOnly")
                      : t("textOps.drawer.editTooltip")
                  }
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            </div>
            <Textarea
              value={instructionsText}
              onChange={handleInstructionsChange}
              placeholder={t("textOps.instructionsPlaceholder")}
              className="w-full min-h-[120px] bg-background"
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-mid-gray/15 pt-4">
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
            {lastRunModelLabel && (
              <div
                className="inline-flex max-w-full rounded-md border border-mid-gray/20 bg-mid-gray/5 px-2 py-1 text-xs text-mid-gray"
                title={lastRunModelLabel}
              >
                <span className="truncate">{lastRunModelLabel}</span>
              </div>
            )}
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

      <PromptEditDrawer
        isOpen={drawer.isOpen}
        close={drawer.close}
        editName={drawer.editName}
        setEditName={drawer.setEditName}
        editPromptText={drawer.editPromptText}
        setEditPromptText={drawer.setEditPromptText}
        isDirty={drawer.isDirty}
        editingPromptId={drawer.editingPromptId}
        onSave={handleDrawerSave}
      />
    </div>
  );
};
