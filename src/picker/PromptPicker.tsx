import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { syncLanguageFromSettings } from "@/i18n";
import "./PromptPicker.css";

interface Prompt {
  id: string;
  name: string;
}

const PromptPicker: React.FC = () => {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const loadPrompts = useCallback(async () => {
    await syncLanguageFromSettings();
    const result = await commands.getAppSettings();
    if (result.status === "ok" && result.data.text_ops_prompts) {
      setPrompts(
        result.data.text_ops_prompts.map((p) => ({ id: p.id, name: p.name })),
      );
    }
  }, []);

  const handleSelect = useCallback(async (promptId: string) => {
    await commands.executePickerPrompt(promptId);
  }, []);

  const handleDismiss = useCallback(async () => {
    await commands.dismissPicker();
  }, []);

  // Load prompts on mount and whenever the window gains focus
  useEffect(() => {
    loadPrompts();

    const setup = async () => {
      const unlistenShow = await listen("show-picker", () => {
        loadPrompts();
        setSelectedIndex(0);
      });

      const unlistenFocus = await getCurrentWindow().onFocusChanged(
        ({ payload: focused }) => {
          if (focused) {
            loadPrompts();
            setSelectedIndex(0);
          } else {
            handleDismiss();
          }
        },
      );

      return () => {
        unlistenShow();
        unlistenFocus();
      };
    };

    setup();
  }, [loadPrompts, handleDismiss]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, prompts.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (prompts[selectedIndex]) {
            handleSelect(prompts[selectedIndex].id);
          }
          break;
        case "Escape":
          e.preventDefault();
          handleDismiss();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prompts, selectedIndex, handleSelect, handleDismiss]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  return (
    <div className="picker-container">
      <div className="picker-header">{t("textOps.picker.title")}</div>
      <div className="picker-list" ref={listRef}>
        {prompts.length === 0 ? (
          <div className="picker-empty">{t("textOps.picker.empty")}</div>
        ) : (
          prompts.map((prompt, index) => (
            <div
              key={prompt.id}
              className={`picker-item ${index === selectedIndex ? "selected" : ""}`}
              onClick={() => handleSelect(prompt.id)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {prompt.name}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PromptPicker;
