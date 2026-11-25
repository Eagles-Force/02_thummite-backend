import { v4 as uuidv4 } from 'uuid'
import db from '../config/db.js'
import { successResponse, errorResponse } from '../utils/response.js'

// -----------------------------------------------
// CREATE INQUIRY (buyer only)
// -----------------------------------------------
export const createInquiry = async (req, res) => {
    try {
        const {
            supplier_id,
            listing_id,
            subject,
            message,
            quantity_needed,
            unit
        } = req.body

        // Validate required fields
        if (!supplier_id || !message) {
            return errorResponse(res, 'Supplier and message are required.')
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
            .select('id, user_id, total_inquiries')
            .eq('id', supplier_id)
            .single()

        if (supplierError || !supplier) {
            return errorResponse(res, 'Supplier not found.', 404)
        }

        // Prevent supplier from inquiring themselves
        if (req.user.id === supplier.user_id) {
            return errorResponse(res, 'You cannot send an inquiry to yourself.')
        }

        // Validate listing belongs to supplier if provided
        if (listing_id) {
            const { data: listing, error: listingError } = await db
                .from('product_listings')
                .select('id')
                .eq('id', listing_id)
                .eq('supplier_id', supplier_id)
                .single()

            if (listingError || !listing) {
                return errorResponse(res, 'Listing not found or does not belong to this supplier.', 404)
            }
        }

        // Create inquiry
        const inquiryId = uuidv4()
        const { data: inquiry, error: inquiryError } = await db
            .from('inquiries')
            .insert({
                id: inquiryId,
                buyer_id: buyer.id,
                supplier_id: supplier.id,
                listing_id: listing_id || null,
                subject: subject || null,
                message,
                quantity_needed: quantity_needed || null,
                unit: unit || null,
                status: 'pending'
            })
            .select(`
                *,
                supplier_profiles (
                    id,
                    business_name,
                    city,
                    state,
                    whatsapp_number,
                    logo_url
                ),
                product_listings (
                    id,
                    name,
                    slug,
                    unit_of_measurement
                )
            `)
            .single()

        if (inquiryError) {
            console.error(inquiryError)
            return errorResponse(res, 'Error sending inquiry. Please try again.', 500)
        }

        // Create first message from the inquiry message itself
        await db
            .from('inquiry_messages')
            .insert({
                id: uuidv4(),
                inquiry_id: inquiryId,
                sender_id: req.user.id,
                message
            })

        // Update supplier total_inquiries count
        await db
            .from('supplier_profiles')
            .update({ total_inquiries: supplier.total_inquiries + 1 })
            .eq('id', supplier.id)

        // Create notification for supplier
        await db
            .from('notifications')
            .insert({
                id: uuidv4(),
                user_id: supplier.user_id,
                title: 'New Inquiry Received',
                message: `You have a new inquiry${listing_id ? ' about one of your listings' : ''}.`,
                type: 'inquiry',
                reference_id: inquiryId
            })

        return successResponse(res, 'Inquiry sent successfully.', { inquiry }, 201)

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET OWN INQUIRIES
// Buyers see inquiries they sent
// Suppliers see inquiries they received
// -----------------------------------------------
export const getInquiries = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query
        const offset = (page - 1) * limit
        const { role } = req.user

        let query = db
            .from('inquiries')
            .select(`
                id,
                subject,
                message,
                quantity_needed,
                unit,
                status,
                responded_at,
                created_at,
                product_listings (
                    id,
                    name,
                    slug,
                    images
                ),
                supplier_profiles (
                    id,
                    business_name,
                    city,
                    state,
                    logo_url
                ),
                buyer_profiles (
                    id,
                    buyer_type,
                    username,
                    business_name,
                    city,
                    state
                )
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        // Filter based on role
        if (role === 'buyer') {
            const { data: buyer } = await db
                .from('buyer_profiles')
                .select('id')
                .eq('user_id', req.user.id)
                .single()

            if (!buyer) return errorResponse(res, 'Buyer profile not found.', 404)
            query = query.eq('buyer_id', buyer.id)
        }

        if (role === 'supplier') {
            const { data: supplier } = await db
                .from('supplier_profiles')
                .select('id')
                .eq('user_id', req.user.id)
                .single()

            if (!supplier) return errorResponse(res, 'Supplier profile not found.', 404)
            query = query.eq('supplier_id', supplier.id)
        }

        if (status) query = query.eq('status', status)

        const { data, error, count } = await query

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching inquiries.', 500)
        }

        return successResponse(res, 'Inquiries retrieved successfully.', {
            inquiries: data,
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
// GET SINGLE INQUIRY WITH MESSAGES
// -----------------------------------------------
export const getInquiry = async (req, res) => {
    try {
        const { id } = req.params

        const { data: inquiry, error } = await db
            .from('inquiries')
            .select(`
                *,
                product_listings (
                    id,
                    name,
                    slug,
                    price_min,
                    price_max,
                    unit_of_measurement,
                    images
                ),
                supplier_profiles (
                    id,
                    business_name,
                    city,
                    state,
                    whatsapp_number,
                    logo_url,
                    users!supplier_profiles_user_id_fkey (
                        email,
                        phone
                    )
                ),
                buyer_profiles (
                    id,
                    buyer_type,
                    username,
                    business_name,
                    city,
                    state,
                    users!buyer_profiles_user_id_fkey (
                        email,
                        phone
                    )
                )
            `)
            .eq('id', id)
            .single()

        if (error || !inquiry) {
            return errorResponse(res, 'Inquiry not found.', 404)
        }

        // Confirm this inquiry belongs to the requesting user
        const { data: buyer } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        const { data: supplier } = await db
            .from('supplier_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        const isBuyer = buyer && inquiry.buyer_id === buyer.id
        const isSupplier = supplier && inquiry.supplier_id === supplier.id

        if (!isBuyer && !isSupplier) {
            return errorResponse(res, 'You do not have access to this inquiry.', 403)
        }

        // Get all messages in this inquiry
        const { data: messages } = await db
            .from('inquiry_messages')
            .select(`
                id,
                message,
                attachments,
                is_read,
                created_at,
                users (
                    id,
                    role
                )
            `)
            .eq('inquiry_id', id)
            .order('created_at', { ascending: true })

        // Mark unread messages as read
        await db
            .from('inquiry_messages')
            .update({ is_read: true })
            .eq('inquiry_id', id)
            .neq('sender_id', req.user.id)

        return successResponse(res, 'Inquiry retrieved successfully.', {
            inquiry: {
                ...inquiry,
                messages: messages || []
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// REPLY TO INQUIRY (buyer or supplier)
// -----------------------------------------------
export const replyToInquiry = async (req, res) => {
    try {
        const { id } = req.params
        const { message, attachments } = req.body

        if (!message) {
            return errorResponse(res, 'Message is required.')
        }

        // Get inquiry
        const { data: inquiry, error: inquiryError } = await db
            .from('inquiries')
            .select('id, buyer_id, supplier_id, status')
            .eq('id', id)
            .single()

        if (inquiryError || !inquiry) {
            return errorResponse(res, 'Inquiry not found.', 404)
        }

        // Confirm inquiry is not closed
        if (inquiry.status === 'closed' || inquiry.status === 'cancelled') {
            return errorResponse(res, 'This inquiry is closed and cannot receive new messages.')
        }

        // Confirm sender is part of this inquiry
        const { data: buyer } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .maybeSingle()

        const { data: supplier } = await db
            .from('supplier_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .maybeSingle()

        const isBuyer = Boolean(buyer && inquiry.buyer_id === buyer.id)
        const isSupplier = Boolean(supplier && inquiry.supplier_id === supplier.id)
        if (!isBuyer && !isSupplier) return errorResponse(res, 'You do not have access to this inquiry.', 403)

        // Resolve the other participant's users.id. inquiry.buyer_id is a buyer_profiles.id,
        // not a users.id, so it must never be written directly to notifications.user_id.
        const recipientTable = isBuyer ? 'supplier_profiles' : 'buyer_profiles'
        const recipientProfileId = isBuyer ? inquiry.supplier_id : inquiry.buyer_id
        const { data: recipientProfile, error: recipientError } = await db
            .from(recipientTable)
            .select('user_id')
            .eq('id', recipientProfileId)
            .single()
        if (recipientError || !recipientProfile?.user_id) {
            return errorResponse(res, 'Unable to locate the other participant on this inquiry.', 500)
        }

        // Create message
        const { data: newMessage, error: messageError } = await db
            .from('inquiry_messages')
            .insert({
                id: uuidv4(),
                inquiry_id: id,
                sender_id: req.user.id,
                message,
                attachments: attachments || []
            })
            .select()
            .single()

        if (messageError) {
            console.error(messageError)
            return errorResponse(res, 'Error sending message. Please try again.', 500)
        }

        // If supplier is replying for first time update responded_at
        if (isSupplier && inquiry.status === 'pending') {
            await db
                .from('inquiries')
                .update({
                    status: 'responded',
                    responded_at: new Date().toISOString()
                })
                .eq('id', id)
        }

        // Notify the other party
        const recipientId = recipientProfile.user_id
        if (recipientId) {
            await db
                .from('notifications')
                .insert({
                    id: uuidv4(),
                    user_id: recipientId,
                    title: 'New Message on Inquiry',
                    message: 'You have a new message on one of your inquiries.',
                    type: 'inquiry',
                    reference_id: id
                })
        }

        return successResponse(res, 'Message sent successfully.', { message: newMessage }, 201)

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// UPDATE INQUIRY STATUS (supplier or buyer)
// -----------------------------------------------
export const updateInquiryStatus = async (req, res) => {
    try {
        const { id } = req.params
        const { status } = req.body

        const validStatuses = ['responded', 'closed', 'cancelled']
        if (!status || !validStatuses.includes(status)) {
            return errorResponse(res, `Status must be one of: ${validStatuses.join(', ')}`)
        }

        // Get inquiry
        const { data: inquiry, error: inquiryError } = await db
            .from('inquiries')
            .select('id, buyer_id, supplier_id, status')
            .eq('id', id)
            .single()

        if (inquiryError || !inquiry) {
            return errorResponse(res, 'Inquiry not found.', 404)
        }

        // Confirm user is part of this inquiry
        const { data: buyer } = await db
            .from('buyer_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        const { data: supplier } = await db
            .from('supplier_profiles')
            .select('id')
            .eq('user_id', req.user.id)
            .single()

        const isBuyer = buyer && inquiry.buyer_id === buyer.id
        const isSupplier = supplier && inquiry.supplier_id === supplier.id

        if (!isBuyer && !isSupplier) {
            return errorResponse(res, 'You do not have access to this inquiry.', 403)
        }

        // Build update
        const updates = { status }
        if (status === 'closed') updates.closed_at = new Date().toISOString()

        const { data: updated, error: updateError } = await db
            .from('inquiries')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (updateError) {
            console.error(updateError)
            return errorResponse(res, 'Error updating inquiry. Please try again.', 500)
        }

        return successResponse(res, 'Inquiry status updated successfully.', { inquiry: updated })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}