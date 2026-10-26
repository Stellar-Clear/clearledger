"use client";

import React from "react";
import { describeDeliveryConfirmation } from "@/lib/deliveryConfirmation";
import type { Invoice } from "@/types";

function PartyRow({ party, confirmed }: { party: "Issuer" | "Buyer"; confirmed: boolean }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="text-slate-400">{party}</span>
      <span className={confirmed ? "font-bold text-emerald-400" : "text-slate-500"}>
        {confirmed ? "Confirmed delivery" : "Not confirmed"}
      </span>
    </li>
  );
}

export function DeliveryConfirmationStatus({ invoice }: { invoice: Invoice }) {
  const status = describeDeliveryConfirmation(invoice);

  return (
    <section aria-labelledby="delivery-confirmation-title" className="space-y-2 text-xs font-mono">
      <h4 id="delivery-confirmation-title" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Delivery confirmation
      </h4>
      <ul className="space-y-1">
        <PartyRow party="Issuer" confirmed={status.issuerConfirmed} />
        <PartyRow party="Buyer" confirmed={status.buyerConfirmed} />
      </ul>
      <p role="status" className="text-slate-300">
        {status.nextAction}
      </p>
    </section>
  );
}
