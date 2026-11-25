import express from 'express'
import {
    createInquiry,
    getInquiries,
    getInquiry,
    replyToInquiry,
    updateInquiryStatus
} from '../controllers/inquiry.controller.js'
import { protect, restrictTo, requireVerifiedEmail } from '../middleware/auth.js'

const router = express.Router()

// All inquiry routes are protected
router.use(protect)
router.use(requireVerifiedEmail)

router.post('/', restrictTo('buyer'), createInquiry)
router.get('/', getInquiries)
router.get('/:id', getInquiry)
router.post('/:id/messages', replyToInquiry)
router.patch('/:id/status', updateInquiryStatus)

export default router