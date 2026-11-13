"use client";

import { ArrowRight, MessageSquareWarning, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useMyOrders, useSessionUser } from "@/hooks/useGoodlyQueries";
import { formatMinor, formatOrderDate, formatPaymentMode } from "@/lib/format";
import { services } from "@/services";
import type { ComplaintRecord, Order } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function CustomerOrdersPage() {
  const { data: user } = useSessionUser("customer");
  const { data: orders = [], isLoading } = useMyOrders(Boolean(user));
  const pushToast = useAppStore((s) => s.pushToast);

  const [reviewOrder, setReviewOrder] = useState<Order | null>(null);
  const [foodRating, setFoodRating] = useState(5);
  const [deliveryRating, setDeliveryRating] = useState(5);
  const [itemRatings, setItemRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [deliveryComment, setDeliveryComment] = useState("");
  const [autoPromptHandled, setAutoPromptHandled] = useState(false);

  const [complaintOrder, setComplaintOrder] = useState<Order | null>(null);
  const [category, setCategory] =
    useState<ComplaintRecord["category"]>("MISSING_ITEM");
  const [description, setDescription] = useState("");

  function openReviewModal(order: Order) {
    setReviewOrder(order);
    setFoodRating(5);
    setDeliveryRating(5);
    const defaults: Record<string, number> = {};
    for (const item of order.items) {
      defaults[item.menuItemId] = 5;
    }
    setItemRatings(defaults);
    setComment("");
    setDeliveryComment("");
  }

  // Trigger rating prompt automatically on app open when an order is eligible
  const eligibleOrder = orders.find(
    (o) =>
      o.orderStatus === "DELIVERED" &&
      o.ratingPromptStatus === "ELIGIBLE_ON_APP_OPEN"
  );
  if (eligibleOrder && !reviewOrder && !autoPromptHandled) {
    setAutoPromptHandled(true);
    openReviewModal(eligibleOrder);
  }

  async function handleSubmitReview() {
    if (!reviewOrder) return;
    try {
      await services.orders.submitReview(reviewOrder.id, {
        foodRating,
        deliveryRating,
        itemRatings: reviewOrder.items.map((i) => ({
          menuItemId: i.menuItemId,
          itemName: i.name,
          rating: itemRatings[i.menuItemId] ?? 5,
        })),
        comment,
        deliveryComment,
      });
      pushToast("success", "Thank you for rating the restaurant, dishes & delivery partner!");
      setReviewOrder(null);
      setComment("");
      setDeliveryComment("");
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Could not submit review."
      );
    }
  }

  async function handleSubmitComplaint() {
    if (!complaintOrder) return;
    if (description.trim().length < 15) {
      pushToast("error", "Please describe the issue in at least 15 characters.");
      return;
    }
    const ticket = await services.orders.submitComplaint(complaintOrder.id, {
      category,
      description,
    });
    pushToast("info", `Support ticket ${ticket.ticketNumber} submitted.`);
    setComplaintOrder(null);
    setDescription("");
  }

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">Sign in to view your orders</h1>
        <Link
          href="/auth/login"
          className="inline-flex bg-[#DEC146] px-5 py-2.5 rounded-lg font-semibold text-sm"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1040px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          YOUR ORDERS
        </div>
        <h1 className="text-3xl font-extrabold text-[#1E1F1C] mt-1">
          Active &amp; past orders
        </h1>
      </div>

      {isLoading ? (
        <div className="text-sm text-[#8A8880]">Loading order history...</div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-10 text-center">
          <p className="font-bold text-[#1E1F1C]">No orders yet</p>
          <p className="text-xs text-[#8A8880] mt-1">
            Something delicious is just around the corner.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div
              key={order.id}
              className="bg-white border border-[#E8E3D5] rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-bold text-[#8A8880]">
                    {order.orderNumber}
                  </span>
                  <StatusBadge status={order.orderStatus} />
                  <StatusBadge status={order.paymentStatus} />
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F5F0E2] text-[#1E1F1C]">
                    {formatPaymentMode(order.paymentMethod)}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-[#1E1F1C]">
                  {order.restaurantName}
                </h2>
                <p className="text-xs text-[#5E5D57]">
                  {order.items
                    .map((i) => `${i.quantity}× ${i.name}`)
                    .join(", ")}
                </p>
                <div className="text-xs text-[#8A8880]">
                  {formatOrderDate(order.createdAt)} ·{" "}
                  <strong className="text-[#1E1F1C] tabular-nums">
                    {formatMinor(order.breakdown.totalPayableMinor, order.currency)}
                  </strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <Link
                  href={`/orders/${order.id}/track`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#DEC146] hover:bg-[#CFAF32] text-xs font-bold text-[#1E1F1C]"
                >
                  <span>
                    {order.orderStatus === "DELIVERED" ? "View receipt" : "Track live"}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>

                {order.orderStatus === "DELIVERED" && (
                  <button
                    type="button"
                    data-testid={`rate-order-${order.id}`}
                    onClick={() => openReviewModal(order)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E8E3D5] hover:bg-[#F5F0E2] text-xs font-semibold"
                  >
                    <Star className="w-3.5 h-3.5 text-[#DEC146]" />
                    <span>
                      {order.ratingPromptStatus === "RATED" ? "Rated" : "Rate"}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setComplaintOrder(order)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E8E3D5] hover:bg-[#F5F0E2] text-xs font-semibold text-[#5E5D57]"
                >
                  <MessageSquareWarning className="w-3.5 h-3.5" />
                  <span>Help</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3-Category Review Modal (1. Restaurant, 2. Menu Items directly below, 3. Delivery Partner) */}
      {reviewOrder && (
        <div
          data-testid="three-category-rating-modal"
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-[#E8E3D5] rounded-2xl max-w-lg w-full p-6 space-y-5 max-h-[85vh] overflow-y-auto">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#5F8E63]">
                POST-DELIVERY FEEDBACK · {reviewOrder.orderNumber}
              </div>
              <h3 className="font-bold text-lg text-[#1E1F1C] mt-0.5">
                How was your order from {reviewOrder.restaurantName}?
              </h3>
            </div>

            {/* Category 1: Restaurant Rating */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-[#1E1F1C]">
                1. Restaurant Rating — {reviewOrder.restaurantName}
              </div>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFoodRating(n)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${
                      foodRating >= n
                        ? "bg-[#DEC146] border-[#DEC146] text-[#1E1F1C]"
                        : "border-[#E8E3D5]"
                    }`}
                  >
                    {n} ★
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="How was the food quality and packaging?"
                className="w-full border border-[#E8E3D5] rounded-xl p-2.5 text-xs"
              />
            </div>

            {/* Category 2: Individual Menu Items (Directly below Restaurant Rating) */}
            <div className="space-y-2 border-t border-[#E8E3D5] pt-4">
              <div className="text-xs font-bold text-[#1E1F1C]">
                2. Rate Individual Menu Items Ordered (Optional)
              </div>
              <div className="space-y-2">
                {reviewOrder.items.map((item) => {
                  const cur = itemRatings[item.menuItemId] ?? 5;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                    >
                      <span className="font-semibold text-[#1E1F1C]">
                        {item.name}
                      </span>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() =>
                              setItemRatings((prev) => ({
                                ...prev,
                                [item.menuItemId]: n,
                              }))
                            }
                            className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                              cur >= n
                                ? "bg-[#DEC146] border-[#DEC146] text-[#1E1F1C]"
                                : "bg-white border-[#E8E3D5] text-[#8A8880]"
                            }`}
                          >
                            {n}★
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Category 3: Delivery Partner Rating */}
            <div className="space-y-2 border-t border-[#E8E3D5] pt-4">
              <div className="text-xs font-bold text-[#1E1F1C]">
                3. Delivery Partner Rating —{" "}
                {reviewOrder.partnerName ?? "Assigned Courier"}
              </div>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDeliveryRating(n)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${
                      deliveryRating >= n
                        ? "bg-[#CBEAD0] border-[#5F8E63] text-[#1E1F1C]"
                        : "border-[#E8E3D5]"
                    }`}
                  >
                    {n} ★
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={deliveryComment}
                onChange={(e) => setDeliveryComment(e.target.value)}
                placeholder="Optional note on delivery speed & handoff..."
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReviewOrder(null)}
                className="px-4 py-2 text-xs font-semibold"
              >
                Later
              </button>
              <button
                type="button"
                data-testid="submit-review-btn"
                onClick={handleSubmitReview}
                className="px-4 py-2 rounded-lg bg-[#DEC146] hover:bg-[#CFAF32] text-xs font-bold text-[#1E1F1C]"
              >
                Submit 3-Category Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complaint Modal */}
      {complaintOrder && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E8E3D5] rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-base">
              Report an issue · {complaintOrder.orderNumber}
            </h3>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as ComplaintRecord["category"])
              }
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
            >
              <option value="MISSING_ITEM">Missing item</option>
              <option value="WRONG_ORDER">Wrong order</option>
              <option value="QUALITY_ISSUE">Food quality issue</option>
              <option value="LATE_DELIVERY">Late delivery</option>
              <option value="BILLING_ISSUE">Billing / refund issue</option>
            </select>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened (min 15 characters)..."
              className="w-full border border-[#E8E3D5] rounded-xl p-3 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setComplaintOrder(null)}
                className="px-4 py-2 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitComplaint}
                className="px-4 py-2 rounded-lg bg-[#1E1F1C] text-[#FCF9F0] text-xs font-bold"
              >
                Submit ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
