import express from 'express';
import { listInvoices, downloadInvoicePdf, generateInvoicePdf } from '../controllers/invoiceController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// List invoices (supports ?archiveId=, ?drawId=, ?partyId=, ?invoiceNo=)
router.get('/', authMiddleware, listInvoices);

// Download invoice PDF (generates if missing)
router.get('/:id/download', authMiddleware, downloadInvoicePdf);

// Regenerate / generate PDF for invoice
router.post('/:id/generate-pdf', authMiddleware, generateInvoicePdf);

export default router;
