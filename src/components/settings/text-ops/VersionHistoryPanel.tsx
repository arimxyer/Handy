import React, { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  History,
  Sparkles,
  Mic,
  RotateCcw,
  Loader2,
  Pencil,
} from "lucide-react";
import { commands, type TranscriptionVersion } from "@/bindings";
import { formatDateTime } from "@/utils/dateFormat";
import { toast } from "sonner";

interface VersionHistoryPanelProps {
  tabId: string;
  historyEntryId: number | null;
  currentContent: string;
  onRestore: (text: string) => void;
  onClose: () => void;
}

export const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({
  historyEntryId,
  currentContent,
  onRestore,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const [versions, setVersions] = useState<TranscriptionVersion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [originalText, setOriginalText] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    if (historyEntryId == null) return;
    setLoading(true);
    try {
      const result = await commands.getTranscriptionVersions(historyEntryId);
      if (result.status === "ok") {
        setVersions(result.data);
      }
      const entryResult = await commands.getHistoryEntry(historyEntryId);
      if (entryResult.status === "ok") {
        setOriginalText(entryResult.data.transcription_text);
      }
    } catch (error) {
      console.error("Failed to fetch versions:", error);
    } finally {
      setLoading(false);
    }
  }, [historyEntryId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  if (historyEntryId == null) {
    return (
      <div className="w-80 border-l border-mid-gray/20 bg-background flex flex-col">
        <PanelHeader onClose={onClose} />
        <div className="flex-1 flex items-center justify-center px-6">
          <p className="text-sm text-text/40 text-center">
            {t("textOps.editor.noVersions")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-mid-gray/20 bg-background flex flex-col">
      <PanelHeader onClose={onClose} />

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && versions == null ? (
          <div className="flex items-center justify-center py-8 text-text/50">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : versions != null ? (
          <div className="flex flex-col">
            {[...versions].reverse().map((version, index) => {
              const isActive = version.text === currentContent;
              return (
                <div key={version.id}>
                  {index > 0 && <VersionConnector />}
                  <VersionCard
                    version={version}
                    entryId={historyEntryId}
                    isActive={isActive}
                    language={i18n.language}
                    onRestore={(text) => {
                      onRestore(text);
                      fetchVersions();
                    }}
                  />
                </div>
              );
            })}
            {originalText != null && (
              <>
                {(versions?.length ?? 0) > 0 && <VersionConnector />}
                <OriginalCard
                  text={originalText}
                  isActive={originalText === currentContent}
                  entryId={historyEntryId}
                  language={i18n.language}
                  onRestore={(text) => {
                    onRestore(text);
                    fetchVersions();
                  }}
                />
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const PanelHeader: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-mid-gray/20">
      <div className="flex items-center gap-2">
        <History className="w-3.5 h-3.5 text-text/50" />
        <span className="text-xs font-semibold text-text/70">
          {t("textOps.editor.versionHistory")}
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="p-1 rounded text-text/40 hover:text-text/70 hover:bg-mid-gray/10 transition-colors cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

const VersionConnector: React.FC = () => (
  <div className="flex pl-4">
    <div className="w-0.5 h-4 bg-mid-gray/20" />
  </div>
);

interface ExpandableTextProps {
  text: string;
  limit: number;
  className?: string;
}

const ExpandableText: React.FC<ExpandableTextProps> = ({
  text,
  limit,
  className,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > limit;

  return (
    <span className={className}>
      {needsTruncation && !expanded ? `${text.substring(0, limit)}...` : text}
      {needsTruncation && (
        <>
          {" "}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-logo-primary hover:text-logo-primary/80 transition-colors cursor-pointer"
          >
            {expanded
              ? t("settings.history.showLess")
              : t("settings.history.showMore")}
          </button>
        </>
      )}
    </span>
  );
};

interface VersionCardProps {
  version: TranscriptionVersion;
  entryId: number;
  isActive: boolean;
  language: string;
  onRestore: (text: string) => void;
}

const VersionCard: React.FC<VersionCardProps> = ({
  version,
  entryId,
  isActive,
  language,
  onRestore,
}) => {
  const { t } = useTranslation();
  const formattedTime = formatDateTime(String(version.timestamp), language);

  const isManual =
    version.model_name === "Manual edit" ||
    version.model_name === "Manual save";
  const isAutoCheckpoint = version.model_name === "Auto-checkpoint";
  const isRecovered = version.model_name === "Recovered";

  return (
    <div
      className={`rounded-md border p-3 ${
        isActive
          ? "border-logo-primary/50 bg-logo-primary/10"
          : "border-mid-gray/20"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              isActive ? "bg-logo-primary" : "bg-text/30"
            }`}
          />
          <span
            className={`text-xs font-medium truncate ${
              isActive ? "text-logo-primary" : "text-text/60"
            }`}
          >
            {formattedTime}
          </span>
          {isManual ? (
            <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-mid-gray/10 text-text/40 shrink-0">
              <Pencil className="w-2.5 h-2.5" />
              {t("settings.history.manualEdit")}
            </span>
          ) : isAutoCheckpoint || isRecovered ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-mid-gray/10 text-text/40 shrink-0">
              {version.model_name}
            </span>
          ) : version.model_name ? (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-mid-gray/10 text-text/40 shrink-0">
              {version.model_name}
            </span>
          ) : null}
        </div>
        {isActive ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-logo-primary text-white shrink-0">
            {t("settings.history.activeVersion")}
          </span>
        ) : (
          <RestoreButton
            entryId={entryId}
            versionId={version.id}
            text={version.text}
            onRestore={onRestore}
          />
        )}
      </div>
      <p
        className={`text-xs leading-relaxed mb-2 ${isActive ? "text-text/80" : "text-text/50"}`}
      >
        <ExpandableText text={version.text} limit={200} />
      </p>
      {version.prompt &&
        version.prompt !== "Manual save" &&
        version.prompt !== "Auto-checkpoint" &&
        version.prompt !== "Recovered" && (
          <div className="flex items-start gap-1">
            <Sparkles className="w-2.5 h-2.5 text-text/30 mt-1 shrink-0" />
            <ExpandableText
              text={version.prompt}
              limit={80}
              className="text-[11px] leading-relaxed text-text/30 whitespace-pre-wrap"
            />
          </div>
        )}
    </div>
  );
};

interface OriginalCardProps {
  text: string;
  isActive: boolean;
  entryId: number;
  language: string;
  onRestore: (text: string) => void;
}

const OriginalCard: React.FC<OriginalCardProps> = ({
  text,
  isActive,
  entryId,
  onRestore,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className={`rounded-md border p-3 ${
        isActive
          ? "border-logo-primary/50 bg-logo-primary/10"
          : "border-mid-gray/20"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isActive ? "bg-logo-primary" : "bg-text/30"
            }`}
          />
          <div className="flex items-center gap-1">
            <Mic className="w-2.5 h-2.5 text-text/30" />
            <span
              className={`text-xs font-medium ${
                isActive ? "text-logo-primary" : "text-text/60"
              }`}
            >
              {t("settings.history.originalVersion")}
            </span>
          </div>
        </div>
        {isActive ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-logo-primary text-white">
            {t("settings.history.activeVersion")}
          </span>
        ) : (
          <RestoreButton
            entryId={entryId}
            versionId={null}
            text={text}
            onRestore={onRestore}
          />
        )}
      </div>
      <p
        className={`text-xs leading-relaxed ${isActive ? "text-text/80" : "text-text/50"}`}
      >
        <ExpandableText text={text} limit={200} />
      </p>
    </div>
  );
};

interface RestoreButtonProps {
  entryId: number;
  versionId: number | null;
  text: string;
  onRestore: (text: string) => void;
}

const RestoreButton: React.FC<RestoreButtonProps> = ({
  entryId,
  versionId,
  text,
  onRestore,
}) => {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = async () => {
    if (!confirming) {
      setConfirming(true);
      timeoutRef.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setConfirming(false);
    setRestoring(true);

    try {
      const result = await commands.restoreVersion(entryId, versionId);
      if (result.status === "ok") {
        onRestore(text);
      } else {
        toast.error(t("settings.history.restoreError"));
      }
    } catch {
      toast.error(t("settings.history.restoreError"));
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (restoring) {
    return (
      <span className="p-1">
        <Loader2 className="w-3 h-3 animate-spin text-text/50" />
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border transition-colors cursor-pointer shrink-0 ${
        confirming
          ? "border-logo-primary text-logo-primary"
          : "border-text/20 text-text/50 hover:text-logo-primary hover:border-logo-primary"
      }`}
    >
      {!confirming && <RotateCcw className="w-2.5 h-2.5" />}
      <span>
        {confirming
          ? t("settings.history.confirmRestore")
          : t("settings.history.restore")}
      </span>
    </button>
  );
};
