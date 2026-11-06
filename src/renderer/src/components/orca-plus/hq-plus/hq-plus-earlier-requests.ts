/** Custom build (hq-plus-one-request): the person's earlier requests here go with the newest one. */
export async function closeEarlierRequests(ids: readonly string[] | undefined): Promise<void> {
  const bell = window.api.pulseBell
  if (!bell || !ids?.length) {
    return
  }
  await Promise.all(ids.map((id) => bell.markDone(id, 'done').catch(() => undefined)))
}
