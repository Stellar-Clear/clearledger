import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PoolPauseNotice } from "./PoolPauseNotice";

describe("PoolPauseNotice", () => {
  it("announces the active state", () => {
    render(<PoolPauseNotice paused={false} isLoading={false} error={null} />);
    expect(screen.getByRole("status").textContent).toMatch(/pool is active/i);
  });

  it("explains which actions are unavailable while paused", () => {
    render(<PoolPauseNotice paused={true} isLoading={false} error={null} />);
    expect(screen.getByRole("alert").textContent).toMatch(
      /deposits, withdrawals, invoice funding/i,
    );
  });

  it("keeps actions guarded while the status is loading or unavailable", () => {
    const { rerender } = render(
      <PoolPauseNotice paused={undefined} isLoading error={null} />,
    );
    expect(screen.getByRole("status").textContent).toMatch(
      /checking the pool contract/i,
    );

    rerender(
      <PoolPauseNotice
        paused={undefined}
        isLoading={false}
        error={new Error("RPC failed")}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /pause state could not be verified/i,
    );
  });
});
