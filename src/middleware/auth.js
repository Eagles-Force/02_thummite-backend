import jwt from 'jsonwebtoken'
import db from '../config/db.js'
import { errorResponse } from '../utils/response.js'

export const protect = async (req, res, next) => {
    try {
        // Check if authorization header exists
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return errorResponse(res, 'Access denied. No token provided.', 401)
        }

        // Extract and verify token
        const token = authHeader.split(' ')[1]
        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        // Fetch user from database
        const { data: user, error } = await db
            .from('users')
            .select('id, email, role, is_active, is_email_verified, phone, token_version')
            .eq('id', decoded.id)
            .single()

        if (error || !user) {
            return errorResponse(res, 'User no longer exists.', 401)
        }

        if (decoded.tokenVersion !== user.token_version) {
            return errorResponse(res, 'Your session is no longer valid. Please log in again.', 401)
        }

        if (!user.is_active) {
            return errorResponse(res, 'Your account has been deactivated.', 401)
        }

        // Keep internal token version out of request handlers and API responses.
        const { token_version, ...safeUser } = user
        req.user = safeUser
        next()

    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return errorResponse(res, 'Session expired. Please log in again.', 401)
        }
        return errorResponse(res, 'Invalid token.', 401)
    }
}

// Restrict access to specific roles
export const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return errorResponse(res, 'You do not have permission to perform this action.', 403)
        }
        next()
    }
}

export const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return errorResponse(res, 'Access denied. Admins only.', 403)
    }
    next()
}
// Business actions require a verified email. OTP verification routes intentionally omit this middleware.
export const requireVerifiedEmail = (req, res, next) => {
    if (!req.user?.is_email_verified) {
        return errorResponse(res, 'Please verify your email address before using this feature.', 403)
    }
    next()
}
