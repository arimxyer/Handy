import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Info, Plus, RefreshCcw, Sparkles, X } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { Dropdown } from "@/components/ui/Dropdown";
import { Textarea } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { ResetButton } from "@/components/ui/ResetButton";
import { Input } from "@/components/ui/Input";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import type { LLMPrompt } from "@/bindings";
import type {
  CompareModel,
  DrawerOverrides,
} from "@/hooks/usePostProcessDrawer";
import type { ModelOption } from "../PostProcessingSettingsApi/types";

interface PostProcessDrawerProps {
  isOpen: boolean;
  close: () => void;
  overrides: DrawerOverrides;
  setOverride: <K extends keyof DrawerOverrides>(
    key: K,
    value: DrawerOverrides[K],
  ) => void;
  effectiveProviderId: string;
  effectiveModelId: string;
  effectivePromptId: string;
  effectivePromptText: string;
  prompts: LLMPrompt[];
  compareEnabled: boolean;
  setCompareEnabled: (enabled: boolean) => void;
  compareModels: CompareModel[];
  setCompareModels: React.Dispatch<React.SetStateAction<CompareModel[]>>;
}

export const PostProcessDrawer: React.FC<PostProcessDrawerProps> = ({
  isOpen,
  close,
  overrides,
  setOverride,
  effectiveProviderId,
  effectiveModelId,
  effectivePromptId,
  effectivePromptText,
  prompts,
  compareEnabled,
  setCompareEnabled,
  compareModels,
  setCompareModels,
}) => {
  const { t } = useTranslation();
  const {
    getSetting,
    updateSetting,
    postProcessModelOptions,
    fetchPostProcessModels,
    isUpdating,
  } = useSettings();
  const providerState = usePostProcessProviderState();

  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newModel, setNewModel] = useState("");
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const preserveBodyScroll = useCallback((update: () => void) => {
    const previousScrollTop = bodyScrollRef.current?.scrollTop ?? 0;
    update();
    requestAnimationFrame(() => {
      const body = bodyScrollRef.current;
      if (!body) return;
      body.scrollTop = previousScrollTop;
    });
  }, []);

  // WebKitGTK may scroll overflow:hidden containers when focus-scroll-into-view
  // triggers on child elements (e.g. toggling Compare Models checkbox). This
  // pushes the header off-screen. Prevent by resetting scrollTop on both the
  // drawer container and the portal.
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

  // Pre-populate API key when newProvider changes
  useEffect(() => {
    if (!newProvider) return;
    const keys = getSetting("post_process_api_keys") ?? {};
    setNewApiKey(keys[newProvider] ?? "");
    setNewModel("");
  }, [newProvider, getSetting]);

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

  // Determine the effective provider for the drawer
  const drawerProviderId =
    overrides.providerId ?? providerState.selectedProviderId;
  const drawerProvider = useMemo(
    () =>
      (getSetting("post_process_providers") ?? []).find(
        (p) => p.id === drawerProviderId,
      ),
    [getSetting, drawerProviderId],
  );
  const isCustomProvider = drawerProvider?.id === "custom";
  const isAppleProvider = drawerProvider?.id === "apple_intelligence";

  // Effective API key: override → global
  const drawerApiKey =
    overrides.apiKey ??
    (getSetting("post_process_api_keys") ?? {})[drawerProviderId] ??
    "";

  // Model options from the shared store (keyed by provider)
  const drawerModelOptions = useMemo<ModelOption[]>(() => {
    const raw = providerState.modelOptions;
    // If drawer provider matches global, use the hook's model options directly
    if (drawerProviderId === providerState.selectedProviderId) {
      return raw;
    }
    // Otherwise, the model options may not have been fetched yet
    return effectiveModelId
      ? [{ value: effectiveModelId, label: effectiveModelId }]
      : [];
  }, [
    providerState.modelOptions,
    providerState.selectedProviderId,
    drawerProviderId,
    effectiveModelId,
  ]);

  // Model options for the add-model form (uses the shared store keyed by provider)
  const addFormModelOptions = useMemo<ModelOption[]>(() => {
    const raw = postProcessModelOptions[newProvider] || [];
    const seen = new Set<string>();
    const options: ModelOption[] = [];
    for (const m of raw) {
      const trimmed = m.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        options.push({ value: trimmed, label: trimmed });
      }
    }
    if (newModel && !seen.has(newModel)) {
      options.push({ value: newModel, label: newModel });
    }
    return options;
  }, [postProcessModelOptions, newProvider, newModel]);

  const isAddFormFetchingModels = isUpdating(
    `post_process_models_fetch:${newProvider}`,
  );

  const promptOptions = prompts.map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const handleProviderChange = useCallback(
    (value: string) => {
      setOverride("providerId", value);
      if (saveAsDefault) {
        providerState.handleProviderSelect(value);
      }
    },
    [setOverride, saveAsDefault, providerState],
  );

  const handleApiKeyBlur = useCallback(
    (value: string) => {
      setOverride("apiKey", value);
      if (saveAsDefault) {
        providerState.handleApiKeyChange(value);
      }
    },
    [setOverride, saveAsDefault, providerState],
  );

  const handleBaseUrlBlur = useCallback(
    (value: string) => {
      setOverride("baseUrl", value);
      if (saveAsDefault) {
        providerState.handleBaseUrlChange(value);
      }
    },
    [setOverride, saveAsDefault, providerState],
  );

  const handleModelSelect = useCallback(
    (value: string) => {
      setOverride("modelId", value);
      if (saveAsDefault) {
        providerState.handleModelSelect(value);
      }
    },
    [setOverride, saveAsDefault, providerState],
  );

  const handleModelCreate = useCallback(
    (value: string) => {
      setOverride("modelId", value);
      if (saveAsDefault) {
        providerState.handleModelCreate(value);
      }
    },
    [setOverride, saveAsDefault, providerState],
  );

  const handlePromptSelect = (value: string) => {
    setOverride("selectedPromptId", value);
    setOverride("promptText", null);
    if (saveAsDefault) {
      updateSetting("post_process_selected_prompt_id", value);
    }
  };

  const handlePromptTextChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setOverride("promptText", e.target.value);
  };

  const handleNewPrompt = () => {
    setOverride("selectedPromptId", "");
    setOverride("promptText", "");
  };

  const portalContainer = document.getElementById("drawer-portal");
  if (!isOpen || !portalContainer) return null;

  return createPortal(
    <div
      ref={drawerRef}
      className="absolute inset-0 min-h-0 border-l border-mid-gray/20 bg-background flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-mid-gray/20">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-logo-primary" />
          <h3 className="text-sm font-semibold">
            {t("settings.history.drawer.title")}
          </h3>
        </div>
        <button
          onClick={close}
          className="p-1 rounded text-text/50 hover:text-text transition-colors cursor-pointer"
          aria-label={t("common.close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div
        ref={bodyScrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4"
        style={{ overflowAnchor: "none" }}
      >
        {/* Description */}
        <p className="text-xs text-text/60">
          {t("settings.history.drawer.description")}
        </p>

        {/* Provider */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-text/80">
            {t("settings.history.drawer.provider")}
          </label>
          <ProviderSelect
            options={providerState.providerOptions}
            value={drawerProviderId}
            onChange={handleProviderChange}
          />
        </div>

        {/* Base URL (custom provider only) */}
        {isCustomProvider && !isAppleProvider && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text/80">
              {t("settings.postProcessing.api.baseUrl.title")}
            </label>
            <BaseUrlField
              value={overrides.baseUrl ?? drawerProvider?.base_url ?? ""}
              onBlur={handleBaseUrlBlur}
              disabled={saveAsDefault && providerState.isBaseUrlUpdating}
              placeholder={t("settings.postProcessing.api.baseUrl.placeholder")}
              className="!min-w-0 w-full"
            />
          </div>
        )}

        {/* API Key (not for Apple) */}
        {!isAppleProvider && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text/80">
              {t("settings.history.drawer.apiKey")}
            </label>
            <ApiKeyField
              value={drawerApiKey}
              onBlur={handleApiKeyBlur}
              disabled={providerState.isApiKeyUpdating}
              placeholder={t("settings.history.drawer.apiKeyPlaceholder")}
              className="!min-w-0 w-full"
            />
          </div>
        )}

        {/* Model (not for Apple) */}
        {!isAppleProvider && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text/80">
              {t("settings.history.drawer.model")}
            </label>
            <div className="flex items-center gap-2">
              <ModelSelect
                value={effectiveModelId}
                options={drawerModelOptions}
                disabled={providerState.isModelUpdating}
                isLoading={providerState.isFetchingModels}
                placeholder={
                  drawerModelOptions.length > 0
                    ? t(
                        "settings.postProcessing.api.model.placeholderWithOptions",
                      )
                    : t(
                        "settings.postProcessing.api.model.placeholderNoOptions",
                      )
                }
                onSelect={handleModelSelect}
                onCreate={handleModelCreate}
                onBlur={() => {}}
                className="flex-1 min-w-0"
              />
              <ResetButton
                onClick={providerState.handleRefreshModels}
                disabled={providerState.isFetchingModels}
                ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
                className="flex h-8 w-8 items-center justify-center flex-shrink-0"
              >
                <RefreshCcw
                  className={`h-3.5 w-3.5 ${providerState.isFetchingModels ? "animate-spin" : ""}`}
                />
              </ResetButton>
            </div>
          </div>
        )}

        {/* Prompt selector */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-text/80">
              {t("settings.history.drawer.prompt")}
            </label>
            <Button onClick={handleNewPrompt} variant="secondary" size="sm">
              {t("settings.history.drawer.newPrompt")}
            </Button>
          </div>
          <Dropdown
            selectedValue={effectivePromptId || null}
            options={promptOptions}
            onSelect={handlePromptSelect}
            placeholder={t("settings.history.drawer.selectPrompt")}
            className="w-full"
          />
        </div>

        {/* Prompt text */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-text/80">
            {t("settings.history.drawer.promptText")}
          </label>
          <Textarea
            value={effectivePromptText}
            onChange={handlePromptTextChange}
            placeholder={t("settings.history.drawer.promptTextPlaceholder")}
            variant="compact"
            className="w-full text-xs"
          />
        </div>

        {/* Save as default toggle */}
        <div className="flex items-center justify-between pt-2 border-t border-mid-gray/20">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-text/80">
              {t("settings.history.drawer.saveAsDefault")}
            </p>
            <p className="text-[11px] text-text/50">
              {t("settings.history.drawer.saveAsDefaultDescription")}
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={saveAsDefault}
              onChange={(e) =>
                preserveBodyScroll(() => setSaveAsDefault(e.target.checked))
              }
            />
            <div className="relative w-9 h-5 bg-mid-gray/20 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-logo-primary rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-background-ui" />
          </label>
        </div>

        {/* Compare Models */}
        <div className="flex items-center justify-between pt-2 border-t border-mid-gray/20">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-text/80">
              {t("settings.history.drawer.compareModels")}
            </p>
            <p className="text-[11px] text-text/50">
              {t("settings.history.drawer.compareModelsDescription")}
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={compareEnabled}
              onChange={(e) =>
                preserveBodyScroll(() => setCompareEnabled(e.target.checked))
              }
            />
            <div className="relative w-9 h-5 bg-mid-gray/20 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-logo-primary rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-background-ui" />
          </label>
        </div>

        {compareEnabled && (
          <div className="space-y-3">
            {/* Info banner */}
            <div className="flex items-start gap-2 rounded-md bg-logo-primary/10 p-2.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-logo-primary" />
              <p className="text-[11px] text-text/70">
                {t("settings.history.drawer.compareNote")}
              </p>
            </div>

            {/* Model list */}
            <div className="space-y-2">
              {/* Primary model chip */}
              <div className="flex items-center justify-between rounded-md border border-logo-primary/40 bg-logo-primary/5 px-2.5 py-2">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[11px] font-medium text-logo-primary">
                    {t("settings.history.drawer.primary")}
                  </p>
                  <p className="text-xs text-text/80 truncate">
                    {effectiveProviderId} / {effectiveModelId}
                  </p>
                </div>
                <label className="inline-flex items-center">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked
                    disabled
                  />
                  <div className="relative w-9 h-5 bg-mid-gray/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-background-ui opacity-60" />
                </label>
              </div>

              {/* Additional model chips */}
              {compareModels.map((cm) => (
                <div
                  key={cm.id}
                  className="flex items-center justify-between rounded-md border border-mid-gray/20 px-2.5 py-2"
                >
                  <p
                    className={`text-xs truncate ${cm.enabled ? "text-text/80" : "text-text/40"}`}
                  >
                    {cm.provider} / {cm.model}
                  </p>
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={cm.enabled}
                      onChange={() =>
                        setCompareModels((prev) =>
                          prev.map((m) =>
                            m.id === cm.id ? { ...m, enabled: !m.enabled } : m,
                          ),
                        )
                      }
                    />
                    <div className="relative w-9 h-5 bg-mid-gray/20 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-logo-primary rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-background-ui" />
                  </label>
                </div>
              ))}
            </div>

            {/* Add Model button / form */}
            {!showAddForm ? (
              <button
                onClick={() => {
                  setNewProvider(drawerProviderId);
                  setShowAddForm(true);
                }}
                className="flex items-center gap-1.5 w-full justify-center rounded-md border border-dashed border-mid-gray/30 py-2 text-xs text-text/60 hover:text-text/80 hover:border-mid-gray/50 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("settings.history.drawer.addModel")}
              </button>
            ) : (
              <div className="space-y-2 rounded-md border border-mid-gray/20 p-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-text/80">
                    {t("settings.history.drawer.addModelProvider")}
                  </label>
                  <ProviderSelect
                    options={providerState.providerOptions}
                    value={newProvider}
                    onChange={(value) => setNewProvider(value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-text/80">
                    {t("settings.history.drawer.addModelApiKey")}
                  </label>
                  <ApiKeyField
                    value={newApiKey}
                    onBlur={(value) => setNewApiKey(value)}
                    disabled={false}
                    placeholder={t("settings.history.drawer.apiKeyPlaceholder")}
                    className="!min-w-0 w-full"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-text/80">
                    {t("settings.history.drawer.addModelModel")}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <ModelSelect
                      value={newModel}
                      options={addFormModelOptions}
                      isLoading={isAddFormFetchingModels}
                      placeholder={
                        addFormModelOptions.length > 0
                          ? t(
                              "settings.postProcessing.api.model.placeholderWithOptions",
                            )
                          : t(
                              "settings.postProcessing.api.model.placeholderNoOptions",
                            )
                      }
                      onSelect={(value) => setNewModel(value)}
                      onCreate={(value) => setNewModel(value)}
                      onBlur={() => {}}
                      className="min-w-0 flex-1"
                    />
                    <ResetButton
                      onClick={() => {
                        if (newProvider) {
                          fetchPostProcessModels(newProvider);
                        }
                      }}
                      disabled={isAddFormFetchingModels || !newProvider}
                      ariaLabel={t(
                        "settings.postProcessing.api.model.refreshModels",
                      )}
                      className="flex h-7 w-7 items-center justify-center flex-shrink-0"
                    >
                      <RefreshCcw
                        className={`h-3 w-3 ${isAddFormFetchingModels ? "animate-spin" : ""}`}
                      />
                    </ResetButton>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewProvider("");
                      setNewBaseUrl("");
                      setNewApiKey("");
                      setNewModel("");
                    }}
                  >
                    {t("settings.history.drawer.addModelCancel")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      if (newProvider && newModel) {
                        setCompareModels((prev) => [
                          ...prev,
                          {
                            id: crypto.randomUUID(),
                            provider: newProvider,
                            model: newModel,
                            apiKey: newApiKey,
                            baseUrl: newBaseUrl,
                            enabled: true,
                          },
                        ]);
                        setShowAddForm(false);
                        setNewProvider("");
                        setNewBaseUrl("");
                        setNewApiKey("");
                        setNewModel("");
                      }
                    }}
                  >
                    {t("settings.history.drawer.addModelAdd")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    portalContainer,
  );
};

PostProcessDrawer.displayName = "PostProcessDrawer";
