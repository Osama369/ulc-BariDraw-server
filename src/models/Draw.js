import mongoose from 'mongoose';

const drawSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, enum: ['GTL', 'PAKISTAN'], required: true },
  draw_date: { type: Date, required: true },
  city: { type: String },
  // Optional prize/bond amount, mainly used for PAKISTAN category
  prize: { type: Number },
  isActive: { type: Boolean, default: true },
  isExpired: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('Draw', drawSchema);
