// server/src/routes/api.js
import express from "express";
import {
  createPool,
  joinPool,
  contribute,
  payout,
  getPoolState,
  getAllPools,
  getMyPools,
  getPoolById,
} from "../controllers/poolController.js";
import {
  register,
  verifyOtp,
  resendOtp,
  login,
  verifyLoginOtp,
  refreshSession,
} from "../controllers/authController.js";
import {
  handlePayMayaWebhook,
  createPayMayaCheckout,
  getPaymentStatus,
  payMayaHealthCheck,
  getWalletBalance,
} from "../controllers/paymayaController.js";
import { getUserHistory } from "../controllers/transactionController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Pool Routes
router.get("/pools", getAllPools);
router.get("/pools/user/:userId", getMyPools);
router.get("/pools/:poolId", getPoolById);
router.post("/pools", verifyToken, createPool);
router.post("/pools/:poolId/join", verifyToken, joinPool);
router.post("/pools/:poolId/contribute", verifyToken, contribute);
router.post("/pools/:poolId/payout", verifyToken, payout);
router.get("/pools/:poolId/state", getPoolState);

// Auth Routes (public)
router.post("/auth/register", register);
router.post("/auth/verify-otp", verifyOtp);
router.post("/auth/resend-otp", resendOtp);
router.post("/auth/login", login);
router.post("/auth/verify-login", verifyLoginOtp);
router.post("/auth/refresh", refreshSession);

// Transaction Routes
router.get("/transactions/history", verifyToken, getUserHistory);

// PayMaya Routes
router.post("/paymaya-webhook", handlePayMayaWebhook); // Webhook is public
router.post("/paymaya/checkout", verifyToken, createPayMayaCheckout); // Protected
router.get(
  "/paymaya/checkout/status/:transactionId",
  verifyToken,
  getPaymentStatus,
); // Protected
router.get("/paymaya/health", payMayaHealthCheck);
router.get("/paymaya/balance", verifyToken, getWalletBalance); // Protected

// Payment redirect pages (public)
router.get("/payment/success", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Successful</title>
        <style>
          body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            margin: 0;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            max-width: 400px;
          }
          .icon { font-size: 64px; margin-bottom: 20px; }
          h1 { color: #006D77; margin-bottom: 10px; }
          p { color: #666; margin-bottom: 20px; }
          .button {
            display: inline-block;
            padding: 12px 30px;
            background: #006D77;
            color: white;
            text-decoration: none;
            border-radius: 30px;
            font-weight: 600;
          }
          .loading { margin-top: 20px; color: #999; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">✅</div>
          <h1>Payment Successful!</h1>
          <p>Your payment has been processed successfully.</p>
          <p>You can close this window and return to the app.</p>
          <div class="loading">Redirecting to app...</div>
        </div>
        <script>
          setTimeout(() => {
            window.location.href = 'csmpmobileapp://payment/success';
          }, 2000);
          
          setTimeout(() => {
            const container = document.querySelector('.container');
            const button = document.createElement('a');
            button.href = 'csmpmobileapp://payment/success';
            button.className = 'button';
            button.textContent = 'Open App';
            container.appendChild(button);
            document.querySelector('.loading').style.display = 'none';
          }, 5000);
        </script>
      </body>
    </html>
  `);
});

router.get("/payment/failure", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Failed</title>
        <style>
          body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            margin: 0;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            max-width: 400px;
          }
          .icon { font-size: 64px; margin-bottom: 20px; }
          h1 { color: #e53e3e; margin-bottom: 10px; }
          p { color: #666; margin-bottom: 20px; }
          .button {
            display: inline-block;
            padding: 12px 30px;
            background: #006D77;
            color: white;
            text-decoration: none;
            border-radius: 30px;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">❌</div>
          <h1>Payment Failed</h1>
          <p>Your payment was not completed. Please try again.</p>
          <a href="csmpmobileapp://payment/failure" class="button">Return to App</a>
        </div>
      </body>
    </html>
  `);
});

router.get("/payment/cancel", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Cancelled</title>
        <style>
          body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            margin: 0;
          }
          .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            max-width: 400px;
          }
          .icon { font-size: 64px; margin-bottom: 20px; }
          h1 { color: #ed8936; margin-bottom: 10px; }
          p { color: #666; margin-bottom: 20px; }
          .button {
            display: inline-block;
            padding: 12px 30px;
            background: #006D77;
            color: white;
            text-decoration: none;
            border-radius: 30px;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">⚠️</div>
          <h1>Payment Cancelled</h1>
          <p>You cancelled the payment process.</p>
          <a href="csmpmobileapp://payment/cancel" class="button">Return to App</a>
        </div>
      </body>
    </html>
  `);
});

export default router;
