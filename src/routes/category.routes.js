import express from 'express'
import { getCategories, getCategory } from '../controllers/category.controller.js'

const router = express.Router()

router.get('/', getCategories)
router.get('/:slug', getCategory)

export default router