import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshCcw } from "lucide-react";

import { Alert } from "../../ui/Alert";
import { Dropdown, SettingContainer, SettingsGroup } from "@/components/ui";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { ResetButton } from "../../ui/ResetButton";

import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import { ShortcutInput } from "../ShortcutInput";
import { useTextOpsProviderState } from "./useTextOpsProviderState";
import { useSettings } from "../../../hooks/useSettings";
import type { TextOpsOutputBehavior } from "@/bindings";

export const TextSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const state = useTextOpsProviderState();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const textOpsEnabled = getSetting("text_ops_enabled") || false;
  const prompts = getSetting("text_ops_prompts") || [];
  const pinnedPromptId = getSetting("text_ops_pinned_prompt_id") ?? null;
  const outputBehavior = (getSetting("text_ops_output_behavior") as string) || "copy_to_clipboard";

  const outputBehaviorOptions = [
    { value: "copy_to_clipboard", label: t("textOps.settings.outputCopyToClipboard") },
    { value: "replace_selection", label: t("textOps.settings.outputReplaceSelection") },
  ];

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("textOps.settings.shortcut")}>
        <ToggleSwitch
          checked={textOpsEnabled}
          onChange={(enabled) => updateSetting("text_ops_enabled", enabled)}
          isUpdating={isUpdating("text_ops_enabled")}
          label={t("textOps.settings.enableShortcut")}
          description={t("textOps.settings.enableShortcutDescription")}
          descriptionMode="tooltip"
          grouped={true}
        />
        {textOpsEnabled && (
          <>
            <ShortcutInput shortcutId="text_ops" grouped={true} />
            <SettingContainer
              title={t("textOps.settings.pinnedPrompt")}
              description={t("textOps.settings.pinnedPromptDescription")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped={true}
            >
              <Dropdown
                selectedValue={pinnedPromptId}
                options={prompts.map((p) => ({ value: p.id, label: p.name }))}
                onSelect={(value) => {
                  if (value) {
                    updateSetting("text_ops_pinned_prompt_id", value);
                  }
                }}
                placeholder={t("textOps.prompts.selectPrompt")}
                className="flex-1"
              />
            </SettingContainer>
            <SettingContainer
              title={t("textOps.settings.outputBehavior")}
              description={t("textOps.settings.outputBehaviorDescription")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped={true}
            >
              <Dropdown
                selectedValue={outputBehavior}
                options={outputBehaviorOptions}
                onSelect={(value) => {
                  if (value) {
                    updateSetting("text_ops_output_behavior", value as TextOpsOutputBehavior);
                  }
                }}
                className="flex-1"
              />
            </SettingContainer>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("textOps.settings.provider")}>
        <SettingContainer
          title={t("settings.postProcessing.api.provider.title")}
          description={t("settings.postProcessing.api.provider.description")}
          descriptionMode="tooltip"
          layout="horizontal"
          grouped={true}
        >
          <div className="flex items-center gap-2">
            <ProviderSelect
              options={state.providerOptions}
              value={state.selectedProviderId}
              onChange={state.handleProviderSelect}
            />
          </div>
        </SettingContainer>

        {state.isAppleProvider ? (
          state.appleIntelligenceUnavailable ? (
            <Alert variant="error" contained>
              {t("settings.postProcessing.api.appleIntelligence.unavailable")}
            </Alert>
          ) : null
        ) : (
          <>
            {state.selectedProvider?.id === "custom" && (
              <SettingContainer
                title={t("settings.postProcessing.api.baseUrl.title")}
                description={t(
                  "settings.postProcessing.api.baseUrl.description",
                )}
                descriptionMode="tooltip"
                layout="horizontal"
                grouped={true}
              >
                <div className="flex items-center gap-2">
                  <BaseUrlField
                    value={state.baseUrl}
                    onBlur={state.handleBaseUrlChange}
                    placeholder={t(
                      "settings.postProcessing.api.baseUrl.placeholder",
                    )}
                    disabled={state.isBaseUrlUpdating}
                    className="min-w-[380px]"
                  />
                </div>
              </SettingContainer>
            )}

            <SettingContainer
              title={t("settings.postProcessing.api.apiKey.title")}
              description={t("settings.postProcessing.api.apiKey.description")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped={true}
            >
              <div className="flex items-center gap-2">
                <ApiKeyField
                  value={state.apiKey}
                  onBlur={state.handleApiKeyChange}
                  placeholder={t(
                    "settings.postProcessing.api.apiKey.placeholder",
                  )}
                  disabled={state.isApiKeyUpdating}
                  className="min-w-[320px]"
                />
              </div>
            </SettingContainer>
          </>
        )}

        {!state.isAppleProvider && (
          <SettingContainer
            title={t("settings.postProcessing.api.model.title")}
            description={
              state.isCustomProvider
                ? t("settings.postProcessing.api.model.descriptionCustom")
                : t("settings.postProcessing.api.model.descriptionDefault")
            }
            descriptionMode="tooltip"
            layout="stacked"
            grouped={true}
          >
            <div className="flex items-center gap-2">
              <ModelSelect
                value={state.model}
                options={state.modelOptions}
                disabled={state.isModelUpdating}
                isLoading={state.isFetchingModels}
                placeholder={
                  state.modelOptions.length > 0
                    ? t(
                        "settings.postProcessing.api.model.placeholderWithOptions",
                      )
                    : t(
                        "settings.postProcessing.api.model.placeholderNoOptions",
                      )
                }
                onSelect={state.handleModelSelect}
                onCreate={state.handleModelCreate}
                onBlur={() => {}}
                className="flex-1 min-w-[380px]"
              />
              <ResetButton
                onClick={state.handleRefreshModels}
                disabled={state.isFetchingModels}
                ariaLabel={t(
                  "settings.postProcessing.api.model.refreshModels",
                )}
                className="flex h-10 w-10 items-center justify-center"
              >
                <RefreshCcw
                  className={`h-4 w-4 ${state.isFetchingModels ? "animate-spin" : ""}`}
                />
              </ResetButton>
            </div>
          </SettingContainer>
        )}
      </SettingsGroup>

    </div>
  );
};
