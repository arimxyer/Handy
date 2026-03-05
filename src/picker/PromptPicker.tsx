import { listen } from "@tauri-apps/api/event";
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
  const [isVisible, setIsVisible] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const loadPrompts = useCallback(async () => {
    const result = await commands.getAppSettings();
    if (result.status === "ok" && result.data.text_ops_prompts) {
      setPrompts(
        result.data.text_ops_prompts.map((p) => ({ id: p.id, name: p.name }))
      );
    }
  }, []);

  const handleSelect = useCallback(async (promptId: string) => {
    setIsVisible(false);
    await commands.executePickerPrompt(promptId);
  }, []);

  const handleDismiss = useCallback(async () => {
    setIsVisible(false);
    await commands.dismissPicker();
  }, []);

  useEffect(() => {
    const setup = async () => {
      const unlistenShow = await listen("show-picker", async () => {
        await syncLanguageFromSettings();
        await loadPrompts();
        setSelectedIndex(0);
        setIsVisible(true);
      });

      return () => {
        unlistenShow();
      };
    };

    setup();
  }, [loadPrompts]);

  useEffect(() => {
    if (!isVisible) return;

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
  }, [isVisible, prompts, selectedIndex, handleSelect, handleDismiss]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (!isVisible) return null;

  return (
    <div className="picker-container" onBlur={handleDismiss}>
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
