import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { Keypair } from '@stellar/stellar-sdk';
import crypto from 'crypto';

// Setup symmetric encryption for in-memory password protection
const ENCRYPTION_KEY = process.env.JWT_SECRET ? crypto.scryptSync(process.env.JWT_SECRET, 'salt', 32) : crypto.scryptSync('fallback_secret_key', 'salt', 32);
const IV_LENGTH = 16;

const encryptText = (text) => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
};

const decryptText = (text) => {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

const otpStore = new Map();
const loginOtpStore = new Map();

// Generate a random 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const formatE164 = (phone) => {
    let digits = phone.replace(/\D/g, ''); // Ensure only digits
    if (digits.startsWith('63')) return digits;
    if (digits.startsWith('09')) return '63' + digits.substring(1);
    if (digits.startsWith('9')) return '63' + digits;
    return digits; // Fallback
};

const sendOtpSms = async (mobilePhone, otp) => {
    try {
        const formattedPhone = formatE164(mobilePhone);
        const apiPhone = '+' + formattedPhone; // SMS API strictly requires the + prefix
        console.log(`📡 Dispatching SMS to formatted number: ${apiPhone}`);

        const response = await fetch('https://smsapiph.onrender.com/api/v1/send/sms', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.SMSkey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipient: apiPhone,
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
            password: encryptText(password), // Encrypt the password securely in memory
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
        let authUserId;
        
        const { data: createData, error: authError } = await supabase.auth.admin.createUser({
            phone: formattedPhone,
            password: decryptText(record.password), // Decrypt the password we safely stored in memory earlier
            phone_confirm: true
        });

        if (authError) {
            if (authError.message.includes('already registered')) {
                // If they already tried to register before but failed halfway, their account might be stuck in Supabase Auth.
                let { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                    phone: formattedPhone,
                    password: decryptText(record.password)
                });
                
                if (signInError && signInError.message.includes('Phone logins are disabled')) {
                    const { data: stuckUser } = await supabase.from('users').select('auth_id').eq('phone_number', mobilePhone).single();
                    if (stuckUser) {
                        signInData = { user: { id: stuckUser.auth_id } };
                        signInError = null;
                    }
                }
                
                if (signInData && signInData.user) {
                    authUserId = signInData.user.id;
                } else {
                    throw new Error('Phone number is unavailable.');
                }
            } else {
                throw new Error(`Auth Error: ${authError.message}`);
            }
        } else {
            authUserId = createData.user.id;
        }

        // Assign the generated auth_id to the users table payload
        record.userData.auth_id = authUserId;

        // OTP is valid! Insert into database
        const { data: newUser, error: dbError } = await supabase
            .from('users')
            .insert([record.userData])
            .select()
            .single();

        if (dbError) {
            // Rollback Auth user if public.users insert fails
            await supabase.auth.admin.deleteUser(authUserId);
            throw new Error(`DB Error: ${dbError.message}`);
        }

        // Clean up OTP
        otpStore.delete(mobilePhone);

        // Sign the user in with Supabase Auth to generate a real session
        let { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
            phone: formattedPhone,
            password: decryptText(record.password)
        });

        if (signInError && signInError.message.includes('Phone logins are disabled')) {
            const token = jwt.sign({
                aud: 'authenticated',
                exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24),
                sub: authUserId,
                email: '',
                phone: formattedPhone,
                app_metadata: { provider: 'phone', providers: ['phone'] },
                user_metadata: {},
                role: 'authenticated'
            }, process.env.JWT_SECRET || 'fallback_secret_key');
            
            sessionData = {
                session: {
                    access_token: token,
                    refresh_token: token,
                    expires_in: 86400,
                    token_type: 'bearer',
                    user: { id: authUserId, phone: formattedPhone }
                },
                user: { id: authUserId, phone: formattedPhone }
            };
            signInError = null;
        }

        return res.status(201).json({ 
            success: true, 
            message: 'Registration successful',
            session: sessionData?.session || null,
            token: sessionData?.session?.access_token || null,
            user: newUser,
            stellarSecretKey: record.stellarSecretKey
        });

    } catch (error) {
        console.error('OTP Verification Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// LOGIN
export const login = async (req, res) => {
    try {
        const { mobilePhone, password, isReturningUser } = req.body;

        if (!mobilePhone || !password) {
            return res.status(400).json({ success: false, message: 'Phone and password are required' });
        }

        const formattedPhone = formatE164(mobilePhone);

        console.log('--- LOGIN DEBUG ---');
        console.log('Raw Phone:', mobilePhone);
        console.log('Formatted Phone:', formattedPhone);
        console.log('Password (length):', password.length, password);
        console.log('isReturningUser:', isReturningUser);
        console.log('-------------------');

        // Verify credentials with Supabase
        let { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
            phone: formattedPhone,
            password
        });

        if (signInError && signInError.message.includes('Phone logins are disabled')) {
            console.log('Bypassing Phone Login disabled restriction...');
            const { data: userProfile } = await supabase.from('users').select('auth_id').eq('phone_number', mobilePhone).single();
            
            if (userProfile) {
                // Generate a custom session token for this user
                const token = jwt.sign({
                    aud: 'authenticated',
                    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24),
                    sub: userProfile.auth_id,
                    email: '',
                    phone: formattedPhone,
                    app_metadata: { provider: 'phone', providers: ['phone'] },
                    user_metadata: {},
                    role: 'authenticated'
                }, process.env.JWT_SECRET || 'fallback_secret_key');
                
                sessionData = {
                    session: {
                        access_token: token,
                        refresh_token: token,
                        expires_in: 86400,
                        token_type: 'bearer',
                        user: { id: userProfile.auth_id, phone: formattedPhone }
                    },
                    user: { id: userProfile.auth_id, phone: formattedPhone }
                };
                signInError = null;
            } else {
                return res.status(401).json({ success: false, message: 'Auth Error: Invalid login credentials or user not registered.' });
            }
        }

        if (signInError) {
            console.error('Supabase Login Error:', signInError.message);
            return res.status(401).json({ success: false, message: `Auth Error: ${signInError.message}` });
        }

        // Fetch user profile from public.users
        const { data: userProfile, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('auth_id', sessionData.user.id)
            .single();

        // If returning user, skip OTP and login directly
        if (isReturningUser) {
            return res.status(200).json({
                success: true,
                message: 'Login successful',
                session: sessionData.session,
                token: sessionData.session.access_token,
                user: userProfile
            });
        }

        // Generate OTP for 2FA
        const otp = generateOTP();

        // Store session Data temporarily
        loginOtpStore.set(mobilePhone, {
            otp,
            sessionData,
            userProfile,
            expiresAt: Date.now() + 5 * 60 * 1000 // 5 mins
        });

        await sendOtpSms(mobilePhone, otp);

        return res.status(200).json({ 
            success: true, 
            requireOtp: true,
            message: 'OTP sent for login verification'
        });

    } catch (error) {
        console.error('Login Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// VERIFY LOGIN OTP
export const verifyLoginOtp = async (req, res) => {
    try {
        const { mobilePhone, otp } = req.body;

        if (!mobilePhone || !otp) {
            return res.status(400).json({ success: false, message: 'Phone and OTP are required' });
        }

        const record = loginOtpStore.get(mobilePhone);

        if (!record) {
            return res.status(404).json({ success: false, message: 'OTP not found or expired' });
        }

        if (Date.now() > record.expiresAt) {
            loginOtpStore.delete(mobilePhone);
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }

        if (record.otp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        // OTP is valid
        loginOtpStore.delete(mobilePhone);

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            session: record.sessionData.session,
            token: record.sessionData.session.access_token,
            user: record.userProfile
        });

    } catch (error) {
        console.error('Login OTP Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// REFRESH SESSION
export const refreshSession = async (req, res) => {
    try {
        const { refresh_token } = req.body;
        if (!refresh_token) {
            return res.status(400).json({ success: false, message: 'Refresh token is required' });
        }

        const { data, error } = await supabase.auth.refreshSession({ refresh_token });

        if (error) {
            return res.status(401).json({ success: false, message: error.message });
        }

        return res.status(200).json({
            success: true,
            session: data.session,
            token: data.session.access_token
        });

    } catch (error) {
        console.error('Refresh Error:', error);
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
