// supabase/functions/razorpay/index.ts
// Deno Edge Function: Handles Razorpay order creation AND signature verification.
// Runs on Supabase's free tier — no credit card required.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Authenticate the user from Bearer token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // === ACTION: CREATE ORDER ===
  if (action === "create-order") {
    const { amount, currency, receipt } = await req.json();
    
    if (!amount || amount < 100) {
      return new Response(JSON.stringify({ error: "Minimum amount is 100 paise" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const credentials = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
    const razorRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount, currency: currency || "INR", receipt }),
    });

    const order = await razorRes.json();
    if (!razorRes.ok) {
      return new Response(JSON.stringify({ error: order.error?.description || "Razorpay order creation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: RAZORPAY_KEY_ID
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // === ACTION: VERIFY PAYMENT ===
  if (action === "verify-payment") {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = await req.json();
    
    // HMAC-SHA256 signature verification using Web Crypto API (Deno-native)
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(RAZORPAY_KEY_SECRET);
    const messageData = encoder.encode(body);
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    
    if (expectedSignature !== razorpay_signature) {
      return new Response(JSON.stringify({ success: false, message: "Invalid signature" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Signature valid — promote user to Pro in Supabase
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ 
        is_premium: true, 
        tier: "pro",
        balance_seconds: 108000  // 30 hours
      })
      .eq("id", user.id);

    if (updateError) {
      return new Response(JSON.stringify({ success: false, message: "DB update failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --- AUDIT LOG: Record the successful transaction ---
    await supabase.from("payments").insert({
        user_id: user.id,
        razorpay_order_id: razorpay_order_id,
        razorpay_payment_id: razorpay_payment_id,
        amount: 29900, // Hardcoded for Elite monthly for now, or could pass from client
        status: 'captured'
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action. Use ?action=create-order or ?action=verify-payment" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
