import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { LLMPrompt } from "@/bindings";

interface PresetToolbarProps {
  presets: LLMPrompt[];
  onPresetClick: (prompt: LLMPrompt) => void;
  disabled: boolean;
}

const GAP_PX = 6;

export const PresetToolbar: React.FC<PresetToolbarProps> = ({
  presets,
  onPresetClick,
  disabled,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRowRef = useRef<HTMLDivElement>(null);
  const measureMoreRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(presets.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  const recalc = useCallback(() => {
    const container = containerRef.current;
    const measureRow = measureRowRef.current;
    if (!container || !measureRow) return;

    const style = getComputedStyle(container);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const available = container.clientWidth - paddingLeft - paddingRight;

    const measureBtns = Array.from(
      measureRow.querySelectorAll<HTMLButtonElement>(
        "button[data-measure='preset']",
      ),
    );
    if (measureBtns.length === 0) {
      setVisibleCount(0);
      return;
    }

    let total = 0;
    for (let i = 0; i < measureBtns.length; i++) {
      total += measureBtns[i].offsetWidth + (i > 0 ? GAP_PX : 0);
    }
    if (total <= available) {
      setVisibleCount(measureBtns.length);
      return;
    }

    const moreWidth = measureMoreRef.current?.offsetWidth ?? 64;

    let used = 0;
    let count = 0;
    for (let i = 0; i < measureBtns.length; i++) {
      const w = measureBtns[i].offsetWidth;
      const candidate = used + (i > 0 ? GAP_PX : 0) + w;
      if (candidate + GAP_PX + moreWidth > available) break;
      used = candidate;
      count = i + 1;
    }
    setVisibleCount(count);
  }, []);

  useLayoutEffect(() => {
    recalc();
  }, [recalc, presets]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => recalc());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recalc]);

  const overflowPresets = presets.slice(visibleCount);
  const hasOverflow = overflowPresets.length > 0;

  useEffect(() => {
    if (!hasOverflow && menuOpen) {
      setMenuOpen(false);
    }
  }, [hasOverflow, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        moreButtonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen || !moreButtonRef.current) return;
    const update = () => {
      const btn = moreButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth ?? 200;
      let left = rect.right - menuWidth;
      if (left < 8) left = 8;
      setMenuPos({ top: rect.bottom + 4, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [menuOpen]);

  const visiblePresets = presets.slice(0, visibleCount);

  return (
    <>
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] top-0 invisible pointer-events-none flex items-center gap-1.5"
      >
        <div ref={measureRowRef} className="flex items-center gap-1.5">
          {presets.map((preset) => (
            <button
              key={`measure-${preset.id}`}
              data-measure="preset"
              type="button"
              tabIndex={-1}
              className="px-2.5 py-1.5 rounded-md bg-mid-gray/10 border border-mid-gray/10 text-xs font-medium text-text shrink-0"
            >
              {preset.name}
            </button>
          ))}
        </div>
        <button
          ref={measureMoreRef}
          data-measure="more"
          type="button"
          tabIndex={-1}
          className="px-2.5 py-1.5 rounded-md bg-mid-gray/10 border border-mid-gray/10 text-xs font-medium text-text shrink-0 flex items-center gap-1"
        >
          <span>{t("textOps.editor.morePresets")}</span>
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex items-center w-full px-8 py-2 gap-1.5 border-b border-mid-gray/20"
      >
        {visiblePresets.map((preset) => (
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
        {hasOverflow && (
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-md bg-mid-gray/10 border border-mid-gray/10 text-xs font-medium text-text hover:bg-mid-gray/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 flex items-center gap-1"
          >
            <span>{t("textOps.editor.morePresets")}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
      </div>

      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          className="fixed bg-background border border-mid-gray/40 rounded-lg shadow-lg z-50 p-1 flex flex-col gap-0.5 min-w-[160px] max-h-80 overflow-y-auto"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {overflowPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onPresetClick(preset);
                setMenuOpen(false);
              }}
              disabled={disabled}
              className="text-left px-2.5 py-1.5 rounded-md text-xs font-medium text-text hover:bg-mid-gray/15 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {preset.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
};
