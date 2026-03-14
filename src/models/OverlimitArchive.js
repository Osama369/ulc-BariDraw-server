import mongoose from 'mongoose';

const overlimitArchiveSchema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  drawId: { type: mongoose.Schema.Types.ObjectId, ref: 'Draw', required: true },
  prizeType: { type: String, required: true },
  partyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  // snapshot of overlimit records included in this archive
  overlimitRecords: [
    {
      number: { type: String },
      fPrize: { type: Number },
      sPrize: { type: Number },
    },
  ],
  recordCount: { type: Number, default: 0 },
  locked: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('OverlimitArchive', overlimitArchiveSchema);
