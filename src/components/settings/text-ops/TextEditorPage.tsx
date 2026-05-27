import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type LLMPrompt } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { useAutosave } from "@/hooks/useAutosave";
import { useDocumentStore } from "@/stores/documentStore";
import { TabBar } from "./TabBar";
import { EditorStatusBar } from "./EditorStatusBar";
import { PresetToolbar } from "./PresetToolbar";
import { AIPopover } from "./AIPopover";
import { BUILTIN_PRESET_COUNT } from "./promptUtils";

export const TextEditorPage: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const {
    tabs,
    activeTabId,
    tabOrder,
    isInitialized,
    initialize,
    createTab,
    updateContent,
    applyAIResult,
    acceptResult,
    revertResult,
    setProcessing,
  } = useDocumentStore();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  const activeTab = activeTabId ? tabs[activeTabId] : null;
  const allPrompts = getSetting("text_ops_prompts") || [];
  const presets = allPrompts.slice(0, BUILTIN_PRESET_COUNT);
  const autosaveEnabled = getSetting("text_ops_autosave_enabled") ?? true;
  const autosaveDelay =
    (getSetting("text_ops_autosave_delay_ms") as number) ?? 1000;

  useAutosave(
    activeTabId,
    activeTab?.content ?? "",
    autosaveEnabled as boolean,
    autosaveDelay,
  );

  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  useEffect(() => {
    if (isInitialized && tabOrder.length === 0) {
      createTab();
    }
  }, [isInitialized, tabOrder.length, createTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPopoverOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        setVersionsOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (activeTabId) {
        updateContent(activeTabId, e.target.value);
      }
    },
    [activeTabId, updateContent],
  );

  const handlePresetClick = useCallback(
    async (prompt: LLMPrompt) => {
      if (!activeTab || !activeTabId || !activeTab.content.trim()) return;
      setProcessing(activeTabId, true);
      setPopoverOpen(true);
      try {
        const result = await commands.processTextWithPrompt(
          activeTab.content,
          prompt.prompt,
          prompt.name,
        );
        if (result.status === "ok") {
          applyAIResult(activeTabId, result.data, prompt.name, prompt.prompt);
        }
      } catch {
        setProcessing(activeTabId, false);
      }
    },
    [activeTab, activeTabId, setProcessing, applyAIResult],
  );

  const handleAISubmit = useCallback(
    async (instruction: string) => {
      if (!activeTab || !activeTabId) return;
      setProcessing(activeTabId, true);
      try {
        const result = await commands.processTextWithPrompt(
          activeTab.content,
          instruction,
          null,
        );
        if (result.status === "ok") {
          applyAIResult(activeTabId, result.data, "AI", instruction);
        }
      } catch {
        setProcessing(activeTabId, false);
      }
    },
    [activeTab, activeTabId, setProcessing, applyAIResult],
  );

  const handleAccept = useCallback(() => {
    if (activeTabId) {
      acceptResult(activeTabId);
      setPopoverOpen(false);
    }
  }, [activeTabId, acceptResult]);

  const handleRevert = useCallback(() => {
    if (activeTabId) {
      revertResult(activeTabId);
      setPopoverOpen(false);
    }
  }, [activeTabId, revertResult]);

  const handleSave = useCallback(() => {
    if (activeTabId && activeTab) {
      commands.updateDocumentTab(activeTabId, activeTab.content);
    }
  }, [activeTabId, activeTab]);

  const handleCopy = useCallback(() => {
    if (activeTab) {
      navigator.clipboard.writeText(activeTab.content);
    }
  }, [activeTab]);

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-full text-text/40 text-sm">
        {t("textOps.editor.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <TabBar />

      <EditorStatusBar
        onAIClick={() => setPopoverOpen((prev) => !prev)}
        onVersionsClick={() => setVersionsOpen((prev) => !prev)}
        onSave={handleSave}
        onCopy={handleCopy}
        onModelClick={() => {
          // TODO: Navigate to TextSettings section — needs section state exposed via store/context
        }}
        versionsOpen={versionsOpen}
      />

      <PresetToolbar
        presets={[...presets, ...allPrompts.slice(BUILTIN_PRESET_COUNT)]}
        onPresetClick={handlePresetClick}
        disabled={
          !activeTab || !activeTab.content.trim() || activeTab.isProcessing
        }
      />

      {/* Document area */}
      <div className={`relative flex-1 min-h-0 ${activeTab?.isProcessing ? "border-t-2 border-logo-primary animate-pulse" : ""}`}>
        {activeTab?.isProcessing && (
          <div className="absolute top-0 left-0 right-0 flex items-center justify-center py-1.5 bg-logo-primary/5 z-10">
            <span className="text-xs text-background-ui font-medium animate-pulse">
              {t("textOps.processing")}
            </span>
          </div>
        )}
        <div className="h-full px-8 py-6 overflow-y-auto">
          <textarea
            value={activeTab?.content ?? ""}
            onChange={handleContentChange}
            disabled={activeTab?.isProcessing}
            placeholder={t("textOps.editor.placeholder")}
            className="w-full h-full border-none bg-transparent resize-none font-normal text-[15px] leading-relaxed outline-none text-text placeholder:text-text/30 disabled:opacity-50"
          />
        </div>

        <AIPopover
          isOpen={popoverOpen}
          onClose={() => setPopoverOpen(false)}
          onSubmit={handleAISubmit}
          onAccept={handleAccept}
          onRevert={handleRevert}
          pendingResult={
            activeTab?.pendingResult
              ? {
                  instruction: activeTab.pendingResult.instruction,
                  modelLabel: activeTab.pendingResult.modelLabel,
                }
              : null
          }
          recentPresets={presets.slice(0, 3)}
          onPresetClick={handlePresetClick}
        />
      </div>
    </div>
  );
};
