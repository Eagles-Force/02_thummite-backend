import express from 'express'
import {
  register, login, getMe, verifyEmail, resendOTP, logout,
  requestPasswordReset, resetPassword
} from '../controllers/auth.controller.js'
import { protect } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'

const router = express.Router()
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many sign-in attempts. Try again in 15 minutes.' })
const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, message: 'Too many registration attempts. Try again later.' })
const resetRequestLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 4, message: 'Too many password reset requests. Try again later.' })
const resetActionLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, message: 'Too many password reset attempts. Try again later.' })
const otpLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 8, message: 'Too many verification attempts. Try again later.' })

router.post('/register', registerLimit, register)
router.post('/login', loginLimit, login)
router.post('/forgot-password', resetRequestLimit, requestPasswordReset)
router.post('/reset-password', resetActionLimit, resetPassword)
router.get('/me', protect, getMe)
router.post('/verify-email', protect, otpLimit, verifyEmail)
router.post('/resend-otp', protect, resetRequestLimit, resendOTP)
router.post('/logout', protect, logout)
export default router
