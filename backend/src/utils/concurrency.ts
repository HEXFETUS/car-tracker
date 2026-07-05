/**
 * Simple bounded concurrency helper.
 * Processes an array of items with a maximum number of concurrent operations.
 */

type Task<T> = (item: T, index: number) => Promise<unknown>;

export async function concurrent<T>(
  items: T[],
  fn: Task<T>,
  concurrency: number,
): Promise<void> {
  const executing: Promise<unknown>[] = [];

  for (const [index, item] of items.entries()) {
    const task = fn(item, index);

    executing.push(task);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove settled tasks
      executing.splice(
        executing.findIndex(p => Promise.race([p, Promise.resolve()]) === p),
        1,
      );
    }
  }

  await Promise.allSettled(executing);
}