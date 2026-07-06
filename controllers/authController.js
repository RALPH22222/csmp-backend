import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { Keypair } from '@stellar/stellar-sdk';

const otpStore = new Map();

// Generate a random 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const formatE164 = (phone) => {
    let digits = phone.replace(/\D/g, ''); // Ensure only digits
    if (digits.startsWith('63')) return '+' + digits;
    if (digits.startsWith('09')) return '+63' + digits.substring(1);
    if (digits.startsWith('9')) return '+63' + digits;
    return '+' + digits; // Fallback
};

const sendOtpSms = async (mobilePhone, otp) => {
    try {
        const formattedPhone = formatE164(mobilePhone);
        console.log(`📡 Dispatching SMS to formatted number: ${formattedPhone}`);

        const response = await fetch('https://smsapiph.onrender.com/api/v1/send/sms', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.SMSkey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipient: formattedPhone,
                message: `Your CSMP verification code is ${otp}`
            })
        });
        const data = await response.json();
        console.log('SMS API Response:', data);
    } catch (error) {
        console.error('Failed to send SMS:', error);
    }
};

//REGISTER
export const register = async (req, res) => {
    try {
        const { mobilePhone, firstName, middleName, lastName, dateOfBirth, sex, password } = req.body;

        if (!mobilePhone || !firstName || !lastName || !password) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('phone_number', mobilePhone)
            .single();

        if (existingUser) {
            return res.status(409).json({ success: false, message: 'Phone number already registered' });
        }

        // Generate mock OTP
        const otp = generateOTP();

        // Generate a new Stellar wallet for the user
        const keypair = Keypair.random();
        const stellarPublicKey = keypair.publicKey();
        const stellarSecretKey = keypair.secret();
        
        // Store user payload temporarily with the OTP
        otpStore.set(mobilePhone, {
            otp,
            password, // Save raw password temporarily to create Supabase Auth user
            stellarSecretKey, // Save secret key to return to user upon verification
            expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
            userData: {
                phone_number: mobilePhone,
                first_name: firstName,
                middle_name: middleName || null,
                last_name: lastName,
                date_of_birth: new Date(dateOfBirth).toISOString().split('T')[0], // Convert to YYYY-MM-DD
                sex,
                stellar_public_key: stellarPublicKey
            }
        });

        await sendOtpSms(mobilePhone, otp);

        return res.status(200).json({ 
            success: true, 
            message: 'OTP sent successfully. Please check your console.' 
        });

    } catch (error) {
        console.error('Registration Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// VERIFY OTP
export const verifyOtp = async (req, res) => {
    try {
        const { mobilePhone, otp } = req.body;

        if (!mobilePhone || !otp) {
            return res.status(400).json({ success: false, message: 'Phone and OTP are required' });
        }

        const record = otpStore.get(mobilePhone);

        if (!record) {
            return res.status(404).json({ success: false, message: 'OTP not found or expired' });
        }

        if (Date.now() > record.expiresAt) {
            otpStore.delete(mobilePhone);
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }

        if (record.otp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        // Create user in Supabase Auth to get auth_id
        const formattedPhone = formatE164(mobilePhone);
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            phone: formattedPhone,
            password: record.password,
            phone_confirm: true
        });

        if (authError) {
            throw new Error(`Auth Error: ${authError.message}`);
        }

        // Assign the generated auth_id to the users table payload
        record.userData.auth_id = authData.user.id;

        // OTP is valid! Insert into database
        const { data: newUser, error: dbError } = await supabase
            .from('users')
            .insert([record.userData])
            .select()
            .single();

        if (dbError) {
            // Rollback Auth user if public.users insert fails
            await supabase.auth.admin.deleteUser(authData.user.id);
            throw new Error(`DB Error: ${dbError.message}`);
        }

        // Clean up OTP
        otpStore.delete(mobilePhone);

        // Generate JWT
        const token = jwt.sign(
            { id: newUser.id, phone: newUser.phone_number },
            process.env.JWT_SECRET || 'fallback_secret_key',
            { expiresIn: '7d' }
        );

        return res.status(201).json({ 
            success: true, 
            message: 'Registration successful',
            token,
            user: newUser,
            stellarSecretKey: record.stellarSecretKey
        });

    } catch (error) {
        console.error('OTP Verification Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


// RESEND OTP
export const resendOtp = async (req, res) => {
    try {
        const { mobilePhone } = req.body;
        
        if (!mobilePhone) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }

        const record = otpStore.get(mobilePhone);
        if (!record) {
            return res.status(404).json({ success: false, message: 'User session not found. Please restart registration.' });
        }

        const newOtp = generateOTP();
        
        otpStore.set(mobilePhone, {
            ...record,
            otp: newOtp,
            expiresAt: Date.now() + 5 * 60 * 1000
        });

        await sendOtpSms(mobilePhone, newOtp);

        return res.status(200).json({ success: true, message: 'OTP resent successfully.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
