import React from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { useDocumentStore } from "@/stores/documentStore";

export const TabBar: React.FC = () => {
  const { t } = useTranslation();
  const { tabs, tabOrder, activeTabId, setActiveTab, closeTab, createTab } =
    useDocumentStore();

  return (
    <div className="flex items-center w-full border-b border-mid-gray/20 overflow-x-auto">
      {tabOrder.map((tabId) => {
        const tab = tabs[tabId];
        if (!tab) return null;
        const isActive = tabId === activeTabId;

        return (
          <button
            key={tabId}
            type="button"
            onClick={() => setActiveTab(tabId)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-r border-mid-gray/20 shrink-0 cursor-pointer transition-colors ${
              isActive
                ? "bg-background text-text"
                : "bg-mid-gray/5 text-text/50 hover:text-text/70"
            }`}
          >
            <span className="truncate max-w-[120px]">{tab.title}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tabId);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  closeTab(tabId);
                }
              }}
              className={`rounded p-0.5 transition-colors hover:bg-mid-gray/20 ${
                isActive ? "text-text/40" : "text-text/25"
              }`}
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => createTab()}
        className="flex items-center px-3 py-2 text-text/40 hover:text-text/60 transition-colors cursor-pointer"
        title={t("textOps.tabs.newTab")}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
