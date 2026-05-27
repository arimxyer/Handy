import React, { useMemo } from "react";
import { diffWords } from "diff";

interface DiffViewProps {
  originalText: string;
  modifiedText: string;
}

export const DiffView: React.FC<DiffViewProps> = ({
  originalText,
  modifiedText,
}) => {
  const parts = useMemo(
    () => diffWords(originalText, modifiedText),
    [originalText, modifiedText],
  );

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
