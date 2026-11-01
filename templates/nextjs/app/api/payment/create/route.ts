import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createSnapTransaction } from "@/lib/midtrans";
import { registerOrder } from "@/lib/orders";
import { resolvePricedItem } from "@/lib/prices";

/**
 * POST /api/payment/create  { itemId, customerName?, customerEmail?, customerPhone? }
 *
 * Flow: resolve price SERVER-SIDE → register pending order → create Snap token.
 * (Register-before-create means the webhook always finds a row, and amount
 * tampering is impossible — the client never sends an amount.)
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      itemId?: string;
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
    };

    if (!body.itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }
    const item = resolvePricedItem(body.itemId);
    if (!item) {
      return NextResponse.json({ error: `Unknown item: ${body.itemId}` }, { status: 400 });
    }

    // Order id format: SHOP-<base36 timestamp>-<random> (unique + sortable)
    const orderId = `SHOP-${Date.now().toString(36).toUpperCase()}-${randomBytes(5)
      .toString("hex")
      .toUpperCase()}`;

    const order = registerOrder({
      orderId,
      itemId: item.id,
      itemName: item.name,
      amountIdr: item.priceIdr,
      customerEmail: body.customerEmail?.toLowerCase(),
    });

    const { token, redirect_url } = await createSnapTransaction({
      orderId,
      grossAmount: order.amountIdr,
      itemName: order.itemName,
      customer: {
        first_name: body.customerName,
        email: body.customerEmail,
        phone: body.customerPhone,
      },
    });

    return NextResponse.json({ orderId, token, redirectUrl: redirect_url });
  } catch (error) {
    console.error("[payment/create]", error);
    return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
  }
}
