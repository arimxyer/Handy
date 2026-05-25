import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface CompletionNotificationsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const CompletionNotifications: React.FC<CompletionNotificationsProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("completion_notifications_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(enabled) =>
          updateSetting("completion_notifications_enabled", enabled)
        }
        isUpdating={isUpdating("completion_notifications_enabled")}
        label={t("settings.advanced.completionNotifications.label")}
        description={t("settings.advanced.completionNotifications.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  });

CompletionNotifications.displayName = "CompletionNotifications";
