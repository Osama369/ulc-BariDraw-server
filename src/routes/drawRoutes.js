import express from 'express';
import { getAllDraws, createDraw, updateDraw, deleteDraw } from '../controllers/drawController.js';
import { authMiddleware, adminMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Public-to-authenticated: any authenticated user may list draws (admin/distributor manage via other routes)
router.get('/', authMiddleware, getAllDraws);
router.post('/', authMiddleware, adminMiddleware, createDraw);
router.patch('/:id', authMiddleware, adminMiddleware, updateDraw);
router.delete('/:id', authMiddleware, adminMiddleware, deleteDraw);

export default router;
