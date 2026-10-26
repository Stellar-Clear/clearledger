# Freighter on ClearLedger Testnet

Install the Freighter extension, select **Testnet**, and connect it from the ClearLedger wallet control. Keep the account address visible and verify the network before signing. Test XLM is required for Soroban fees; never enter a recovery phrase into the app. Set `NEXT_PUBLIC_NETWORK_PASSPHRASE` and the RPC URL from the checked-in environment example when running locally.

## If Freighter is not installed

When the extension is not detected, the wallet control shows "Freighter wallet not detected" with an **Install Freighter** link (the official page at https://www.freighter.app/, opens in a new tab) instead of **Connect Wallet**. After installing:

- The app re-checks automatically for about 20 seconds, and again whenever you return to the tab or window.
- Click **I installed it, retry** to re-check immediately.
- If it is still not detected, refresh the page so the extension can inject itself, then choose **Testnet** in Freighter and connect.

A locked wallet or a failed check is not treated as "not installed"; those surface through the normal connect flow. Developers: use `checkFreighterAvailability()` (`apps/web/lib/freighter.ts`) and `useFreighterInstallStatus()` (`apps/web/hooks/`); `isFreighterInstalled()` is unchanged.
