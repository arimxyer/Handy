import React from "react";
import { useTranslation } from "react-i18next";
import {
  Cog,
  FlaskConical,
  History,
  Info,
  Lightbulb,
  Mic,
  Sparkles,
  Type,
  Cpu,
} from "lucide-react";
import HandyTextLogo from "./icons/HandyTextLogo";
import HandyHand from "./icons/HandyHand";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  InsightsSettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
  TextOperationsPage,
  TextSettingsPage,
} from "./settings";

export type AppMode = "voice" | "text";
export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
  mode: "voice" | "text" | "both";
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: HandyHand,
    component: GeneralSettings,
    enabled: () => true,
    mode: "voice",
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
    mode: "voice",
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
    mode: "voice",
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: (settings) => settings?.post_process_enabled ?? false,
    mode: "voice",
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
    mode: "both",
  },
  insights: {
    labelKey: "sidebar.insights",
    icon: Lightbulb,
    component: InsightsSettings,
    enabled: (settings) =>
      (settings?.experimental_enabled ?? false) &&
      (settings?.post_process_enabled ?? false),
    mode: "voice",
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
    mode: "both",
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
    mode: "both",
  },
  textOperations: {
    labelKey: "sidebar.textOperations",
    icon: Type,
    component: TextOperationsPage,
    enabled: () => true,
    mode: "text",
  },
  textSettings: {
    labelKey: "sidebar.textSettings",
    icon: Cog,
    component: TextSettingsPage,
    enabled: () => true,
    mode: "text",
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  appMode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
  appMode,
  onModeChange,
}) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(
      ([_, config]) =>
        config.enabled(settings) &&
        (config.mode === appMode || config.mode === "both"),
    )
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <div className="flex flex-col w-40 h-full border-e border-mid-gray/20 items-center px-2">
      <HandyTextLogo width={120} className="m-4" />
      <div className="flex gap-1 w-full p-1 rounded-lg bg-mid-gray/10 mb-2">
        <button
          className={`flex-1 flex items-center justify-center rounded-md p-1.5 transition-colors ${
            appMode === "voice"
              ? "bg-logo-primary/80"
              : "hover:bg-mid-gray/20 opacity-85"
          }`}
          onClick={() => onModeChange("voice")}
          title={t("sidebar.voice")}
        >
          <Mic size={16} />
        </button>
        <button
          className={`flex-1 flex items-center justify-center rounded-md p-1.5 transition-colors ${
            appMode === "text"
              ? "bg-logo-primary/80"
              : "hover:bg-mid-gray/20 opacity-85"
          }`}
          onClick={() => onModeChange("text")}
          title={t("sidebar.text")}
        >
          <Type size={16} />
        </button>
      </div>
      <div className="flex flex-col w-full items-center gap-1 pt-2 border-t border-mid-gray/20">
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <div
              key={section.id}
              className={`flex gap-2 items-center p-2 w-full rounded-lg cursor-pointer transition-colors ${
                isActive
                  ? "bg-logo-primary/80"
                  : "hover:bg-mid-gray/20 hover:opacity-100 opacity-85"
              }`}
              onClick={() => onSectionChange(section.id)}
            >
              <Icon width={24} height={24} className="shrink-0" />
              <p
                className="text-sm font-medium truncate"
                title={t(section.labelKey)}
              >
                {t(section.labelKey)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
