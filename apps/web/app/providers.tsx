"use client";

import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ConfirmationDialog } from "@/components/shared/ConfirmationDialog";
import { ConfigBanner } from "@/components/shared/ConfigBanner";
import { useAccountChangeRefresh } from "@/hooks/useAccountChangeRefresh";

function AccountChangeRefresh() {
  useAccountChangeRefresh();
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 4000,
          },
        },
      }),
  );

  useEffect(() => {
    (
      window as Window & { __reactQueryClient?: QueryClient }
    ).__reactQueryClient = queryClient;
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <AccountChangeRefresh />
      <ConfigBanner />
      {children}
      <ConfirmationDialog />
      <Toaster
        containerAriaLabel="Notifications"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#0d131a",
            border: "1px solid #1a2330",
            color: "#e2e8f0",
            fontFamily: "ui-monospace, monospace",
          },
        }}
      />
    </QueryClientProvider>
  );
}
