import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes, createHash } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import db, { getClient } from '../config/db.js'
import { successResponse, errorResponse } from '../utils/response.js'
import { sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail } from '../utils/email.js'
import { generateOTP, storeOTP, verifyOTP } from '../utils/otp.js'

const generateToken = (id, role, tokenVersion = 0) => jwt.sign({ id, role, tokenVersion }, process.env.JWT_SECRET, {
  expiresIn: process.env.JWT_EXPIRES_IN || '7d'
})

const getProfile = async (role, userId) => {
  const table = role === 'supplier' ? 'supplier_profiles' : role === 'buyer' ? 'buyer_profiles' : 'admin_profiles'
  const { data } = await db.from(table).select('*').eq('user_id', userId).maybeSingle()
  return data || null
}

export const register = async (req, res) => {
  const client = await getClient()
  try {
    const {
      email, phone, password, role, business_name, state, city, address, industry,
      buyer_type, username
    } = req.body

    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedPhone = String(phone || '').trim()
    if (!normalizedEmail || !normalizedPhone || !password || !role) {
      return errorResponse(res, 'Email, phone, password and account type are required.')
    }
    if (!['supplier', 'buyer'].includes(role)) {
      return errorResponse(res, 'Choose either Buyer or Supplier. Administrator accounts are created privately.')
    }
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return errorResponse(res, 'Enter a valid email address.')
    if (String(password).length < 8) return errorResponse(res, 'Password must be at least 8 characters.')
    if (normalizedPhone.length < 7 || normalizedPhone.length > 20) return errorResponse(res, 'Enter a valid phone number.')

    const selectedBuyerType = buyer_type || 'organisation'
    if (role === 'buyer' && !['individual', 'organisation'].includes(selectedBuyerType)) {
      return errorResponse(res, 'Buyer type must be individual or organisation.')
    }
    if (role === 'buyer' && selectedBuyerType === 'individual' && !/^[a-zA-Z0-9_.-]{3,50}$/.test(String(username || '').trim())) {
      return errorResponse(res, 'Choose a username of 3–50 characters using letters, numbers, dots, underscores or hyphens.')
    }
    if (role === 'buyer' && selectedBuyerType === 'organisation' && String(business_name || '').trim().length < 2) {
      return errorResponse(res, 'Organisation name is required.')
    }
    if (role === 'supplier' && (!business_name || !state || !city || !address)) {
      return errorResponse(res, 'Suppliers must provide business name, state, city and business address.')
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const userId = uuidv4()
    await client.query('BEGIN')
    const userResult = await client.query(
      `INSERT INTO users (id, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, phone, role, is_email_verified, token_version, created_at`,
      [userId, normalizedEmail, normalizedPhone, passwordHash, role]
    )

    if (role === 'supplier') {
      await client.query(
        `INSERT INTO supplier_profiles (id, user_id, business_name, state, city, address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), userId, String(business_name).trim(), state, String(city).trim(), String(address).trim()]
      )
    } else {
      const isIndividual = selectedBuyerType === 'individual'
      await client.query(
        `INSERT INTO buyer_profiles
          (id, user_id, buyer_type, username, business_name, industry, state, city, address)
         VALUES ($1, $2, $3::buyer_type, $4, $5, $6, $7, $8, $9)`,
        [uuidv4(), userId, selectedBuyerType,
          isIndividual ? String(username).trim() : null,
          isIndividual ? null : String(business_name).trim(),
          industry?.trim() || null, state || null, city?.trim() || null, address?.trim() || null]
      )
    }
    await client.query('COMMIT')

    const newUser = userResult.rows[0]
    const displayName = role === 'supplier' || selectedBuyerType === 'organisation'
      ? business_name : username
    const token = generateToken(newUser.id, newUser.role, newUser.token_version)
    try {
      const otp = generateOTP()
      await storeOTP(newUser.id, otp)
      await sendOTPEmail(newUser.email, displayName || newUser.email, otp)
    } catch (emailError) {
      console.error('Registration email delivery failed:', emailError.message)
      return successResponse(res, 'Account created, but the verification email could not be delivered. Sign in and request a new verification code.', {
        token,
        user: { id: newUser.id, email: newUser.email, phone: newUser.phone, role: newUser.role, is_email_verified: false, profile: await getProfile(role, userId) },
        email_sent: false
      }, 201)
    }

    return successResponse(res, 'Account created successfully. Please check your email for a verification code.', {
      token,
      user: { id: newUser.id, email: newUser.email, phone: newUser.phone, role: newUser.role, is_email_verified: false, profile: await getProfile(role, userId) },
      email_sent: true
    }, 201)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505') {
      const field = error.constraint?.includes('phone') ? 'phone number' : error.constraint?.includes('username') ? 'username' : 'email'
      return errorResponse(res, `An account with this ${field} already exists.`, 409)
    }
    if (error.code === '23514') return errorResponse(res, 'The buyer profile details are incomplete or invalid.', 400)
    console.error('Registration error:', error)
    return errorResponse(res, 'Unable to create your account. Please try again.', 500)
  } finally {
    client.release()
  }
}

export const login = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    const { password } = req.body
    if (!email || !password) return errorResponse(res, 'Email and password are required.')
    const { data: user, error } = await db.from('users')
      .select('id, email, phone, role, password_hash, is_active, is_email_verified, token_version')
      .eq('email', email).maybeSingle()
    if (error || !user) return errorResponse(res, 'Invalid email or password.', 401)
    if (!user.is_active) return errorResponse(res, 'Your account has been deactivated. Contact support.', 401)
    if (!await bcrypt.compare(password, user.password_hash)) return errorResponse(res, 'Invalid email or password.', 401)
    await db.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id)
    const profile = await getProfile(user.role, user.id)
    const token = generateToken(user.id, user.role, user.token_version)
    const { password_hash, token_version, ...safeUser } = user
    return successResponse(res, 'Login successful.', { token, user: { ...safeUser, profile } })
  } catch (error) {
    console.error('Login error:', error)
    return errorResponse(res, 'Something went wrong. Please try again.', 500)
  }
}

export const getMe = async (req, res) => {
  try {
    const profile = await getProfile(req.user.role, req.user.id)
    return successResponse(res, 'User retrieved successfully.', { user: { ...req.user, profile } })
  } catch (error) {
    console.error(error)
    return errorResponse(res, 'Unable to retrieve your account.', 500)
  }
}

export const verifyEmail = async (req, res) => {
  try {
    const { otp } = req.body
    if (!/^\d{6}$/.test(String(otp || ''))) return errorResponse(res, 'Enter the six-digit verification code.')
    if (req.user.is_email_verified) return errorResponse(res, 'Email is already verified.')
    const result = await verifyOTP(req.user.id, otp)
    if (!result.valid) return errorResponse(res, result.message)
    const { data: user, error } = await db.from('users').update({ is_email_verified: true })
      .eq('id', req.user.id).select('id, email, role').single()
    if (error || !user) return errorResponse(res, 'Unable to verify your email. Please try again.', 500)
    const profile = await getProfile(user.role, user.id)
    const displayName = profile?.business_name || profile?.username || user.email
    await sendWelcomeEmail(user.email, displayName, user.role).catch((err) => console.error('Welcome email failed:', err.message))
    return successResponse(res, 'Email verified successfully. Welcome to Thummite!')
  } catch (error) {
    console.error(error)
    return errorResponse(res, 'Something went wrong. Please try again.', 500)
  }
}

export const resendOTP = async (req, res) => {
  try {
    if (req.user.is_email_verified) return errorResponse(res, 'Email is already verified.')
    const { data: user, error } = await db.from('users').select('id, email, role').eq('id', req.user.id).single()
    if (error || !user) return errorResponse(res, 'Account not found.', 404)
    const profile = await getProfile(user.role, user.id)
    const otp = generateOTP()
    await storeOTP(user.id, otp)
    await sendOTPEmail(user.email, profile?.business_name || profile?.username || user.email, otp)
    return successResponse(res, 'A new verification code has been sent to your email.')
  } catch (error) {
    console.error('Resend OTP error:', error)
    return errorResponse(res, 'Unable to send a verification code right now.', 503)
  }
}

export const requestPasswordReset = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    if (!email) return errorResponse(res, 'Email address is required.')
    const genericMessage = 'If an account exists for that email, a password reset link has been sent.'
    const { data: user } = await db.from('users').select('id, email, role').eq('email', email).maybeSingle()
    if (user) {
      const rawToken = randomBytes(32).toString('hex')
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      const client = await getClient()
      try {
        await client.query('BEGIN')
        await client.query('DELETE FROM password_reset_tokens WHERE expires_at <= NOW() OR used_at IS NOT NULL')
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL', [user.id])
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`, [user.id, tokenHash]
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally { client.release() }
      if (!process.env.FRONTEND_URL) throw new Error('FRONTEND_URL is not configured.')
      const resetUrl = `${process.env.FRONTEND_URL.replace(/\/+$/, '')}/auth/reset-password?token=${rawToken}`
      await sendPasswordResetEmail(user.email, user.email, resetUrl)
    }
    return successResponse(res, genericMessage)
  } catch (error) {
    console.error('Password reset request error:', error)
    // Do not reveal whether an account exists; delivery errors are intentionally generic.
    return successResponse(res, 'If an account exists for that email, a password reset link has been sent.')
  }
}

export const resetPassword = async (req, res) => {
  const client = await getClient()
  try {
    const { token, password } = req.body
    if (!token || !password) return errorResponse(res, 'Reset token and new password are required.')
    if (String(password).length < 8) return errorResponse(res, 'Password must be at least 8 characters.')
    const tokenHash = createHash('sha256').update(String(token)).digest('hex')
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       FOR UPDATE`, [tokenHash]
    )
    const resetRecord = result.rows[0]
    if (!resetRecord) {
      await client.query('ROLLBACK')
      return errorResponse(res, 'This password reset link is invalid or has expired. Request a new one.', 400)
    }
    const passwordHash = await bcrypt.hash(password, 12)
    await client.query('UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = NOW() WHERE id = $2', [passwordHash, resetRecord.user_id])
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [resetRecord.user_id])
    await client.query('COMMIT')
    return successResponse(res, 'Your password has been reset. You can now sign in with your new password.')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Password reset error:', error)
    return errorResponse(res, 'Unable to reset your password. Please request a new link.', 500)
  } finally { client.release() }
}

export const logout = async (req, res) => {
  return successResponse(res, 'Logged out successfully.')
}
