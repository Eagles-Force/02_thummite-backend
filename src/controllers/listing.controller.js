import { v4 as uuidv4 } from 'uuid'
import db from '../config/db.js'
import { successResponse, errorResponse } from '../utils/response.js'
import { generateSlug } from '../utils/slug.js'

// -----------------------------------------------
// CREATE LISTING (supplier only)
// -----------------------------------------------
export const createListing = async (req, res) => {
    try {
        const {
            category_id,
            name,
            description,
            price_min,
            price_max,
            currency,
            unit_of_measurement,
            minimum_order_quantity,
            lead_time_days,
            images,
            specifications,
            tags
        } = req.body

        // Validate required fields
        if (!category_id || !name || !unit_of_measurement) {
            return errorResponse(res, 'Category, name and unit of measurement are required.')
        }

        // Get supplier profile
        const { data: supplier, error: supplierError } = await db
            .from('supplier_profiles')
            .select('id, subscription_tier, total_listings')
            .eq('user_id', req.user.id)
            .single()

        if (supplierError || !supplier) {
            return errorResponse(res, 'Supplier profile not found.', 404)
        }

        // Enforce free tier listing limit of 5
        if (supplier.subscription_tier === 'free' && supplier.total_listings >= 5) {
            return errorResponse(
                res,
                'Free plan is limited to 5 listings. Upgrade to standard or premium for unlimited listings.',
                403
            )
        }

        // Validate category exists
        const { data: category, error: categoryError } = await db
            .from('categories')
            .select('id')
            .eq('id', category_id)
            .eq('is_active', true)
            .single()

        if (categoryError || !category) {
            return errorResponse(res, 'Invalid category selected.', 400)
        }

        // Generate unique slug
        let slug = generateSlug(name)
        const { data: existingSlug } = await db
            .from('product_listings')
            .select('id')
            .eq('slug', slug)
            .single()

        // If slug exists append short unique id
        if (existingSlug) {
            slug = `${slug}-${uuidv4().split('-')[0]}`
        }

        // Create the listing
        const { data: listing, error: listingError } = await db
            .from('product_listings')
            .insert({
                id: uuidv4(),
                supplier_id: supplier.id,
                category_id,
                name,
                slug,
                description: description || null,
                price_min: price_min || null,
                price_max: price_max || null,
                currency: currency || 'NGN',
                unit_of_measurement,
                minimum_order_quantity: minimum_order_quantity || null,
                lead_time_days: lead_time_days || null,
                images: images || [],
                specifications: specifications || {},
                tags: tags || [],
                status: 'active'
            })
            .select(`
                *,
                categories (
                    id,
                    name,
                    slug
                )
            `)
            .single()

        if (listingError) {
            console.error(listingError)
            return errorResponse(res, 'Error creating listing. Please try again.', 500)
        }

        // Update supplier total_listings count
        await db
            .from('supplier_profiles')
            .update({ total_listings: supplier.total_listings + 1 })
            .eq('id', supplier.id)

        return successResponse(res, 'Listing created successfully.', { listing }, 201)

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET ALL LISTINGS (public, with search & filters)
// -----------------------------------------------
export const getListings = async (req, res) => {
    try {
        const {
            search,
            category_id,
            state,
            city,
            price_min,
            price_max,
            status = 'active',
            page = 1,
            limit = 20
        } = req.query

        const offset = (page - 1) * limit

        let query = db
            .from('product_listings')
            .select(`
                id,
                name,
                slug,
                description,
                price_min,
                price_max,
                currency,
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
            `, { count: 'exact' })
            .eq('status', status)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        // Apply filters
        if (category_id) query = query.eq('category_id', category_id)
        if (price_min) query = query.gte('price_min', price_min)
        if (price_max) query = query.lte('price_max', price_max)
        if (search) query = query.textSearch('search_vector', search, {
            type: 'websearch',
            config: 'english'
        })

        // Filter by supplier location
        if (state) {
            query = query.eq('supplier_profiles.state', state)
        }
        if (city) {
            query = query.eq('supplier_profiles.city', city)
        }

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

// -----------------------------------------------
// GET SINGLE LISTING (public)
// -----------------------------------------------
export const getListing = async (req, res) => {
    try {
        const { slug } = req.params

        const { data: listing, error } = await db
            .from('product_listings')
            .select(`
                *,
                categories (
                    id,
                    name,
                    slug
                ),
                supplier_profiles (
                    id,
                    business_name,
                    business_description,
                    city,
                    state,
                    address,
                    whatsapp_number,
                    verification_status,
                    subscription_tier,
                    average_rating,
                    total_reviews,
                    logo_url,
                    users!supplier_profiles_user_id_fkey (
                        email,
                        phone
                    )
                )
            `)
            .eq('slug', slug)
            .single()

        if (error || !listing) {
            return errorResponse(res, 'Listing not found.', 404)
        }

        // Increment view count
        await db
            .from('product_listings')
            .update({ view_count: listing.view_count + 1 })
            .eq('id', listing.id)

        return successResponse(res, 'Listing retrieved successfully.', {
            listing: {
                ...listing,
                view_count: listing.view_count + 1
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// UPDATE LISTING (supplier only, own listings)
// -----------------------------------------------
export const updateListing = async (req, res) => {
    try {
        const { id } = req.params

        // Get supplier profile
        const { data: supplier } = await db
            .from('supplier_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (!supplier) {
            return errorResponse(res, 'Supplier profile not found.', 404)
        }

        // Confirm listing belongs to this supplier
        const { data: existing, error: fetchError } = await db
            .from('product_listings')
            .select('id')
            .eq('id', id)
            .eq('supplier_id', supplier.id)
            .single()

        if (fetchError || !existing) {
            return errorResponse(res, 'Listing not found or does not belong to you.', 404)
        }

        const {
            category_id,
            name,
            description,
            price_min,
            price_max,
            currency,
            unit_of_measurement,
            minimum_order_quantity,
            lead_time_days,
            images,
            specifications,
            tags,
            status,
            stock_available
        } = req.body

        // Build update object with only provided fields
        const updates = {}
        if (category_id) updates.category_id = category_id
        if (name) updates.name = name
        if (description !== undefined) updates.description = description
        if (price_min !== undefined) updates.price_min = price_min
        if (price_max !== undefined) updates.price_max = price_max
        if (currency) updates.currency = currency
        if (unit_of_measurement) updates.unit_of_measurement = unit_of_measurement
        if (minimum_order_quantity !== undefined) updates.minimum_order_quantity = minimum_order_quantity
        if (lead_time_days !== undefined) updates.lead_time_days = lead_time_days
        if (images) updates.images = images
        if (specifications) updates.specifications = specifications
        if (tags) updates.tags = tags
        if (status) updates.status = status
        if (stock_available !== undefined) updates.stock_available = stock_available

        if (Object.keys(updates).length === 0) {
            return errorResponse(res, 'No fields provided to update.')
        }

        const { data: updated, error: updateError } = await db
            .from('product_listings')
            .update(updates)
            .eq('id', id)
            .select(`
                *,
                categories (
                    id,
                    name,
                    slug
                )
            `)
            .single()

        if (updateError) {
            console.error(updateError)
            return errorResponse(res, 'Error updating listing. Please try again.', 500)
        }

        return successResponse(res, 'Listing updated successfully.', { listing: updated })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// DELETE LISTING (supplier only, own listings)
// -----------------------------------------------
export const deleteListing = async (req, res) => {
    try {
        const { id } = req.params

        // Get supplier profile
        const { data: supplier } = await db
            .from('supplier_profiles')
            .select('id, total_listings')
            .eq('user_id', req.user.id)
            .single()

        if (!supplier) {
            return errorResponse(res, 'Supplier profile not found.', 404)
        }

        // Confirm listing belongs to this supplier
        const { data: existing, error: fetchError } = await db
            .from('product_listings')
            .select('id')
            .eq('id', id)
            .eq('supplier_id', supplier.id)
            .single()

        if (fetchError || !existing) {
            return errorResponse(res, 'Listing not found or does not belong to you.', 404)
        }

        const { error: deleteError } = await db
            .from('product_listings')
            .delete()
            .eq('id', id)

        if (deleteError) {
            console.error(deleteError)
            return errorResponse(res, 'Error deleting listing. Please try again.', 500)
        }

        // Decrement supplier total_listings count
        await db
            .from('supplier_profiles')
            .update({ total_listings: Math.max(0, supplier.total_listings - 1) })
            .eq('id', supplier.id)

        return successResponse(res, 'Listing deleted successfully.')

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}