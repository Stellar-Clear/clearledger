import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncQueryState<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export interface AsyncMutationState<TArgs extends unknown[], TResult> {
  mutate: (...args: TArgs) => Promise<TResult>;
  isPending: boolean;
  error: Error | null;
}

/**
 * Runs an async query whenever `deps` change, exposing
 * loading/error/data state plus a `refetch` trigger.
 */
export function useAsyncQuery<T>(
  queryFn: () => Promise<T>,
  deps: unknown[],
): AsyncQueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);

  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  const run = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await queryFnRef.current();
      if (currentRequest === requestId.current) setData(result);
    } catch (err) {
      if (currentRequest === requestId.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    return () => {
      // Ignore responses from the previous wallet, network, or contract.
      requestId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    isLoading,
    error,
    refetch: run,
  };
}

/**
 * Wraps a mutation function, exposing pending/error state and a `mutate`
 * caller that rethrows so callers can handle failures locally too.
 */
export function useAsyncMutation<TArgs extends unknown[], TResult>(
  mutationFn: (...args: TArgs) => Promise<TResult>,
): AsyncMutationState<TArgs, TResult> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutationFnRef = useRef(mutationFn);
  mutationFnRef.current = mutationFn;

  const mutate = useCallback(async (...args: TArgs): Promise<TResult> => {
    setIsPending(true);
    setError(null);
    try {
      return await mutationFnRef.current(...args);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  return { mutate, isPending, error };
}
