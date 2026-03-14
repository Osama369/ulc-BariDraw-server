// Party routes deprecated. Party accounts are now `User` documents with role='party'.
// This file remains for backward compatibility but routes are intentionally not registered in `app.js`.
import express from 'express';
const router = express.Router();
router.get('/', (req, res) => res.status(410).json({ error: 'Party routes deprecated. Use /api/v1/users endpoints.' }));
export default router;
