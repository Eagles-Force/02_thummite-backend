import express from 'express'
import {
    getMyProfile,
    updateMyProfile,
    saveSupplier,
    unsaveSupplier,
    getSavedSuppliers,
    saveListing,
    unsaveListing,
    getSavedListings
} from '../controllers/buyer.controller.js'
import { protect, restrictTo, requireVerifiedEmail } from '../middleware/auth.js'

const router = express.Router()

// All buyer routes are protected and buyer only
router.use(protect)
router.use(requireVerifiedEmail)
router.use(restrictTo('buyer'))

router.get('/profile/me', getMyProfile)
router.put('/profile/me', updateMyProfile)

router.get('/saved/suppliers', getSavedSuppliers)
router.post('/saved/suppliers/:supplier_id', saveSupplier)
router.delete('/saved/suppliers/:supplier_id', unsaveSupplier)

router.get('/saved/listings', getSavedListings)
router.post('/saved/listings/:listing_id', saveListing)
router.delete('/saved/listings/:listing_id', unsaveListing)

export default router