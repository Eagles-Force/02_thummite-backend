import express from 'express'
import {
    getDashboard,
    getUsers,
    getUser,
    toggleUserStatus,
    getPendingSuppliers,
    verifySupplier,
    deleteListing,
    getAllListings,
    addCategory,
    toggleCategoryStatus
} from '../controllers/admin.controller.js'
import { protect, adminOnly, requireVerifiedEmail } from '../middleware/auth.js'

const router = express.Router()

// All admin routes are protected and admin only
router.use(protect)
router.use(requireVerifiedEmail)
router.use(adminOnly)

// Dashboard
router.get('/dashboard', getDashboard)

// Users
router.get('/users', getUsers)
router.get('/users/:id', getUser)
router.patch('/users/:id/toggle-status', toggleUserStatus)

// Supplier verification
router.get('/suppliers/pending', getPendingSuppliers)
router.patch('/suppliers/:id/verify', verifySupplier)

// Listings
router.get('/listings', getAllListings)
router.delete('/listings/:id', deleteListing)

// Categories
router.post('/categories', addCategory)
router.patch('/categories/:id/toggle-status', toggleCategoryStatus)

export default router