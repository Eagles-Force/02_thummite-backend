import db from '../config/db.js'
import { successResponse, errorResponse } from '../utils/response.js'

// -----------------------------------------------
// GET ALL SUPPLIERS (public, with filters)
// -----------------------------------------------
export const getSuppliers = async (req, res) => {
    try {
        const {
            state,
            city,
            category_id,
            verification_status,
            subscription_tier,
            search,
            page = 1,
            limit = 20
        } = req.query

        const offset = (page - 1) * limit

        let query = db
            .from('supplier_profiles')
            .select(`
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
                created_at,
                users!supplier_profiles_user_id_fkey (
                    email,
                    phone
                )
            `, { count: 'exact' })
            .order('subscription_tier', { ascending: false })  // premium first
            .order('average_rating', { ascending: false })
            .range(offset, offset + limit - 1)

        // Apply filters
        if (state) query = query.ilike('state', `%${state}%`)
        if (city) query = query.ilike('city', `%${city}%`)
        if (verification_status) query = query.eq('verification_status', verification_status)
        if (subscription_tier) query = query.eq('subscription_tier', subscription_tier)
        if (search) query = query.ilike('business_name', `%${search}%`)

        const { data, error, count } = await query

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching suppliers.', 500)
        }

        return successResponse(res, 'Suppliers retrieved successfully.', {
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
// GET SINGLE SUPPLIER (public)
// -----------------------------------------------
export const getSupplier = async (req, res) => {
    try {
        const { id } = req.params

        // Get supplier profile
        const { data: supplier, error } = await db
            .from('supplier_profiles')
            .select(`
                *,
                users!supplier_profiles_user_id_fkey (
                    email,
                    phone
                )
            `)
            .eq('id', id)
            .single()

        if (error || !supplier) {
            return errorResponse(res, 'Supplier not found.', 404)
        }

        // Get their active listings
        const { data: listings } = await db
            .from('product_listings')
            .select(`
                id,
                name,
                slug,
                price_min,
                price_max,
                unit_of_measurement,
                minimum_order_quantity,
                images,
                status,
                view_count,
                inquiry_count,
                created_at,
                categories (
                    id,
                    name,
                    slug
                )
            `)
            .eq('supplier_id', supplier.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })

        // Get their reviews
        const { data: reviews } = await db
            .from('reviews')
            .select(`
                id,
                rating,
                comment,
                created_at,
                buyer_profiles (
                    business_name,
                    city,
                    state
                )
            `)
            .eq('supplier_id', supplier.id)
            .order('created_at', { ascending: false })
            .limit(10)

        // Increment view count on listings
        if (listings && listings.length > 0) {
            listings.forEach(async (listing) => {
                await db
                    .from('product_listings')
                    .update({ view_count: listing.view_count + 1 })
                    .eq('id', listing.id)
            })
        }

        return successResponse(res, 'Supplier retrieved successfully.', {
            supplier: {
                ...supplier,
                listings: listings || [],
                reviews: reviews || []
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// UPDATE SUPPLIER PROFILE (protected, supplier only)
// -----------------------------------------------
export const updateSupplierProfile = async (req, res) => {
    try {
        const {
            business_name,
            business_description,
            cac_number,
            address,
            city,
            state,
            latitude,
            longitude,
            whatsapp_number,
            website_url,
            logo_url,
            banner_url
        } = req.body

        // Get supplier profile linked to logged in user
        const { data: existing, error: fetchError } = await db
            .from('supplier_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (fetchError || !existing) {
            return errorResponse(res, 'Supplier profile not found.', 404)
        }

        // Build update object with only provided fields
        const updates = {}
        if (business_name) updates.business_name = business_name
        if (business_description) updates.business_description = business_description
        if (cac_number) updates.cac_number = cac_number
        if (address) updates.address = address
        if (city) updates.city = city
        if (state) updates.state = state
        if (latitude) updates.latitude = latitude
        if (longitude) updates.longitude = longitude
        if (whatsapp_number) updates.whatsapp_number = whatsapp_number
        if (website_url) updates.website_url = website_url
        if (logo_url) updates.logo_url = logo_url
        if (banner_url) updates.banner_url = banner_url

        if (Object.keys(updates).length === 0) {
            return errorResponse(res, 'No fields provided to update.')
        }

        const { data: updated, error: updateError } = await db
            .from('supplier_profiles')
            .update(updates)
            .eq('id', existing.id)
            .select('*')
            .single()

        if (updateError) {
            console.error(updateError)
            return errorResponse(res, 'Error updating profile. Please try again.', 500)
        }

        return successResponse(res, 'Profile updated successfully.', {
            profile: updated
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET OWN SUPPLIER PROFILE (protected, supplier only)
// -----------------------------------------------
export const getMyProfile = async (req, res) => {
    try {
        const { data: profile, error } = await db
            .from('supplier_profiles')
            .select('*')
            .eq('user_id', req.user.id)
            .single()

        if (error || !profile) {
            return errorResponse(res, 'Supplier profile not found.', 404)
        }

        // Get their listings including inactive ones
        const { data: listings } = await db
            .from('product_listings')
            .select(`
                id,
                name,
                slug,
                price_min,
                price_max,
                unit_of_measurement,
                status,
                view_count,
                inquiry_count,
                created_at,
                categories (
                    id,
                    name,
                    slug
                )
            `)
            .eq('supplier_id', profile.id)
            .order('created_at', { ascending: false })

        return successResponse(res, 'Profile retrieved successfully.', {
            profile: {
                ...profile,
                listings: listings || []
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}