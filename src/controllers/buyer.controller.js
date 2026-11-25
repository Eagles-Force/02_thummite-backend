import { v4 as uuidv4 } from 'uuid'
import db from '../config/db.js'
import { successResponse, errorResponse } from '../utils/response.js'

// -----------------------------------------------
// GET OWN BUYER PROFILE
// -----------------------------------------------
export const getMyProfile = async (req, res) => {
    try {
        const { data: profile, error } = await db
            .from('buyer_profiles')
            .select('*')
            .eq('user_id', req.user.id)
            .single()

        if (error || !profile) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        return successResponse(res, 'Profile retrieved successfully.', { profile })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// UPDATE OWN BUYER PROFILE
// -----------------------------------------------
export const updateMyProfile = async (req, res) => {
    try {
        const { username, business_name, industry, address, city, state } = req.body
        const { data: existing, error: fetchError } = await db
            .from('buyer_profiles').select('id, buyer_type').eq('user_id', req.user.id).single()
        if (fetchError || !existing) return errorResponse(res, 'Buyer profile not found.', 404)

        const updates = {}
        if (existing.buyer_type === 'individual' && username !== undefined) {
            if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(String(username).trim())) return errorResponse(res, 'Username must be 3–50 characters using letters, numbers, dots, underscores or hyphens.')
            updates.username = String(username).trim()
        }
        if (existing.buyer_type === 'organisation' && business_name !== undefined) {
            if (String(business_name).trim().length < 2) return errorResponse(res, 'Organisation name is required.')
            updates.business_name = String(business_name).trim()
        }
        for (const field of ['industry', 'address', 'city', 'state']) {
            if (req.body[field] !== undefined) updates[field] = req.body[field] || null
        }
        if (!Object.keys(updates).length) return errorResponse(res, 'No editable fields provided.')

        const { data: updated, error: updateError } = await db
            .from('buyer_profiles').update(updates).eq('id', existing.id).select('*').single()
        if (updateError) {
            if (updateError.code === '23505') return errorResponse(res, 'That username is already in use.', 409)
            console.error(updateError)
            return errorResponse(res, 'Error updating profile. Please try again.', 500)
        }
        return successResponse(res, 'Profile updated successfully.', { profile: updated })
    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// SAVE A SUPPLIER
// -----------------------------------------------
export const saveSupplier = async (req, res) => {
    try {
        const { supplier_id } = req.params

        // Get buyer profile
        const { data: buyer, error: buyerError } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (buyerError || !buyer) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        // Confirm supplier exists
        const { data: supplier, error: supplierError } = await db
            .from('supplier_profiles')
            .select('id, business_name')
            .eq('id', supplier_id)
            .single()

        if (supplierError || !supplier) {
            return errorResponse(res, 'Supplier not found.', 404)
        }

        // Check if already saved
        const { data: existing } = await db
            .from('saved_suppliers')
            .select('id')
            .eq('buyer_id', buyer.id)
            .eq('supplier_id', supplier_id)
            .single()

        if (existing) {
            return errorResponse(res, 'Supplier already saved.')
        }

        const { error: saveError } = await db
            .from('saved_suppliers')
            .insert({
                id: uuidv4(),
                buyer_id: buyer.id,
                supplier_id
            })

        if (saveError) {
            console.error(saveError)
            return errorResponse(res, 'Error saving supplier. Please try again.', 500)
        }

        return successResponse(res, `${supplier.business_name} saved successfully.`)

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// UNSAVE A SUPPLIER
// -----------------------------------------------
export const unsaveSupplier = async (req, res) => {
    try {
        const { supplier_id } = req.params

        const { data: buyer, error: buyerError } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (buyerError || !buyer) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        const { error: deleteError } = await db
            .from('saved_suppliers')
            .delete()
            .eq('buyer_id', buyer.id)
            .eq('supplier_id', supplier_id)

        if (deleteError) {
            console.error(deleteError)
            return errorResponse(res, 'Error removing saved supplier. Please try again.', 500)
        }

        return successResponse(res, 'Supplier removed from saved list.')

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET SAVED SUPPLIERS
// -----------------------------------------------
export const getSavedSuppliers = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query
        const offset = (page - 1) * limit

        const { data: buyer, error: buyerError } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (buyerError || !buyer) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        const { data, error, count } = await db
            .from('saved_suppliers')
            .select(`
                id,
                created_at,
                supplier_profiles (
                    id,
                    business_name,
                    business_description,
                    logo_url,
                    city,
                    state,
                    verification_status,
                    subscription_tier,
                    average_rating,
                    total_reviews,
                    total_listings,
                    whatsapp_number
                )
            `, { count: 'exact' })
            .eq('buyer_id', buyer.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching saved suppliers.', 500)
        }

        return successResponse(res, 'Saved suppliers retrieved successfully.', {
            saved_suppliers: data,
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
// SAVE A LISTING
// -----------------------------------------------
export const saveListing = async (req, res) => {
    try {
        const { listing_id } = req.params

        const { data: buyer, error: buyerError } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (buyerError || !buyer) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        // Confirm listing exists
        const { data: listing, error: listingError } = await db
            .from('product_listings')
            .select('id, name')
            .eq('id', listing_id)
            .single()

        if (listingError || !listing) {
            return errorResponse(res, 'Listing not found.', 404)
        }

        // Check if already saved
        const { data: existing } = await db
            .from('saved_listings')
            .select('id')
            .eq('buyer_id', buyer.id)
            .eq('listing_id', listing_id)
            .single()

        if (existing) {
            return errorResponse(res, 'Listing already saved.')
        }

        const { error: saveError } = await db
            .from('saved_listings')
            .insert({
                id: uuidv4(),
                buyer_id: buyer.id,
                listing_id
            })

        if (saveError) {
            console.error(saveError)
            return errorResponse(res, 'Error saving listing. Please try again.', 500)
        }

        return successResponse(res, `${listing.name} saved successfully.`)

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// UNSAVE A LISTING
// -----------------------------------------------
export const unsaveListing = async (req, res) => {
    try {
        const { listing_id } = req.params

        const { data: buyer, error: buyerError } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (buyerError || !buyer) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        const { error: deleteError } = await db
            .from('saved_listings')
            .delete()
            .eq('buyer_id', buyer.id)
            .eq('listing_id', listing_id)

        if (deleteError) {
            console.error(deleteError)
            return errorResponse(res, 'Error removing saved listing. Please try again.', 500)
        }

        return successResponse(res, 'Listing removed from saved list.')

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET SAVED LISTINGS
// -----------------------------------------------
export const getSavedListings = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query
        const offset = (page - 1) * limit

        const { data: buyer, error: buyerError } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (buyerError || !buyer) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        const { data, error, count } = await db
            .from('saved_listings')
            .select(`
                id,
                created_at,
                product_listings (
                    id,
                    name,
                    slug,
                    price_min,
                    price_max,
                    currency,
                    unit_of_measurement,
                    minimum_order_quantity,
                    images,
                    status,
                    view_count,
                    inquiry_count,
                    categories (
                        id,
                        name,
                        slug
                    ),
                    supplier_profiles (
                        id,
                        business_name,
                        city,
                        state,
                        verification_status,
                        average_rating,
                        logo_url
                    )
                )
            `, { count: 'exact' })
            .eq('buyer_id', buyer.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching saved listings.', 500)
        }

        return successResponse(res, 'Saved listings retrieved successfully.', {
            saved_listings: data,
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