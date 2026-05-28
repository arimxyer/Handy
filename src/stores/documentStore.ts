import { create } from "zustand";
import { commands, type DocumentTab } from "@/bindings";

interface PendingResult {
  text: string;
  modelLabel: string;
  originalText: string;
  instruction: string;
}

interface PreviewVersion {
  text: string;
  label: string;
}

interface DocumentTabState {
  id: string;
  title: string;
  content: string;
  pendingResult: PendingResult | null;
  isProcessing: boolean;
  isDirty: boolean;
  historyEntryId: number | null;
  autoLabeled: boolean;
  previewVersion: PreviewVersion | null;
}

interface DocumentStore {
  tabs: Record<string, DocumentTabState>;
  activeTabId: string | null;
  tabOrder: string[];
  isInitialized: boolean;

  initialize: () => Promise<void>;
  createTab: (title?: string) => Promise<string | null>;
  closeTab: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  renameTab: (id: string, title: string) => Promise<void>;
  setProcessing: (id: string, processing: boolean) => void;
  applyAIResult: (
    id: string,
    result: string,
    modelLabel: string,
    instruction: string,
  ) => void;
  acceptResult: (id: string) => Promise<void>;
  revertResult: (id: string) => Promise<void>;
  autoCheckpoint: (id: string) => Promise<void>;
  setPreviewVersion: (id: string, preview: PreviewVersion | null) => void;
}

function documentTabFromBackend(tab: DocumentTab): DocumentTabState {
  return {
    id: tab.id,
    title: tab.title,
    content: tab.content,
    pendingResult: null,
    isProcessing: false,
    isDirty: false,
    historyEntryId: tab.history_entry_id ?? null,
    autoLabeled: tab.auto_labeled ?? false,
    previewVersion: null,
  };
}

export const useDocumentStore = create<DocumentStore>()((set, get) => ({
  tabs: {},
  activeTabId: null,
  tabOrder: [],
  isInitialized: false,

  initialize: async () => {
    const result = await commands.getOpenTabs();
    if (result.status === "ok") {
      const tabs: Record<string, DocumentTabState> = {};
      const tabOrder: string[] = [];
      for (const tab of result.data) {
        tabs[tab.id] = documentTabFromBackend(tab);
        tabOrder.push(tab.id);
      }
      set({
        tabs,
        tabOrder,
        activeTabId: tabOrder[0] ?? null,
        isInitialized: true,
      });

      for (const tab of result.data) {
        if (tab.history_entry_id == null || !tab.content.trim()) continue;
        try {
          const versionsResult = await commands.getTranscriptionVersions(
            tab.history_entry_id,
          );
          if (versionsResult.status !== "ok" || versionsResult.data.length === 0)
            continue;
          const latest =
            versionsResult.data[versionsResult.data.length - 1];
          if (latest.text !== tab.content && tab.updated_at > latest.timestamp) {
            await commands.saveTabVersion(
              tab.id,
              tab.content,
              "Recovered",
              "Recovered",
            );
          }
        } catch {
          // Best-effort crash recovery
        }
      }
    }
  },

  createTab: async (title) => {
    const effectiveTitle = title ?? new Intl.DateTimeFormat(navigator.language, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date());
    const result = await commands.createDocumentTab(effectiveTitle);
    if (result.status !== "ok") return null;

    const tab = documentTabFromBackend(result.data);
    set((state) => ({
      tabs: { ...state.tabs, [tab.id]: tab },
      tabOrder: [...state.tabOrder, tab.id],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  closeTab: async (id) => {
    const { tabs, tabOrder, activeTabId } = get();
    const tab = tabs[id];
    if (!tab) return;

    const archive = tab.content.trim().length > 0;
    await commands.closeDocumentTab(id, archive);

    const newTabOrder = tabOrder.filter((tid) => tid !== id);
    const newTabs = { ...tabs };
    delete newTabs[id];

    let newActiveId = activeTabId;
    if (activeTabId === id) {
      const closedIndex = tabOrder.indexOf(id);
      newActiveId =
        newTabOrder[Math.min(closedIndex, newTabOrder.length - 1)] ?? null;
    }

    set({
      tabs: newTabs,
      tabOrder: newTabOrder,
      activeTabId: newActiveId,
    });
  },

  setActiveTab: (id) => {
    set({ activeTabId: id });
  },

  updateContent: (id, content) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return {
        tabs: {
          ...state.tabs,
          [id]: { ...tab, content, isDirty: true },
        },
      };
    });
  },

  renameTab: async (id, title) => {
    await commands.renameDocumentTab(id, title);
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return {
        tabs: { ...state.tabs, [id]: { ...tab, title } },
      };
    });
  },

  setProcessing: (id, processing) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return {
        tabs: { ...state.tabs, [id]: { ...tab, isProcessing: processing } },
      };
    });
  },

  applyAIResult: (id, result, modelLabel, instruction) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return {
        tabs: {
          ...state.tabs,
          [id]: {
            ...tab,
            content: result,
            pendingResult: {
              text: result,
              modelLabel,
              originalText: tab.content,
              instruction,
            },
            isProcessing: false,
            isDirty: true,
          },
        },
      };
    });
  },

  setPreviewVersion: (id, preview) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return {
        tabs: { ...state.tabs, [id]: { ...tab, previewVersion: preview } },
      };
    });
  },

  autoCheckpoint: async (id) => {
    const tab = get().tabs[id];
    if (!tab?.historyEntryId) return;
    try {
      const result = await commands.getTranscriptionVersions(
        tab.historyEntryId,
      );
      if (result.status !== "ok" || result.data.length === 0) return;
      const latest = result.data[result.data.length - 1];
      if (latest.text !== tab.content) {
        await commands.saveTabVersion(
          id,
          tab.content,
          "Auto-checkpoint",
          "Auto-checkpoint",
        );
      }
    } catch {
      // Best-effort — don't block the operation
    }
  },

  acceptResult: async (id) => {
    const tab = get().tabs[id];
    if (!tab?.pendingResult) return;

    await get().autoCheckpoint(id);

    let historyEntryId = tab.historyEntryId;
    try {
      const entryResult = await commands.ensureTabHistoryEntry(
        id,
        tab.pendingResult.originalText,
      );
      if (entryResult.status === "ok") {
        historyEntryId = entryResult.data;
        await commands.saveTabVersion(
          id,
          tab.pendingResult.text,
          tab.pendingResult.instruction,
          tab.pendingResult.modelLabel,
        );
      }
    } catch {
      // Still clear pending even if version save fails
    }

    set((state) => {
      const t = state.tabs[id];
      if (!t) return state;
      return {
        tabs: {
          ...state.tabs,
          [id]: { ...t, pendingResult: null, historyEntryId },
        },
      };
    });
  },

  revertResult: async (id) => {
    const tab = get().tabs[id];
    if (!tab?.pendingResult) return;

    await get().autoCheckpoint(id);

    set((state) => {
      const t = state.tabs[id];
      if (!t?.pendingResult) return state;
      return {
        tabs: {
          ...state.tabs,
          [id]: {
            ...t,
            content: t.pendingResult.originalText,
            pendingResult: null,
          },
        },
      };
    });
  },
}));
