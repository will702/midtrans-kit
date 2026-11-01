"use client";

/**
 * Drop-in checkout button.
 *
 *   <PayButton itemId="tshirt" label="Buy T-shirt (Rp 50.000)" />
 *
 * Flow: click → POST /api/payment/create → window.snap.pay(token) → poll
 * /api/payment/status until the webhook (or the reconcile poll) settles it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    snap?: {
      pay: (token: string, callbacks?: {
        onSuccess?: (result: { order_id?: string }) => void;
        onPending?: (result: { order_id?: string }) => void;
        onError?: (result: unknown) => void;
        onClose?: () => void;
      }) => void;
    };
  }
}

type Phase = "idle" | "creating" | "paying" | "waiting" | "paid" | "failed";

export function PayButton({
  itemId,
  label,
  customerName,
  customerEmail,
  customerPhone,
}: {
  itemId: string;
  label: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [orderId, setOrderId] = useState<string | null>(null);
  const snapLoaded = useRef(false);

  // Load snap.js once. The URL depends on your environment — keep
  // NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION in sync with MIDTRANS_IS_PRODUCTION!
  useEffect(() => {
    if (snapLoaded.current) return;
    const isProduction = process.env.NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION === "true";
    const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
    if (!clientKey) {
      console.error("NEXT_PUBLIC_MIDTRANS_CLIENT_KEY is not set");
      return;
    }
    const script = document.createElement("script");
    script.src = `${isProduction ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com"}/snap/snap.js`;
    script.setAttribute("data-client-key", clientKey);
    script.onload = () => {
      snapLoaded.current = true;
    };
    document.body.appendChild(script);
  }, []);

  const pollStatus = useCallback(async (id: string) => {
    // The webhook settles the order; this poll catches it (and reconciles via
    // the status API if the webhook lags). 24 tries × 5s ≈ 2 minutes.
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      try {
        const response = await fetch(`/api/payment/status?order_id=${encodeURIComponent(id)}`);
        if (!response.ok) continue;
        const data = (await response.json()) as { status: string };
        if (data.status === "paid") return setPhase("paid");
        if (data.status === "failed" || data.status === "expired") return setPhase("failed");
      } catch {
        // network hiccup — keep polling
      }
    }
    setPhase("failed");
  }, []);

  const startPayment = useCallback(async () => {
    setPhase("creating");
    try {
      const response = await fetch("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, customerName, customerEmail, customerPhone }),
      });
      if (!response.ok) throw new Error(`create failed (HTTP ${response.status})`);
      const { orderId: id, token, redirectUrl } = (await response.json()) as {
        orderId: string;
        token: string;
        redirectUrl: string;
      };
      setOrderId(id);

      if (window.snap) {
        setPhase("paying");
        window.snap.pay(token, {
          onSuccess: (result) => {
            const done = result.order_id ?? id;
            setPhase("waiting");
            void pollStatus(done);
          },
          onPending: (result) => {
            const done = result.order_id ?? id;
            setPhase("waiting");
            void pollStatus(done);
          },
          onError: () => setPhase("failed"),
          onClose: () => setPhase((p) => (p === "paying" ? "idle" : p)),
        });
      } else {
        // snap.js not ready — fall back to the full-page redirect.
        window.location.href = redirectUrl;
      }
    } catch (error) {
      console.error(error);
      setPhase("failed");
    }
  }, [itemId, customerName, customerEmail, customerPhone, pollStatus]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <button onClick={startPayment} disabled={phase === "creating" || phase === "paying" || phase === "waiting"}>
        {label}
      </button>
      {phase === "waiting" && orderId && (
        <p style={{ fontSize: 14, color: "#666" }}>
          Waiting for payment confirmation ({orderId})… this page updates automatically.
        </p>
      )}
      {phase === "paid" && (
        <p style={{ fontSize: 14, color: "#0a7d32", fontWeight: 600 }}>✓ Payment received — thank you!</p>
      )}
      {phase === "failed" && (
        <p style={{ fontSize: 14, color: "#b3261e" }}>
          Payment not completed. You can try again — nothing was charged unless you saw success.
        </p>
      )}
    </div>
  );
}
