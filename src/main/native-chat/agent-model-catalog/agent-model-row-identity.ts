/** Custom build (native-chat-model-window-suffix): the row a pick or report names, by alias or
 *  resolved id. `claude-opus-5-5[1m]` falls back to the row resolving to `claude-opus-5-5` — the
 *  suffix picks a context window, not a model — but only after an exact pass, so a listed
 *  `opus[1m]` row still wins over `opus`. */
export function findModelRowByIdentity<T extends { id: string; resolvedModel?: string | null }>(
  rows: readonly T[],
  modelId: string
): T | undefined {
  const names = (row: T, id: string) => row.id === id || row.resolvedModel === id
  const exact = rows.find((row) => names(row, modelId))
  const base = modelId.replace(/\[[^\]]*\]$/u, '')
  return exact ?? (base === modelId ? undefined : rows.find((row) => names(row, base)))
}
