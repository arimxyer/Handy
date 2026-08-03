import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FolderOpen,
  History,
  Loader2,
  MessageSquare,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  commands,
  events,
  type HistoryEntry,
  type HistoryUpdatePayload,
} from "@/bindings";
import { useOsType } from "@/hooks/useOsType";
import {
  usePostProcessDrawer,
  type CompareModel,
} from "@/hooks/usePostProcessDrawer";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import { sendCompletionNotification } from "@/lib/notifications";
import { formatDateTime } from "@/utils/dateFormat";
import { useDocumentStore } from "@/stores/documentStore";
import { Button } from "../../ui/Button";
import { AudioPlayer, AudioPlayerGroup } from "../../ui/AudioPlayer";
import { PostProcessDrawer } from "./PostProcessDrawer";
import { VersionHistory } from "./VersionHistory";

const PAGE_SIZE = 30;

type HistorySource = "voice" | "text";
type HistoryEntryWithExtras = HistoryEntry & {
  source?: string;
  version_count?: number;
};
type PaginatedHistory = {
  entries: HistoryEntryWithExtras[];
  has_more: boolean;
};
type GetHistoryEntriesCommand = (
  source: HistorySource,
  cursor: number | null,
  limit: number | null,
) => Promise<
  { status: "ok"; data: PaginatedHistory } | { status: "error"; error: string }
>;

interface ResolvedDrawerOverrides {
  providerId: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  modelId: string | null;
  promptText: string | null;
}

interface IconButtonProps {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}

const IconButton: React.FC<IconButtonProps> = ({
  onClick,
  title,
  disabled,
  active,
  className,
  children,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`p-1.5 rounded-md flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
      active
        ? "text-logo-primary hover:text-logo-primary/80"
        : "text-text/50 hover:text-logo-primary"
    } ${className ?? ""}`}
    title={title}
  >
    {children}
  </button>
);

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
  label,
}) => (
  <Button
    onClick={onClick}
    variant="secondary"
    size="sm"
    className="flex items-center gap-2"
    title={label}
  >
    <FolderOpen className="w-4 h-4" />
    <span>{label}</span>
  </Button>
);

const getHistoryEntriesPaginated =
  commands.getHistoryEntries as unknown as GetHistoryEntriesCommand;

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const { getSetting } = useSettings();
  const appMode = useSettingsStore((state) => state.appMode);
  const [entries, setEntries] = useState<HistoryEntryWithExtras[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HistoryEntryWithExtras[]>([]);
  const loadingRef = useRef(false);
  const source = appMode === "text" ? "text" : "voice";

  const historyPostProcessEnabled =
    (getSetting("experimental_enabled") || false) &&
    (getSetting("post_process_enabled") || false) &&
    (getSetting("history_post_process_enabled") || false);
  const historyPostProcessAutoCopy =
    getSetting("history_post_process_auto_copy") ?? false;
  const completionNotificationsEnabled =
    getSetting("completion_notifications_enabled") ?? false;

  const providerId = getSetting("post_process_provider_id");
  const selectedPromptId = getSetting("post_process_selected_prompt_id");
  const postProcessConfigured = useMemo(
    () => !!providerId && !!selectedPromptId,
    [providerId, selectedPromptId],
  );

  const drawer = usePostProcessDrawer();

  const resolvedDrawerOverrides: ResolvedDrawerOverrides = useMemo(() => {
    const { overrides } = drawer;
    let promptText = overrides.promptText;
    if (promptText == null && overrides.selectedPromptId != null) {
      const prompt = drawer.prompts.find(
        (candidate) => candidate.id === overrides.selectedPromptId,
      );
      promptText = prompt?.prompt ?? null;
    }
    return {
      providerId: overrides.providerId,
      baseUrl: overrides.baseUrl,
      apiKey: overrides.apiKey,
      modelId: overrides.modelId,
      promptText,
    };
  }, [drawer.overrides, drawer.prompts]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const loadPage = useCallback(
    async (cursor?: number) => {
      const isFirstPage = cursor === undefined;
      if (!isFirstPage && loadingRef.current) {
        return;
      }

      loadingRef.current = true;
      if (isFirstPage) {
        setLoading(true);
      }

      try {
        const result = await getHistoryEntriesPaginated(
          source,
          cursor ?? null,
          PAGE_SIZE,
        );
        if (result.status === "ok") {
          const { entries: newEntries, has_more } = result.data;
          setEntries((previous) =>
            isFirstPage ? newEntries : [...previous, ...newEntries],
          );
          setHasMore(has_more);
        } else if (isFirstPage) {
          setEntries([]);
          setHasMore(false);
        }
      } catch (error) {
        console.error("Failed to load history entries:", error);
        if (isFirstPage) {
          setEntries([]);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [source],
  );

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (observerEntries) => {
        const first = observerEntries[0];
        if (!first?.isIntersecting) {
          return;
        }
        const lastEntry = entriesRef.current[entriesRef.current.length - 1];
        if (lastEntry) {
          loadPage(lastEntry.id);
        }
      },
      { threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadPage, loading]);

  useEffect(() => {
    const unlisten = events.historyUpdatePayload.listen((event) => {
      const payload = event.payload as HistoryUpdatePayload;
      if (payload.action === "deleted") {
        setEntries((previous) =>
          previous.filter((entry) => entry.id !== payload.id),
        );
        return;
      }

      const incomingEntry = payload.entry as HistoryEntryWithExtras;
      if (incomingEntry.source != null && incomingEntry.source !== source) {
        return;
      }

      setEntries((previous) => {
        const next =
          payload.action === "added"
            ? [
                incomingEntry,
                ...previous.filter((entry) => entry.id !== incomingEntry.id),
              ]
            : previous.map((entry) =>
                entry.id === incomingEntry.id ? incomingEntry : entry,
              );
        return next;
      });
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [source]);

  const reloadFirstPage = useCallback(async () => {
    await loadPage();
  }, [loadPage]);

  const replaceEntry = useCallback((updatedEntry: HistoryEntryWithExtras) => {
    setEntries((previous) =>
      previous.map((entry) =>
        entry.id === updatedEntry.id ? updatedEntry : entry,
      ),
    );
  }, []);

  const toggleSaved = useCallback(
    async (id: number) => {
      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === id ? { ...entry, saved: !entry.saved } : entry,
        ),
      );

      try {
        const result = await commands.toggleHistoryEntrySaved(id);
        if (result.status !== "ok") {
          setEntries((previous) =>
            previous.map((entry) =>
              entry.id === id ? { ...entry, saved: !entry.saved } : entry,
            ),
          );
        } else {
          replaceEntry(result.data);
        }
      } catch (error) {
        console.error("Failed to toggle saved status:", error);
        setEntries((previous) =>
          previous.map((entry) =>
            entry.id === id ? { ...entry, saved: !entry.saved } : entry,
          ),
        );
      }
    },
    [replaceEntry],
  );

  const getAudioUrl = useCallback(
    async (fileName: string) => {
      try {
        const result = await commands.getAudioFilePath(fileName);
        if (result.status === "ok") {
          if (osType === "linux") {
            const fileData = await readFile(result.data);
            const blob = new Blob([fileData], { type: "audio/wav" });
            return URL.createObjectURL(blob);
          }
          return convertFileSrc(result.data, "asset");
        }
        return null;
      } catch (error) {
        console.error("Failed to get audio file path:", error);
        return null;
      }
    },
    [osType],
  );

  const deleteHistoryEntry = useCallback(
    async (id: number) => {
      setEntries((previous) => previous.filter((entry) => entry.id !== id));
      try {
        const result = await commands.deleteHistoryEntry(id);
        if (result.status !== "ok") {
          await reloadFirstPage();
        }
      } catch (error) {
        console.error("Failed to delete history entry:", error);
        await reloadFirstPage();
      }
    },
    [reloadFirstPage],
  );

  const retryHistoryEntry = useCallback(
    async (id: number) => {
      const result = await commands.retryHistoryEntryTranscription(id);
      if (result.status !== "ok") {
        throw new Error(String(result.error));
      }
      replaceEntry(result.data);
    },
    [replaceEntry],
  );

  const openRecordingsFolder = useCallback(async () => {
    try {
      const result = await commands.openRecordingsFolder();
      if (result.status !== "ok") {
        throw new Error(String(result.error));
      }
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  }, []);

  const historyContent = loading ? (
    <div className="px-4 py-3 text-center text-text/60">
      {t("settings.history.loading")}
    </div>
  ) : entries.length === 0 ? (
    <div className="px-4 py-3 text-center text-text/60">
      {source === "text"
        ? t("settings.history.textEmpty")
        : t("settings.history.empty")}
    </div>
  ) : (
    <>
      <AudioPlayerGroup>
        <div
          className={
            source === "text" ? "space-y-3" : "divide-y divide-mid-gray/20"
          }
        >
          {entries
            .filter((entry) => {
              if (source !== "text" || !searchQuery.trim()) return true;
              const q = searchQuery.toLowerCase();
              return (
                entry.transcription_text?.toLowerCase().includes(q) ||
                entry.post_processed_text?.toLowerCase().includes(q) ||
                entry.post_process_prompt?.toLowerCase().includes(q)
              );
            })
            .map((entry) =>
              source === "text" ? (
                <TextHistoryEntryComponent
                  key={entry.id}
                  entry={entry}
                  onToggleSaved={() => toggleSaved(entry.id)}
                  deleteEntry={deleteHistoryEntry}
                />
              ) : (
                <VoiceHistoryEntryComponent
                  key={entry.id}
                  entry={entry}
                  onToggleSaved={() => toggleSaved(entry.id)}
                  getAudioUrl={getAudioUrl}
                  deleteAudio={deleteHistoryEntry}
                  retryTranscription={retryHistoryEntry}
                  replaceEntry={replaceEntry}
                  showPostProcess={historyPostProcessEnabled}
                  postProcessConfigured={postProcessConfigured}
                  drawerOverrides={resolvedDrawerOverrides}
                  compareEnabled={drawer.compareEnabled}
                  compareModels={drawer.compareModels}
                  autoCopyEnhanced={historyPostProcessAutoCopy}
                  completionNotificationsEnabled={
                    completionNotificationsEnabled
                  }
                />
              ),
            )}
        </div>
      </AudioPlayerGroup>
      <div ref={sentinelRef} className="h-1" />
    </>
  );

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <div className="space-y-2">
        <div className="px-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
              {source === "text"
                ? t("settings.history.textOpsTitle")
                : t("settings.history.title")}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {source === "voice" && historyPostProcessEnabled && (
              <Button
                onClick={drawer.isOpen ? drawer.close : drawer.open}
                variant="secondary"
                size="sm"
                className="flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>{t("settings.history.drawer.title")}</span>
              </Button>
            )}
            {source === "voice" && (
              <OpenRecordingsButton
                onClick={openRecordingsFolder}
                label={t("settings.history.openFolder")}
              />
            )}
          </div>
        </div>
        {source === "text" && (
          <div className="flex items-center gap-2 px-1">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-mid-gray/10 border border-mid-gray/20">
              <Search className="w-3.5 h-3.5 text-text/30 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("settings.history.searchPlaceholder")}
                className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text/30"
              />
            </div>
          </div>
        )}
        {source === "text" ? (
          <div className="space-y-3">{historyContent}</div>
        ) : (
          <div className="bg-background border border-mid-gray/20 rounded-lg overflow-hidden">
            {historyContent}
          </div>
        )}
      </div>
      {source === "voice" && <PostProcessDrawer {...drawer} />}
    </div>
  );
};

interface VoiceHistoryEntryProps {
  entry: HistoryEntryWithExtras;
  onToggleSaved: () => void;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
  retryTranscription: (id: number) => Promise<void>;
  replaceEntry: (entry: HistoryEntryWithExtras) => void;
  showPostProcess: boolean;
  postProcessConfigured: boolean;
  drawerOverrides: ResolvedDrawerOverrides;
  compareEnabled: boolean;
  compareModels: CompareModel[];
  autoCopyEnhanced: boolean;
  completionNotificationsEnabled: boolean;
}

const VoiceHistoryEntryComponent: React.FC<VoiceHistoryEntryProps> = ({
  entry,
  onToggleSaved,
  getAudioUrl,
  deleteAudio,
  retryTranscription,
  replaceEntry,
  showPostProcess,
  postProcessConfigured,
  drawerOverrides,
  compareEnabled,
  compareModels,
  autoCopyEnhanced,
  completionNotificationsEnabled,
}) => {
  const { t, i18n } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const hasTranscription = entry.transcription_text.trim().length > 0;
  const hasEnhancedText = entry.post_processed_text != null;
  const displayText =
    hasEnhancedText && !showOriginal
      ? (entry.post_processed_text ?? entry.transcription_text)
      : entry.transcription_text;

  const handleLoadAudio = useCallback(
    () => getAudioUrl(entry.file_name),
    [entry.file_name, getAudioUrl],
  );

  const copyTextToClipboard = (text: string) => {
    if (!text.trim()) {
      return;
    }
    navigator.clipboard.writeText(text).catch((error) => {
      console.error("Failed to copy to clipboard:", error);
    });
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleCopyText = () => {
    copyTextToClipboard(displayText);
  };

  const handleDeleteEntry = async () => {
    if (!pendingDelete) {
      setPendingDelete(true);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setPendingDelete(false), 3000);
      return;
    }
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setPendingDelete(false);
    try {
      await deleteAudio(entry.id);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      toast.error(t("settings.history.deleteError"));
    }
  };

  const handleRetranscribe = async () => {
    try {
      setRetrying(true);
      await retryTranscription(entry.id);
    } catch (error) {
      console.error("Failed to re-transcribe:", error);
      toast.error(t("settings.history.retranscribeError"));
    } finally {
      setRetrying(false);
    }
  };

  const handlePostProcess = async () => {
    setIsProcessing(true);
    try {
      const result = await commands.postProcessHistoryEntry(
        entry.id,
        drawerOverrides.providerId,
        drawerOverrides.baseUrl,
        drawerOverrides.apiKey,
        drawerOverrides.modelId,
        drawerOverrides.promptText,
        true,
      );

      if (result.status === "ok") {
        replaceEntry(result.data);
        setShowOriginal(false);
        if (autoCopyEnhanced && result.data.post_processed_text) {
          copyTextToClipboard(result.data.post_processed_text);
        }
        if (completionNotificationsEnabled) {
          sendCompletionNotification(
            t("notifications.enhancementComplete.title"),
            t("notifications.enhancementComplete.body"),
          );
        }
        if (compareEnabled) {
          for (const model of compareModels.filter(
            (candidate) => candidate.enabled,
          )) {
            try {
              const comparisonResult = await commands.postProcessHistoryEntry(
                entry.id,
                model.provider,
                model.baseUrl || null,
                model.apiKey || null,
                model.model,
                drawerOverrides.promptText,
                false,
              );
              if (comparisonResult.status === "ok") {
                replaceEntry(comparisonResult.data);
              }
            } catch (error) {
              console.error(
                `Comparison model ${model.provider}/${model.model} failed:`,
                error,
              );
              toast.warning(
                t("settings.history.compareModelFailed", {
                  model: `${model.provider}/${model.model}`,
                }),
              );
            }
          }
        }
      } else {
        const errorKey: Record<string, string> = {
          HISTORY_POST_PROCESS_DISABLED: "settings.history.postProcessDisabled",
          TRANSCRIPTION_EMPTY: "settings.history.postProcessEmptyText",
          POST_PROCESS_FAILED: "settings.history.postProcessError",
        };
        toast.error(
          t(errorKey[result.error] ?? "settings.history.postProcessError"),
        );
      }
    } catch (error) {
      console.error("Failed to post-process entry:", error);
      toast.error(t("settings.history.postProcessError"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartEdit = () => {
    setEditText(displayText);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditText("");
  };

  const handleSaveEdit = async () => {
    const trimmed = editText.trim();
    if (trimmed === displayText) {
      handleCancelEdit();
      return;
    }

    const field =
      hasEnhancedText && !showOriginal ? "post_processed" : "transcription";

    try {
      const result = await commands.updateHistoryEntryText(
        entry.id,
        field,
        trimmed,
      );
      if (result.status === "error") {
        toast.error(result.error);
      } else {
        replaceEntry(result.data);
        toast.success(t("settings.history.editSaved"));
      }
    } catch (error) {
      console.error("Failed to save edit:", error);
      toast.error(t("settings.history.postProcessError"));
    } finally {
      setIsEditing(false);
      setEditText("");
    }
  };

  const handleEditKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      handleCancelEdit();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleSaveEdit();
    }
  };

  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);

  return (
    <div className="px-4 py-2 pb-5 flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <p className="min-w-0 truncate text-sm font-medium">{formattedDate}</p>
        <div className="justify-self-center">
          {hasEnhancedText && (
            <button
              onClick={() => setShowOriginal((current) => !current)}
              className="text-xs px-2 py-1 border border-text/20 rounded text-text/50 hover:text-logo-primary hover:border-logo-primary transition-colors cursor-pointer whitespace-nowrap"
            >
              {showOriginal
                ? t("settings.history.showEnhanced")
                : t("settings.history.showOriginal")}
            </button>
          )}
        </div>
        <div className="justify-self-end">
          <div className="flex items-center">
            {showPostProcess && (
              <IconButton
                onClick={handlePostProcess}
                disabled={
                  isEditing ||
                  isProcessing ||
                  !postProcessConfigured ||
                  !hasTranscription
                }
                title={
                  postProcessConfigured
                    ? t("settings.history.postProcess")
                    : t("settings.history.postProcessNotConfigured")
                }
              >
                {isProcessing ? (
                  <Loader2 width={16} height={16} className="animate-spin" />
                ) : (
                  <Sparkles width={16} height={16} />
                )}
              </IconButton>
            )}
            <IconButton
              onClick={handleStartEdit}
              disabled={isEditing || retrying}
              title={t("settings.history.editTranscription")}
            >
              <Pencil width={16} height={16} />
            </IconButton>
            <IconButton
              onClick={handleCopyText}
              disabled={!displayText.trim() || isEditing || retrying}
              title={
                hasEnhancedText
                  ? showOriginal
                    ? t("settings.history.copyOriginal")
                    : t("settings.history.copyEnhanced")
                  : t("settings.history.copyToClipboard")
              }
            >
              {showCopied ? (
                <Check width={16} height={16} />
              ) : (
                <Copy width={16} height={16} />
              )}
            </IconButton>
            <IconButton
              onClick={onToggleSaved}
              disabled={isEditing || retrying}
              active={entry.saved}
              title={
                entry.saved
                  ? t("settings.history.unsave")
                  : t("settings.history.save")
              }
            >
              <Star
                width={16}
                height={16}
                fill={entry.saved ? "currentColor" : "none"}
              />
            </IconButton>
            <IconButton
              onClick={handleRetranscribe}
              disabled={retrying || isEditing}
              title={t("settings.history.retranscribe")}
            >
              <RotateCcw
                width={16}
                height={16}
                style={
                  retrying
                    ? { animation: "spin 1s linear infinite reverse" }
                    : undefined
                }
              />
            </IconButton>
            <button
              type="button"
              onClick={handleDeleteEntry}
              disabled={isEditing || retrying}
              className={`p-1.5 rounded-md flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                pendingDelete
                  ? "bg-red-500/10 text-red-500"
                  : "text-text/50 hover:text-logo-primary"
              }`}
              title={
                pendingDelete
                  ? t("textOps.prompts.clickToConfirm")
                  : t("settings.history.delete")
              }
            >
              {pendingDelete ? (
                <span className="flex items-center gap-1 text-[11px] font-medium px-0.5">
                  <Trash2 width={14} height={14} />
                  {t("textOps.prompts.clickToConfirm")}
                </span>
              ) : (
                <Trash2 width={16} height={16} />
              )}
            </button>
          </div>
        </div>
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            onKeyDown={handleEditKeyDown}
            className="w-full text-sm text-text/90 bg-background border border-mid-gray/20 rounded-md p-2 resize-y focus:outline-none focus:border-logo-primary min-h-[60px]"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={handleCancelEdit}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveEdit}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : (
        <p
          className={`italic text-sm pb-2 whitespace-pre-wrap break-words ${
            retrying
              ? ""
              : hasTranscription
                ? "text-text/90 select-text cursor-text"
                : "text-text/40"
          }`}
          style={
            retrying
              ? { animation: "transcribe-pulse 3s ease-in-out infinite" }
              : undefined
          }
        >
          {retrying
            ? t("settings.history.transcribing")
            : hasTranscription
              ? displayText
              : t("settings.history.transcriptionFailed")}
        </p>
      )}

      {retrying && (
        <style>{`
          @keyframes transcribe-pulse {
            0%, 100% { color: color-mix(in srgb, var(--color-text) 40%, transparent); }
            50% { color: color-mix(in srgb, var(--color-text) 90%, transparent); }
          }
        `}</style>
      )}

      {(entry.version_count ?? 0) > 0 && <VersionHistory entry={entry} />}
      <AudioPlayer onLoadRequest={handleLoadAudio} className="w-full" />
    </div>
  );
};

interface TextHistoryEntryProps {
  entry: HistoryEntryWithExtras;
  onToggleSaved: () => void;
  deleteEntry: (id: number) => Promise<void>;
}

const TextHistoryEntryComponent: React.FC<TextHistoryEntryProps> = ({
  entry,
  onToggleSaved,
  deleteEntry,
}) => {
  const { t, i18n } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { createTab } = useDocumentStore();

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const handleCopy = () => {
    const text = entry.post_processed_text || entry.transcription_text;
    navigator.clipboard.writeText(text).catch((error) => {
      console.error("Failed to copy to clipboard:", error);
    });
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!pendingDelete) {
      setPendingDelete(true);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setPendingDelete(false), 3000);
      return;
    }
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setPendingDelete(false);
    try {
      await deleteEntry(entry.id);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      toast.error(t("settings.history.deleteError"));
    }
  };

  const finishRenaming = useCallback(async () => {
    const newTitle = renameValue.trim();
    if (newTitle && newTitle !== entry.title) {
      try {
        await commands.renameHistoryEntry(entry.id, newTitle);
        const tabs = useDocumentStore.getState().tabs;
        const linkedTabId = Object.keys(tabs).find(
          (id) => tabs[id]?.historyEntryId === entry.id,
        );
        if (linkedTabId) {
          await commands.renameDocumentTab(linkedTabId, newTitle);
          useDocumentStore.setState((state) => {
            const tab = state.tabs[linkedTabId];
            if (!tab) return state;
            return {
              tabs: {
                ...state.tabs,
                [linkedTabId]: { ...tab, title: newTitle },
              },
            };
          });
        }
      } catch (error) {
        console.error("Failed to rename entry:", error);
      }
    }
    setIsRenaming(false);
  }, [entry.id, entry.title, renameValue]);

  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);
  const outputText = entry.post_processed_text || entry.transcription_text;
  const versionCount = entry.version_count ?? 0;

  return (
    <div className="bg-background border border-mid-gray/20 rounded-lg overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-mid-gray/5 border-b border-mid-gray/20">
        <div className="flex items-center gap-2 min-w-0">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={finishRenaming}
              onKeyDown={(e) => {
                if (e.key === "Enter") finishRenaming();
                if (e.key === "Escape") setIsRenaming(false);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-transparent border-b border-logo-primary text-xs text-text outline-none w-[200px]"
            />
          ) : (
            <>
              <span className="text-xs text-text/50">{formattedDate}</span>
              <button
                type="button"
                onClick={() => {
                  setIsRenaming(true);
                  setRenameValue(entry.title);
                }}
                className="text-text/30 hover:text-text/60 transition-colors cursor-pointer"
                title={t("settings.history.rename")}
              >
                <Pencil className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton
            onClick={handleCopy}
            title={t("settings.history.copyToClipboard")}
          >
            {showCopied ? (
              <Check width={14} height={14} />
            ) : (
              <Copy width={14} height={14} />
            )}
          </IconButton>
          <IconButton
            onClick={onToggleSaved}
            active={entry.saved}
            title={
              entry.saved
                ? t("settings.history.unsave")
                : t("settings.history.save")
            }
          >
            <Bookmark
              width={14}
              height={14}
              fill={entry.saved ? "currentColor" : "none"}
            />
          </IconButton>
          <button
            type="button"
            onClick={handleDelete}
            className={`p-1.5 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
              pendingDelete
                ? "bg-red-500/10 text-red-500"
                : "text-text/50 hover:text-logo-primary"
            }`}
            title={
              pendingDelete
                ? t("textOps.prompts.clickToConfirm")
                : t("settings.history.delete")
            }
          >
            {pendingDelete ? (
              <span className="flex items-center gap-1 text-[11px] font-medium px-0.5">
                <Trash2 width={12} height={12} />
                {t("textOps.prompts.clickToConfirm")}
              </span>
            ) : (
              <Trash2 width={14} height={14} />
            )}
          </button>
        </div>
      </div>

      {/* Card body */}
      <div className="px-4 py-3 space-y-2.5">
        {entry.post_process_prompt && (
          <div className="flex items-start gap-1.5 rounded-md bg-mid-gray/5 px-2.5 py-1.5">
            <MessageSquare className="w-3 h-3 text-text/30 shrink-0 mt-0.5" />
            <span className="text-xs text-text/50">
              {entry.post_process_prompt}
            </span>
          </div>
        )}
        <p className="text-sm text-text/90 select-text cursor-text whitespace-pre-wrap break-words line-clamp-4">
          {outputText}
        </p>

        {/* Collapsible input */}
        {showInput && (
          <div className="rounded-md bg-mid-gray/5 border border-mid-gray/10 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-mid-gray uppercase tracking-wide">
                {t("settings.history.textInput")}
              </span>
            </div>
            <p className="text-xs italic text-text/60 select-text cursor-text whitespace-pre-wrap break-words">
              {entry.transcription_text}
            </p>
          </div>
        )}

        {/* Collapsible version history */}
        {showVersions && versionCount > 0 && <VersionHistory entry={entry} />}
      </div>

      {/* Card footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-mid-gray/20">
        <div className="flex items-center gap-3">
          {versionCount > 0 && (
            <button
              type="button"
              onClick={() => setShowVersions(!showVersions)}
              className="flex items-center gap-1 text-logo-primary cursor-pointer"
            >
              <History className="w-3 h-3" />
              <span className="text-[11px] font-medium">
                {showVersions
                  ? t("settings.history.hideVersions")
                  : `${versionCount} ${t("settings.history.versions")}`}
              </span>
              {showVersions ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowInput(!showInput)}
            className="flex items-center gap-1 text-text/40 cursor-pointer"
          >
            <span className="text-[11px]">
              {showInput
                ? t("settings.history.hideInput")
                : t("settings.history.showInput")}
            </span>
            {showInput ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={async () => {
            const text = entry.post_processed_text || entry.transcription_text;
            const tabId = await createTab(entry.title || undefined);
            if (tabId) {
              useDocumentStore.getState().updateContent(tabId, text);
              await commands.linkTabToHistoryEntry(tabId, entry.id);
              useDocumentStore.setState((state) => {
                const tab = state.tabs[tabId];
                if (!tab) return state;
                return {
                  tabs: {
                    ...state.tabs,
                    [tabId]: {
                      ...tab,
                      historyEntryId: entry.id,
                      autoLabeled: true,
                    },
                  },
                };
              });
              useSettingsStore.getState().setAppMode("text");
              useSettingsStore.getState().setCurrentSection("textOperations");
            }
          }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-mid-gray/10 border border-mid-gray/20 text-text/60 hover:text-text/80 transition-colors cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" />
          <span className="text-[11px] font-medium">
            {t("settings.history.openAsTab")}
          </span>
        </button>
      </div>
    </div>
  );
};
