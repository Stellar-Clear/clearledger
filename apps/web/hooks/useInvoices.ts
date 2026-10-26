import { useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getInvoices,
  getInvoiceByID,
  createInvoice,
  PaginatedInvoices,
} from "@/lib/api";
import { useWalletStore } from "@/store/wallet";
import { showSuccessToast } from "@/lib/toast";
import { createErrorHandler } from "@/lib/errors";
import { useTokenAllowance } from "./useTokenAllowance";
import type { AssetType } from "@/types";
import type { InvoiceClient, PoolClient } from "@clearledger/sdk";

const { handleMutationError } = createErrorHandler("useInvoices");

const invoiceContractID = process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ID || "";
const poolContractID = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID || "";

function invalidateInvoiceQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  address?: string | null,
) {
  queryClient.invalidateQueries({ queryKey: ["invoices"] });
  queryClient.invalidateQueries({ queryKey: ["poolStats"] });
  if (address) {
    queryClient.invalidateQueries({ queryKey: ["lpPosition", address] });
  }
}

export function useInvoicesList(filters?: {
  status?: string;
  issuer?: string;
  page?: number;
  limit?: number;
}) {
  const invoicesQuery = useQuery<PaginatedInvoices>({
    queryKey: ["invoices", filters],
    queryFn: ({ signal }) => getInvoices(filters, signal),
    refetchInterval: 15000,
    staleTime: 15000,
  });

  return {
    invoices: invoicesQuery.data?.data ?? [],
    total: invoicesQuery.data?.total ?? 0,
    totalPages: invoicesQuery.data?.totalPages ?? 1,
    page: invoicesQuery.data?.page ?? filters?.page ?? 1,
    limit: invoicesQuery.data?.limit ?? filters?.limit ?? 20,
    isLoading: invoicesQuery.isLoading,
    error: invoicesQuery.error,
    refetch: invoicesQuery.refetch,
  };
}

export function useInvoiceList(filters?: {
  status?: string;
  issuer?: string;
  page?: number;
  limit?: number;
}) {
  return useInvoicesList(filters);
}

export function useInvoiceActions() {
  const queryClient = useQueryClient();
  const address = useWalletStore((s) => s.address);
  const { ensureAllowance } = useTokenAllowance();

  const invoiceClientRef = useRef<InvoiceClient | null>(null);
  const poolClientRef = useRef<PoolClient | null>(null);

  const getInvoiceClient = useCallback(async () => {
    if (!invoiceClientRef.current) {
      const { InvoiceClient } = await import("@clearledger/sdk");
      invoiceClientRef.current = new InvoiceClient(invoiceContractID);
    }
    return invoiceClientRef.current;
  }, []);

  const getPoolClient = useCallback(async () => {
    if (!poolClientRef.current) {
      const { PoolClient } = await import("@clearledger/sdk");
      poolClientRef.current = new PoolClient(poolContractID);
    }
    return poolClientRef.current;
  }, []);

  const createInvoiceMutation = useMutation({
    mutationFn: async ({
      buyer,
      faceValue,
      dueDate,
      asset,
    }: {
      buyer: string;
      faceValue: string;
      dueDate: number;
      asset?: AssetType;
    }) => {
      return createInvoice(buyer, faceValue, dueDate, asset);
    },
    onSuccess: () => {
      invalidateInvoiceQueries(queryClient, address);
      showSuccessToast("Invoice Created");
    },
    onError: (error) => {
      handleMutationError(error, "Invoice Creation Failed");
    },
  });

  const listInvoiceMutation = useMutation({
    mutationFn: async ({
      invoiceId,
      discountBps,
    }: {
      invoiceId: string;
      discountBps: number;
    }) => {
      if (!address) throw new Error("Wallet not connected");
      const client = await getInvoiceClient();
      return client.listForFinancing(invoiceId, discountBps, address);
    },
    onSuccess: () => {
      invalidateInvoiceQueries(queryClient, address);
      showSuccessToast("Invoice Listed for Financing");
    },
    onError: (error) => {
      handleMutationError(error, "Listing Failed");
    },
  });

  const fundInvoiceMutation = useMutation({
    mutationFn: async ({ invoiceId }: { invoiceId: string }) => {
      if (!address) throw new Error("Wallet not connected");
      const client = await getPoolClient();
      if (await client.getPauseState(address)) {
        throw new Error(
          "Pool is paused; invoice funding is unavailable until it is resumed",
        );
      }
      return client.fundInvoice(invoiceId, address);
    },
    onSuccess: () => {
      invalidateInvoiceQueries(queryClient, address);
      showSuccessToast("Invoice Funded");
    },
    onError: (error) => {
      handleMutationError(error, "Funding Failed");
    },
  });

  const shipInvoiceMutation = useMutation({
    mutationFn: async ({ invoiceId }: { invoiceId: string }) => {
      if (!address) throw new Error("Wallet not connected");
      const client = await getInvoiceClient();
      return client.markShipped(invoiceId, address);
    },
    onSuccess: () => {
      invalidateInvoiceQueries(queryClient, address);
      showSuccessToast("Invoice Shipped");
    },
    onError: (error) => {
      handleMutationError(error, "Shipping Failed");
    },
  });

  const confirmDeliveryMutation = useMutation({
    mutationFn: async ({ invoiceId }: { invoiceId: string }) => {
      if (!address) throw new Error("Wallet not connected");
      const invoice = await getInvoiceByID(invoiceId);
      const client = await getInvoiceClient();
      return client.confirmDelivery(invoiceId, invoice.buyer, address);
    },
    onSuccess: () => {
      invalidateInvoiceQueries(queryClient, address);
      showSuccessToast("Delivery Confirmed");
    },
    onError: (error) => {
      handleMutationError(error, "Confirmation Failed");
    },
  });

  const repayInvoiceMutation = useMutation({
    mutationFn: async ({ invoiceId }: { invoiceId: string }) => {
      if (!address) throw new Error("Wallet not connected");
      const client = await getInvoiceClient();
      const invoice = await client.get(invoiceId, address);
      try {
        await ensureAllowance(invoiceContractID, invoice.faceValue);
      } catch (allowanceErr: unknown) {
        const message =
          allowanceErr instanceof Error ? allowanceErr.message : "";
        if (
          message.toLowerCase().includes("user rejected") ||
          message.toLowerCase().includes("rejected") ||
          message.toLowerCase().includes("user denied") ||
          message.toLowerCase().includes("canceled")
        ) {
          throw new Error("Allowance rejected");
        }
        throw allowanceErr;
      }
      return client.repay(invoiceId, address);
    },
    onSuccess: () => {
      invalidateInvoiceQueries(queryClient, address);
      showSuccessToast("Invoice Repaid");
    },
    onError: (error) => {
      handleMutationError(error, "Repayment Failed");
    },
  });

  const defaultInvoiceMutation = useMutation({
    mutationFn: async ({ invoiceId }: { invoiceId: string }) => {
      if (!address) throw new Error("Wallet not connected");
      const client = await getInvoiceClient();
      return client.triggerDefault(invoiceId, address);
    },
    onSuccess: () => {
      invalidateInvoiceQueries(queryClient, address);
      showSuccessToast("Invoice Defaulted");
    },
    onError: (error) => {
      handleMutationError(error, "Default Action Failed");
    },
  });

  return {
    createInvoice: createInvoiceMutation.mutateAsync,
    isCreating: createInvoiceMutation.isPending,
    createError: createInvoiceMutation.error,
    listInvoice: listInvoiceMutation.mutateAsync,
    isListing: listInvoiceMutation.isPending,
    listError: listInvoiceMutation.error,
    fundInvoice: fundInvoiceMutation.mutateAsync,
    isFunding: fundInvoiceMutation.isPending,
    fundError: fundInvoiceMutation.error,
    shipInvoice: shipInvoiceMutation.mutateAsync,
    isShipping: shipInvoiceMutation.isPending,
    shipError: shipInvoiceMutation.error,
    confirmDelivery: confirmDeliveryMutation.mutateAsync,
    isConfirming: confirmDeliveryMutation.isPending,
    confirmError: confirmDeliveryMutation.error,
    repayInvoice: repayInvoiceMutation.mutateAsync,
    isRepaying: repayInvoiceMutation.isPending,
    repayError: repayInvoiceMutation.error,
    defaultInvoice: defaultInvoiceMutation.mutateAsync,
    isDefaulting: defaultInvoiceMutation.isPending,
    defaultError: defaultInvoiceMutation.error,
  };
}

export function useCreateInvoice() {
  const actions = useInvoiceActions();
  return {
    createInvoice: actions.createInvoice,
    isCreating: actions.isCreating,
    createError: actions.createError,
  };
}

export function useListInvoice() {
  const actions = useInvoiceActions();
  return {
    listInvoice: actions.listInvoice,
    isListing: actions.isListing,
    listError: actions.listError,
  };
}

export function useFundInvoice() {
  const actions = useInvoiceActions();
  return {
    fundInvoice: actions.fundInvoice,
    isFunding: actions.isFunding,
    fundError: actions.fundError,
  };
}

export function useShipInvoice() {
  const actions = useInvoiceActions();
  return {
    shipInvoice: actions.shipInvoice,
    isShipping: actions.isShipping,
    shipError: actions.shipError,
  };
}

export function useConfirmDelivery() {
  const actions = useInvoiceActions();
  return {
    confirmDelivery: actions.confirmDelivery,
    isConfirming: actions.isConfirming,
    confirmError: actions.confirmError,
  };
}

export function useRepayInvoice() {
  const actions = useInvoiceActions();
  return {
    repayInvoice: actions.repayInvoice,
    isRepaying: actions.isRepaying,
    repayError: actions.repayError,
  };
}

export function useDefaultInvoice() {
  const actions = useInvoiceActions();
  return {
    defaultInvoice: actions.defaultInvoice,
    isDefaulting: actions.isDefaulting,
    defaultError: actions.defaultError,
  };
}

export function useInvoices(filters?: {
  status?: string;
  issuer?: string;
  page?: number;
  limit?: number;
}) {
  const list = useInvoicesList(filters);
  const actions = useInvoiceActions();

  return {
    ...list,
    createInvoice: actions.createInvoice,
    isCreating: actions.isCreating,
    createError: actions.createError,
    listInvoice: actions.listInvoice,
    isListing: actions.isListing,
    listError: actions.listError,
    fundInvoice: actions.fundInvoice,
    isFunding: actions.isFunding,
    fundError: actions.fundError,
    shipInvoice: actions.shipInvoice,
    isShipping: actions.isShipping,
    shipError: actions.shipError,
    confirmDelivery: actions.confirmDelivery,
    isConfirming: actions.isConfirming,
    confirmError: actions.confirmError,
    repayInvoice: actions.repayInvoice,
    isRepaying: actions.isRepaying,
    repayError: actions.repayError,
    defaultInvoice: actions.defaultInvoice,
    isDefaulting: actions.isDefaulting,
    defaultError: actions.defaultError,
  };
}

export function useInvoice(id: string) {
  const invoiceQuery = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => getInvoiceByID(id),
    enabled: !!id,
    staleTime: 60000,
  });

  return {
    invoice: invoiceQuery.data,
    isLoading: invoiceQuery.isLoading,
    error: invoiceQuery.error,
    refetch: invoiceQuery.refetch,
  };
}
