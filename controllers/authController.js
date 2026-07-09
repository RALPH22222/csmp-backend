import bcrypt from "bcrypt";
import {
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import {
  stellarRpc,
  networkPassphrase,
  PHP_TOKEN_CODE,
  PHP_TOKEN_ISSUER,
} from "../config/stellar.js";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";
import crypto from "crypto";

// --------------------------------------------------------------
// Encryption helpers (AES-256-CBC)
// --------------------------------------------------------------
const ENCRYPTION_KEY = process.env.JWT_SECRET
  ? crypto.scryptSync(process.env.JWT_SECRET, "salt", 32)
  : crypto.scryptSync("fallback_secret_key", "salt", 32);
const IV_LENGTH = 16;

const encryptText = (text) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
};

const decryptText = (text) => {
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift(), "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

// --------------------------------------------------------------
// OTP store and helpers
// --------------------------------------------------------------
const otpStore = new Map();
const loginOtpStore = new Map();

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const formatE164 = (phone) => {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("63")) return digits;
  if (digits.startsWith("09")) return "63" + digits.substring(1);
  if (digits.startsWith("9")) return "63" + digits;
  return digits;
};

const sendOtpSms = async (mobilePhone, otp) => {
  try {
    const formattedPhone = formatE164(mobilePhone);
    const apiPhone = "+" + formattedPhone;
    console.log(`📡 Sending OTP to ${apiPhone}`);

    const response = await fetch(
      "https://smsapiph.onrender.com/api/v1/send/sms",
      {
        method: "POST",
        headers: {
          "x-api-key": process.env.SMSkey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: apiPhone,
          message: `Your CSMP verification code is ${otp}`,
        }),
      },
    );
    const data = await response.json();
    console.log("SMS API Response:", data);
  } catch (error) {
    console.error("Failed to send SMS:", error);
  }
};

// --------------------------------------------------------------
// Helper: set up user's Stellar account (fund + trustline)
// --------------------------------------------------------------
async function setupUserStellarAccount(publicKey, secretKey) {
  try {
    console.log(`💧 Funding ${publicKey} via Friendbot...`);
    const fundRes = await fetch(
      `https://friendbot-futurenet.stellar.org?addr=${publicKey}`,
    );
    const fundData = await fundRes.json();
    if (!fundData.successful) {
      console.error(`Friendbot funding failed for ${publicKey}`);
      return;
    }

    console.log(`🔗 Adding PHP trustline for ${publicKey}...`);
    const keypair = Keypair.fromSecret(secretKey);
    const asset = new Asset(PHP_TOKEN_CODE, PHP_TOKEN_ISSUER);
    const sourceAccount = await stellarRpc.getAccount(publicKey);

    let tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const sendResp = await stellarRpc.sendTransaction(tx);
    if (sendResp.status !== "PENDING") {
      console.error("Trustline send failed:", sendResp);
      return;
    }

    let txResp;
    while (true) {
      await new Promise((r) => setTimeout(r, 1000));
      txResp = await stellarRpc.getTransaction(sendResp.hash);
      if (txResp.status === "SUCCESS") break;
      if (txResp.status === "FAILED") {
        console.error("Trustline transaction failed:", txResp);
        return;
      }
    }
    console.log(`✅ Stellar account ready for ${publicKey}`);
  } catch (err) {
    console.error("Stellar setup error:", err);
  }
}

// --------------------------------------------------------------
// REGISTER
// --------------------------------------------------------------
export const register = async (req, res) => {
  try {
    const {
      mobilePhone,
      firstName,
      middleName,
      lastName,
      dateOfBirth,
      sex,
      password,
    } = req.body;

    if (!mobilePhone || !firstName || !lastName || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("phone_number", mobilePhone)
      .single();

    if (existingUser) {
      return res
        .status(409)
        .json({ success: false, message: "Phone number already registered" });
    }

    const otp = generateOTP();

    if (process.env.NODE_ENV !== "production") {
      console.log(`🔑 [DEV] OTP for ${mobilePhone}: ${otp}`);
    }

    // Generate a new Stellar wallet for the user
    const keypair = Keypair.random();
    const stellarPublicKey = keypair.publicKey();
    const stellarSecretKey = keypair.secret();

    // Store user payload temporarily with OTP
    otpStore.set(mobilePhone, {
      otp,
      password: encryptText(password),
      stellarSecretKey,
      expiresAt: Date.now() + 5 * 60 * 1000,
      userData: {
        phone_number: mobilePhone,
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        date_of_birth: new Date(dateOfBirth).toISOString().split("T")[0],
        sex,
        stellar_public_key: stellarPublicKey,
      },
    });

    await sendOtpSms(mobilePhone, otp);

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully.",
    });
  } catch (error) {
    console.error("Registration Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// --------------------------------------------------------------
// VERIFY OTP (Registration)
// --------------------------------------------------------------
export const verifyOtp = async (req, res) => {
  try {
    const { mobilePhone, otp } = req.body;

    if (!mobilePhone || !otp) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and OTP are required" });
    }

    const record = otpStore.get(mobilePhone);

    if (!record) {
      return res
        .status(404)
        .json({ success: false, message: "OTP not found or expired" });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(mobilePhone);
      return res
        .status(400)
        .json({ success: false, message: "OTP has expired" });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // Create user in Supabase Auth to get auth_id
    const formattedPhone = formatE164(mobilePhone);
    let authUserId;

    const { data: createData, error: authError } =
      await supabase.auth.admin.createUser({
        phone: formattedPhone,
        password: decryptText(record.password),
        phone_confirm: true,
      });

    if (authError) {
      if (authError.message.includes("already registered")) {
        let { data: signInData, error: signInError } =
          await supabase.auth.signInWithPassword({
            phone: formattedPhone,
            password: decryptText(record.password),
          });

        if (
          signInError &&
          signInError.message.includes("Phone logins are disabled")
        ) {
          const { data: stuckUser } = await supabase
            .from("users")
            .select("auth_id")
            .eq("phone_number", mobilePhone)
            .single();
          if (stuckUser) {
            signInData = { user: { id: stuckUser.auth_id } };
            signInError = null;
          }
        }

        if (signInData && signInData.user) {
          authUserId = signInData.user.id;
        } else {
          throw new Error(
            "Phone number is stuck in Supabase Auth. Please delete it manually from the dashboard.",
          );
        }
      } else {
        throw new Error(`Auth Error: ${authError.message}`);
      }
    } else {
      authUserId = createData.user.id;
    }

    record.userData.auth_id = authUserId;

    // Insert into public.users
    const { data: newUser, error: dbError } = await supabase
      .from("users")
      .insert([record.userData])
      .select()
      .single();

    if (dbError) {
      await supabase.auth.admin.deleteUser(authUserId);
      throw new Error(`DB Error: ${dbError.message}`);
    }

    // Store the encrypted Stellar secret
    const encryptedSecret = encryptText(record.stellarSecretKey);
    await supabase
      .from("users")
      .update({ stellar_secret: encryptedSecret })
      .eq("id", newUser.id);

    // Fire-and-forget: fund the account and create trustline
    setupUserStellarAccount(
      record.userData.stellar_public_key,
      record.stellarSecretKey,
    ).catch((err) => console.error("Stellar setup error:", err));

    // Clean up OTP store
    otpStore.delete(mobilePhone);

    // Sign in the user to return a session
    let { data: sessionData, error: signInError } =
      await supabase.auth.signInWithPassword({
        phone: formattedPhone,
        password: decryptText(record.password),
      });

    if (
      signInError &&
      signInError.message.includes("Phone logins are disabled")
    ) {
      const token = jwt.sign(
        {
          aud: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
          sub: authUserId,
          email: "",
          phone: formattedPhone,
          app_metadata: { provider: "phone", providers: ["phone"] },
          user_metadata: {},
          role: "authenticated",
        },
        process.env.JWT_SECRET || "fallback_secret_key",
      );

      sessionData = {
        session: {
          access_token: token,
          refresh_token: token,
          expires_in: 86400,
          token_type: "bearer",
          user: { id: authUserId, phone: formattedPhone },
        },
        user: { id: authUserId, phone: formattedPhone },
      };
      signInError = null;
    }

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      session: sessionData?.session || null,
      token: sessionData?.session?.access_token || null,
      user: newUser,
    });
  } catch (error) {
    console.error("OTP Verification Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// --------------------------------------------------------------
// LOGIN, VERIFY LOGIN OTP, REFRESH, RESEND OTP
// --------------------------------------------------------------
export const login = async (req, res) => {
  try {
    const { mobilePhone, password, isReturningUser } = req.body;

    if (!mobilePhone || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and password are required" });
    }

    const formattedPhone = formatE164(mobilePhone);

    let { data: sessionData, error: signInError } =
      await supabase.auth.signInWithPassword({
        phone: formattedPhone,
        password,
      });

    if (
      signInError &&
      signInError.message.includes("Phone logins are disabled")
    ) {
      const { data: userProfile } = await supabase
        .from("users")
        .select("auth_id")
        .eq("phone_number", mobilePhone)
        .single();

      if (userProfile) {
        const token = jwt.sign(
          {
            aud: "authenticated",
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
            sub: userProfile.auth_id,
            email: "",
            phone: formattedPhone,
            app_metadata: { provider: "phone", providers: ["phone"] },
            user_metadata: {},
            role: "authenticated",
          },
          process.env.JWT_SECRET || "fallback_secret_key",
        );

        sessionData = {
          session: {
            access_token: token,
            refresh_token: token,
            expires_in: 86400,
            token_type: "bearer",
            user: { id: userProfile.auth_id, phone: formattedPhone },
          },
          user: { id: userProfile.auth_id, phone: formattedPhone },
        };
        signInError = null;
      } else {
        return res.status(401).json({
          success: false,
          message:
            "Auth Error: Invalid login credentials or user not registered.",
        });
      }
    }

    if (signInError) {
      console.error("Supabase Login Error:", signInError.message);
      return res.status(401).json({
        success: false,
        message: `Auth Error: ${signInError.message}`,
      });
    }

    const { data: userProfile, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("auth_id", sessionData.user.id)
      .single();

    if (isReturningUser) {
      return res.status(200).json({
        success: true,
        message: "Login successful",
        session: sessionData.session,
        token: sessionData.session.access_token,
        user: userProfile,
      });
    }

    const otp = generateOTP();

    loginOtpStore.set(mobilePhone, {
      otp,
      sessionData,
      userProfile,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    await sendOtpSms(mobilePhone, otp);

    return res.status(200).json({
      success: true,
      requireOtp: true,
      message: "OTP sent for login verification",
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyLoginOtp = async (req, res) => {
  try {
    const { mobilePhone, otp } = req.body;

    if (!mobilePhone || !otp) {
      return res
        .status(400)
        .json({ success: false, message: "Phone and OTP are required" });
    }

    const record = loginOtpStore.get(mobilePhone);

    if (!record) {
      return res
        .status(404)
        .json({ success: false, message: "OTP not found or expired" });
    }

    if (Date.now() > record.expiresAt) {
      loginOtpStore.delete(mobilePhone);
      return res
        .status(400)
        .json({ success: false, message: "OTP has expired" });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    loginOtpStore.delete(mobilePhone);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      session: record.sessionData.session,
      token: record.sessionData.session.access_token,
      user: record.userProfile,
    });
  } catch (error) {
    console.error("Login OTP Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const refreshSession = async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res
        .status(400)
        .json({ success: false, message: "Refresh token is required" });
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token,
    });

    if (error) {
      return res.status(401).json({ success: false, message: error.message });
    }

    return res.status(200).json({
      success: true,
      session: data.session,
      token: data.session.access_token,
    });
  } catch (error) {
    console.error("Refresh Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const resendOtp = async (req, res) => {
  try {
    const { mobilePhone } = req.body;

    if (!mobilePhone) {
      return res
        .status(400)
        .json({ success: false, message: "Phone number is required" });
    }

    const record = otpStore.get(mobilePhone);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "User session not found. Please restart registration.",
      });
    }

    const newOtp = generateOTP();

    if (process.env.NODE_ENV !== "production") {
      console.log(`🔑 [DEV] OTP for ${mobilePhone}: ${newOtp}`);
    }

    otpStore.set(mobilePhone, {
      ...record,
      otp: newOtp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    await sendOtpSms(mobilePhone, newOtp);

    return res
      .status(200)
      .json({ success: true, message: "OTP resent successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};