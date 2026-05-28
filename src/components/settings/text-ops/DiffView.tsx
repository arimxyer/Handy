import React, { useMemo } from "react";
import { diffWords } from "diff";

export type DiffMode = "unified" | "split";

interface DiffViewProps {
  originalText: string;
  modifiedText: string;
  mode?: DiffMode;
}

export const DiffView: React.FC<DiffViewProps> = ({
  originalText,
  modifiedText,
  mode = "unified",
}) => {
  const parts = useMemo(
    () => diffWords(originalText, modifiedText),
    [originalText, modifiedText],
  );

  if (mode === "split") {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="whitespace-pre-wrap font-normal text-[15px] leading-relaxed text-text border-r border-mid-gray/20 pr-4">
          {parts.map((part, i) => {
            if (part.added) return null;
            if (part.removed) {
              return (
                <span
                  key={i}
                  className="bg-red-500/20 text-red-700 dark:text-red-300"
                >
                  {part.value}
                </span>
              );
            }
            return <span key={i}>{part.value}</span>;
          })}
        </div>
        <div className="whitespace-pre-wrap font-normal text-[15px] leading-relaxed text-text">
          {parts.map((part, i) => {
            if (part.removed) return null;
            if (part.added) {
              return (
                <span
                  key={i}
                  className="bg-green-500/20 text-green-700 dark:text-green-300"
                >
                  {part.value}
                </span>
              );
            }
            return <span key={i}>{part.value}</span>;
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap font-normal text-[15px] leading-relaxed text-text">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <ins
              key={i}
              className="bg-green-500/20 text-green-700 dark:text-green-300 no-underline"
            >
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del
              key={i}
              className="bg-red-500/20 text-red-700 dark:text-red-300 line-through"
            >
              {part.value}
            </del>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
};
