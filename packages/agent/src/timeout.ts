/** Error raised when an operation exceeds its time budget. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not finish within ${Math.round(ms / 1000)} s.`);
    this.name = "TimeoutError";
  }
}

/** Rejects with `TimeoutError` when `promise` does not settle within `ms`; the underlying work is not cancelled. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
