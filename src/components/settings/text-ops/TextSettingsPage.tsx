import React from "react";
import { useTranslation } from "react-i18next";

import { Dropdown, SettingContainer, SettingsGroup } from "@/components/ui";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
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
  const outputBehavior =
    (getSetting("text_ops_output_behavior") as string) || "copy_to_clipboard";

  const outputBehaviorOptions = [
    {
      value: "copy_to_clipboard",
      label: t("textOps.settings.outputCopyToClipboard"),
    },
    {
      value: "replace_selection",
      label: t("textOps.settings.outputReplaceSelection"),
    },
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
                    updateSetting(
                      "text_ops_output_behavior",
                      value as TextOpsOutputBehavior,
                    );
                  }
                }}
                className="flex-1"
              />
            </SettingContainer>
            <ShortcutInput shortcutId="text_ops_picker" grouped={true} />
          </>
        )}
      </SettingsGroup>

      {!state.isAppleProvider && (
        <SettingsGroup title={t("settings.postProcessing.api.apiKey.title")}>
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
        </SettingsGroup>
      )}
    </div>
  );
};
