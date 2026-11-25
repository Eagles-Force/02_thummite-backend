import { v4 as uuidv4 } from 'uuid'
import db from '../config/db.js'
import { successResponse, errorResponse } from '../utils/response.js'

// -----------------------------------------------
// CREATE REVIEW (buyer only)
// -----------------------------------------------
export const createReview = async (req, res) => {
    try {
        const { supplier_id, inquiry_id, rating, comment } = req.body

        // Validate required fields
        if (!supplier_id || !rating) {
            return errorResponse(res, 'Supplier and rating are required.')
        }

        // Validate rating range
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return errorResponse(res, 'Rating must be a whole number between 1 and 5.')
        }

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
            .select('id, business_name, user_id')
            .eq('id', supplier_id)
            .single()

        if (supplierError || !supplier) {
            return errorResponse(res, 'Supplier not found.', 404)
        }

        // If inquiry_id provided, validate it belongs to this buyer and supplier
        if (inquiry_id) {
            const { data: inquiry, error: inquiryError } = await db
                .from('inquiries')
                .select('id, status')
                .eq('id', inquiry_id)
                .eq('buyer_id', buyer.id)
                .eq('supplier_id', supplier_id)
                .single()

            if (inquiryError || !inquiry) {
                return errorResponse(res, 'Inquiry not found or does not belong to this transaction.', 404)
            }

            // Only allow reviews on responded or closed inquiries
            if (!['responded', 'closed'].includes(inquiry.status)) {
                return errorResponse(res, 'You can only review a supplier after they have responded to your inquiry.')
            }
        }

        // Check if review already exists for this buyer-supplier-inquiry combination
        let duplicateQuery = db
            .from('reviews')
            .select('id')
            .eq('buyer_id', buyer.id)
            .eq('supplier_id', supplier_id)

        if (inquiry_id) {
            duplicateQuery = duplicateQuery.eq('inquiry_id', inquiry_id)
        }

        const { data: existing } = await duplicateQuery.single()

        if (existing) {
            return errorResponse(res, 'You have already reviewed this supplier for this inquiry.')
        }

        // Create review
        const { data: review, error: reviewError } = await db
            .from('reviews')
            .insert({
                id: uuidv4(),
                buyer_id: buyer.id,
                supplier_id,
                inquiry_id: inquiry_id || null,
                rating,
                comment: comment || null,
                is_verified: inquiry_id ? true : false
            })
            .select(`
                id,
                rating,
                comment,
                is_verified,
                created_at,
                supplier_profiles (
                    id,
                    business_name
                ),
                buyer_profiles (
                    id,
                    buyer_type,
                    username,
                    business_name,
                    city,
                    state
                )
            `)
            .single()

        if (reviewError) {
            console.error(reviewError)
            return errorResponse(res, 'Error submitting review. Please try again.', 500)
        }

        // Notify supplier about new review
        await db
            .from('notifications')
            .insert({
                id: uuidv4(),
                user_id: supplier.user_id,
                title: 'New Review Received',
                message: `You received a ${rating}-star review${comment ? ': "' + comment.substring(0, 50) + (comment.length > 50 ? '...' : '') + '"' : '.'}`,
                type: 'review',
                reference_id: review.id
            })

        return successResponse(res, 'Review submitted successfully.', { review }, 201)

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET REVIEWS FOR A SUPPLIER (public)
// -----------------------------------------------
export const getSupplierReviews = async (req, res) => {
    try {
        const { supplier_id } = req.params
        const { page = 1, limit = 20 } = req.query
        const offset = (page - 1) * limit

        // Confirm supplier exists
        const { data: supplier, error: supplierError } = await db
            .from('supplier_profiles')
            .select('id, business_name, average_rating, total_reviews')
            .eq('id', supplier_id)
            .single()

        if (supplierError || !supplier) {
            return errorResponse(res, 'Supplier not found.', 404)
        }

        const { data, error, count } = await db
            .from('reviews')
            .select(`
                id,
                rating,
                comment,
                is_verified,
                created_at,
                buyer_profiles (
                    id,
                    buyer_type,
                    username,
                    business_name,
                    city,
                    state
                )
            `, { count: 'exact' })
            .eq('supplier_id', supplier_id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching reviews.', 500)
        }

        // Rating breakdown
        const { data: allRatings } = await db
            .from('reviews')
            .select('rating')
            .eq('supplier_id', supplier_id)

        const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
        allRatings?.forEach(r => breakdown[r.rating]++)

        return successResponse(res, 'Reviews retrieved successfully.', {
            supplier: {
                id: supplier.id,
                business_name: supplier.business_name,
                average_rating: supplier.average_rating,
                total_reviews: supplier.total_reviews
            },
            rating_breakdown: breakdown,
            reviews: data,
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
// GET MY REVIEWS (buyer sees reviews they wrote)
// -----------------------------------------------
export const getMyReviews = async (req, res) => {
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
            .from('reviews')
            .select(`
                id,
                rating,
                comment,
                is_verified,
                created_at,
                supplier_profiles (
                    id,
                    business_name,
                    city,
                    state,
                    logo_url,
                    average_rating
                )
            `, { count: 'exact' })
            .eq('buyer_id', buyer.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching reviews.', 500)
        }

        return successResponse(res, 'Reviews retrieved successfully.', {
            reviews: data,
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
// UPDATE REVIEW (buyer only, own reviews)
// -----------------------------------------------
export const updateReview = async (req, res) => {
    try {
        const { id } = req.params
        const { rating, comment } = req.body

        if (!rating && comment === undefined) {
            return errorResponse(res, 'No fields provided to update.')
        }

        if (rating && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
            return errorResponse(res, 'Rating must be a whole number between 1 and 5.')
        }

        // Get buyer profile
        const { data: buyer, error: buyerError } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (buyerError || !buyer) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        // Confirm review belongs to this buyer
        const { data: existing, error: fetchError } = await db
            .from('reviews')
            .select('id')
            .eq('id', id)
            .eq('buyer_id', buyer.id)
            .single()

        if (fetchError || !existing) {
            return errorResponse(res, 'Review not found or does not belong to you.', 404)
        }

        const updates = {}
        if (rating) updates.rating = rating
        if (comment !== undefined) updates.comment = comment

        const { data: updated, error: updateError } = await db
            .from('reviews')
            .update(updates)
            .eq('id', id)
            .select(`
                id,
                rating,
                comment,
                is_verified,
                created_at,
                supplier_profiles (
                    id,
                    business_name
                )
            `)
            .single()

        if (updateError) {
            console.error(updateError)
            return errorResponse(res, 'Error updating review. Please try again.', 500)
        }

        return successResponse(res, 'Review updated successfully.', { review: updated })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// DELETE REVIEW (buyer only, own reviews)
// -----------------------------------------------
export const deleteReview = async (req, res) => {
    try {
        const { id } = req.params

        const { data: buyer, error: buyerError } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        if (buyerError || !buyer) {
            return errorResponse(res, 'Buyer profile not found.', 404)
        }

        // Confirm review belongs to this buyer
        const { data: existing, error: fetchError } = await db
            .from('reviews')
            .select('id, supplier_id')
            .eq('id', id)
            .eq('buyer_id', buyer.id)
            .single()

        if (fetchError || !existing) {
            return errorResponse(res, 'Review not found or does not belong to you.', 404)
        }

        const { error: deleteError } = await db
            .from('reviews')
            .delete()
            .eq('id', id)

        if (deleteError) {
            console.error(deleteError)
            return errorResponse(res, 'Error deleting review. Please try again.', 500)
        }

        return successResponse(res, 'Review deleted successfully.')

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}