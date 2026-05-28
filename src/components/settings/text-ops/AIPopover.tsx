import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, ChevronDown, Sparkles } from "lucide-react";
import type { LLMPrompt } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { useTextOpsProviderState } from "./useTextOpsProviderState";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";

interface AIPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (instruction: string) => void;
  onAccept: () => void;
  onRevert: () => void;
  pendingResult: {
    instruction: string;
    modelLabel: string;
  } | null;
  recentPresets: LLMPrompt[];
  onPresetClick: (prompt: LLMPrompt) => void;
  documentAreaRef?: React.RefObject<HTMLDivElement | null>;
}

const POSITION_CLASSES: Record<string, string> = {
  bottom_center: "fixed bottom-6 left-1/2 -translate-x-1/2",
  bottom_left: "fixed bottom-6 left-[176px]",
  bottom_right: "fixed bottom-6 right-6",
};

export const AIPopover: React.FC<AIPopoverProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onAccept,
  onRevert,
  pendingResult,
  recentPresets,
  onPresetClick,
  documentAreaRef,
}) => {
  const { t } = useTranslation();
  const [instruction, setInstruction] = useState("");
  const [showModelSelector, setShowModelSelector] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const providerState = useTextOpsProviderState();
  const { getSetting } = useSettings();

  const aiPosition = (getSetting("text_ops_ai_position") as string) ?? "bottom_center";
  let positionClass = POSITION_CLASSES[aiPosition] ?? POSITION_CLASSES.bottom_center;
  let topStyle: number | undefined;
  if (aiPosition === "top_center" && documentAreaRef?.current) {
    const rect = documentAreaRef.current.getBoundingClientRect();
    topStyle = rect.top + 8;
    positionClass = "fixed left-1/2 -translate-x-1/2";
  }

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = () => {
    if (!instruction.trim()) return;
    onSubmit(instruction.trim());
    setInstruction("");
  };

  if (!isOpen) return null;

  return (
    <div
      className={`${positionClass} w-[min(580px,calc(100%-200px))] bg-background border border-mid-gray/40 rounded-lg shadow-lg overflow-hidden z-50`}
      style={topStyle !== undefined ? { top: topStyle } : undefined}
    >
      {/* Accept/revert bar */}
      {pendingResult && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-logo-primary/5 border-b border-logo-primary/15">
          <div className="flex items-center gap-1.5">
            <Check className="w-3 h-3 text-background-ui" />
            <span className="text-[11px] text-text/60">
              {t("textOps.editor.changesApplied")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRevert}
              className="px-2 py-0.5 rounded text-[11px] font-medium text-text/60 hover:text-text/80 cursor-pointer"
            >
              {t("textOps.editor.revert")}
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="px-2 py-0.5 rounded bg-background-ui text-[11px] font-medium text-white cursor-pointer"
            >
              {t("textOps.editor.accept")}
            </button>
          </div>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles className="w-3.5 h-3.5 text-background-ui shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder={
            pendingResult
              ? t("textOps.editor.askAnother")
              : t("textOps.editor.describeWhatToDo")
          }
          className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text/30"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!instruction.trim()}
          className="p-1 rounded bg-background-ui text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Preset chips */}
      {recentPresets.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 pb-2">
          {recentPresets.slice(0, 3).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPresetClick(preset)}
              className="px-2 py-0.5 rounded-full bg-mid-gray/10 text-[10px] text-text/50 hover:text-text/70 cursor-pointer"
            >
              {preset.name}
            </button>
          ))}
        </div>
      )}

      {/* Model selector */}
      <div className="border-t border-mid-gray/20 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setShowModelSelector((prev) => !prev)}
          className="flex items-center gap-1 text-[10px] text-text/40 hover:text-text/60 transition-colors cursor-pointer"
        >
          <span>
            {providerState.isAppleProvider
              ? providerState.selectedProvider?.label
              : providerState.model.trim()
                ? `${providerState.selectedProvider?.label} / ${providerState.model.trim()}`
                : providerState.selectedProvider?.label}
          </span>
          <ChevronDown
            className={`w-2.5 h-2.5 transition-transform ${showModelSelector ? "rotate-180" : ""}`}
          />
        </button>
        {showModelSelector && !providerState.isAppleProvider && (
          <div className="flex items-center gap-2 mt-1.5">
            <ProviderSelect
              options={providerState.providerOptions}
              value={providerState.selectedProviderId}
              onChange={providerState.handleProviderSelect}
            />
            <ModelSelect
              value={providerState.model}
              options={providerState.modelOptions}
              disabled={providerState.isModelUpdating}
              isLoading={providerState.isFetchingModels}
              placeholder={t("textOps.editor.changeModel")}
              onSelect={providerState.handleModelSelect}
              onCreate={providerState.handleModelCreate}
              onBlur={() => {}}
              className="min-w-0 flex-1"
            />
          </div>
        )}
      </div>
    </div>
  );
};
