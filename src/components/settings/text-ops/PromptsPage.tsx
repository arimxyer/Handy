import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { commands } from "@/bindings";
import { Textarea } from "@/components/ui";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { useSettings } from "../../../hooks/useSettings";
import { BUILTIN_PRESET_COUNT } from "./promptUtils";

export const PromptsPage: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();

  const allPrompts = getSetting("text_ops_prompts") || [];
  const presets = allPrompts.slice(0, BUILTIN_PRESET_COUNT);
  const customPrompts = allPrompts.slice(BUILTIN_PRESET_COUNT);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const startEdit = useCallback(
    (id: string) => {
      const prompt = allPrompts.find((p) => p.id === id);
      if (!prompt) return;
      setEditingId(id);
      setIsCreating(false);
      setDraftName(prompt.name);
      setDraftText(prompt.prompt);
      setPendingDeleteId(null);
    },
    [allPrompts],
  );

  const startCreate = useCallback(() => {
    setIsCreating(true);
    setEditingId(null);
    setDraftName("");
    setDraftText("");
    setPendingDeleteId(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setIsCreating(false);
    setDraftName("");
    setDraftText("");
  }, []);

  const handleSave = useCallback(async () => {
    if (!draftName.trim() || !draftText.trim()) return;
    if (isCreating) {
      const result = await commands.addTextOpsPrompt(
        draftName.trim(),
        draftText.trim(),
      );
      if (result.status === "ok") {
        await refreshSettings();
        setIsCreating(false);
      }
    } else if (editingId) {
      await commands.updateTextOpsPrompt(
        editingId,
        draftName.trim(),
        draftText.trim(),
      );
      await refreshSettings();
      setEditingId(null);
    }
    setDraftName("");
    setDraftText("");
  }, [draftName, draftText, isCreating, editingId, refreshSettings]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (pendingDeleteId !== id) {
        setPendingDeleteId(id);
        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
        deleteTimerRef.current = setTimeout(
          () => setPendingDeleteId(null),
          3000,
        );
        return;
      }
      await commands.deleteTextOpsPrompt(id);
      await refreshSettings();
      setPendingDeleteId(null);
      if (editingId === id) cancelEdit();
    },
    [pendingDeleteId, editingId, refreshSettings, cancelEdit],
  );

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <div className="space-y-2">
        <div className="px-4 flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
            {t("textOps.prompts.libraryTitle")}
          </h2>
          <Button
            onClick={startCreate}
            variant="secondary"
            size="sm"
            disabled={isCreating}
            className="inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("textOps.prompts.createNew")}
          </Button>
        </div>
      </div>

      {/* Built-in presets */}
      <div className="space-y-2">
        <div className="px-4">
          <h3 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
            {t("textOps.prompts.builtInGroup")}
          </h3>
        </div>
        <div className="bg-background border border-mid-gray/20 rounded-lg overflow-hidden">
          <div className="divide-y divide-mid-gray/20">
            {presets.map((prompt) => (
              <div
                key={prompt.id}
                className="px-4 py-2.5 flex flex-col gap-0.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate min-w-0">
                    {prompt.name}
                  </span>
                  <span className="text-[11px] bg-logo-primary/10 text-logo-primary px-2 py-0.5 rounded shrink-0">
                    {t("textOps.prompts.builtInBadge")}
                  </span>
                </div>
                <p className="text-xs text-text/60 line-clamp-2 whitespace-pre-wrap break-words">
                  {prompt.prompt}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Custom prompts */}
      <div className="space-y-2">
        <div className="px-4">
          <h3 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
            {t("textOps.prompts.customGroup")}
          </h3>
        </div>
        <div className="bg-background border border-mid-gray/20 rounded-lg overflow-hidden">
          {/* Inline create form */}
          {isCreating && (
            <div className="border-l-[3px] border-logo-primary bg-logo-primary/5 px-4 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-background-ui" />
                  <span className="text-xs font-semibold text-background-ui">
                    {t("textOps.prompts.newPrompt")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="text-xs font-medium text-text/80 cursor-pointer"
                  >
                    {t("textOps.prompts.cancel")}
                  </button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    disabled={!draftName.trim() || !draftText.trim()}
                  >
                    {t("textOps.prompts.createPrompt")}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-text/60">
                  {t("textOps.prompts.promptLabel")}
                </label>
                <Input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder={t("textOps.prompts.promptLabelPlaceholder")}
                  variant="compact"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-text/60">
                  {t("textOps.prompts.promptInstructions")}
                </label>
                <Textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder={t(
                    "textOps.prompts.promptInstructionsPlaceholder",
                  )}
                />
                <p className="text-[10px] text-text/40">
                  {t("textOps.prompts.promptTip")}
                </p>
              </div>
            </div>
          )}

          {customPrompts.length === 0 && !isCreating ? (
            <div className="px-4 py-3 text-center text-text/60 text-sm">
              {t("textOps.prompts.createFirst")}
            </div>
          ) : (
            <div className="divide-y divide-mid-gray/20">
              {customPrompts.map((prompt) => {
                const isEditing = editingId === prompt.id;
                const isDeleting = pendingDeleteId === prompt.id;

                if (isEditing) {
                  return (
                    <div
                      key={prompt.id}
                      className="border-l-[3px] border-logo-primary bg-logo-primary/5 px-4 py-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Pencil className="w-3.5 h-3.5 text-background-ui" />
                          <span className="text-xs font-semibold text-background-ui">
                            {t("textOps.prompts.editing")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="text-xs font-medium text-text/80 cursor-pointer"
                          >
                            {t("textOps.prompts.cancel")}
                          </button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleSave}
                            disabled={
                              !draftName.trim() || !draftText.trim()
                            }
                          >
                            {t("textOps.prompts.savePrompt")}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-text/60">
                          {t("textOps.prompts.promptLabel")}
                        </label>
                        <Input
                          type="text"
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          placeholder={t(
                            "textOps.prompts.promptLabelPlaceholder",
                          )}
                          variant="compact"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-text/60">
                          {t("textOps.prompts.promptInstructions")}
                        </label>
                        <Textarea
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          placeholder={t(
                            "textOps.prompts.promptInstructionsPlaceholder",
                          )}
                        />
                        <p className="text-[10px] text-text/40">
                          {t("textOps.prompts.promptTip")}
                        </p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={prompt.id}
                    className="px-4 py-2.5 flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate min-w-0">
                        {prompt.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(prompt.id)}
                          className="p-1 rounded text-text/50 hover:text-text hover:bg-mid-gray/10 transition-colors cursor-pointer"
                          title={t("textOps.prompts.editPrompt")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(prompt.id)}
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            isDeleting
                              ? "bg-red-500/10 text-red-500"
                              : "text-text/50 hover:text-text hover:bg-mid-gray/10"
                          }`}
                          title={
                            isDeleting
                              ? t("textOps.prompts.clickToConfirm")
                              : t("textOps.prompts.deletePrompt")
                          }
                        >
                          {isDeleting ? (
                            <span className="flex items-center gap-1 text-[11px] font-medium px-1">
                              <Trash2 className="w-3 h-3" />
                              {t("textOps.prompts.clickToConfirm")}
                            </span>
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-text/60 line-clamp-2 whitespace-pre-wrap break-words">
                      {prompt.prompt}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
