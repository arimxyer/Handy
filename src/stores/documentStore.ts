import { create } from "zustand";
import { commands, type DocumentTab } from "@/bindings";

interface PendingResult {
  text: string;
  modelLabel: string;
  originalText: string;
  instruction: string;
}

interface DocumentTabState {
  id: string;
  title: string;
  content: string;
  pendingResult: PendingResult | null;
  isProcessing: boolean;
  isDirty: boolean;
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
  acceptResult: (id: string) => void;
  revertResult: (id: string) => void;
}

function documentTabFromBackend(tab: DocumentTab): DocumentTabState {
  return {
    id: tab.id,
    title: tab.title,
    content: tab.content,
    pendingResult: null,
    isProcessing: false,
    isDirty: false,
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
    }
  },

  createTab: async (title) => {
    const result = await commands.createDocumentTab(title ?? null);
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

  acceptResult: (id) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab) return state;
      return {
        tabs: {
          ...state.tabs,
          [id]: { ...tab, pendingResult: null },
        },
      };
    });
  },

  revertResult: (id) => {
    set((state) => {
      const tab = state.tabs[id];
      if (!tab?.pendingResult) return state;
      return {
        tabs: {
          ...state.tabs,
          [id]: {
            ...tab,
            content: tab.pendingResult.originalText,
            pendingResult: null,
          },
        },
      };
    });
  },
}));
