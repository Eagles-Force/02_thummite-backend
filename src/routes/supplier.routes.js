import express from 'express'
import {
    getSuppliers,
    getSupplier,
    updateSupplierProfile,
    getMyProfile
} from '../controllers/supplier.controller.js'
import { protect, restrictTo, requireVerifiedEmail } from '../middleware/auth.js'

const router = express.Router()

// Specific protected routes must precede the dynamic /:id route.
router.get('/profile/me', protect, requireVerifiedEmail, restrictTo('supplier'), getMyProfile)
router.put('/profile/me', protect, requireVerifiedEmail, restrictTo('supplier'), updateSupplierProfile)

// Public routes
router.get('/', getSuppliers)
router.get('/:id', getSupplier)

export default router