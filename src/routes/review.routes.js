import express from 'express'
import {
    createReview,
    getSupplierReviews,
    getMyReviews,
    updateReview,
    deleteReview
} from '../controllers/review.controller.js'
import { protect, restrictTo, requireVerifiedEmail } from '../middleware/auth.js'

const router = express.Router()

// Public routes
router.get('/supplier/:supplier_id', getSupplierReviews)

// Protected routes
router.post('/', protect, requireVerifiedEmail, restrictTo('buyer'), createReview)
router.get('/me', protect, requireVerifiedEmail, restrictTo('buyer'), getMyReviews)
router.put('/:id', protect, requireVerifiedEmail, restrictTo('buyer'), updateReview)
router.delete('/:id', protect, requireVerifiedEmail, restrictTo('buyer'), deleteReview)

export default router