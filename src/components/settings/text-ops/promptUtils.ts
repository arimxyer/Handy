export const BUILTIN_PRESET_COUNT = 8;

export function isBuiltInPrompt(
  promptId: string,
  allPrompts: { id: string }[],
): boolean {
  const index = allPrompts.findIndex((p) => p.id === promptId);
  return index >= 0 && index < BUILTIN_PRESET_COUNT;
}
