"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/shared/Navbar";
import { TopStatusBar } from "@/components/shared/TopStatusBar";

const faqItems = [
  {
    id: "what-is-clearledger",
    question: "What is ClearLedger?",
    answer:
      "ClearLedger is an experimental Stellar testnet application that coordinates SMEs, trade buyers and liquidity providers around invoice terms, delivery confirmation, funding and repayment.",
  },
  {
    id: "verify-profile",
    question: "How do I verify my profile?",
    answer:
      "Connect a Stellar wallet and register an SME issuer or buyer profile from the Profile page. Registration records the profile on-chain; a designated protocol administrator must separately mark it verified before gated actions are available.",
  },
  {
    id: "profile-data",
    question: "Is my business profile information private?",
    answer:
      "No. Profile metadata is stored on the public Stellar ledger and may be copied by anyone. Use test data only; do not submit real tax identifiers, personal contact details or confidential business information.",
  },
  {
    id: "wallet-freighter",
    question: "Which wallet do I need?",
    answer:
      "You need a Stellar-compatible wallet such as Freighter to connect your account and authorize transactions. Keep your recovery phrase private; ClearLedger never needs it.",
  },
  {
    id: "invoice-tokenization",
    question: "How does invoice tokenization work?",
    answer:
      "An invoice is recorded in the Soroban contract with its issuer, buyer, amount, due date and lifecycle status. The record is used to validate financing and settlement; it does not represent fractional ownership of the invoice.",
  },
  {
    id: "discount-rate-bps",
    question: "What is the discount rate and BPS?",
    answer:
      "The discount rate sets the difference between an invoice’s face value and its financing amount. Rates are expressed in basis points: 100 bps equals 1%. Review the terms shown for each invoice.",
  },
  {
    id: "funding-flow",
    question: "How does the funding flow work?",
    answer:
      "A listed invoice may be funded from its configured pool if it meets protocol rules and sufficient liquidity is available. Funding is not guaranteed. The pool calculates proceeds from the face value and discount, and escrow coordinates the transfer.",
  },
  {
    id: "delivery-confirmation",
    question: "How does delivery confirmation work?",
    answer:
      "After the issuer marks an invoice as shipped, the invoice can move through delivery confirmation. The contract records the required confirmations before repayment settlement.",
  },
  {
    id: "lp-yield",
    question: "How do LPs earn yield?",
    answer:
      "When an invoice is repaid, the pool accounts for the repayment and applicable discount. Share value can change; returns are variable and repayment, liquidity or smart contract risks may result in losses. No return is guaranteed.",
  },
  {
    id: "network-and-risk",
    question: "Is ClearLedger ready for production?",
    answer:
      "No. ClearLedger is an experimental Stellar testnet prototype, and the contracts have not been formally audited. Use testnet assets only. Do not deposit real funds.",
  },
  {
    id: "default-handling",
    question: "What happens in case of a default?",
    answer:
      "An overdue invoice may be marked defaulted through the protocol’s contract flow. Default handling coordinates with escrow and updates pool accounting. ClearLedger does not promise recovery, collateral or arbitration.",
  },
];

interface AccordionItemProps {
  item: { id: string; question: string; answer: string };
  isOpen: boolean;
  onClick: () => void;
}

function AccordionItem({ item, isOpen, onClick }: AccordionItemProps) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-2 py-4 text-left text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onClick={onClick}
        aria-expanded={isOpen}
        aria-controls={`faq-content-${item.id}`}
        id={`faq-header-${item.id}`}
      >
        {item.question}
        <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
      </button>
      <div
        id={`faq-content-${item.id}`}
        role="region"
        aria-labelledby={`faq-header-${item.id}`}
        className={`px-2 pb-4 text-sm leading-6 text-muted-foreground ${isOpen ? "block" : "hidden"}`}
      >
        {item.answer}
      </div>
    </div>
  );
}

export default function HelpPage() {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopStatusBar />
      <Navbar />
      <main id="main-content" className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">ClearLedger help</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Frequently asked questions</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
        Learn how invoice records, participant profiles, pool funding and repayment work in the Stellar testnet preview.
      </p>

      <div className="mt-8 space-y-2 border-t border-border pt-4">
        {faqItems.map((item) => (
          <AccordionItem
            key={item.id}
            item={item}
            isOpen={openId === item.id}
            onClick={() => setOpenId(openId === item.id ? null : item.id)}
          />
        ))}
      </div>

      <section className="mt-10 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Need help getting started?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Review setup instructions and participant guides before connecting a wallet.</p>
        </div>
        <Link href="/docs" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">
          View participant guides
        </Link>
      </section>

      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        Accessibility: read the{" "}
        <a
          href="https://github.com/Stellar-Clear/clearledger/blob/main/docs/ACCESSIBILITY.md"
          className="text-primary hover:underline"
        >
          accessibility statement
        </a>{" "}
        for tested keyboard flows, known limitations and how to report a
        problem.
      </p>
      </main>
    </div>
  );
}
