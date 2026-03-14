import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import archiveController from '../controllers/archiveController.js';

const router = express.Router();

router.post('/', authMiddleware, archiveController.createArchive);
router.get('/', authMiddleware, archiveController.listArchives);
router.get('/:id/download', authMiddleware, archiveController.downloadArchive);
router.delete('/:id', authMiddleware, archiveController.deleteArchive);

export default router;
