interface PoolPauseNoticeProps {
  paused: boolean | undefined;
  isLoading: boolean;
  error: unknown;
}

export function PoolPauseNotice({
  paused,
  isLoading,
  error,
}: PoolPauseNoticeProps) {
  if (isLoading) {
    return (
      <p
        role="status"
        className="rounded border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-200"
      >
        Checking the pool contract pause state before enabling actions…
      </p>
    );
  }

  if (error || paused === undefined) {
    return (
      <p
        role="alert"
        className="rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
      >
        The pool pause state could not be verified. Deposits and withdrawals are
        disabled until the contract status can be read.
      </p>
    );
  }

  if (paused) {
    return (
      <p
        role="alert"
        className="rounded border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
      >
        The pool is paused. Deposits, withdrawals, invoice funding, and other
        state-changing pool calls are unavailable until the pool is resumed.
      </p>
    );
  }

  return (
    <p
      role="status"
      className="rounded border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100"
    >
      The pool is active. Deposits and withdrawals are currently available,
      subject to liquidity and contract checks.
    </p>
  );
}
