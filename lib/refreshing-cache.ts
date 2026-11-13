/** One value from a slow or unreliable source: fresh for `freshMs`, and served until `staleMs` old while a refresh runs or after it
    fails. Ages use a monotonic clock, so clock changes do not matter. */
export function createRefreshingCache<T>({ freshMs, staleMs, load }: { freshMs: number; staleMs: number; load: () => Promise<T> }): () => Promise<T> {
  let cache: { loadedAt: number; value: T } | undefined;
  let inflight: Promise<T> | undefined;

  async function refresh(): Promise<T> {
    try {
      const value = await load();
      cache = { loadedAt: performance.now(), value };
      return value;
    } catch (error) {
      if (cache && performance.now() - cache.loadedAt < staleMs) return cache.value;
      throw error;
    } finally {
      inflight = undefined;
    }
  }

  return async () => {
    const age = cache ? performance.now() - cache.loadedAt : Infinity;
    if (cache && age < freshMs) return cache.value;
    inflight ??= refresh();
    if (cache && age < staleMs) {
      inflight.catch(() => undefined);
      return cache.value;
    }
    return inflight;
  };
}
