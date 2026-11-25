import express from 'express'
import {
    createListing,
    getListings,
    getListing,
    updateListing,
    deleteListing
} from '../controllers/listing.controller.js'
import { protect, restrictTo, requireVerifiedEmail } from '../middleware/auth.js'

const router = express.Router()

// Public routes
router.get('/', getListings)
router.get('/:slug', getListing)

// Protected routes - supplier only
router.post('/', protect, requireVerifiedEmail, restrictTo('supplier'), createListing)
router.put('/:id', protect, requireVerifiedEmail, restrictTo('supplier'), updateListing)
router.delete('/:id', protect, requireVerifiedEmail, restrictTo('supplier'), deleteListing)

export default router