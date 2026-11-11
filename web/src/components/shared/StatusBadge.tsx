"use client";

import type {
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
  VerificationStatus,
} from "@/services/contracts/types";

const STATUS_MAP: Record<string, { label: string; classes: string }> = {
  PENDING_PAYMENT: {
    label: "Awaiting payment",
    classes: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  },
  CONFIRMED: {
    label: "Confirmed",
    classes: "bg-[#DFF3E2] text-[#2E7D32] border-[#CBEAD0]",
  },
  RESTAURANT_ACCEPTED: {
    label: "Accepted by kitchen",
    classes: "bg-[#DFF3E2] text-[#2E7D32] border-[#CBEAD0]",
  },
  PREPARING: {
    label: "Preparing",
    classes: "bg-[#F7ECC1] text-[#6B5400] border-[#DEC146]/50",
  },
  READY_FOR_PICKUP: {
    label: "Ready for pickup",
    classes: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  },
  OUT_FOR_DELIVERY: {
    label: "Out for delivery",
    classes: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  },
  DELIVERED: {
    label: "Delivered",
    classes: "bg-[#E8F5E9] text-[#1B5E20] border-[#A5D6A7]",
  },
  CANCELLED: {
    label: "Cancelled",
    classes: "bg-[#FDECEA] text-[#C62828] border-[#FAC8C3]",
  },
  CAPTURED: {
    label: "Paid",
    classes: "bg-[#E8F5E9] text-[#1B5E20] border-[#A5D6A7]",
  },
  FAILED: {
    label: "Payment failed",
    classes: "bg-[#FDECEA] text-[#C62828] border-[#FAC8C3]",
  },
  REFUNDED: {
    label: "Refunded",
    classes: "bg-[#F5F0E2] text-[#5E5D57] border-[#D5CEBC]",
  },
  PARTIALLY_REFUNDED: {
    label: "Partially refunded",
    classes: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  },
  UNASSIGNABLE: {
    label: "Needs dispatch",
    classes: "bg-[#FDECEA] text-[#C62828] border-[#FAC8C3]",
  },
  PARTNER_ASSIGNED: {
    label: "Rider assigned",
    classes: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  },
  PICKED_UP: {
    label: "Picked up",
    classes: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  },
  APPROVED: {
    label: "Verified",
    classes: "bg-[#E8F5E9] text-[#1B5E20] border-[#A5D6A7]",
  },
  PENDING_REVIEW: {
    label: "Pending review",
    classes: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  },
  NOT_SUBMITTED: {
    label: "Onboarding skipped",
    classes: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  },
  PENDING_ACCEPTANCE: {
    label: "Invitation pending",
    classes: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
  },
  PENDING_APPROVAL: {
    label: "Accepted · Needs approval",
    classes: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  },
  PENDING_ADMIN_APPROVAL: {
    label: "Accepted · Needs admin approval",
    classes: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  },
  ACTIVE: {
    label: "Active",
    classes: "bg-[#E8F5E9] text-[#1B5E20] border-[#A5D6A7]",
  },
  DECLINED: {
    label: "Declined",
    classes: "bg-[#FDECEA] text-[#C62828] border-[#FAC8C3]",
  },
  REVOKED: {
    label: "Revoked",
    classes: "bg-[#F5F0E2] text-[#5E5D57] border-[#D5CEBC]",
  },
  REJECTED: {
    label: "Rejected",
    classes: "bg-[#FDECEA] text-[#C62828] border-[#FAC8C3]",
  },
  SUSPENDED: {
    label: "Suspended",
    classes: "bg-[#FDECEA] text-[#C62828] border-[#FAC8C3]",
  },
};

export function StatusBadge({
  status,
  className = "",
}: {
  status: OrderStatus | PaymentStatus | DeliveryStatus | VerificationStatus | string;
  className?: string;
}) {
  const cfg = STATUS_MAP[status] ?? {
    label: status.replaceAll("_", " "),
    classes: "bg-[#F5F0E2] text-[#5E5D57] border-[#E8E3D5]",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${cfg.classes} ${className}`}
    >
      {cfg.label}
    </span>
  );
}
