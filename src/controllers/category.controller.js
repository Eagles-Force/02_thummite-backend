import db from '../config/db.js'
import { successResponse, errorResponse } from '../utils/response.js'

// -----------------------------------------------
// GET ALL CATEGORIES (with subcategories)
// -----------------------------------------------
export const getCategories = async (req, res) => {
    try {
        const { data, error } = await db
            .from('categories')
            .select('*')
            .eq('is_active', true)
            .order('name', { ascending: true })

        if (error) {
            console.error(error)
            return errorResponse(res, 'Error fetching categories.', 500)
        }

        // Separate parents and children
        const parents = data.filter(cat => cat.parent_id === null)
        const children = data.filter(cat => cat.parent_id !== null)

        // Nest children under their parent
        const categories = parents.map(parent => ({
            ...parent,
            subcategories: children.filter(child => child.parent_id === parent.id)
        }))

        return successResponse(res, 'Categories retrieved successfully.', { categories })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}

// -----------------------------------------------
// GET SINGLE CATEGORY WITH ITS LISTINGS
// -----------------------------------------------
export const getCategory = async (req, res) => {
    try {
        const { slug } = req.params

        // Get category
        const { data: category, error } = await db
            .from('categories')
            .select('*')
            .eq('slug', slug)
            .eq('is_active', true)
            .single()

        if (error || !category) {
            return errorResponse(res, 'Category not found.', 404)
        }

        // Get subcategories if this is a parent
        const { data: subcategories } = await db
            .from('categories')
            .select('*')
            .eq('parent_id', category.id)
            .eq('is_active', true)

        // Get active listings in this category
        const { data: listings } = await db
            .from('product_listings')
            .select(`
                id,
                name,
                slug,
                price_min,
                price_max,
                unit_of_measurement,
                images,
                view_count,
                inquiry_count,
                supplier_profiles (
                    id,
                    business_name,
                    city,
                    state,
                    verification_status,
                    average_rating
                )
            `)
            .eq('category_id', category.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(20)

        return successResponse(res, 'Category retrieved successfully.', {
            category: {
                ...category,
                subcategories: subcategories || [],
                listings: listings || []
            }
        })

    } catch (err) {
        console.error(err)
        return errorResponse(res, 'Something went wrong. Please try again.', 500)
    }
}