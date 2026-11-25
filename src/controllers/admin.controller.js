import db from '../config/db.js'
import { successResponse, errorResponse } from '../utils/response.js'
import { v4 as uuidv4 } from 'uuid'
import { generateSlug } from '../utils/slug.js'

// -----------------------------------------------
// DASHBOARD METRICS
// -----------------------------------------------
export const getDashboard = async (req, res) => {
    try {
        // Total users by role
        const { data: users } = await db
            .from('users')
            .select('role')

        const totalUsers = users?.length || 0
        const totalSuppliers = users?.filter(u => u.role === 'supplier').length || 0
        const totalBuyers = users?.filter(u => u.role === 'buyer').length || 0

        // Total listings
        const { count: totalListings } = await db
            .from('product_listings')
            .select('*', { count: 'exact', head: true })

        // Total inquiries
        const { count: totalInquiries } = await db
            .from('inquiries')
            .select('*', { count: 'exact', head: true })

        // Pending supplier verifications
        const { count: pendingVerifications } = await db
            .from('supplier_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('verification_status', 'pending')

        // Recent registrations - last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { count: recentRegistrations } = await db
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', sevenDaysAgo)

        // Recent listings - last 7 days
        const { count: recentListings } = await db
            .from('product_listings')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', sevenDaysAgo)

        // Recent inquiries - last 7 days
        const { count: recentInquiries } = await db
            .from('inquiries')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', sevenDaysAgo)

        // Suppliers by verification status
        const { data: verificationStats } = await db
            .from('supplier_profiles')
            .select('verification_status')

        const verified = verificationStats?.filter(s => s.verification_status === 'verified').length || 0
        const pending = verificationStats?.filter(s => s.verification_status === 'pending').length || 0
        const rejected = verificationStats?.filter(s => s.verification_status === 'rejected').length || 0

        // Suppliers by subscription tier
        const { data: subscriptionStats } = await db
            .from('supplier_profiles')
            .select('subscription_tier')

        const freeTier = subscriptionStats?.filter(s => s.subscription_tier === 'free').length || 0
        const standardTier = subscriptionStats?.filter(s => s.subscription_tier === 'standard').length || 0
        const premiumTier = subscriptionStats?.filter(s => s.subscription_tier === 'premium').length || 0

        return successResponse(res, 'Dashboard metrics retrieved successfully.', {
            overview: {
                total_users: totalUsers,
                total_suppliers: totalSuppliers,
                total_buyers: totalBuyers,
                total_listings: totalListings,
                total_inquiries: totalInquiries,
                pending_verifications: pendingVerifications
            },
            last_7_days: {
                new_registrations: recentRegistrations,
                new_listings: recentListings,
                new_inquiries: recentInquiries
            },
            supplier_verification: {
                verified,
                pending,
                rejected
            },
            supplier_subscriptions: {
                free: freeTier,
                standard: standardTier,
                premium: premiumTier
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET ALL USERS
// -----------------------------------------------
export const getUsers = async (req, res) => {
    try {
        const {
            role,
            is_active,
            is_email_verified,
            search,
            page = 1,
            limit = 20
        } = req.query

        const offset = (page - 1) * limit

        let query = db
            .from('users')
            .select('id, email, phone, role, is_email_verified, is_active, last_login, created_at', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (role) query = query.eq('role', role)
        if (is_active !== undefined) query = query.eq('is_active', is_active === 'true')
        if (is_email_verified !== undefined) query = query.eq('is_email_verified', is_email_verified === 'true')
        if (search) query = query.or(`email.ilike.%${search}%,phone.ilike.%${search}%`)

        const { data, error, count } = await query

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching users.', 500)
        }

        return successResponse(res, 'Users retrieved successfully.', {
            users: data,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / limit)
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET SINGLE USER WITH FULL PROFILE
// -----------------------------------------------
export const getUser = async (req, res) => {
    try {
        const { id } = req.params

        const { data: user, error } = await db
            .from('users')
            .select('id, email, phone, role, is_email_verified, is_active, last_login, created_at')
            .eq('id', id)
            .single()

        if (error || !user) {
            return errorResponse(res, 'User not found.', 404)
        }

        let profile = null

        if (user.role === 'supplier') {
            const { data } = await db
                .from('supplier_profiles')
                .select('*')
                .eq('user_id', id)
                .single()
            profile = data
        }

        if (user.role === 'buyer') {
            const { data } = await db
                .from('buyer_profiles')
                .select('*')
                .eq('user_id', id)
                .single()
            profile = data
        }

        if (user.role === 'admin') {
            const { data } = await db
                .from('admin_profiles')
                .select('*')
                .eq('user_id', id)
                .single()
            profile = data
        }

        return successResponse(res, 'User retrieved successfully.', {
            user: { ...user, profile }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// ACTIVATE OR DEACTIVATE USER
// -----------------------------------------------
export const toggleUserStatus = async (req, res) => {
    try {
        const { id } = req.params

        // Prevent admin from deactivating themselves
        if (id === req.user.id) {
            return errorResponse(res, 'You cannot deactivate your own account.')
        }

        const { data: user, error: fetchError } = await db
            .from('users')
            .select('id, is_active, role, email')
            .eq('id', id)
            .single()

        if (fetchError || !user) {
            return errorResponse(res, 'User not found.', 404)
        }

        const { data: updated, error: updateError } = await db
            .from('users')
            .update({ is_active: !user.is_active })
            .eq('id', id)
            .select('id, email, role, is_active')
            .single()

        if (updateError) {
            console.error(updateError)
            return errorResponse(res, 'Error updating user status.', 500)
        }

        const action = updated.is_active ? 'activated' : 'deactivated'
        return successResponse(res, `User ${action} successfully.`, { user: updated })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET PENDING SUPPLIER VERIFICATIONS
// -----------------------------------------------
export const getPendingSuppliers = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query
        const offset = (page - 1) * limit

        const { data, error, count } = await db
            .from('supplier_profiles')
            .select(`
                id,
                business_name,
                business_description,
                cac_number,
                cac_document_url,
                address,
                city,
                state,
                total_listings,
                created_at,
                users!supplier_profiles_user_id_fkey (
                    id,
                    email,
                    phone,
                    is_email_verified,
                    created_at
                )
            `, { count: 'exact' })
            .eq('verification_status', 'pending')
            .order('created_at', { ascending: true })
            .range(offset, offset + limit - 1)

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching pending suppliers.', 500)
        }

        return successResponse(res, 'Pending suppliers retrieved successfully.', {
            suppliers: data,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / limit)
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// VERIFY OR REJECT SUPPLIER
// -----------------------------------------------
export const verifySupplier = async (req, res) => {
    try {
        const { id } = req.params
        const { action, reason } = req.body

        if (!action || !['verify', 'reject'].includes(action)) {
            return errorResponse(res, 'Action must be either verify or reject.')
        }

        const { data: supplier, error: fetchError } = await db
            .from('supplier_profiles')
            .select('id, business_name, user_id')
            .eq('id', id)
            .single()

        if (fetchError || !supplier) {
            return errorResponse(res, 'Supplier not found.', 404)
        }

        const updates = {
            verification_status: action === 'verify' ? 'verified' : 'rejected',
            verified_at: new Date().toISOString(),
            verified_by: req.user.id
        }

        const { data: updated, error: updateError } = await db
            .from('supplier_profiles')
            .update(updates)
            .eq('id', id)
            .select('id, business_name, verification_status, verified_at')
            .single()

        if (updateError) {
            console.error(updateError)
            return errorResponse(res, 'Error updating supplier verification.', 500)
        }

        // Notify supplier
        const notificationMessage = action === 'verify'
            ? 'Congratulations! Your supplier account has been verified on Thummite.'
            : `Your supplier verification was rejected. ${reason ? 'Reason: ' + reason : 'Please contact support for more information.'}`

        await db
            .from('notifications')
            .insert({
                id: uuidv4(),
                user_id: supplier.user_id,
                title: action === 'verify' ? 'Account Verified' : 'Verification Rejected',
                message: notificationMessage,
                type: 'verification',
                reference_id: id
            })

        const statusMessage = action === 'verify'
            ? `${supplier.business_name} has been verified successfully.`
            : `${supplier.business_name} verification has been rejected.`

        return successResponse(res, statusMessage, { supplier: updated })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// DELETE LISTING
// -----------------------------------------------
export const deleteListing = async (req, res) => {
    try {
        const { id } = req.params
        const { reason } = req.body

        const { data: listing, error: fetchError } = await db
            .from('product_listings')
            .select(`
                id,
                name,
                supplier_id,
                supplier_profiles (
                    user_id,
                    total_listings,
                    business_name
                )
            `)
            .eq('id', id)
            .single()

        if (fetchError || !listing) {
            return errorResponse(res, 'Listing not found.', 404)
        }

        const { error: deleteError } = await db
            .from('product_listings')
            .delete()
            .eq('id', id)

        if (deleteError) {
            console.error(deleteError)
            return errorResponse(res, 'Error deleting listing.', 500)
        }

        // Update supplier listing count
        await db
            .from('supplier_profiles')
            .update({
                total_listings: Math.max(0, listing.supplier_profiles.total_listings - 1)
            })
            .eq('id', listing.supplier_id)

        // Notify supplier
        await db
            .from('notifications')
            .insert({
                id: uuidv4(),
                user_id: listing.supplier_profiles.user_id,
                title: 'Listing Removed',
                message: `Your listing "${listing.name}" has been removed by admin. ${reason ? 'Reason: ' + reason : ''}`,
                type: 'listing',
                reference_id: id
            })

        return successResponse(res, 'Listing deleted successfully.')

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// ADD CATEGORY
// -----------------------------------------------
export const addCategory = async (req, res) => {
    try {
        const { name, description, parent_id, icon_url } = req.body

        if (!name) {
            return errorResponse(res, 'Category name is required.')
        }

        let slug = generateSlug(name)

        // Check slug uniqueness
        const { data: existingSlug } = await db
            .from('categories')
            .select('id')
            .eq('slug', slug)
            .single()

        if (existingSlug) {
            slug = `${slug}-${uuidv4().split('-')[0]}`
        }

        // Validate parent category if provided
        if (parent_id) {
            const { data: parent, error: parentError } = await db
                .from('categories')
                .select('id')
                .eq('id', parent_id)
                .single()

            if (parentError || !parent) {
                return errorResponse(res, 'Parent category not found.', 404)
            }
        }

        const { data: category, error } = await db
            .from('categories')
            .insert({
                id: uuidv4(),
                name,
                slug,
                description: description || null,
                parent_id: parent_id || null,
                icon_url: icon_url || null
            })
            .select('*')
            .single()

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error creating category.', 500)
        }

        return successResponse(res, 'Category created successfully.', { category }, 201)

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// TOGGLE CATEGORY STATUS
// -----------------------------------------------
export const toggleCategoryStatus = async (req, res) => {
    try {
        const { id } = req.params

        const { data: category, error: fetchError } = await db
            .from('categories')
            .select('id, name, is_active')
            .eq('id', id)
            .single()

        if (fetchError || !category) {
            return errorResponse(res, 'Category not found.', 404)
        }

        const { data: updated, error: updateError } = await db
            .from('categories')
            .update({ is_active: !category.is_active })
            .eq('id', id)
            .select('id, name, is_active')
            .single()

        if (updateError) {
            console.error(updateError)
            return errorResponse(res, 'Error updating category.', 500)
        }

        const action = updated.is_active ? 'activated' : 'deactivated'
        return successResponse(res, `Category ${action} successfully.`, { category: updated })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET ALL LISTINGS (admin view, all statuses)
// -----------------------------------------------
export const getAllListings = async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query
        const offset = (page - 1) * limit

        let query = db
            .from('product_listings')
            .select(`
                id,
                name,
                slug,
                status,
                price_min,
                price_max,
                view_count,
                inquiry_count,
                created_at,
                categories (
                    id,
                    name
                ),
                supplier_profiles (
                    id,
                    business_name,
                    city,
                    state,
                    verification_status
                )
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (status) query = query.eq('status', status)
        if (search) query = query.ilike('name', `%${search}%`)

        const { data, error, count } = await query

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching listings.', 500)
        }

        return successResponse(res, 'Listings retrieved successfully.', {
            listings: data,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(count / limit)
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}