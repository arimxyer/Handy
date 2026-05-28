import React, { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCcw, Settings } from "lucide-react";
import { useTextOpsProviderState } from "./useTextOpsProviderState";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ResetButton } from "../../ui/ResetButton";

interface ModelSettingsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onGoToSettings: () => void;
}

export const ModelSettingsPopover: React.FC<ModelSettingsPopoverProps> = ({
  isOpen,
  onClose,
  anchorRef,
  onGoToSettings,
}) => {
  const { t } = useTranslation();
  const state = useTextOpsProviderState();
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen || !anchorRef.current) return null;

  const rect = anchorRef.current.getBoundingClientRect();

  return (
    <div
      ref={popoverRef}
      className="fixed w-72 bg-background border border-mid-gray/40 rounded-lg shadow-lg z-[60] isolate p-3 flex flex-col gap-2.5"
      style={{ top: rect.bottom + 4, left: rect.left }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-text/40 uppercase tracking-wider">
          {t("settings.postProcessing.api.provider.title")}
        </span>
        <ProviderSelect
          options={state.providerOptions}
          value={state.selectedProviderId}
          onChange={state.handleProviderSelect}
        />
      </div>

      {!state.isAppleProvider && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium text-text/40 uppercase tracking-wider">
            {t("settings.postProcessing.api.model.title")}
          </span>
          <div className="flex items-center gap-1.5">
            <ModelSelect
              value={state.model}
              options={state.modelOptions}
              disabled={state.isModelUpdating}
              isLoading={state.isFetchingModels}
              placeholder={t("textOps.editor.changeModel")}
              onSelect={state.handleModelSelect}
              onCreate={state.handleModelCreate}
              onBlur={() => {}}
              className="min-w-0 flex-1"
            />
            <ResetButton
              onClick={state.handleRefreshModels}
              disabled={state.isFetchingModels}
              ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
              className="flex h-8 w-8 shrink-0 items-center justify-center"
            >
              <RefreshCcw
                className={`h-3.5 w-3.5 ${state.isFetchingModels ? "animate-spin" : ""}`}
              />
            </ResetButton>
          </div>
        </div>
      )}

      {!state.isAppleProvider && state.selectedProvider?.id === "custom" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium text-text/40 uppercase tracking-wider">
            {t("settings.postProcessing.api.baseUrl.title")}
          </span>
          <BaseUrlField
            value={state.baseUrl}
            onBlur={state.handleBaseUrlChange}
            placeholder={t("settings.postProcessing.api.baseUrl.placeholder")}
            disabled={state.isBaseUrlUpdating}
            className="w-full"
          />
        </div>
      )}

      <div className="border-t border-mid-gray/20 pt-2">
        <button
          type="button"
          onClick={onGoToSettings}
          className="flex items-center gap-1.5 text-[11px] text-text/50 hover:text-text/70 transition-colors cursor-pointer"
        >
          <Settings className="w-3 h-3" />
          <span>{t("textOps.editor.moreSettings")}</span>
        </button>
      </div>
    </div>
  );
};
