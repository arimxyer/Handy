import React from "react";
import type { LLMPrompt } from "@/bindings";

interface PresetToolbarProps {
  presets: LLMPrompt[];
  onPresetClick: (prompt: LLMPrompt) => void;
  disabled: boolean;
}

export const PresetToolbar: React.FC<PresetToolbarProps> = ({
  presets,
  onPresetClick,
  disabled,
}) => {
  return (
    <div className="flex items-center w-full px-8 py-2 gap-1.5 border-b border-mid-gray/20 overflow-x-auto">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onPresetClick(preset)}
          disabled={disabled}
          className="px-2.5 py-1.5 rounded-md bg-mid-gray/10 border border-mid-gray/10 text-xs font-medium text-text hover:bg-mid-gray/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {preset.name}
        </button>
      ))}
    </div>
  );
};
