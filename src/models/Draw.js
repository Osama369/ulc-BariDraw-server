import mongoose from 'mongoose';

const drawSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, enum: ['GTL', 'PAKISTAN'], required: true },
  draw_date: { type: Date, required: true },
  // Stored explicitly to enforce year-scoped uniqueness.
  drawYear: { type: Number, required: true, index: true },
  // Unique serial number within the same year (across categories).
  serialNo: { type: Number, required: true },
  // Draw number used only by PAKISTAN category; unique within year for PAKISTAN.
  drawNo: { type: Number },
  city: { type: String },
  // Optional prize/bond amount, mainly used for PAKISTAN category
  prize: { type: Number },
  isActive: { type: Boolean, default: true },
  isExpired: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

drawSchema.index(
  { drawYear: 1, serialNo: 1 },
  {
    unique: true,
    partialFilterExpression: {
      drawYear: { $exists: true },
      serialNo: { $exists: true },
    },
  }
);
drawSchema.index(
  { drawYear: 1, drawNo: 1 },
  {
    unique: true,
    partialFilterExpression: {
      drawYear: { $exists: true },
      category: 'PAKISTAN',
      drawNo: { $exists: true },
    },
  }
);

export default mongoose.model('Draw', drawSchema);
