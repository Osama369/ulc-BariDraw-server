import mongoose from 'mongoose';

const InvoiceSchema = new mongoose.Schema({
  invoiceNo: { type: Number, required: true, unique: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  drawId: { type: mongoose.Schema.Types.ObjectId, ref: 'Draw', required: true },
  prizeType: String,
  partyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Party' },
  archiveId: { type: mongoose.Schema.Types.ObjectId, ref: 'OverlimitArchive' },
  records: [{ number: String, fPrize: Number, sPrize: Number }],
  recordCount: Number,
  highestRecord: { number: String, fPrize: Number, sPrize: Number },
  pdfPath: String,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Invoice', InvoiceSchema);
