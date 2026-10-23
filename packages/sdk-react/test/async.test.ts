import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAsyncQuery, useAsyncMutation } from "../src/async.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAsyncQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores a slow response from the previous dependency after a reconnect", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queryFn = vi.fn((key: string) => (key === "a" ? first.promise : second.promise));

    const { result, rerender } = renderHook(({ key }) => useAsyncQuery(() => queryFn(key), [key]), {
      initialProps: { key: "a" },
    });
    rerender({ key: "b" });

    await act(async () => {
      second.resolve("from b");
      first.resolve("from a");
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBe("from b");
    expect(result.current.error).toBeNull();
  });

  it("does not refetch when re-rendered with the same dependencies", async () => {
    const queryFn = vi.fn(async () => "value");
    const { result, rerender } = renderHook(() => useAsyncQuery(queryFn, ["same"]));

    await waitFor(() => expect(result.current.data).toBe("value"));
    rerender();
    rerender();

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("drops a response that arrives after unmount without logging an error", async () => {
    const pending = deferred<string>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() => useAsyncQuery(() => pending.promise, ["x"]));

    unmount();
    await act(async () => {
      pending.resolve("late");
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reports an error from the latest request only", async () => {
    const stale = deferred<string>();
    const current = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }) => useAsyncQuery(() => (key === "a" ? stale.promise : current.promise), [key]),
      { initialProps: { key: "a" } },
    );
    rerender({ key: "b" });

    await act(async () => {
      stale.reject(new Error("old failure"));
      current.resolve("fresh");
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("fresh");
  });
});

describe("useAsyncMutation", () => {
  it("resolves after unmount without throwing", async () => {
    const pending = deferred<number>();
    const { result, unmount } = renderHook(() => useAsyncMutation(() => pending.promise));

    let call!: Promise<number>;
    act(() => {
      call = result.current.mutate();
    });
    unmount();
    pending.resolve(7);

    await expect(call).resolves.toBe(7);
  });
});
