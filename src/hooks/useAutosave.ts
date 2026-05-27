import { useEffect } from "react";
import { useDebouncedCallback } from "use-debounce";
import { commands } from "@/bindings";

export function useAutosave(
  tabId: string | null,
  content: string,
  enabled: boolean,
  delayMs: number,
) {
  const debouncedSave = useDebouncedCallback(
    (id: string, text: string) => {
      commands.updateDocumentTab(id, text);
    },
    delayMs,
    { maxWait: 5000 },
  );

  useEffect(() => {
    if (enabled && tabId) {
      debouncedSave(tabId, content);
    }
  }, [content, tabId, enabled, debouncedSave]);

  useEffect(() => {
    return () => {
      debouncedSave.flush();
    };
  }, [debouncedSave]);

  return { flush: debouncedSave.flush };
}
