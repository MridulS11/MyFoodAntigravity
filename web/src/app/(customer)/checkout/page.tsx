"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  MapPin,
  ShieldCheck,
  Smartphone,
  Tag,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OrderChargesBreakdown } from "@/components/customer/OrderChargesBreakdown";
import { useAddresses, useCart, useSessionUser } from "@/hooks/useGoodlyQueries";
import { formatMinor } from "@/lib/format";
import { services } from "@/services";
import type { Order, PaymentRecord } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

const TIP_OPTIONS = [0, 2000, 3000, 5000];

export default function CheckoutPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: user, isLoading: userLoading } = useSessionUser("customer");
  const { data: cart, isLoading } = useCart();
  const { data: addresses = [] } = useAddresses(Boolean(user));
  const activeAddressId = useAppStore((s) => s.activeAddressId);
  const setActiveLocation = useAppStore((s) => s.setActiveLocation);
  const setAddressModalOpen = useAppStore((s) => s.setAddressModalOpen);
  const pushToast = useAppStore((s) => s.pushToast);

  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState("");
  const [instructions, setInstructions] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"ONLINE" | "COD">("ONLINE");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failedOrderId, setFailedOrderId] = useState<string | null>(null);
  const [gatewaySession, setGatewaySession] = useState<{
    order: Order;
    payment: PaymentRecord;
  } | null>(null);
  const [simInstrument, setSimInstrument] = useState<"UPI" | "CARD" | "NETBANKING">("UPI");
  const [simProcessing, setSimProcessing] = useState(false);
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `idemp-${Date.now()}`
  );

  if (isLoading || userLoading) {
    return <div className="max-w-5xl mx-auto p-8 text-sm">Loading checkout...</div>;
  }

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-[#1E1F1C]">Sign in to checkout</h1>
        <p className="text-sm text-[#5E5D57]">
          Please sign in to your Customer account to confirm your delivery address and pay. Your bag is saved.
        </p>
        <Link
          href="/auth/login?next=/checkout"
          data-testid="checkout-signin-link"
          className="inline-flex items-center gap-2 bg-[#DEC146] text-[#1E1F1C] font-semibold text-sm px-5 py-2.5 rounded-lg"
        >
          Sign in to Customer Account →
        </Link>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold text-[#1E1F1C]">Your bag is empty</h1>
        <p className="text-sm text-[#5E5D57]">
          Add dishes from a neighborhood restaurant before checking out.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-[#DEC146] text-[#1E1F1C] font-semibold text-sm px-5 py-2.5 rounded-lg"
        >
          Browse restaurants
        </Link>
      </div>
    );
  }

  const selectedAddress =
    addresses.find((a) => a.id === activeAddressId) ??
    addresses.find((a) => a.isServiceable) ??
    addresses[0];

  async function handleApplyCoupon() {
    setCouponError("");
    try {
      const updated = await services.cart.applyCoupon(couponInput);
      qc.setQueryData(["cart"], updated);
      setCouponInput("");
      pushToast("success", `Promo code ${updated.appliedCouponCode} applied!`);
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : "Invalid code.");
    }
  }

  async function handleRemoveCoupon() {
    const updated = await services.cart.removeCoupon();
    qc.setQueryData(["cart"], updated);
  }

  async function handleTipChange(tipMinor: number) {
    const updated = await services.cart.setTip(tipMinor);
    qc.setQueryData(["cart"], updated);
  }

  async function handlePlaceOrder() {
    if (!user) {
      pushToast("info", "Please sign in to place your order.");
      router.push("/auth/login");
      return;
    }
    if (!selectedAddress) {
      pushToast("error", "Select a delivery address first.");
      return;
    }
    setSubmitting(true);
    try {
      if (paymentMethod === "COD") {
        const { order } = await services.orders.createOrder({
          deliveryAddressId: selectedAddress.id,
          paymentMethod: "COD",
          pricingQuoteHash: "authoritative",
          idempotencyKey,
          specialInstructions: instructions,
        });
        qc.setQueryData(["orderDetail", order.id], order);
        pushToast("success", `Order ${order.orderNumber} confirmed (Cash on Delivery)!`);
        router.push(`/orders/${order.id}/track`);
        void qc.invalidateQueries({ queryKey: ["cart"] });
        void qc.invalidateQueries({ queryKey: ["myOrders"] });
        return;
      }

      // ONLINE payment: create PENDING_PAYMENT order + gateway session in a single hop
      const { order, payment } = await services.orders.createOrder({
        deliveryAddressId: selectedAddress.id,
        paymentMethod: "ONLINE",
        pricingQuoteHash: "authoritative",
        idempotencyKey,
        specialInstructions: instructions,
        deferOnlineCapture: true,
      });

      void qc.invalidateQueries({ queryKey: ["myOrders"] });
      setGatewaySession({ order, payment });
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Checkout failed."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGatewayDecision(outcome: "CAPTURE" | "FAIL") {
    if (!gatewaySession) return;
    setSimProcessing(true);
    try {
      const targetOrder = gatewaySession.order;
      const result = services.orders.simulateGatewayDecision
        ? await services.orders.simulateGatewayDecision(
            targetOrder.id,
            outcome,
            outcome === "FAIL"
              ? `Simulated ${simInstrument} authorization decline`
              : undefined,
            targetOrder
          )
        : outcome === "CAPTURE"
          ? await services.orders.retryPayment(targetOrder.id)
          : { order: targetOrder, payment: { ...gatewaySession.payment, status: "FAILED" as const } };

      if (outcome === "FAIL" || result.payment.status === "FAILED") {
        void qc.invalidateQueries({ queryKey: ["cart"] });
        void qc.invalidateQueries({ queryKey: ["myOrders"] });
        setFailedOrderId(result.order.id);
        setGatewaySession(null);
        pushToast(
          "error",
          result.payment.failureMessage ?? "Payment authorization declined."
        );
      } else {
        setFailedOrderId(null);
        setGatewaySession(null);
        qc.setQueryData(["orderDetail", result.order.id], result.order);
        pushToast(
          "success",
          `Payment captured via ${simInstrument}! Order ${result.order.orderNumber} confirmed.`
        );
        router.push(`/orders/${result.order.id}/track`);
        void qc.invalidateQueries({ queryKey: ["cart"] });
        void qc.invalidateQueries({ queryKey: ["myOrders"] });
      }
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Payment simulation failed."
      );
    } finally {
      setSimProcessing(false);
    }
  }

  async function handleRetryPayment() {
    if (!failedOrderId) return;
    setSubmitting(true);
    try {
      const existingOrder = await services.orders.getOrderById(failedOrderId);
      setGatewaySession({
        order: existingOrder,
        payment: {
          id: `pay-${existingOrder.id}`,
          orderId: existingOrder.id,
          orderNumber: existingOrder.orderNumber,
          customerId: existingOrder.customerId,
          provider: "RAZORPAY",
          providerOrderId: existingOrder.orderNumber,
          amountMinor: existingOrder.breakdown.totalPayableMinor,
          currency: existingOrder.currency,
          status: "FAILED",
          createdAt: existingOrder.createdAt,
        },
      });
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Could not open payment retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link
        href={`/restaurants/${cart.restaurantSlug}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E5D57] hover:text-[#1E1F1C]"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to {cart.restaurantName}</span>
      </Link>

      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          CHECKOUT
        </div>
        <h1 className="text-3xl font-extrabold text-[#1E1F1C] mt-1">
          Review &amp; pay for your order
        </h1>
      </div>

      {failedOrderId && (
        <div
          data-testid="payment-failed-banner"
          className="bg-[#FDECEA] border border-[#FAC8C3] rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#C62828] mt-0.5" />
            <div>
              <h2 className="text-sm font-bold text-[#C62828]">
                Payment authorization failed
              </h2>
              <p className="text-xs text-[#5E5D57] mt-0.5">
                Your order is preserved in PENDING_PAYMENT state without duplicating items. Retry payment below.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetryPayment}
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-[#DEC146] hover:bg-[#CFAF32] text-xs font-bold text-[#1E1F1C]"
          >
            Retry Payment Now
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column */}
        <div className="lg:col-span-7 space-y-6">
          {/* Delivery Address */}
          <section className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#1E1F1C] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#5F8E63]" />
                <span>Delivery address</span>
              </h2>
              <button
                type="button"
                onClick={() => setAddressModalOpen(true)}
                className="text-xs font-semibold text-[#5F8E63] hover:underline"
              >
                Change
              </button>
            </div>

            {selectedAddress ? (
              <div className="p-3.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] text-xs space-y-1">
                <div className="font-bold text-[#1E1F1C]">
                  {selectedAddress.label} · {selectedAddress.recipientName}
                </div>
                <div className="text-[#5E5D57]">
                  {selectedAddress.addressLine1}, {selectedAddress.city},{" "}
                  {selectedAddress.state} {selectedAddress.postalCode}
                </div>
                {!selectedAddress.isServiceable && (
                  <div className="text-[#C62828] font-semibold pt-1">
                    Warning: Selected address is outside our delivery area.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        const home = addresses.find((a) => a.isServiceable);
                        if (home) {
                          setActiveLocation({
                            addressId: home.id,
                            cityLabel: `${home.city}, ${home.state}`,
                            point: home.location,
                          });
                        }
                      }}
                      className="underline"
                    >
                      Switch to Bengaluru Home
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#8A8880]">No address selected.</p>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#5E5D57] mb-1.5">
                Kitchen &amp; delivery instructions (optional)
              </label>
              <textarea
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                maxLength={300}
                placeholder="No utensils needed, ring second-floor bell..."
                className="w-full bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-[#1E1F1C]"
              />
            </div>
          </section>

          {/* Promo Code & Tip */}
          <section className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold text-[#1E1F1C] flex items-center gap-2 mb-3">
                <Tag className="w-4 h-4 text-[#5F8E63]" />
                <span>Promo code</span>
              </h2>
              {cart.appliedCouponCode ? (
                <div className="flex items-center justify-between bg-[#DFF3E2] border border-[#CBEAD0] rounded-xl px-4 py-2.5 text-xs">
                  <span className="font-bold text-[#1E1F1C]">
                    Applied: {cart.appliedCouponCode} (−
                    {formatMinor(cart.breakdown.discountAmountMinor, cart.currency)})
                  </span>
                  <button
                    type="button"
                    onClick={handleRemoveCoupon}
                    className="font-semibold text-[#C62828] hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Try WELCOMEGOODLY or FREEDELIVERY"
                      className="flex-1 bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl px-3.5 py-2 text-xs uppercase"
                    />
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      className="px-4 py-2 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] text-xs font-semibold"
                    >
                      Apply
                    </button>
                  </div>
                  {couponError && (
                    <p className="text-xs text-[#C62828]">{couponError}</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-[#E8E3D5] pt-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-[#1E1F1C]">
                  Tip your delivery partner
                </h3>
                <span className="text-[11px] text-[#8A8880]">
                  100% goes to your rider
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {TIP_OPTIONS.map((tip) => {
                  const active = cart.tipAmountMinor === tip;
                  return (
                    <button
                      key={tip}
                      type="button"
                      onClick={() => handleTipChange(tip)}
                      className={`py-2 rounded-xl border text-xs font-bold tabular-nums transition-colors ${
                        active
                          ? "bg-[#DEC146] border-[#DEC146] text-[#1E1F1C]"
                          : "bg-[#FCF9F0] border-[#E8E3D5] text-[#5E5D57] hover:border-[#1E1F1C]"
                      }`}
                    >
                      {tip === 0 ? "No tip" : formatMinor(tip, cart.currency)}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Payment Method */}
          <section className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-bold text-[#1E1F1C] flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#5F8E63]" />
              <span>Payment method</span>
            </h2>

            <div className="space-y-2.5">
              <label className="flex items-center justify-between p-3.5 rounded-xl border border-[#1E1F1C] bg-[#FCF9F0] cursor-pointer">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "ONLINE"}
                    onChange={() => setPaymentMethod("ONLINE")}
                    className="accent-[#1E1F1C]"
                  />
                  <div>
                    <div className="text-xs font-bold text-[#1E1F1C]">
                      Online Payment (Razorpay UPI / Card / Netbanking)
                    </div>
                    <div className="text-[11px] text-[#8A8880]">
                      Verified via signed payment gateway webhook
                    </div>
                  </div>
                </div>
                <ShieldCheck className="w-4 h-4 text-[#5F8E63]" />
              </label>

              <label className="flex items-center justify-between p-3.5 rounded-xl border border-[#E8E3D5] bg-white cursor-pointer">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === "COD"}
                    onChange={() => setPaymentMethod("COD")}
                    className="accent-[#1E1F1C]"
                  />
                  <div>
                    <div className="text-xs font-bold text-[#1E1F1C]">
                      Cash on Delivery (COD)
                    </div>
                    <div className="text-[11px] text-[#8A8880]">
                      Pay cash or UPI at your doorstep upon arrival (no delivery OTP required)
                    </div>
                  </div>
                </div>
              </label>

              <label className="flex items-center gap-2 text-xs text-[#8A8880] pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simulateFailure}
                  onChange={(e) => setSimulateFailure(e.target.checked)}
                />
                <span>Simulate gateway payment decline (Phase 1 test toggle)</span>
              </label>
            </div>
          </section>
        </div>

        {/* Right Column Summary */}
        <aside className="lg:col-span-5 bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-5 sticky top-24">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#5F8E63]">
              ORDER SUMMARY
            </div>
            <h2 className="text-lg font-bold text-[#1E1F1C] mt-0.5">
              {cart.restaurantName}
            </h2>
          </div>

          <div className="divide-y divide-[#E8E3D5] border-t border-b border-[#E8E3D5]">
            {cart.items.map((item) => (
              <div key={item.id} className="py-2.5 flex justify-between text-xs">
                <div>
                  <span className="font-bold">{item.quantity} ×</span> {item.name}
                  {item.customizations.length > 0 && (
                    <div className="text-[11px] text-[#8A8880]">
                      {item.customizations.map((c) => c.optionName).join(", ")}
                    </div>
                  )}
                </div>
                <span className="font-semibold tabular-nums">
                  {formatMinor(item.lineTotalMinor, cart.currency)}
                </span>
              </div>
            ))}
          </div>

          <OrderChargesBreakdown
            breakdown={cart.breakdown}
            currency={cart.currency}
            totalLabel="Total payable"
            totalTestId="checkout-total"
          />

          <button
            type="button"
            data-testid="place-order-btn"
            onClick={handlePlaceOrder}
            disabled={submitting || !selectedAddress?.isServiceable}
            className="w-full bg-[#DEC146] hover:bg-[#CFAF32] disabled:opacity-50 text-[#1E1F1C] font-bold text-sm py-3.5 px-5 rounded-xl flex items-center justify-between transition-colors"
          >
            <span>
              {submitting
                ? "Processing..."
                : paymentMethod === "ONLINE"
                  ? "Proceed to Online Payment"
                  : "Place COD Order"}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </aside>
      </div>

      {gatewaySession && (
        <div
          data-testid="payment-simulator-modal"
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div className="bg-white border border-[#E8E3D5] rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-[#1E1F1C] text-[#FCF9F0] px-6 py-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#DEC146]">
                  {gatewaySession.payment.provider} SANDBOX CHECKOUT
                </div>
                <div className="text-base font-extrabold mt-0.5">
                  Goodly · {gatewaySession.order.orderNumber}
                </div>
                <div className="text-[11px] text-[#B8B6AE] font-mono">
                  Gateway Ref: {gatewaySession.payment.providerOrderId}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-extrabold tabular-nums text-[#DEC146]">
                  {formatMinor(
                    gatewaySession.payment.amountMinor,
                    gatewaySession.payment.currency
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Cancel payment simulation"
                  onClick={() => {
                    setFailedOrderId(gatewaySession.order.id);
                    setGatewaySession(null);
                  }}
                  className="text-[11px] text-[#B8B6AE] hover:text-white inline-flex items-center gap-1 mt-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Close</span>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "UPI", label: "UPI / QR", icon: Smartphone },
                    { id: "CARD", label: "Card", icon: CreditCard },
                    { id: "NETBANKING", label: "Netbanking", icon: Building2 },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = simInstrument === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSimInstrument(tab.id)}
                      className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-colors ${
                        active
                          ? "bg-[#FCF9F0] border-[#1E1F1C] text-[#1E1F1C]"
                          : "bg-white border-[#E8E3D5] text-[#5E5D57] hover:border-[#1E1F1C]"
                      }`}
                    >
                      <Icon className="w-4 h-4 text-[#5F8E63]" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl p-4 text-xs space-y-1.5">
                {simInstrument === "UPI" && (
                  <>
                    <div className="font-bold text-[#1E1F1C]">
                      Instant UPI Collect / Intent (Sandbox)
                    </div>
                    <div className="text-[#5E5D57] font-mono">
                      VPA: {user?.email?.split("@")[0] ?? "customer"}@okhdfcbank
                    </div>
                  </>
                )}
                {simInstrument === "CARD" && (
                  <>
                    <div className="font-bold text-[#1E1F1C]">
                      Test Visa Debit / Credit Card
                    </div>
                    <div className="text-[#5E5D57] font-mono">
                      4111 •••• •••• 4242 · Exp 12/28 · CVV 123
                    </div>
                  </>
                )}
                {simInstrument === "NETBANKING" && (
                  <>
                    <div className="font-bold text-[#1E1F1C]">
                      HDFC Bank Retail NetBanking (Sandbox)
                    </div>
                    <div className="text-[#5E5D57]">
                      Instant HMAC-signed callback confirmation
                    </div>
                  </>
                )}
              </div>

              {simulateFailure && (
                <div className="text-[11px] bg-[#FFF8E1] border border-[#DEC146] rounded-xl px-3 py-2 text-[#6B5400]">
                  Note: Your checkout test toggle is enabled — click{" "}
                  <strong>Simulate Payment Failure</strong> below to test decline &amp; retry, or{" "}
                  <strong>Pay Now</strong> to authorize.
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  data-testid="sim-pay-success-btn"
                  disabled={simProcessing}
                  onClick={() => handleGatewayDecision("CAPTURE")}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#5F8E63] hover:bg-[#4e7a52] disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {simProcessing
                      ? "Verifying Signature..."
                      : `Pay ${formatMinor(
                          gatewaySession.payment.amountMinor,
                          gatewaySession.payment.currency
                        )} (Simulate Success)`}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="sim-pay-fail-btn"
                  disabled={simProcessing}
                  onClick={() => handleGatewayDecision("FAIL")}
                  className="w-full py-2.5 px-4 rounded-xl border border-[#FAC8C3] bg-[#FDECEA] hover:bg-[#fbdad6] disabled:opacity-50 text-[#C62828] font-bold text-xs flex items-center justify-center gap-2"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Simulate Payment Decline / Failure</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
