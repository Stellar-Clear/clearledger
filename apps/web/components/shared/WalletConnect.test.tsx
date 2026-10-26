import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WalletConnect } from "./WalletConnect";
import { useWallet } from "@/hooks/useWallet";
import { checkFreighterAvailability } from "@/lib/freighter";
import { useWalletStore } from "@/store/wallet";

const freighterApi = vi.hoisted(() => ({
  setNetwork: vi.fn(),
}));

vi.mock("@/hooks/useWallet", () => {
  const state: string = "disconnected";
  return {
    useWallet: vi.fn(() => ({
      connected: state === "connected",
      loading: state === "connecting",
      address:
        state === "connected"
          ? "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB"
          : null,
      error: state === "error" ? "Connection failed" : null,
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
    })),
  };
});

vi.mock("@/lib/freighter", () => ({
  checkFreighterAvailability: vi.fn().mockResolvedValue("installed"),
  // Issue #873's post-connect watcher; a no-op stop function keeps these
  // render tests focused on WalletConnect's own UI.
  watchFreighterChanges: vi.fn(() => () => {}),
  FreighterError: class FreighterError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "FreighterError";
      this.code = code;
    }
  },
}));

vi.mock("@stellar/freighter-api", () => ({
  setNetwork: freighterApi.setNetwork,
}));

beforeEach(() => {
  vi.clearAllMocks();
  freighterApi.setNetwork.mockReset().mockResolvedValue(undefined);
  useWalletStore.setState({ network: null });
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

describe("WalletConnect", () => {
  it("renders disconnected state", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      loading: false,
      address: null,
      error: null,
    } as any);
    render(<WalletConnect />);
    expect(screen.getByText(/Connect Wallet/i)).toBeInTheDocument();
  });

  it("renders connecting state", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      loading: true,
      address: null,
      error: null,
    } as any);
    render(<WalletConnect />);
    expect(screen.getByText(/Connecting.../i)).toBeInTheDocument();
  });

  it("renders connected state", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address: "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGBYZ",
      error: null,
    } as any);
    render(<WalletConnect />);
    expect(screen.getByText(/GACR43\.\.\.GBYZ/i)).toBeInTheDocument();
  });

  it("shows the testnet switch for an unsupported network", async () => {
    useWalletStore.setState({ network: "futurenet" });
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address: "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGBYZ",
      error: null,
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
    } as any);

    render(<WalletConnect />);

    expect(
      await screen.findByRole("button", { name: /Switch to Testnet/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Testnet$|^Mainnet$/)).not.toBeInTheDocument();
  });

  it.each([
    ["testnet", "Testnet"],
    ["mainnet", "Mainnet"],
  ])("shows the %s badge without a switch button", async (network, badge) => {
    useWalletStore.setState({ network });
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address: "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGBYZ",
      error: null,
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
    } as any);

    render(<WalletConnect />);

    expect(await screen.findByText(badge)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Switch to Testnet/i }),
    ).not.toBeInTheDocument();
  });

  it("switches to testnet, disables the button while switching, then reconnects", async () => {
    useWalletStore.setState({ network: "futurenet" });
    let resolveSwitch!: (value: unknown) => void;
    const pendingSwitch = new Promise((resolve) => {
      resolveSwitch = resolve;
    });
    const connectWallet = vi.fn();
    freighterApi.setNetwork.mockReturnValue(pendingSwitch);
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address: "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGBYZ",
      error: null,
      connectWallet,
      disconnectWallet: vi.fn(),
    } as any);

    render(<WalletConnect />);

    const switchButton = await screen.findByRole("button", {
      name: /Switch to Testnet/i,
    });
    fireEvent.click(switchButton);

    await waitFor(() =>
      expect(freighterApi.setNetwork).toHaveBeenCalledWith("TESTNET"),
    );
    expect(
      await screen.findByRole("button", { name: /SWITCHING\.\.\./i }),
    ).toBeDisabled();
    expect(connectWallet).not.toHaveBeenCalled();

    resolveSwitch(undefined);

    await waitFor(() => expect(connectWallet).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: /Switch to Testnet/i }),
    ).toBeEnabled();
  });

  it("shows the unsupported-version warning when Freighter cannot switch networks", async () => {
    useWalletStore.setState({ network: "futurenet" });
    vi.resetModules();
    vi.doMock("@stellar/freighter-api", () => ({}));
    const connectWallet = vi.fn();
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address: "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGBYZ",
      error: null,
      connectWallet,
      disconnectWallet: vi.fn(),
    } as any);

    render(<WalletConnect />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Switch to Testnet/i }),
    );

    expect(
      await screen.findByText(
        /Open Freighter, switch its network to Testnet, then reconnect your wallet/i,
      ),
    ).toBeInTheDocument();
    expect(connectWallet).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Switch to Testnet/i }),
    ).toBeEnabled();
    vi.doMock("@stellar/freighter-api", () => ({
      setNetwork: freighterApi.setNetwork,
    }));
    vi.resetModules();
  });

  it("shows network rejection details and re-enables switching", async () => {
    useWalletStore.setState({ network: "futurenet" });
    freighterApi.setNetwork.mockRejectedValue(
      new Error("Network switch denied by wallet"),
    );
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address: "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGBYZ",
      error: null,
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
    } as any);

    render(<WalletConnect />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Switch to Testnet/i }),
    );

    expect(
      await screen.findByText("Network switch denied by wallet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Switch to Testnet/i }),
    ).toBeEnabled();
  });

  it("shows errors returned by Freighter and does not reconnect", async () => {
    useWalletStore.setState({ network: "futurenet" });
    freighterApi.setNetwork.mockResolvedValue({
      error: "Freighter rejected the network change",
    });
    const connectWallet = vi.fn();
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address: "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGBYZ",
      error: null,
      connectWallet,
      disconnectWallet: vi.fn(),
    } as any);

    render(<WalletConnect />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Switch to Testnet/i }),
    );

    expect(
      await screen.findByText("Freighter rejected the network change"),
    ).toBeInTheDocument();
    expect(connectWallet).not.toHaveBeenCalled();
  });

  it("renders error state", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      loading: false,
      address: null,
      error: "Connection failed",
      errorCode: null,
    } as any);
    render(<WalletConnect />);
    expect(screen.getByText(/Connection failed/i)).toBeInTheDocument();
  });

  it("renders user-rejected message when errorCode is user_rejected", async () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      loading: false,
      address: null,
      error: "The user rejected this request.",
      errorCode: "user_rejected",
    } as any);
    render(<WalletConnect />);
    expect(
      await screen.findByText(/You cancelled the connection request/i),
    ).toBeInTheDocument();
  });

  it("renders install CTA when errorCode is not_installed", async () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      loading: false,
      address: null,
      error: "Freighter wallet is not installed",
      errorCode: "not_installed",
    } as any);
    render(<WalletConnect />);

    const installLink = await screen.findByText(/Install Freighter/i);
    expect(installLink).toBeInTheDocument();
    expect(installLink.closest("a")).toHaveAttribute(
      "href",
      "https://www.freighter.app/",
    );
  });

  it("renders generic error for errorCode unknown", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      loading: false,
      address: null,
      error: "Something went wrong",
      errorCode: "unknown",
    } as any);
    render(<WalletConnect />);
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });

  it("renders install prompt when Freighter is not installed", async () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      loading: false,
      address: null,
      error: null,
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
    } as any);
    vi.mocked(checkFreighterAvailability).mockResolvedValue("not-installed");

    render(<WalletConnect />);

    expect(await screen.findByText(/Install Freighter/i)).toBeInTheDocument();
    expect(screen.queryByText(/Connect Wallet/i)).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Install Freighter/i });
    expect(link).toHaveAttribute("href", "https://www.freighter.app/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByRole("button", { name: /I installed it, retry/i }),
    ).toBeInTheDocument();
  });

  it("shows the connect button after retry once Freighter is installed", async () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      loading: false,
      address: null,
      error: null,
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
    } as any);
    vi.mocked(checkFreighterAvailability)
      .mockResolvedValueOnce("not-installed")
      .mockResolvedValue("installed");

    render(<WalletConnect />);
    fireEvent.click(
      await screen.findByRole("button", { name: /I installed it, retry/i }),
    );

    expect(await screen.findByText(/Connect Wallet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Freighter wallet not detected/i)).toBeNull();
  });

  it("copies the wallet address when connected", async () => {
    const address = "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB";
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address,
      error: null,
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
    } as any);
    vi.mocked(checkFreighterAvailability).mockResolvedValue("installed");

    render(<WalletConnect />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Copy wallet address/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Copy wallet address/i));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(address);
  });

  it("shows an error when copying the wallet address fails", async () => {
    const address = "GACR43ILX6H4PGAOO5QKSZLU4ZJMGT3E66EAUDPLM5J6YTP4Y3PSHWGB";
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      loading: false,
      address,
      error: null,
      connectWallet: vi.fn(),
      disconnectWallet: vi.fn(),
    } as any);
    vi.mocked(checkFreighterAvailability).mockResolvedValue("installed");
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("Clipboard permission denied"),
    );

    render(<WalletConnect />);

    const copyButton = await screen.findByLabelText(/Copy wallet address/i);
    fireEvent.click(copyButton);

    expect(
      await screen.findByText(/couldn't copy wallet address/i),
    ).toBeInTheDocument();
  });
});
