// server/src/controllers/paymayaController.js

import crypto from "crypto";

// Handle successful payment
const handlePaymentCompleted = async (paymentData) => {
  try {
    const userId = paymentData.metadata?.user_id;
    const amount = paymentData.amount?.value || paymentData.amount;
    const referenceNumber = paymentData.reference_number || paymentData.id;

    if (!userId) {
      console.error("No user ID found in payment metadata");
      return;
    }

    console.log(
      `✅ Payment completed: User ${userId} credited with ₱${amount}`,
    );
    console.log(`📝 Reference: ${referenceNumber}`);

    return { success: true, userId, amount, referenceNumber };
  } catch (error) {
    console.error("❌ Error handling payment completion:", error);
    throw error;
  }
};

// Handle payment created event
const handlePaymentCreated = async (paymentData) => {
  try {
    console.log(`📝 Payment created: ${paymentData.id}`);
    console.log(
      `💰 Amount: ₱${paymentData.amount?.value || paymentData.amount}`,
    );
    console.log(
      `🔢 Reference: ${paymentData.reference_number || paymentData.id}`,
    );

    return { success: true };
  } catch (error) {
    console.error("Error handling payment created:", error);
    throw error;
  }
};

// Handle payment failed event
const handlePaymentFailed = async (paymentData) => {
  try {
    console.log(`❌ Payment failed: ${paymentData.id}`);
    console.log(
      `🔢 Reference: ${paymentData.reference_number || paymentData.id}`,
    );

    return { success: true };
  } catch (error) {
    console.error("Error handling payment failed:", error);
    throw error;
  }
};

// Verify webhook signature using PayMaya secret key
const verifySignature = (signature, payload, secretKey) => {
  try {
    if (!signature || !secretKey) {
      console.warn(
        "⚠️ No signature or secret key provided, skipping verification",
      );
      return true;
    }

    const expectedSignature = crypto
      .createHmac("sha256", secretKey)
      .update(JSON.stringify(payload))
      .digest("hex");

    const isValid = signature === expectedSignature;
    if (!isValid) {
      console.error("❌ Signature mismatch");
      console.log(`Expected: ${expectedSignature}`);
      console.log(`Received: ${signature}`);
    }

    return isValid;
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
};

// Main webhook handler - EXPORT THIS
export const handlePayMayaWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const signature = req.headers["x-paymaya-signature"];
    const secretKey = process.env.TEAM_NAME_SECRET_KEY;

    console.log("📨 PayMaya Webhook received:");
    console.log(`📋 Event Type: ${payload.type}`);
    console.log(`🆔 Transaction ID: ${payload.data?.id || payload.id}`);

    if (secretKey && signature) {
      const isValid = verifySignature(signature, payload, secretKey);
      if (!isValid) {
        console.error("❌ Invalid webhook signature");
        return res.status(401).json({
          error: "Invalid signature",
          message: "Webhook signature verification failed",
        });
      }
      console.log("✅ Webhook signature verified");
    }

    let result;
    switch (payload.type) {
      case "payment.created":
        result = await handlePaymentCreated(payload.data || payload);
        break;

      case "payment.completed":
        result = await handlePaymentCompleted(payload.data || payload);
        break;

      case "payment.failed":
        result = await handlePaymentFailed(payload.data || payload);
        break;

      default:
        console.log(`⚠️ Unknown webhook type: ${payload.type}`);
        result = { success: true, message: "Unknown event type, acknowledged" };
    }

    res.status(200).json({
      received: true,
      success: result?.success ?? true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("❌ PayMaya webhook error:", error);
    res.status(200).json({
      received: true,
      error: "Webhook processing failed but acknowledged",
    });
  }
};

export const createPayMayaCheckout = async (req, res) => {
  try {
    const authenticatedUserId =
      req.user?.id || req.user?.sub || req.user?.userId;

    const {
      amount,
      referenceNumber,
      metadata,
      successUrl,
      failureUrl,
      cancelUrl,
    } = req.body;

    const finalUserId = authenticatedUserId;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount",
      });
    }

    if (!finalUserId) {
      console.error("❌ No user ID found in token:", req.user);
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    console.log("👤 Creating Pay with Maya payment for user:", finalUserId);

    const payMayaApiUrl =
      "https://pg-sandbox.paymaya.com/payby/v2/paymaya/payments";

    const publicKey = process.env.TEAM_NAME_PUBLIC_KEY;

    const paymentPayload = {
      totalAmount: {
        value: amount,
        currency: "PHP",
      },
      redirectUrl: {
        success: successUrl || `${process.env.API_BASE_URL}/payment/success`,
        failure: failureUrl || `${process.env.API_BASE_URL}/payment/failure`,
        cancel: cancelUrl || `${process.env.API_BASE_URL}/payment/cancel`,
      },
      requestReferenceNumber: referenceNumber || `CASH-${Date.now()}`,
      metadata: metadata || {
        user_id: finalUserId,
        transaction_type: "cash_in",
      },
    };

    console.log(
      "📤 Pay with Maya payload:",
      JSON.stringify(paymentPayload, null, 2),
    );

    const authString = Buffer.from(publicKey + ":").toString("base64");

    const response = await fetch(payMayaApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authString}`,
      },
      body: JSON.stringify(paymentPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Pay with Maya API Error:", data);
      return res.status(response.status).json({
        success: false,
        error: data.error || data.message || "Failed to create payment",
        details: data,
      });
    }

    console.log("✅ Pay with Maya payment created:", data.paymentId);
    console.log("🔗 Redirect URL:", data.redirectUrl);

    res.status(200).json({
      success: true,
      checkout_url: data.redirectUrl,
      transaction_id: data.paymentId,
      reference_number: paymentPayload.requestReferenceNumber,
      amount: amount,
    });
  } catch (error) {
    console.error("❌ Error creating Pay with Maya payment:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create payment",
      message: error.message,
    });
  }
};

// Check payment status - EXPORT THIS
export const getPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const authenticatedUserId =
      req.user?.id || req.user?.sub || req.user?.userId;

    if (!authenticatedUserId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    // TODO: Query your database for the transaction status
    // For demo purposes - return a mock response
    res.status(200).json({
      status: "completed",
      amount: 2000,
      transaction_id: transactionId,
      message: "Payment completed successfully",
    });
  } catch (error) {
    console.error("Error checking payment status:", error);
    res.status(500).json({ error: "Failed to check payment status" });
  }
};

// Health check endpoint - EXPORT THIS
export const payMayaHealthCheck = async (req, res) => {
  try {
    res.status(200).json({
      status: "healthy",
      service: "paymaya-webhook",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ status: "unhealthy", error: error.message });
  }
};

// Default export for convenience
export default {
  handlePayMayaWebhook,
  createPayMayaCheckout,
  getPaymentStatus,
  payMayaHealthCheck,
};
