import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { upstreamReleaseUrl } from "./upstreamRelease";

interface UpdateCheckerProps {
  className?: string;
}

const UpdateChecker: React.FC<UpdateCheckerProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const [isChecking, setIsChecking] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [showUpToDate, setShowUpToDate] = useState(false);

  const { settings, isLoading } = useSettings();
  const settingsLoaded = !isLoading && settings !== null;
  const updateChecksEnabled = settings?.update_checks_enabled ?? false;

  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isManualCheckRef = useRef(false);

  const checkForUpdates = async () => {
    if (!updateChecksEnabled || isChecking) return;

    try {
      setIsChecking(true);
      const update = await check();

      if (update) {
        setAvailableVersion(update.version);
        setShowUpToDate(false);
      } else {
        setAvailableVersion(null);

        if (isManualCheckRef.current) {
          setShowUpToDate(true);
          if (upToDateTimeoutRef.current) {
            clearTimeout(upToDateTimeoutRef.current);
          }
          upToDateTimeoutRef.current = setTimeout(() => {
            setShowUpToDate(false);
          }, 3000);
        }
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      setIsChecking(false);
      isManualCheckRef.current = false;
    }
  };

  const handleManualUpdateCheck = () => {
    if (!updateChecksEnabled) return;
    isManualCheckRef.current = true;
    checkForUpdates();
  };

  useEffect(() => {
    if (!settingsLoaded) return;

    if (!updateChecksEnabled) {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      setIsChecking(false);
      setAvailableVersion(null);
      setShowUpToDate(false);
      return;
    }

    checkForUpdates();

    const updateUnlisten = listen("check-for-updates", () => {
      handleManualUpdateCheck();
    });

    return () => {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      updateUnlisten.then((fn) => fn());
    };
  }, [settingsLoaded, updateChecksEnabled]);

  const openUpstreamRelease = () => {
    if (availableVersion) {
      openUrl(upstreamReleaseUrl(availableVersion));
    }
  };

  const getUpdateStatusText = () => {
    if (!updateChecksEnabled) return t("footer.updateCheckingDisabled");
    if (isChecking) return t("footer.checkingUpdates");
    if (showUpToDate) return t("footer.upToDate");
    if (availableVersion) {
      return t("footer.updateAvailable", { version: availableVersion });
    }
    return t("footer.checkForUpdates");
  };

  const getUpdateStatusAction = () => {
    if (!updateChecksEnabled) return undefined;
    if (availableVersion) return openUpstreamRelease;
    if (!isChecking) return handleManualUpdateCheck;
    return undefined;
  };

  const isUpdateDisabled = !updateChecksEnabled || isChecking;
  const isUpdateClickable =
    !isUpdateDisabled &&
    (availableVersion !== null || (!isChecking && !showUpToDate));

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {isUpdateClickable ? (
        <button
          onClick={getUpdateStatusAction()}
          disabled={isUpdateDisabled}
          className={`transition-colors disabled:opacity-50 tabular-nums ${
            availableVersion
              ? "text-logo-primary hover:text-logo-primary/80 font-medium"
              : "text-text/60 hover:text-text/80"
          }`}
        >
          {getUpdateStatusText()}
        </button>
      ) : (
        <span className="text-text/60 tabular-nums">
          {getUpdateStatusText()}
        </span>
      )}
    </div>
  );
};

export default UpdateChecker;
