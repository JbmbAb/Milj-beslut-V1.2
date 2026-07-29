export interface ConcurrencyOptions {
  readonly signal?: AbortSignal;
  readonly stopOnError?: boolean;
}

export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  options: ConcurrencyOptions = {},
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency level must be a positive safe integer larger than 0.');
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let hasFailed = false;

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (true) {
        if (options.signal?.aborted) throw new Error('Operation aborted by user signal.');
        if (hasFailed && options.stopOnError) break;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) break;
        try {
          results[index] = await fn(items[index]!);
        } catch (err) {
          hasFailed = true;
          throw err;
        }
      }
    },
  );

  await Promise.all(workers);
  return results;
}
