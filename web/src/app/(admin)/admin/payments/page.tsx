"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMinor, formatOrderDate } from "@/lib/format";
import { services } from "@/services";
import type { PaymentRecord } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function AdminPaymentsPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data, isError, error } = useQuery({
    queryKey: ["adminPayments"],
    queryFn: () => services.adminPortal.listPaymentsAndRefunds(),
  });

  const [refundTarget, setRefundTarget] = useState<PaymentRecord | null>(null);
  const [refundDollars, setRefundDollars] = useState("5.00");
  const [refundNotes, setRefundNotes] = useState("Partial adjustment for missing item");
  const [reconciling, setReconciling] = useState(false);

  async function handleRunReconcile() {
    if (!services.adminPortal.reconcilePayments) return;
    setReconciling(true);
    try {
      const res = await services.adminPortal.reconcilePayments();
      await qc.invalidateQueries();
      pushToast(
        "success",
        `Reconciliation complete: ${res.reconciledCount} captures, ${res.processedRefundsCount} refunds processed.`
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Reconciliation failed.");
    } finally {
      setReconciling(false);
    }
  }

  if (isError) {
    return (
      <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]">
        {error instanceof Error ? error.message : "Permission refunds:approve required."}
      </div>
    );
  }

  const payments = data?.payments ?? [];
  const refunds = data?.refunds ?? [];

  async function handleIssueRefund() {
    if (!refundTarget) return;
    const minor = Math.round(Number(refundDollars) * 100);
    if (!Number.isFinite(minor) || minor <= 0) {
      pushToast("error", "Enter a valid positive refund amount.");
      return;
    }
    try {
      await services.adminPortal.issueRefund({
        orderId: refundTarget.orderId,
        amountMinor: minor,
        reasonCode: "ADMIN_ADJUSTMENT",
        notes: refundNotes,
      });
      await qc.invalidateQueries();
      pushToast("success", `Refund of ${formatMinor(minor)} processed.`);
      setRefundTarget(null);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Refund failed.");
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
            FINANCIAL LEDGER
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
            Payments, reconciliation &amp; refunds
          </h1>
        </div>
        {services.adminPortal.reconcilePayments && (
          <button
            type="button"
            disabled={reconciling}
            onClick={handleRunReconcile}
            className="px-4 py-2 rounded-xl border border-[#E8E3D5] bg-white hover:bg-[#F5F0E2] text-xs font-bold text-[#1E1F1C] disabled:opacity-50"
          >
            {reconciling ? "Reconciling..." : "Run Reconciliation & Pending Refunds"}
          </button>
        )}
      </div>

      <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E8E3D5] font-bold text-sm">
          Payment Transactions
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
              <tr>
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Provider ID</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Reconciled</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E3D5]">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-bold">{p.orderNumber}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{p.providerOrderId}</td>
                  <td className="px-4 py-3 font-bold tabular-nums">
                    {formatMinor(p.amountMinor, p.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-[#8A8880]">
                    {p.reconciledAt ? formatOrderDate(p.reconciledAt) : "Pending"}
                  </td>
                  <td className="px-4 py-3">
                    {["CAPTURED", "PARTIALLY_REFUNDED"].includes(p.status) && (
                      <button
                        type="button"
                        onClick={() => {
                          setRefundTarget(p);
                          setRefundDollars((p.amountMinor / 100).toFixed(2));
                        }}
                        className="px-3 py-1 rounded-lg border border-[#E8E3D5] hover:bg-[#F5F0E2] font-semibold"
                      >
                        Issue Refund
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E8E3D5] font-bold text-sm">
          Refund History ({refunds.length})
        </div>
        <div className="divide-y divide-[#E8E3D5]">
          {refunds.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#8A8880]">
              No refunds issued yet.
            </div>
          ) : (
            refunds.map((r) => (
              <div key={r.id} className="p-4 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold">{r.orderNumber}</span> · {r.refundType} ·{" "}
                  <span className="text-[#5E5D57]">{r.reasonCode}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold tabular-nums">
                    {formatMinor(r.amountMinor, r.currency)}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {refundTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E8E3D5] rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-base">
              Issue Refund · {refundTarget.orderNumber}
            </h3>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Refund Amount (INR ₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={refundDollars}
                onChange={(e) => setRefundDollars(e.target.value)}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Notes</label>
              <input
                type="text"
                value={refundNotes}
                onChange={(e) => setRefundNotes(e.target.value)}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefundTarget(null)}
                className="px-4 py-2 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleIssueRefund}
                className="px-4 py-2 rounded-lg bg-[#DEC146] text-xs font-bold"
              >
                Process Refund
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
