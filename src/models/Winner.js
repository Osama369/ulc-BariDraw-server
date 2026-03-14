import mongoose from "mongoose";

const winnerSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    // timeSlot is kept for legacy records but no longer required
    timeSlot: {
        type: String,
        required: false,
    },
    date: {
        type: Date,
        required: true,
        default: Date.now,
    },
    WinningNumbers: [
        {
            number: {
                type: String,
                required: true,
            },
            type: {
                type: String,
                enum: ['first', 'second'],
                required: true,
            }
        }
    ]
}, {
    timestamps: true,
});

export default mongoose.model("Winner", winnerSchema);