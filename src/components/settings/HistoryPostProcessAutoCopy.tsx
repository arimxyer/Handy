import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface HistoryPostProcessAutoCopyProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const HistoryPostProcessAutoCopy: React.FC<HistoryPostProcessAutoCopyProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("history_post_process_auto_copy") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(enabled) =>
          updateSetting("history_post_process_auto_copy", enabled)
        }
        isUpdating={isUpdating("history_post_process_auto_copy")}
        label={t("settings.advanced.historyPostProcessAutoCopy.label")}
        description={t(
          "settings.advanced.historyPostProcessAutoCopy.description",
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  });

HistoryPostProcessAutoCopy.displayName = "HistoryPostProcessAutoCopy";
