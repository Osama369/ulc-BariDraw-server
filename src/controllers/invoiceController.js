import fs from 'fs';
import path from 'path';
import os from 'os';
import PDFDocument from 'pdfkit';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';
import Draw from '../models/Draw.js';
import OverlimitArchive from '../models/OverlimitArchive.js';

// Helper to generate PDF for an invoice and update invoice.pdfPath
async function generatePdfForInvoice(inv) {
  // populate related data for nicer invoice
  const invoice = await Invoice.findById(inv._id).lean();
  const creator = invoice && invoice.creator ? await User.findById(invoice.creator).lean() : null;
  const party = invoice && invoice.partyId ? await User.findById(invoice.partyId).lean() : null;
  const draw = invoice && invoice.drawId ? await Draw.findById(invoice.drawId).lean() : null;
  const archive = invoice && invoice.archiveId ? await OverlimitArchive.findById(invoice.archiveId).lean() : null;

  const downloadsDir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

  const filename = `invoice_${invoice.invoiceNo || String(invoice._id)}.pdf`;
  const pdfPath = path.join(downloadsDir, filename);
  // Determine a user-friendly archive display name before creating the PDF stream.
  // Prefer stored fileName, then filePath basename, otherwise attempt a lookup by invoice.archiveId
  // and finally fall back to the raw id with .zip
  let archiveDisplay = '';
  if (archive && archive.fileName) {
    archiveDisplay = archive.fileName;
  } else if (archive && archive.filePath) {
    archiveDisplay = path.basename(String(archive.filePath));
  } else if (invoice && invoice.archiveId) {
    try {
      const resolved = await OverlimitArchive.findById(invoice.archiveId).lean();
      if (resolved && resolved.fileName) archiveDisplay = resolved.fileName;
      else if (resolved && resolved.filePath) archiveDisplay = path.basename(String(resolved.filePath));
    } catch (e) {
      // ignore lookup errors and fall back
    }
    if (!archiveDisplay) archiveDisplay = `${String(invoice.archiveId)}.zip`;
  }

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Header: distributor (creator) + Dealer ID on next line
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text(creator?.username || 'Distributor', { align: 'left' });
    if (creator?.dealerId) doc.font('Helvetica').fontSize(10).fillColor('#333').text(`Dealer ID: ${creator.dealerId}`, { align: 'left' });
    doc.moveDown(0.8);

    // Invoice meta (INVOICE # prominent)
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(`INVOICE #${invoice.invoiceNo || ''}`, { align: 'left' });
    doc.moveDown(0.4);

    const drawDate = draw?.draw_date ? new Date(draw.draw_date).toLocaleDateString() : '';
    doc.font('Helvetica').fontSize(10).fillColor('#000').text(`Draw Date: ${drawDate}`);
    doc.text(`Prize Type: ${invoice.prizeType || ''}`);
    doc.text(`Party: ${party?.username || ''} ${party?.partyCode ? `(${party.partyCode})` : ''}`);
    if (archiveDisplay) doc.text(`Archive: ${archiveDisplay}`);
    doc.moveDown();

    // Table header with light gray background
    const tableTop = doc.y;
    const startX = doc.page.margins.left;
    const col1 = startX + 10; // NUMBER
    const col2 = startX + 180; // F PRIZE
    const col3 = startX + 330; // S PRIZE
    const headerHeight = 18;
    doc.rect(startX, tableTop - 4, doc.page.width - doc.page.margins.left - doc.page.margins.right, headerHeight).fill('#f3f4f6');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('Number', col1, tableTop, { continued: false });
    doc.text('F Prize', col2, tableTop, { continued: false });
    doc.text('S Prize', col3, tableTop);
    doc.moveDown(1.0);

    // Records
    const records = Array.isArray(invoice.records) && invoice.records.length ? invoice.records : (Array.isArray(inv.records) ? inv.records : []);
    doc.font('Helvetica').fontSize(10).fillColor('#000');
    records.forEach(r => {
      const number = r.number || r.uniqueId || '';
      const fp = Number(r.fPrize ?? r.firstPrice ?? 0).toFixed(2);
      const sp = Number(r.sPrize ?? r.secondPrice ?? 0).toFixed(2);
      doc.text(number, col1, doc.y, { continued: false });
      doc.text(fp, col2, doc.y, { continued: false });
      doc.text(sp, col3, doc.y);
      doc.moveDown(0.4);
    });

    // Summary
    doc.moveDown(0.6);
    const totalRecords = invoice.recordCount || records.length;
    const totalPrize = records.reduce((s, x) => s + Number(x.fPrize ?? x.firstPrice ?? 0) + Number(x.sPrize ?? x.secondPrice ?? 0), 0);
    const highest = invoice.highestRecord || records.reduce((best, x) => {
      const f = Number(x.fPrize ?? x.firstPrice ?? 0);
      const s = Number(x.sPrize ?? x.secondPrice ?? 0);
      const t = f + s;
      if (!best || t > (best.fPrize + best.sPrize) || (t === (best.fPrize + best.sPrize) && parseInt(String(x.number || x.uniqueId).replace(/[^0-9]/g, ''), 10) > parseInt(String(best.number || '').replace(/[^0-9]/g, ''), 10))) {
        return { number: x.number || x.uniqueId, fPrize: f, sPrize: s };
      }
      return best;
    }, null);

    doc.font('Helvetica-Bold').fontSize(10).text(`Total records: `, { continued: true }).font('Helvetica').text(`${totalRecords}`);
    doc.font('Helvetica-Bold').text(`Record type: `, { continued: true }).font('Helvetica').text(`${invoice.prizeType || ''}`);
    doc.font('Helvetica-Bold').text(`Total prize: `, { continued: true }).font('Helvetica').text(`${Number(totalPrize).toFixed(2)}`);
    if (highest) doc.font('Helvetica-Bold').text(`Highest NUMBER: `, { continued: true }).font('Helvetica').text(`${highest.number} (F:${(highest.fPrize||0).toFixed(2)} S:${(highest.sPrize||0).toFixed(2)})`);

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  // update invoice pdfPath and return
  await Invoice.findByIdAndUpdate(inv._id, { pdfPath }, { new: true });
  return pdfPath;
}

export const listInvoices = async (req, res) => {
  try {
    const { archiveId, drawId, partyId, invoiceNo } = req.query;
    const filter = {};
    if (archiveId) filter.archiveId = archiveId;
    if (drawId) filter.drawId = drawId;
    if (partyId) filter.partyId = partyId;
    if (invoiceNo) filter.invoiceNo = Number(invoiceNo);

    // Restrict regular users/party to their own invoices only
    try {
      const role = req.user?.role;
      const userId = req.user?.id;
      if (role === 'user' || role === 'party') {
        filter.creator = userId;
      }
    } catch (e) {
      // if auth info is not present, behave as before (but authMiddleware should set it)
    }

    const invoices = await Invoice.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ invoices });
  } catch (err) {
    console.error('listInvoices error', err);
    res.status(500).json({ error: err.message });
  }
};

export const downloadInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await Invoice.findById(id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    // Enforce ownership: only admin or the invoice creator may download
    try {
      const role = req.user?.role;
      const userId = req.user?.id;
      if (role !== 'admin' && String(inv.creator) !== String(userId)) {
        return res.status(403).json({ error: 'Forbidden: you do not own this invoice' });
      }
    } catch (e) {
      // ignore and proceed (authMiddleware should prevent this)
    }

    // If pdfPath exists and file available, stream it
    if (inv.pdfPath && fs.existsSync(inv.pdfPath)) {
      return res.download(inv.pdfPath, path.basename(inv.pdfPath));
    }

    // Otherwise generate PDF and then send
    try {
      await generatePdfForInvoice(inv);
      if (inv.pdfPath && fs.existsSync(inv.pdfPath)) return res.download(inv.pdfPath, path.basename(inv.pdfPath));
      return res.status(500).json({ error: 'PDF generation failed' });
    } catch (gerr) {
      console.error('generatePdfForInvoice error', gerr);
      return res.status(500).json({ error: 'PDF generation error' });
    }
  } catch (err) {
    console.error('downloadInvoicePdf error', err);
    res.status(500).json({ error: err.message });
  }
};

export const generateInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await Invoice.findById(id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    // Ownership check for generating/regenerating PDF
    try {
      const role = req.user?.role;
      const userId = req.user?.id;
      if (role !== 'admin' && String(inv.creator) !== String(userId)) {
        return res.status(403).json({ error: 'Forbidden: you do not own this invoice' });
      }
    } catch (e) {
      // ignore
    }
    await generatePdfForInvoice(inv);
    return res.json({ invoice: inv });
  } catch (err) {
    console.error('generateInvoicePdf error', err);
    res.status(500).json({ error: err.message });
  }
};

export { generatePdfForInvoice };

export default { listInvoices, downloadInvoicePdf, generateInvoicePdf };
