import { useState, useCallback, useRef } from "react";
import type { LLMPrompt } from "@/bindings";

export function usePromptEditDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPromptText, setEditPromptText] = useState("");

  const originalName = useRef("");
  const originalPromptText = useRef("");

  const isDirty =
    editName.trim() !== originalName.current ||
    editPromptText.trim() !== originalPromptText.current.trim();

  const loadPromptForEdit = useCallback((prompt: LLMPrompt) => {
    setEditingPromptId(prompt.id);
    setEditName(prompt.name);
    setEditPromptText(prompt.prompt);
    originalName.current = prompt.name;
    originalPromptText.current = prompt.prompt;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setEditingPromptId(null);
    setEditName("");
    setEditPromptText("");
    originalName.current = "";
    originalPromptText.current = "";
  }, []);

  return {
    isOpen,
    close,
    editingPromptId,
    editName,
    setEditName,
    editPromptText,
    setEditPromptText,
    isDirty,
    loadPromptForEdit,
  };
}
