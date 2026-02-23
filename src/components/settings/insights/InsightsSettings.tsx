import React, { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignLeft,
  BookOpen,
  Calendar,
  Clock,
  Copy,
  Cpu,
  Check,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  List,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  commands,
  type InsightsResult,
  type InsightsSection,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { SettingContainer, SettingsGroup, ToggleSwitch } from "@/components/ui";
import { ResetButton } from "../../ui/ResetButton";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { useInsightsProviderState } from "./useInsightsProviderState";
import { formatDateTime, formatDate } from "@/utils/dateFormat";
import { toast } from "sonner";

/** Match a section icon by title keywords */
function getSectionIcon(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("filler") || lower.includes("verbal"))
    return MessageCircle;
  if (lower.includes("sentence") || lower.includes("structure"))
    return AlignLeft;
  if (
    lower.includes("topic") ||
    lower.includes("vocabular") ||
    lower.includes("word")
  )
    return BookOpen;
  if (lower.includes("prompt") || lower.includes("suggest")) return Lightbulb;
  return Sparkles;
}

/** Convert structured sections to natural-language prompt text */
function sectionsToPromptText(sections: InsightsSection[]): string {
  const instructions = sections
    .map(
      (s) =>
        `## ${s.title}\n${s.summary}\n\nInstruction: ${s.prompt_suggestion}`,
    )
    .join("\n\n");
  return `${instructions}\n\n\${output}`;
}

const DEFAULT_PROMPT_ID = "default_improve_transcriptions";

const SEVERITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const SEVERITY_STYLES: Record<string, { badge: string; bar: string }> = {
  high: {
    badge: "bg-red-500/15 text-red-400 border border-red-500/20",
    bar: "bg-red-500/10 border-b border-red-500/20",
  },
  medium: {
    badge: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
    bar: "bg-amber-500/5 border-b border-amber-500/15",
  },
  low: {
    badge: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
    bar: "bg-background border-b border-mid-gray/15",
  },
};

const FREQUENCY_STYLES: Record<string, string> = {
  "very common": "bg-red-500/10 text-red-400",
  common: "bg-amber-500/10 text-amber-400",
  occasional: "bg-emerald-500/10 text-emerald-400",
};

export const InsightsSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { getSetting, updateSetting, refreshSettings } = useSettings();
  const providerState = useInsightsProviderState();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [tokenEstimate, setTokenEstimate] = useState<number | null>(null);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(0);
  const [enhancePreview, setEnhancePreview] = useState<string | null>(null);

  // Load persisted history from settings
  const insightsHistory: InsightsResult[] =
    getSetting("insights_history") ?? [];
  const persistedResult: InsightsResult | null =
    insightsHistory[selectedHistoryIndex] ?? null;

  const insightsEntryCount = getSetting("insights_entry_count") ?? 50;
  const insightsUseAllHistory = getSetting("insights_use_all_history") ?? false;

  // Estimate tokens when scope settings change
  useEffect(() => {
    let cancelled = false;
    const estimate = async () => {
      try {
        const result = await commands.estimateInsightsTokens();
        if (!cancelled && result.status === "ok") {
          setTokenEstimate(result.data);
        }
      } catch {
        // Silently ignore — estimate is optional
      }
    };
    estimate();
    return () => {
      cancelled = true;
    };
  }, [insightsEntryCount, insightsUseAllHistory]);

  const handleEntryCountChange = useCallback(
    async (e: React.FocusEvent<HTMLInputElement>) => {
      const parsed = parseInt(e.target.value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        await updateSetting("insights_entry_count", parsed);
      }
    },
    [updateSetting],
  );

  const handleUseAllHistoryChange = useCallback(
    async (value: boolean) => {
      await updateSetting("insights_use_all_history", value);
    },
    [updateSetting],
  );

  const handleAnalyze = useCallback(async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const result = await commands.analyzeSpeechPatterns();
      if (result.status === "ok") {
        await refreshSettings();
        setSelectedHistoryIndex(0);
      } else {
        const errorMap: Record<string, string> = {
          INSIGHTS_DISABLED: "settings.insights.errors.disabled",
          NO_HISTORY_ENTRIES: "settings.insights.errors.empty",
          NO_TRANSCRIPTION_TEXTS: "settings.insights.errors.empty",
        };
        const key = errorMap[result.error] || "settings.insights.errors.failed";
        setAnalysisError(t(key));
      }
    } catch {
      setAnalysisError(t("settings.insights.errors.failed"));
    } finally {
      setIsAnalyzing(false);
    }
  }, [t, refreshSettings]);

  const handleClearHistory = useCallback(async () => {
    try {
      const result = await commands.clearInsightsHistory();
      if (result.status === "ok") {
        await refreshSettings();
        setSelectedHistoryIndex(0);
      }
    } catch {
      toast.error(t("settings.insights.errors.failed"));
    }
  }, [t, refreshSettings]);

  const handleCreatePrompt = useCallback(async () => {
    if (!persistedResult) return;
    const promptText =
      persistedResult.sections && persistedResult.sections.length > 0
        ? sectionsToPromptText(persistedResult.sections)
        : `${persistedResult.analysis}\n\n\${output}`;
    try {
      const result = await commands.addPostProcessPrompt(
        t("settings.insights.actions.generatedPromptName"),
        promptText,
      );
      if (result.status === "ok") {
        await refreshSettings();
        toast.success(t("settings.insights.actions.promptCreated"));
      }
    } catch {
      toast.error(t("settings.insights.errors.failed"));
    }
  }, [persistedResult, t, refreshSettings]);

  const handleCreatePromptFromSuggestion = useCallback(
    async (suggestion: string, sectionTitle?: string) => {
      const name = sectionTitle
        ? `Insights - ${sectionTitle}`
        : t("settings.insights.actions.generatedPromptName");
      try {
        const result = await commands.addPostProcessPrompt(
          name,
          `${suggestion}\n\n\${output}`,
        );
        if (result.status === "ok") {
          await refreshSettings();
          toast.success(t("settings.insights.actions.promptCreated"));
        }
      } catch {
        toast.error(t("settings.insights.errors.failed"));
      }
    },
    [t, refreshSettings],
  );

  const handleEnhancePrompt = useCallback(() => {
    if (!persistedResult) return;
    const prompts = getSetting("post_process_prompts") ?? [];
    const defaultPrompt = prompts.find(
      (p: { id: string }) => p.id === DEFAULT_PROMPT_ID,
    );
    const baseText = defaultPrompt?.prompt ?? "";

    let additions: string;
    if (persistedResult.sections && persistedResult.sections.length > 0) {
      additions = persistedResult.sections
        .map(
          (s: InsightsSection, i: number) => `${i + 1}. ${s.prompt_suggestion}`,
        )
        .join("\n");
    } else {
      additions = persistedResult.analysis;
    }

    const combined = `${baseText}\n\n# Additional instructions based on speech pattern analysis:\n${additions}`;
    setEnhancePreview(combined);
  }, [persistedResult, getSetting]);

  const handleSaveEnhancedPrompt = useCallback(async () => {
    if (!enhancePreview) return;
    const now = new Date().toLocaleDateString(i18n.language);
    try {
      const result = await commands.addPostProcessPrompt(
        `Improve Transcriptions - enhanced ${now}`,
        enhancePreview,
      );
      if (result.status === "ok") {
        await refreshSettings();
        setEnhancePreview(null);
        toast.success(t("settings.insights.actions.promptCreated"));
      }
    } catch {
      toast.error(t("settings.insights.errors.failed"));
    }
  }, [enhancePreview, i18n.language, t, refreshSettings]);

  const formatTokenCount = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return String(count);
  };

  const dateRange = persistedResult
    ? `${formatDate(String(persistedResult.earliest_entry_date), i18n.language)} – ${formatDate(String(persistedResult.latest_entry_date), i18n.language)}`
    : "";

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup
        title={t("settings.insights.title")}
        description={t("settings.insights.description")}
      >
        <SettingContainer
          title={t("settings.insights.api.provider")}
          description={t("settings.insights.api.description")}
          descriptionMode="tooltip"
          layout="horizontal"
          grouped={true}
        >
          <div className="flex items-center gap-2">
            <ProviderSelect
              options={providerState.providerOptions}
              value={providerState.selectedProviderId}
              onChange={providerState.handleProviderSelect}
            />
          </div>
        </SettingContainer>

        {providerState.isCustomProvider && !providerState.isAppleProvider && (
          <SettingContainer
            title={t("settings.postProcessing.api.baseUrl.title")}
            description={t("settings.postProcessing.api.baseUrl.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <div className="flex items-center gap-2">
              <BaseUrlField
                value={providerState.baseUrl}
                onBlur={providerState.handleBaseUrlChange}
                placeholder={t(
                  "settings.postProcessing.api.baseUrl.placeholder",
                )}
                disabled={providerState.isBaseUrlUpdating}
                className="min-w-[380px]"
              />
            </div>
          </SettingContainer>
        )}

        {!providerState.isAppleProvider && (
          <>
            <SettingContainer
              title={t("settings.insights.api.apiKey")}
              description={t("settings.insights.api.description")}
              layout="horizontal"
              grouped={true}
            >
              <div className="flex items-center gap-2">
                <ApiKeyField
                  value={providerState.apiKey}
                  onBlur={providerState.handleApiKeyChange}
                  placeholder={t("settings.insights.api.apiKeyPlaceholder")}
                  disabled={providerState.isApiKeyUpdating}
                  className="min-w-[280px]"
                />
              </div>
            </SettingContainer>

            <SettingContainer
              title={t("settings.insights.api.model")}
              description={t("settings.insights.api.description")}
              layout="stacked"
              grouped={true}
            >
              <div className="flex items-center gap-2">
                <ModelSelect
                  value={providerState.model}
                  options={providerState.modelOptions}
                  disabled={providerState.isModelUpdating}
                  isLoading={providerState.isFetchingModels}
                  placeholder={
                    providerState.modelOptions.length > 0
                      ? t(
                          "settings.postProcessing.api.model.placeholderWithOptions",
                        )
                      : t(
                          "settings.postProcessing.api.model.placeholderNoOptions",
                        )
                  }
                  onSelect={providerState.handleModelSelect}
                  onCreate={providerState.handleModelCreate}
                  onBlur={() => {}}
                  className="flex-1 min-w-[380px]"
                />
                <ResetButton
                  onClick={providerState.handleRefreshModels}
                  disabled={providerState.isFetchingModels}
                  ariaLabel={t(
                    "settings.postProcessing.api.model.refreshModels",
                  )}
                  className="flex h-10 w-10 items-center justify-center"
                >
                  <RefreshCcw
                    className={`h-4 w-4 ${providerState.isFetchingModels ? "animate-spin" : ""}`}
                  />
                </ResetButton>
              </div>
            </SettingContainer>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("settings.insights.scope.title")}>
        <SettingContainer
          title={t("settings.insights.scope.entryCount")}
          description={t("settings.insights.scope.title")}
          layout="horizontal"
          grouped={true}
        >
          <Input
            type="number"
            defaultValue={String(insightsEntryCount)}
            onBlur={handleEntryCountChange}
            min={1}
            disabled={insightsUseAllHistory}
            variant="compact"
            className="w-24"
          />
        </SettingContainer>

        <ToggleSwitch
          checked={insightsUseAllHistory}
          onChange={handleUseAllHistoryChange}
          label={t("settings.insights.scope.useAllHistory")}
          description={t("settings.insights.scope.title")}
          grouped={true}
        />

        {tokenEstimate != null && tokenEstimate > 0 && (
          <div className="px-4 py-2">
            <p className="text-xs text-text/50">
              {t("settings.insights.scope.tokenEstimate", {
                count: tokenEstimate,
              })}
            </p>
          </div>
        )}
      </SettingsGroup>

      <div className="px-4">
        <Button
          onClick={handleAnalyze}
          variant="primary"
          size="md"
          disabled={isAnalyzing}
          className="flex items-center gap-2"
        >
          {isAnalyzing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>
            {isAnalyzing
              ? t("settings.insights.analyzing")
              : t("settings.insights.analyze")}
          </span>
        </Button>
      </div>

      {/* Loading animation */}
      {isAnalyzing && (
        <div className="px-4">
          <div className="p-4 rounded-lg border border-mid-gray/20 bg-background">
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-logo-primary animate-bounce [animation-delay:0ms]" />
                <div className="w-2 h-2 rounded-full bg-logo-primary animate-bounce [animation-delay:150ms]" />
                <div className="w-2 h-2 rounded-full bg-logo-primary animate-bounce [animation-delay:300ms]" />
              </div>
              <p className="text-sm text-text/60">
                {t("settings.insights.processingMessage")}
              </p>
            </div>
          </div>
        </div>
      )}

      {analysisError && (
        <div className="px-4">
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400">{analysisError}</p>
          </div>
        </div>
      )}

      {persistedResult && !isAnalyzing ? (
        <SettingsGroup title={t("settings.insights.results.title")}>
          {/* History selector — only shown when there are multiple results */}
          {insightsHistory.length > 1 && (
            <div className="px-4 py-3 border-b border-mid-gray/20">
              <div className="flex items-center gap-2">
                <label className="text-xs text-text/50 shrink-0">
                  {t("settings.insights.history.label")}
                </label>
                <select
                  value={selectedHistoryIndex}
                  onChange={(e) =>
                    setSelectedHistoryIndex(Number(e.target.value))
                  }
                  className="flex-1 rounded-md border border-mid-gray/20 bg-background px-2 py-1 text-xs text-text/80"
                >
                  {insightsHistory.map((entry, idx) => (
                    <option key={idx} value={idx}>
                      {formatDateTime(String(entry.timestamp), i18n.language)} —{" "}
                      {entry.entries_analyzed}{" "}
                      {t("settings.insights.badges.entries").toLowerCase()}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleClearHistory}
                  className="p-1.5 rounded text-text/40 hover:text-red-400 transition-colors cursor-pointer"
                  title={t("settings.insights.history.clear")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Actions + metadata badges */}
          <div className="px-4 py-3 border-b border-mid-gray/20">
            <div className="flex items-center gap-2 mb-3">
              <Button
                onClick={handleCreatePrompt}
                variant="secondary"
                size="sm"
              >
                {t("settings.insights.actions.createPrompt")}
              </Button>
              <Button
                onClick={handleEnhancePrompt}
                variant="secondary"
                size="sm"
              >
                {t("settings.insights.actions.enhancePrompt")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MetadataBadge
                icon={Cpu}
                label={t("settings.insights.badges.model")}
                value={
                  persistedResult.model_name || persistedResult.provider_id
                }
              />
              <MetadataBadge
                icon={List}
                label={t("settings.insights.badges.entries")}
                value={String(persistedResult.entries_analyzed)}
              />
              <MetadataBadge
                icon={Calendar}
                label={t("settings.insights.badges.range")}
                value={dateRange}
              />
              <MetadataBadge
                icon={Clock}
                label={t("settings.insights.badges.analyzed")}
                value={formatDateTime(
                  String(persistedResult.timestamp),
                  i18n.language,
                )}
              />
            </div>
          </div>

          {/* Enhance prompt preview */}
          {enhancePreview !== null && (
            <div className="px-4 py-3 border-b border-mid-gray/20 space-y-2">
              <p className="text-xs font-medium text-text/70">
                {t("settings.insights.actions.enhancePreviewTitle")}
              </p>
              <textarea
                value={enhancePreview}
                onChange={(e) => setEnhancePreview(e.target.value)}
                rows={10}
                className="w-full rounded-md border border-mid-gray/20 bg-background px-3 py-2 text-xs text-text/80 font-mono resize-y"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveEnhancedPrompt}
                  variant="primary"
                  size="sm"
                >
                  {t("settings.insights.actions.saveEnhancedPrompt")}
                </Button>
                <Button
                  onClick={() => setEnhancePreview(null)}
                  variant="secondary"
                  size="sm"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}

          {/* Section cards (structured) or freeform fallback */}
          <div className="px-4 py-4 space-y-3">
            {persistedResult.sections && persistedResult.sections.length > 0 ? (
              [...persistedResult.sections]
                .sort(
                  (a, b) =>
                    (SEVERITY_ORDER[a.severity] ?? 3) -
                    (SEVERITY_ORDER[b.severity] ?? 3),
                )
                .map((section, i) => (
                  <SectionCard
                    key={i}
                    section={section}
                    t={t}
                    onUseAsPrompt={handleCreatePromptFromSuggestion}
                  />
                ))
            ) : (
              <FreeformResults analysis={persistedResult.analysis} />
            )}
          </div>
        </SettingsGroup>
      ) : (
        !analysisError &&
        !isAnalyzing && (
          <div className="px-4">
            <p className="text-sm text-text/50">
              {t("settings.insights.noResults")}
            </p>
          </div>
        )
      )}
    </div>
  );
};

/** Metadata badge pill */
function MetadataBadge({
  icon: Icon,
  label,
  value,
}: {
  icon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number | string }>;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-mid-gray/10 px-2.5 py-1 text-[11px]">
      <Icon className="w-3 h-3 text-text/40" />
      <span className="text-text/50">{label}:</span>
      <span className="text-text/70 font-medium">{value}</span>
    </span>
  );
}

/** Structured section card */
function SectionCard({
  section,
  t,
  onUseAsPrompt,
}: {
  section: InsightsSection;
  t: (key: string) => string;
  onUseAsPrompt: (prompt: string, sectionTitle?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const Icon = getSectionIcon(section.title);
  const severity = section.severity.toLowerCase();
  const styles = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.low;

  const handleCopy = () => {
    navigator.clipboard.writeText(section.prompt_suggestion);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-mid-gray/20 overflow-hidden">
      {/* Header bar */}
      <div className={`flex items-center gap-2 px-3 py-2.5 ${styles.bar}`}>
        <Icon className="w-4 h-4 text-text/60 shrink-0" />
        <h4 className="text-sm font-semibold text-text/90 flex-1">
          {section.title}
        </h4>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles.badge}`}
        >
          {t(`settings.insights.severity.${severity}`)}
        </span>
      </div>

      {/* Summary */}
      <div className="px-3 py-2.5">
        <p className="text-xs text-text/70 leading-relaxed">
          {section.summary}
        </p>
      </div>

      {/* Patterns */}
      {section.patterns.length > 0 && (
        <div className="px-3 pb-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-text/50 hover:text-text/70 transition-colors cursor-pointer mb-1.5"
          >
            {expanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            <span>
              {t("settings.insights.sections.patterns")} (
              {section.patterns.length})
            </span>
          </button>

          {expanded && (
            <div className="space-y-2 pl-1">
              {section.patterns.map((pattern, pi) => {
                const freqStyle =
                  FREQUENCY_STYLES[pattern.frequency] ??
                  "bg-mid-gray/10 text-text/50";
                return (
                  <div
                    key={pi}
                    className="rounded-md bg-mid-gray/5 p-2 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text/80 font-medium flex-1">
                        {pattern.pattern}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${freqStyle}`}
                      >
                        {t(`settings.insights.frequency.${pattern.frequency}`)}
                      </span>
                    </div>
                    {pattern.examples.length > 0 && (
                      <div className="space-y-0.5 pl-2">
                        {pattern.examples.map((ex, ei) => (
                          <p
                            key={ei}
                            className="text-[11px] text-text/50 italic"
                          >
                            {ex}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Prompt suggestion */}
      {section.prompt_suggestion && (
        <div className="px-3 py-2.5 border-t border-mid-gray/10 bg-logo-primary/5">
          <div className="flex items-start gap-2">
            <Lightbulb className="w-3.5 h-3.5 mt-0.5 text-logo-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-logo-primary mb-1">
                {t("settings.insights.sections.promptSuggestion")}
              </p>
              <p className="text-xs text-text/70 leading-relaxed">
                {section.prompt_suggestion}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleCopy}
                className="p-1 rounded text-text/40 hover:text-text/70 transition-colors cursor-pointer"
                title={t("common.cancel")}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() =>
                  onUseAsPrompt(section.prompt_suggestion, section.title)
                }
                className="text-[10px] text-logo-primary hover:text-logo-primary/80 transition-colors cursor-pointer whitespace-nowrap"
              >
                {t("settings.insights.sections.useAsPrompt")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Freeform fallback renderer — wraps detected sections in cards */
function FreeformResults({ analysis }: { analysis: string }) {
  const lines = analysis.split("\n");
  const elements: React.ReactNode[] = [];
  let currentSection: React.ReactNode[] = [];
  let sectionKey = 0;

  const flushSection = () => {
    if (currentSection.length > 0) {
      elements.push(
        <div
          key={`section-${sectionKey++}`}
          className="rounded-lg border border-mid-gray/20 overflow-hidden p-3 space-y-1.5"
        >
          {currentSection}
        </div>,
      );
      currentSection = [];
    }
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Numbered headings start a new section
    if (/^\d+[.)]\s/.test(trimmed)) {
      flushSection();
      currentSection.push(
        <h4 key={`h-${i}`} className="text-sm font-semibold text-text/95">
          {trimmed}
        </h4>,
      );
      return;
    }

    // Markdown headings start a new section
    if (/^#{1,3}\s/.test(trimmed)) {
      flushSection();
      currentSection.push(
        <h4 key={`h-${i}`} className="text-sm font-semibold text-text/95">
          {trimmed.replace(/^#{1,3}\s*/, "")}
        </h4>,
      );
      return;
    }

    // Bold markers
    if (/^\*\*/.test(trimmed)) {
      currentSection.push(
        <p key={`b-${i}`} className="text-sm font-medium text-text/85">
          {trimmed.replace(/\*\*/g, "")}
        </p>,
      );
      return;
    }

    // Bullet points
    if (/^[-•]/.test(trimmed)) {
      currentSection.push(
        <p
          key={`li-${i}`}
          className="text-sm text-text/80 pl-4 before:content-['•'] before:absolute before:left-0 relative"
        >
          {trimmed.replace(/^[-•]\s*/, "")}
        </p>,
      );
      return;
    }

    // Regular text
    currentSection.push(
      <p key={`p-${i}`} className="text-sm text-text/80">
        {trimmed}
      </p>,
    );
  });

  flushSection();

  return (
    <div className="prose-sm text-text/90 space-y-3 select-text cursor-text">
      {elements}
    </div>
  );
}
