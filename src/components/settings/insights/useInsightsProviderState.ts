import { useCallback, useMemo, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { commands, type PostProcessProvider } from "@/bindings";
import type { ModelOption } from "../PostProcessingSettingsApi/types";
import type { DropdownOption } from "../../ui/Dropdown";

type InsightsProviderState = {
  providerOptions: DropdownOption[];
  selectedProviderId: string;
  selectedProvider: PostProcessProvider | undefined;
  isCustomProvider: boolean;
  isAppleProvider: boolean;
  appleIntelligenceUnavailable: boolean;
  baseUrl: string;
  handleBaseUrlChange: (value: string) => void;
  isBaseUrlUpdating: boolean;
  apiKey: string;
  handleApiKeyChange: (value: string) => void;
  isApiKeyUpdating: boolean;
  model: string;
  handleModelChange: (value: string) => void;
  modelOptions: ModelOption[];
  isModelUpdating: boolean;
  isFetchingModels: boolean;
  handleProviderSelect: (providerId: string) => void;
  handleModelSelect: (value: string) => void;
  handleModelCreate: (value: string) => void;
  handleRefreshModels: () => void;
};

const APPLE_PROVIDER_ID = "apple_intelligence";

export const useInsightsProviderState = (): InsightsProviderState => {
  const {
    settings,
    isUpdating,
    refreshSettings,
    postProcessModelOptions,
    fetchPostProcessModels,
  } = useSettings();

  const providers = settings?.post_process_providers || [];

  // Insights uses its own provider setting, falling back to post-process provider
  const selectedProviderId = useMemo(() => {
    const insightsId = settings?.insights_provider_id;
    if (insightsId) return insightsId;
    return settings?.post_process_provider_id || providers[0]?.id || "openai";
  }, [
    providers,
    settings?.insights_provider_id,
    settings?.post_process_provider_id,
  ]);

  const selectedProvider = useMemo(() => {
    return (
      providers.find((provider) => provider.id === selectedProviderId) ||
      providers[0]
    );
  }, [providers, selectedProviderId]);

  const isAppleProvider = selectedProvider?.id === APPLE_PROVIDER_ID;
  const [appleIntelligenceUnavailable, setAppleIntelligenceUnavailable] =
    useState(false);

  const baseUrl = selectedProvider?.base_url ?? "";

  // Insights has its own API key and model per provider
  const apiKey =
    settings?.insights_api_keys?.[selectedProviderId] ??
    settings?.post_process_api_keys?.[selectedProviderId] ??
    "";
  const model =
    settings?.insights_models?.[selectedProviderId] ??
    settings?.post_process_models?.[selectedProviderId] ??
    "";

  const providerOptions = useMemo<DropdownOption[]>(() => {
    return providers.map((provider) => ({
      value: provider.id,
      label: provider.label,
    }));
  }, [providers]);

  const handleProviderSelect = useCallback(
    async (providerId: string) => {
      setAppleIntelligenceUnavailable(false);
      if (providerId === selectedProviderId) return;

      if (providerId === APPLE_PROVIDER_ID) {
        const available = await commands.checkAppleIntelligenceAvailable();
        if (!available) {
          setAppleIntelligenceUnavailable(true);
        }
      }

      const result = await commands.changeInsightsProviderId(providerId);
      if (result.status === "ok") {
        await refreshSettings();
      }
    },
    [selectedProviderId, refreshSettings],
  );

  const handleBaseUrlChange = useCallback((_value: string) => {
    // Base URL is managed by the provider definition, not per-context.
    // Insights shares providers with post-process, so no separate base URL.
  }, []);

  const handleApiKeyChange = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== apiKey) {
        const result = await commands.changeInsightsApiKey(
          selectedProviderId,
          trimmed,
        );
        if (result.status === "ok") {
          await refreshSettings();
        }
      }
    },
    [apiKey, selectedProviderId, refreshSettings],
  );

  const handleModelChange = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== model) {
        const result = await commands.changeInsightsModel(
          selectedProviderId,
          trimmed,
        );
        if (result.status === "ok") {
          await refreshSettings();
        }
      }
    },
    [model, selectedProviderId, refreshSettings],
  );

  const handleModelSelect = useCallback(
    async (value: string) => {
      const result = await commands.changeInsightsModel(
        selectedProviderId,
        value.trim(),
      );
      if (result.status === "ok") {
        await refreshSettings();
      }
    },
    [selectedProviderId, refreshSettings],
  );

  const handleModelCreate = useCallback(
    async (value: string) => {
      const result = await commands.changeInsightsModel(
        selectedProviderId,
        value,
      );
      if (result.status === "ok") {
        await refreshSettings();
      }
    },
    [selectedProviderId, refreshSettings],
  );

  // Reuse the shared model fetching (same providers, same API)
  const handleRefreshModels = useCallback(() => {
    if (isAppleProvider) return;
    void fetchPostProcessModels(selectedProviderId);
  }, [fetchPostProcessModels, isAppleProvider, selectedProviderId]);

  // Model options from the shared store
  const availableModelsRaw = postProcessModelOptions[selectedProviderId] || [];

  const modelOptions = useMemo<ModelOption[]>(() => {
    const seen = new Set<string>();
    const options: ModelOption[] = [];

    const upsert = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push({ value: trimmed, label: trimmed });
    };

    for (const candidate of availableModelsRaw) {
      upsert(candidate);
    }

    upsert(model);

    return options;
  }, [availableModelsRaw, model]);

  const isBaseUrlUpdating = false;
  const isApiKeyUpdating = isUpdating(`insights_api_key:${selectedProviderId}`);
  const isModelUpdating = isUpdating(`insights_model:${selectedProviderId}`);
  const isFetchingModels = isUpdating(
    `post_process_models_fetch:${selectedProviderId}`,
  );

  const isCustomProvider = selectedProvider?.id === "custom";

  return {
    providerOptions,
    selectedProviderId,
    selectedProvider,
    isCustomProvider,
    isAppleProvider,
    appleIntelligenceUnavailable,
    baseUrl,
    handleBaseUrlChange,
    isBaseUrlUpdating,
    apiKey,
    handleApiKeyChange,
    isApiKeyUpdating,
    model,
    handleModelChange,
    modelOptions,
    isModelUpdating,
    isFetchingModels,
    handleProviderSelect,
    handleModelSelect,
    handleModelCreate,
    handleRefreshModels,
  };
};
