import { useState, useCallback } from "react";
import { useSettings } from "./useSettings";
import type { LLMPrompt } from "@/bindings";

export interface DrawerOverrides {
  providerId: string | null;
  apiKey: string | null;
  modelId: string | null;
  selectedPromptId: string | null;
  promptText: string | null;
}

const EMPTY_OVERRIDES: DrawerOverrides = {
  providerId: null,
  apiKey: null,
  modelId: null,
  selectedPromptId: null,
  promptText: null,
};

export function usePostProcessDrawer() {
  const { getSetting } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [overrides, setOverrides] = useState<DrawerOverrides>({
    ...EMPTY_OVERRIDES,
  });

  // Effective values: override if set, else fall back to global setting
  const effectiveProviderId =
    overrides.providerId ?? getSetting("post_process_provider_id") ?? "";
  const effectiveModelId =
    overrides.modelId ??
    getSetting("post_process_models")?.[effectiveProviderId] ??
    "";
  const effectivePromptId =
    overrides.selectedPromptId ??
    getSetting("post_process_selected_prompt_id") ??
    "";

  const prompts: LLMPrompt[] = getSetting("post_process_prompts") ?? [];
  const selectedPrompt = prompts.find((p) => p.id === effectivePromptId);
  const effectivePromptText =
    overrides.promptText ?? selectedPrompt?.prompt ?? "";

  const setOverride = useCallback(
    <K extends keyof DrawerOverrides>(key: K, value: DrawerOverrides[K]) => {
      setOverrides((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetOverrides = useCallback(() => {
    setOverrides({ ...EMPTY_OVERRIDES });
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    resetOverrides();
  }, [resetOverrides]);

  return {
    isOpen,
    open,
    close,
    overrides,
    setOverride,
    resetOverrides,
    effectiveProviderId,
    effectiveModelId,
    effectivePromptId,
    effectivePromptText,
    prompts,
  };
}
