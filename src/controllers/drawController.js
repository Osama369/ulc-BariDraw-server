import Draw from '../models/Draw.js';

const toPositiveIntOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
};

const toDrawYear = (dt) => dt.getFullYear();

const toSerialDisplay = (serialNo) => {
  const n = Number(serialNo);
  if (!Number.isInteger(n) || n <= 0) return '';
  return String(n).padStart(2, '0');
};

const getNextSerialNo = async (drawYear) => {
  const last = await Draw.findOne({ drawYear }).sort({ serialNo: -1 }).select('serialNo').lean();
  return (last?.serialNo || 0) + 1;
};

const hasSerialConflict = async ({ drawYear, serialNo, excludeId }) => {
  const query = { drawYear, serialNo };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await Draw.findOne(query).select('_id').lean();
  return !!existing;
};

const hasPakistanDrawNoConflict = async ({ drawYear, drawNo, excludeId }) => {
  const query = { drawYear, category: 'PAKISTAN', drawNo };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await Draw.findOne(query).select('_id').lean();
  return !!existing;
};

const getAllDraws = async (req, res) => {
  try {
    const now = new Date();
    // mark expired draws in DB
    await Draw.updateMany({ draw_date: { $lte: now }, isExpired: false }, { $set: { isExpired: true } });

    const draws = await Draw.find().sort({ draw_date: -1 }).lean();
    // attach remainingMs and expired status
    const enhanced = draws.map(d => {
      const diff = new Date(d.draw_date).getTime() - now.getTime();
      // if draw is already marked expired, force remainingMs to 0 so UI shows "Expired"
      const baseRemaining = diff > 0 ? diff : 0;
      const remainingMs = d.isExpired ? 0 : baseRemaining;
      return {
        ...d,
        remainingMs,
        isExpired: d.isExpired || remainingMs === 0,
        serialNoDisplay: toSerialDisplay(d.serialNo),
      };
    });
    return res.json(enhanced);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const createDraw = async (req, res) => {
  try {
    const { title, category, draw_date, city, isActive, prize } = req.body;
    if (!title || !category || !draw_date) {
      return res.status(400).json({ error: 'title, category and draw_date are required' });
    }

    const dt = new Date(draw_date);
    if (Number.isNaN(dt.getTime())) {
      return res.status(400).json({ error: 'Invalid draw_date' });
    }

    const drawYear = toDrawYear(dt);
    const serialNo = toPositiveIntOrNull(req.body.serialNo) || await getNextSerialNo(drawYear);
    if (await hasSerialConflict({ drawYear, serialNo })) {
      return res.status(409).json({ error: `Serial No ${serialNo} already exists for year ${drawYear}` });
    }

    const drawNo = toPositiveIntOrNull(req.body.drawNo);
    if (category === 'PAKISTAN') {
      if (!drawNo) {
        return res.status(400).json({ error: 'drawNo is required for PAKISTAN category' });
      }
      if (await hasPakistanDrawNoConflict({ drawYear, drawNo })) {
        return res.status(409).json({ error: `Draw No ${drawNo} already exists for PAKISTAN year ${drawYear}` });
      }
    }

    const isExpired = dt.getTime() <= Date.now();
    const draw = new Draw({
      title,
      category,
      draw_date: dt,
      drawYear,
      serialNo,
      drawNo: category === 'PAKISTAN' ? drawNo : undefined,
      city,
      // prize is mainly relevant for PAKISTAN category but stored generically
      prize: typeof prize === 'number' ? prize : (prize ? Number(prize) : undefined),
      isActive: typeof isActive === 'boolean' ? isActive : true,
      isExpired,
      createdBy: req.user?.id,
    });
    await draw.save();
    const dto = draw.toObject();
    dto.serialNoDisplay = toSerialDisplay(dto.serialNo);
    return res.status(201).json(dto);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Duplicate year-wise serial/draw number detected' });
    }
    return res.status(500).json({ error: error.message });
  }
};

const updateDraw = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};

    const draw = await Draw.findById(id);
    if (!draw) return res.status(404).json({ error: 'Draw not found' });

    const nextCategory = payload.category || draw.category;
    const nextDate = payload.draw_date ? new Date(payload.draw_date) : new Date(draw.draw_date);
    if (Number.isNaN(nextDate.getTime())) {
      return res.status(400).json({ error: 'Invalid draw_date' });
    }

    const nextDrawYear = toDrawYear(nextDate);
    let nextSerialNo = draw.serialNo;
    if (payload.serialNo !== undefined) {
      const parsed = toPositiveIntOrNull(payload.serialNo);
      if (!parsed) return res.status(400).json({ error: 'serialNo must be a positive integer' });
      nextSerialNo = parsed;
    } else if (nextDrawYear !== draw.drawYear) {
      nextSerialNo = await getNextSerialNo(nextDrawYear);
    }

    if (await hasSerialConflict({ drawYear: nextDrawYear, serialNo: nextSerialNo, excludeId: id })) {
      return res.status(409).json({ error: `Serial No ${nextSerialNo} already exists for year ${nextDrawYear}` });
    }

    let nextDrawNo = draw.drawNo;
    if (nextCategory === 'PAKISTAN') {
      if (payload.drawNo !== undefined) {
        const parsedDrawNo = toPositiveIntOrNull(payload.drawNo);
        if (!parsedDrawNo) return res.status(400).json({ error: 'drawNo must be a positive integer for PAKISTAN category' });
        nextDrawNo = parsedDrawNo;
      }

      if (!nextDrawNo) {
        return res.status(400).json({ error: 'drawNo is required for PAKISTAN category' });
      }

      if (await hasPakistanDrawNoConflict({ drawYear: nextDrawYear, drawNo: nextDrawNo, excludeId: id })) {
        return res.status(409).json({ error: `Draw No ${nextDrawNo} already exists for PAKISTAN year ${nextDrawYear}` });
      }
    } else {
      nextDrawNo = undefined;
    }

    if (payload.title !== undefined) draw.title = payload.title;
    if (payload.category !== undefined) draw.category = payload.category;
    draw.draw_date = nextDate;
    draw.drawYear = nextDrawYear;
    draw.serialNo = nextSerialNo;
    draw.drawNo = nextDrawNo;
    if (payload.city !== undefined) draw.city = payload.city;
    if (payload.isActive !== undefined) draw.isActive = !!payload.isActive;
    if (payload.isExpired !== undefined) {
      draw.isExpired = !!payload.isExpired;
    } else {
      draw.isExpired = nextDate.getTime() <= Date.now();
    }
    if (payload.prize !== undefined) {
      const n = Number(payload.prize);
      draw.prize = Number.isNaN(n) ? undefined : n;
    }

    await draw.save();
    const dto = draw.toObject();
    dto.serialNoDisplay = toSerialDisplay(dto.serialNo);
    return res.json(dto);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Duplicate year-wise serial/draw number detected' });
    }
    return res.status(500).json({ error: error.message });
  }
};

const deleteDraw = async (req, res) => {
  try {
    const { id } = req.params;
    const draw = await Draw.findByIdAndDelete(id);
    if (!draw) return res.status(404).json({ error: 'Draw not found' });
    return res.json({ message: 'Draw deleted' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export { getAllDraws, createDraw, updateDraw, deleteDraw };
