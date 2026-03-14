import Draw from '../models/Draw.js';

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
      return { ...d, remainingMs, isExpired: d.isExpired || remainingMs === 0 };
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
    const isExpired = dt.getTime() <= Date.now();
    const draw = new Draw({
      title,
      category,
      draw_date: dt,
      city,
      // prize is mainly relevant for PAKISTAN category but stored generically
      prize: typeof prize === 'number' ? prize : (prize ? Number(prize) : undefined),
      isActive: typeof isActive === 'boolean' ? isActive : true,
      isExpired,
      createdBy: req.user?.id,
    });
    await draw.save();
    return res.status(201).json(draw);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const updateDraw = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;
    // Normalize prize to number if present
    if (payload.prize !== undefined) {
      const n = Number(payload.prize);
      payload.prize = Number.isNaN(n) ? undefined : n;
    }
    if (payload.draw_date) payload.draw_date = new Date(payload.draw_date);
    // if draw_date present, update isExpired accordingly
    if (payload.draw_date) {
      payload.isExpired = payload.draw_date.getTime() <= Date.now();
    }
    const draw = await Draw.findByIdAndUpdate(id, payload, { new: true });
    if (!draw) return res.status(404).json({ error: 'Draw not found' });
    return res.json(draw);
  } catch (error) {
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
