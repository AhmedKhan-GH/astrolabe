export function shouldFetchNextPage({
  lastVisibleIndex,
  loadedCount,
  hasNextPage,
  isFetchingNextPage,
}: {
  lastVisibleIndex: number
  loadedCount: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
}): boolean {
  return hasNextPage && !isFetchingNextPage && lastVisibleIndex >= Math.max(0, loadedCount - 10)
}
