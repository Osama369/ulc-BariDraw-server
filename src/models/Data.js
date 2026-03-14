import mongoose from "mongoose";

const dataSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    // Reference to admin-created Draw. This is the canonical link to a draw/date.
    drawId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Draw',
        required: true,
    },
    // Date of the draw — populated from the referenced Draw.draw_date when creating entries
    date: {
        type: Date,
        required: true,
    },

    // Optional prize type for demand/overlimit snapshots so we can
    // keep separate documents per prize type (e.g. Hinsa, Akra,
    // Tandola, Pangora). General/raw data typically omits this.
    prizeType: {
        type: String,
        enum: ["Hinsa", "Akra", "Tandola", "Pangora"],
        required: false,
    },

    category: {
        type: String,
        enum: ["general", "demand", "overlimit"],
        default: "general"
    },
    data: [
        {
            uniqueId: {
                type: String,
                required: true,
            },
            firstPrice: {
                type: Number,
                required: true,
            },
            secondPrice: {
                type: Number,
                required: true,
            },
            archived: {
                type: Boolean,
                default: false,
            },
            locked: {
                type: Boolean,
                default: false,
            },
            archiveId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'OverlimitArchive',
                default: null,
            },
        },
    ],
    // Optional snapshot of the last-analyzed demand used to compute deltas when saving demand.
    lastAnalyzed: [
        {
            uniqueId: { type: String },
            firstPrice: { type: Number, default: 0 },
            secondPrice: { type: Number, default: 0 },
        }
    ],
    // Snapshot of combined totals (raw/general totals) at last Save Demand
    lastCombined: [
        {
            uniqueId: { type: String },
            firstPrice: { type: Number, default: 0 },
            secondPrice: { type: Number, default: 0 },
        }
    ],

     // 
}, {
    timestamps: true,
});

export default mongoose.model("Data", dataSchema);
