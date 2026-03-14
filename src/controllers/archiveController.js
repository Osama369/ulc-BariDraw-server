import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import os from 'os';
import Data from '../models/Data.js';
import OverlimitArchive from '../models/OverlimitArchive.js';
import Invoice from '../models/Invoice.js';
import Counter from '../models/Counter.js';
import { generatePdfForInvoice } from './invoiceController.js';
import Draw from '../models/Draw.js';

// POST /api/v1/archives
// body: { drawId, prizeType, partyId, records: [{ uniqueId, firstPrice, secondPrice }], mode?: 'Mohsin' | 'RLC' }
export const createArchive = async (req, res) => {
  try {
    const { drawId, prizeType, partyId, records, mode } = req.body;
    if (!drawId || !prizeType || !partyId || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Ensure draw exists and is not closed/expired
    try {
      const draw = await Draw.findById(drawId);
      if (!draw) return res.status(404).json({ error: 'Draw not found' });
      if (draw.isExpired) return res.status(400).json({ error: 'Draw is closed. Cannot create archive/email.' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    // Previously we prevented creating a new archive if a locked archive existed for
    // the same draw/party/prizeType. Allow creating a new archive regardless so users
    // can re-run Create Email after demand/overlimit updates; older archives remain
    // tracked in the OverlimitArchive collection.

    // Prepare downloads folder (use the user's Downloads directory so filePath is like C:\Users\<user>\Downloads\...)
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

    // All provided records (may include demand or limit types).
    const allRecords = Array.isArray(records) ? records : [];
    // Overlimit records: where one of the prizes > 0
    const filteredRecords = allRecords.filter(r => (Number(r.firstPrice) > 0 || Number(r.secondPrice) > 0));

    // Sort by numeric value of NUMBER (preserve original string for output to keep leading zeros)
    filteredRecords.sort((a, b) => {
      const na = parseInt(String(a.uniqueId).replace(/[^0-9]/g, ''), 10);
      const nb = parseInt(String(b.uniqueId).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a.uniqueId).localeCompare(String(b.uniqueId));
    });

    // Build invoice snapshot now so it can be stored in the archive doc
    const invoiceRecords = filteredRecords.map(r => ({
      number: String(r.uniqueId),
      fPrize: Number(r.firstPrice) || 0,
      sPrize: Number(r.secondPrice) || 0,
    }));

    // Map prizeType to PID (numeric field)
    const pidMap = {
      Hinsa: 1,
      Akra: 2,
      Tandola: 3,
      Pangora: 4,
    };
    const normalizedPrize = String(prizeType || '').trim();
    const prizeKey = normalizedPrize.charAt(0).toUpperCase() + String(normalizedPrize).slice(1).toLowerCase();
    const pidValue = pidMap[prizeKey] || 0;

    // Define DBF schemas for AKOBAK (default) and TDOBAK (Tandola)
    const akFields = [
      { name: 'VID', type: 'C', length: 8, dec: 0 },
      { name: 'VNO', type: 'C', length: 8, dec: 0 },
      { name: 'DATE', type: 'C', length: 8, dec: 0 },
      { name: 'CODE', type: 'C', length: 8, dec: 0 },
      { name: 'SCODE', type: 'C', length: 8, dec: 0 },
      { name: 'REF', type: 'C', length: 8, dec: 0 },
      { name: 'OP_COM', type: 'C', length: 8, dec: 0 },
      { name: 'OP_WIN1', type: 'C', length: 8, dec: 0 },
      { name: 'OP_WIN2', type: 'C', length: 8, dec: 0 },
      { name: 'AK_COM', type: 'C', length: 8, dec: 0 },
      { name: 'AK_WIN1', type: 'C', length: 8, dec: 0 },
      { name: 'AK_WIN2', type: 'C', length: 8, dec: 0 },
      { name: 'TD_COM', type: 'C', length: 8, dec: 0 },
      { name: 'TD_WIN1', type: 'C', length: 8, dec: 0 },
      { name: 'TD_WIN2', type: 'C', length: 8, dec: 0 },
      { name: 'FC_COM', type: 'C', length: 8, dec: 0 },
      { name: 'FC_WIN1', type: 'C', length: 8, dec: 0 },
      { name: 'FC_WIN2', type: 'C', length: 8, dec: 0 },
      { name: 'DOT_COM', type: 'C', length: 8, dec: 0 },
      { name: 'DOT_WIN1', type: 'C', length: 8, dec: 0 },
      { name: 'DOT_WIN2', type: 'C', length: 8, dec: 0 },
      { name: 'SC_OWN', type: 'C', length: 8, dec: 0 },
      { name: 'SC_RATE', type: 'C', length: 8, dec: 0 },
      { name: 'SC_COM', type: 'C', length: 8, dec: 0 },
      { name: 'WIN1', type: 'C', length: 8, dec: 0 },
      { name: 'WIN2', type: 'C', length: 8, dec: 0 },
      { name: 'WIN3', type: 'C', length: 8, dec: 0 },
      { name: 'PID', type: 'N', length: 8, dec: 0 },
      { name: 'PKT', type: 'C', length: 8, dec: 0 },
      { name: 'S_PRIZE1', type: 'C', length: 8, dec: 0 },
      { name: 'S_PRIZE2', type: 'C', length: 8, dec: 0 },
      { name: 'P_PRIZE1', type: 'N', length: 8, dec: 2 },
      { name: 'P_PRIZE2', type: 'N', length: 8, dec: 2 },
      { name: 'WIN_QTY', type: 'C', length: 8, dec: 0 },
      { name: 'WIN_AMT', type: 'C', length: 8, dec: 0 },
      { name: 'WIN_1ST', type: 'C', length: 8, dec: 0 },
      { name: 'WIN_2ND', type: 'C', length: 8, dec: 0 },
    ];

    const tdFields = [
      { name: 'VID', type: 'C', length: 3, dec: 0 },
      { name: 'VNO', type: 'N', length: 5, dec: 0 },
      { name: 'DATE', type: 'D', length: 8, dec: 0 },
      { name: 'CODE', type: 'C', length: 8, dec: 0 },
      { name: 'SCODE', type: 'C', length: 8, dec: 0 },
      { name: 'REF', type: 'C', length: 10, dec: 0 },
      { name: 'OP_COM', type: 'N', length: 7, dec: 2 },
      { name: 'OP_WIN1', type: 'N', length: 7, dec: 2 },
      { name: 'OP_WIN2', type: 'N', length: 7, dec: 2 },
      { name: 'AK_COM', type: 'N', length: 7, dec: 2 },
      { name: 'AK_WIN1', type: 'N', length: 7, dec: 2 },
      { name: 'AK_WIN2', type: 'N', length: 7, dec: 2 },
      { name: 'TD_COM', type: 'N', length: 7, dec: 2 },
      { name: 'TD_WIN1', type: 'N', length: 7, dec: 2 },
      { name: 'TD_WIN2', type: 'N', length: 7, dec: 2 },
      { name: 'FC_COM', type: 'N', length: 7, dec: 2 },
      { name: 'FC_WIN1', type: 'N', length: 7, dec: 2 },
      { name: 'FC_WIN2', type: 'N', length: 7, dec: 2 },
      { name: 'DOT_COM', type: 'N', length: 7, dec: 2 },
      { name: 'DOT_WIN1', type: 'N', length: 7, dec: 2 },
      { name: 'DOT_WIN2', type: 'N', length: 7, dec: 2 },
      { name: 'SC_OWN', type: 'N', length: 6, dec: 2 },
      { name: 'SC_RATE', type: 'N', length: 8, dec: 2 },
      { name: 'SC_COM', type: 'N', length: 7, dec: 2 },
      { name: 'WIN1', type: 'N', length: 10, dec: 0 },
      { name: 'WIN2', type: 'N', length: 10, dec: 0 },
      { name: 'WIN3', type: 'N', length: 10, dec: 0 },
      { name: 'PID', type: 'C', length: 2, dec: 0 },
      { name: 'PKT', type: 'C', length: 4, dec: 0 },
      { name: 'S_PRIZE1', type: 'N', length: 10, dec: 2 },
      { name: 'S_PRIZE2', type: 'N', length: 10, dec: 2 },
      { name: 'P_PRIZE1', type: 'N', length: 10, dec: 2 },
      { name: 'P_PRIZE2', type: 'N', length: 10, dec: 2 },
      { name: 'WIN_QTY', type: 'N', length: 2, dec: 0 },
      { name: 'WIN_AMT', type: 'N', length: 12, dec: 2 },
      { name: 'WIN_1ST', type: 'L', length: 1, dec: 0 },
      { name: 'WIN_2ND', type: 'L', length: 1, dec: 0 },
    ];

    // Alternate RLC schema matches existing 2025-12-01 (13).dbf:
    //   ANO   C(4)
    //   SUM_A1 N(5,0)
    //   SUM_A2 N(5,0)
    const rlcFields = [
      { name: 'ANO', type: 'C', length: 4, dec: 0 },
      { name: 'SUM_A1', type: 'N', length: 5, dec: 0 },
      { name: 'SUM_A2', type: 'N', length: 5, dec: 0 },
    ];

    // choose schema based on requested mode; default to Mohsin
    const lowerKey = prizeKey.toLowerCase();
    const effectiveMode = (typeof mode === 'string' && mode.toLowerCase() === 'rlc') ? 'RLC' : 'Mohsin';
    const dbfFields = effectiveMode === 'RLC'
      ? rlcFields
      : ((lowerKey === 'tandola' || lowerKey === 'pangora') ? tdFields : akFields);

    try {
      console.log('[createArchive] DBF mode', { rawMode: mode, effectiveMode, prizeType, partyId: String(partyId), recordCount: filteredRecords.length });
    } catch (e) {}

    // Helper: format date as YYYYMMDD
    const formatDateYYYYMMDD = (d) => {
      const dt = d ? new Date(d) : new Date();
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yyyy}${mm}${dd}`;
    };

    // Helper: produce field value for a record
    function getFieldValue(field, rec) {
      const f = field.name;

      // RLC mode: simple ANO/SUM_A1/SUM_A2 layout
      if (effectiveMode === 'RLC') {
        if (f === 'ANO') {
          // Use ticket/number string, trimmed to 4 chars
          return String(rec.uniqueId || '').slice(0, field.length);
        }
        if (f === 'SUM_A1') {
          const v = Number(rec.firstPrice || 0);
          return Number.isFinite(v) ? String(Math.round(v)) : '';
        }
        if (f === 'SUM_A2') {
          const v = Number(rec.secondPrice || 0);
          return Number.isFinite(v) ? String(Math.round(v)) : '';
        }
        return '';
      }

      // Mohsin/default mode: detailed AKOBAK/TDOBAK schema
      // Only populate the requested fields; leave others empty to match AKOBAK01.DBF
      if (f === 'VID') return '2PR'; // literal as requested
      // NUMBER value should go into PKT field per instruction
      if (f === 'PKT') return String(rec.uniqueId || '').slice(0, field.length);
      // PID according to prizeType mapping. If schema expects character PID (e.g., TDOBAK/FCOBAK), return string; otherwise numeric string
      if (f === 'PID') {
        if (field.type === 'C') return String(pidValue).slice(0, field.length);
        return Number.isFinite(pidValue) ? String(pidValue) : '';
      }
      // Prize amounts into P_PRIZE1 / P_PRIZE2 (numeric with 2 decimals)
      if (f === 'P_PRIZE1') return (typeof rec.firstPrice !== 'undefined' && rec.firstPrice !== null) ? Number(rec.firstPrice).toFixed(2) : '';
      if (f === 'P_PRIZE2') return (typeof rec.secondPrice !== 'undefined' && rec.secondPrice !== null) ? Number(rec.secondPrice).toFixed(2) : '';
      // leave all other fields blank
      return '';
    }

    // Build DBF in-memory buffer pieces
    const fieldCount = dbfFields.length;
    const headerLength = 32 + fieldCount * 32 + 1; // header + fields + terminator
    const recordBodyLength = dbfFields.reduce((s, f) => s + f.length, 0);
    const recordLength = 1 + recordBodyLength; // deletion flag + body

    // Create header buffer
    const now = new Date();
    const yy = now.getFullYear() - 1900;
    const mm = now.getMonth() + 1;
    const dd = now.getDate();
    const headerBuf = Buffer.alloc(32);
    headerBuf[0] = 0x03; // dBase III
    headerBuf[1] = yy & 0xff;
    headerBuf[2] = mm & 0xff;
    headerBuf[3] = dd & 0xff;
    // number of records (4 bytes little-endian)
    headerBuf.writeUInt32LE(filteredRecords.length, 4);
    // header length (2 bytes little-endian)
    headerBuf.writeUInt16LE(headerLength, 8);
    // record length (2 bytes little-endian)
    headerBuf.writeUInt16LE(recordLength, 10);

    // field descriptors
    const fieldBufs = [];
    for (const f of dbfFields) {
      const fb = Buffer.alloc(32, 0);
      // name (max 11 bytes)
      const nameBytes = Buffer.from(String(f.name).slice(0, 11), 'ascii');
      nameBytes.copy(fb, 0);
      // type
      fb[11] = Buffer.from(String(f.type))[0];
      // field displacement (4 bytes) left as 0
      // length
      fb[16] = f.length & 0xff;
      // decimal count
      fb[17] = f.dec & 0xff;
      // remaining bytes reserved (already zero)
      fieldBufs.push(fb);
    }

    // terminator 0x0D
    const terminator = Buffer.from([0x0d]);

    // records
    const recordBufs = [];
    for (const rec of filteredRecords) {
      const rb = Buffer.alloc(recordLength, 0x20); // fill with spaces
      rb[0] = 0x20; // not-deleted (space)
      let offset = 1;
      for (const f of dbfFields) {
        const val = getFieldValue(f, rec);
        if (f.type === 'C') {
          const b = Buffer.from(String(val || ''), 'ascii');
          // left-justify and pad with spaces
          b.copy(rb, offset, 0, Math.min(b.length, f.length));
          // rest already spaces
        } else if (f.type === 'N') {
          const s = (val === '' || val === null || typeof val === 'undefined') ? '' : String(val);
          // numeric fields are right-justified ASCII
          const nb = Buffer.from(s, 'ascii');
          const start = offset + Math.max(0, f.length - nb.length);
          if (nb.length <= f.length) nb.copy(rb, start, 0, nb.length);
          else nb.copy(rb, offset, 0, f.length);
        }
        offset += f.length;
      }
      recordBufs.push(rb);
    }

    // assemble full DBF buffer and write to file
    // Map prizeType to the required base filename
    const fileBaseMap = {
      Hinsa: 'HNOBAK',
      Akra: 'AKOBAK',
      Tandola: 'TDOBAK',
      Pangora: 'FCOBAK',
    };
    const baseName = fileBaseMap[normalizedPrize] || String(prizeType || '').toUpperCase();
    // Compute total prize for naming
    const totalPrize = invoiceRecords.reduce((s, r) => s + (Number(r.fPrize || 0) + Number(r.sPrize || 0)), 0);
    // Use rounded integer total for filename (avoid dots in filename)
    const totalPrizeRounded = Math.round(totalPrize);

    // Name DBF and ZIP using base and total prize. Append timestamp to avoid collisions
    // (e.g. FCOBAK=12345-1630000000000.DBF)
    const timeStamp = Date.now();
    const dbfName = `${baseName}=${totalPrizeRounded}-${timeStamp}.DBF`;
    const dbfPath = path.join(downloadsDir, dbfName);
    const parts = [headerBuf, ...fieldBufs, terminator, ...recordBufs, Buffer.from([0x1A])]; // EOF 0x1A
    const full = Buffer.concat(parts);
    fs.writeFileSync(dbfPath, full);


    // Create ZIP containing only the DBF
    const zipName = `${baseName}=${totalPrizeRounded}-${timeStamp}.zip`;
    const zipPath = path.join(downloadsDir, zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.file(dbfPath, { name: dbfName });
    await archive.finalize();

    // remove the temporary .dbf file so only the ZIP remains in Downloads
    try {
      if (fs.existsSync(dbfPath)) fs.unlinkSync(dbfPath);
    } catch (err) {
      console.warn('Failed to remove temporary dbf file:', dbfPath, err.message);
    }

    // Remove the temp dbf if you want; keep for now

    const archiveDoc = await OverlimitArchive.create({
      creator: req.user.id,
      drawId,
      prizeType,
      partyId,
      fileName: zipName,
      filePath: zipPath,
      overlimitRecords: invoiceRecords,
      recordCount: filteredRecords.length,
      locked: true,
    });

    // Create Invoice record and generate PDF
    try {
      // Reserve an invoice number atomically
      const seqDoc = await Counter.findOneAndUpdate(
        { _id: 'invoice' },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
      );
      const invoiceNo = seqDoc.seq;

      // invoiceRecords already built earlier and stored on archiveDoc

      // find highest record by total prize (fPrize + sPrize). Tie-breaker: larger numeric ticket number.
      let highest = null;
      for (const rec of invoiceRecords) {
        const f = Number(rec.fPrize || 0);
        const s = Number(rec.sPrize || 0);
        const total = f + s;
        if (!highest) {
          highest = { ...rec, total };
          continue;
        }
        const hf = Number(highest.fPrize || 0);
        const hs = Number(highest.sPrize || 0);
        const htotal = hf + hs;
        if (total > htotal) {
          highest = { ...rec, total };
        } else if (total === htotal) {
          // tie-breaker by numeric value of ticket (if both numeric)
          const rn = parseInt(String(rec.number || '').replace(/[^0-9]/g, ''), 10);
          const hn = parseInt(String(highest.number || '').replace(/[^0-9]/g, ''), 10);
          if (!isNaN(rn) && !isNaN(hn) && rn > hn) {
            highest = { ...rec, total };
          }
        }
      }

      const invDoc = await Invoice.create({
        invoiceNo,
        creator: req.user.id,
        drawId,
        prizeType,
        partyId,
        archiveId: archiveDoc._id,
        records: invoiceRecords,
        recordCount: invoiceRecords.length,
        highestRecord: highest || { number: '', fPrize: 0, sPrize: 0 },
      });

      // Generate the official invoice PDF (invoice_{invoiceNo}.pdf) and update the Invoice record.
      try {
        await generatePdfForInvoice(invDoc);
      } catch (pdfErr) {
        console.error('Invoice PDF generation error', pdfErr);
      }
    } catch (invErr) {
      console.error('Invoice creation error', invErr);
    }

    // Mark matching Data entries as archived/locked and set archiveId for the overlimit records
    // Only touch Data documents that are category === 'overlimit' so demand rows remain editable for future Analyze/Save runs
    for (const rec of filteredRecords) {
      await Data.updateMany(
        { drawId, category: 'overlimit', 'data.uniqueId': rec.uniqueId },
        { $set: { 'data.$.archived': true, 'data.$.archiveId': archiveDoc._id, 'data.$.locked': true } }
      );
    }

    // Demand records are saved separately via the Hisab "Save Demand" action.
    // We do not modify or lock demand entries here.

    return res.status(201).json({ archive: archiveDoc });
  } catch (error) {
    console.error('createArchive error', error);
    return res.status(500).json({ error: error.message });
  }
};

export const downloadArchive = async (req, res) => {
  try {
    const { id } = req.params;
    const archiveDoc = await OverlimitArchive.findById(id);
    if (!archiveDoc) return res.status(404).json({ error: 'Archive not found' });
    if (!fs.existsSync(archiveDoc.filePath)) {
      // If file missing, clean up DB and unlock rows
      await cleanupMissingArchive(archiveDoc);
      return res.status(410).json({ error: 'Archive file missing; record cleaned' });
    }
    res.download(archiveDoc.filePath, archiveDoc.fileName);
  } catch (error) {
    console.error('downloadArchive error', error);
    res.status(500).json({ error: error.message });
  }
};

export const listArchives = async (req, res) => {
  try {
    const { drawId, partyId, prizeType } = req.query;
    const filter = {};
    if (drawId) filter.drawId = drawId;
    if (partyId) filter.partyId = partyId;
    if (prizeType) filter.prizeType = prizeType;
    const archives = await OverlimitArchive.find(filter).sort({ createdAt: -1 }).lean();

    // Enrich each archive with linked invoice number (if any)
    const enriched = await Promise.all(archives.map(async (a) => {
      try {
        const inv = await Invoice.findOne({ archiveId: a._id }).select('invoiceNo').lean();
        return { ...a, invoiceNo: inv ? inv.invoiceNo : null, invoiceId: inv ? inv._id : null };
      } catch (e) {
        return { ...a, invoiceNo: null, invoiceId: null };
      }
    }));

    res.json({ archives: enriched });
  } catch (error) {
    console.error('listArchives error', error);
    res.status(500).json({ error: error.message });
  }
};

export const deleteArchive = async (req, res) => {
  try {
    const { id } = req.params;
    const archiveDoc = await OverlimitArchive.findById(id);
    if (!archiveDoc) return res.status(404).json({ error: 'Archive not found' });

    // Only creator or admin can delete
    if (String(archiveDoc.creator) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // delete files if exist (zip, dbf, csv) and remove parent folder if empty
    try {
      if (!archiveDoc.filePath) {
        console.warn('No filePath on archiveDoc');
      } else {
        const zipPath = path.resolve(archiveDoc.filePath);
        const dbfPathTry = zipPath.replace(/\.zip$/i, '.dbf');
        const csvPathTry = zipPath.replace(/\.zip$/i, '.csv');

        const pathsToTry = [zipPath, dbfPathTry, csvPathTry];
        for (const p of pathsToTry) {
          try {
            if (p && fs.existsSync(p)) {
              fs.unlinkSync(p);
            }
          } catch (err) {
            console.warn('Error deleting file', p, err.message);
          }
        }

        // attempt to remove any folder with the same base name (e.g., extracted folder), recursively
        try {
          const downloadsRoot = path.join(os.homedir(), 'Downloads');
          const baseName = path.basename(zipPath, path.extname(zipPath));
          const candidateDir = path.join(downloadsRoot, baseName);
          if (fs.existsSync(candidateDir) && fs.lstatSync(candidateDir).isDirectory()) {
            try {
              fs.rmSync(candidateDir, { recursive: true, force: true });
            } catch (err) {
              // fallback to rmdirSync for older Node versions
              const rimraf = (p) => {
                if (!fs.existsSync(p)) return;
                for (const entry of fs.readdirSync(p)) {
                  const cur = path.join(p, entry);
                  if (fs.lstatSync(cur).isDirectory()) rimraf(cur);
                  else fs.unlinkSync(cur);
                }
                fs.rmdirSync(p);
              };
              rimraf(candidateDir);
            }
          }

          // climb up from the candidateDir (or zipPath dir) and remove empty dirs until downloadsRoot
          let dirToCheck = fs.existsSync(candidateDir) ? candidateDir : path.dirname(zipPath);
          const normalizedRoot = path.normalize(downloadsRoot);
          while (dirToCheck && path.normalize(dirToCheck).startsWith(normalizedRoot)) {
            try {
              const files = fs.readdirSync(dirToCheck).filter(f => f && f !== '.' && f !== '..');
              if (files.length === 0) {
                fs.rmdirSync(dirToCheck);
                dirToCheck = path.dirname(dirToCheck);
                continue;
              }
            } catch (err) {
              // stop climbing on any error
              break;
            }
            break;
          }
          // Additionally, scan downloads root for any files/folders that start with baseName and remove them
          try {
            if (fs.existsSync(downloadsRoot)) {
              const entries = fs.readdirSync(downloadsRoot);
              for (const entry of entries) {
                if (!entry) continue;
                if (entry.startsWith(baseName)) {
                  const full = path.join(downloadsRoot, entry);
                  try {
                    const stat = fs.lstatSync(full);
                    if (stat.isDirectory()) {
                      fs.rmSync(full, { recursive: true, force: true });
                    } else {
                      fs.unlinkSync(full);
                    }
                  } catch (err) {
                    console.warn('Failed removing matching downloads entry', full, err.message);
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Error scanning downloads root for matching entries:', err.message);
          }
        } catch (err) {
          console.warn('Error removing archive folder:', err.message);
        }
      }
    } catch (e) {
      console.warn('Error deleting archive files:', e.message);
    }

    // Remove overlimit rows that belong to this archiveId from Data collection.
    // If a Data document ends up with no rows, delete that document entirely.
    try {
      const docs = await Data.find({ category: 'overlimit', 'data.archiveId': archiveDoc._id });
      for (const doc of docs) {
        const beforeLen = Array.isArray(doc.data) ? doc.data.length : 0;
        doc.data = (doc.data || []).filter((row) => String(row.archiveId) !== String(archiveDoc._id));
        const afterLen = doc.data.length;
        if (afterLen === 0) {
          await Data.deleteOne({ _id: doc._id });
        } else if (afterLen !== beforeLen) {
          await doc.save();
        }
      }
    } catch (cleanErr) {
      console.error('Error cleaning Data overlimit rows for archive delete', archiveDoc._id, cleanErr);
    }
    // Also delete any Invoice documents associated with this archive and remove their PDF files
    try {
      const linkedInvoices = await Invoice.find({ archiveId: archiveDoc._id });
      for (const inv of linkedInvoices) {
        try {
          if (inv.pdfPath && fs.existsSync(inv.pdfPath)) {
            try { fs.unlinkSync(inv.pdfPath); } catch (err) { console.warn('Failed to delete invoice PDF', inv.pdfPath, err.message); }
          }
        } catch (e) {
          console.warn('Error checking invoice pdfPath', e.message);
        }
      }
      // remove invoice documents
      await Invoice.deleteMany({ archiveId: archiveDoc._id });
    } catch (invErr) {
      console.warn('Error removing linked invoices for archive', archiveDoc._id, invErr.message);
    }

    await OverlimitArchive.findByIdAndDelete(id);
    return res.json({ message: 'Archive deleted and data unlocked' });
  } catch (error) {
    console.error('deleteArchive error', error);
    res.status(500).json({ error: error.message });
  }
};

async function cleanupMissingArchive(archiveDoc) {
  try {
    // Mirror deleteArchive behavior when the underlying file is missing: remove
    // overlimit rows tied to this archiveId and drop empty documents.
    const docs = await Data.find({ category: 'overlimit', 'data.archiveId': archiveDoc._id });
    for (const doc of docs) {
      const beforeLen = Array.isArray(doc.data) ? doc.data.length : 0;
      doc.data = (doc.data || []).filter((row) => String(row.archiveId) !== String(archiveDoc._id));
      const afterLen = doc.data.length;
      if (afterLen === 0) {
        await Data.deleteOne({ _id: doc._id });
      } else if (afterLen !== beforeLen) {
        await doc.save();
      }
    }
    await OverlimitArchive.findByIdAndDelete(archiveDoc._id);
  } catch (err) {
    console.error('cleanupMissingArchive error', err);
  }
}

export default { createArchive, downloadArchive, deleteArchive, listArchives };
