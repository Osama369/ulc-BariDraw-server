import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true }, 
  phone: { type: String, required: true, unique: true },
  hasSubscribed : { type: Boolean, default: false },
  city : { type: String },
  dealerId : { 
    type: String,
    trim: true,
    // Require dealerId for distributor accounts (must be provided manually)
    required: function() { return this.role === 'distributor'; },
    validate: {
      validator: function(v) {
        // allow empty when not required
        if (!v && this.role !== 'distributor') return true;
        // Accept numeric-only or mixed alphanumeric dealer IDs between 4 and 10 characters
        return /^[A-Za-z0-9]{4,10}$/.test(v);
      },
      message: 'dealerId must be 4-10 alphanumeric characters (letters and/or digits)'
    }
  },
  password: { type: String, required: true, minlength: 8 },
  balance: { type: Number, default: 0 },
  singleFigure: { type: Number, default: 0 },
  doubleFigure: { type: Number, default: 0 },
  tripleFigure: { type: Number, default: 0 },
  fourFigure: { type: Number, default: 0 },
  // Dynamic prize multipliers per section (required, default 0 for backward compatibility)
  hinsaMultiplier: { type: Number, required: true, default: 0 },
  akraMultiplier: { type: Number, required: true, default: 0 },
  tandolaMultiplier: { type: Number, required: true, default: 0 },
  pangoraMultiplier: { type: Number, required: true, default: 0 },
  commission: { type: Number, default: 0 }, // this is Hissa percentage
  // Optional party code when a distributor creates a 'user' (party account)
  partyCode: { type: String, unique: true, sparse: true },
  isActive : {
    type: Boolean, 
    default: true
  }, 
  // Add 'party' role so distributor-created party accounts can be recognized
  role: { type: String, enum: ['admin', 'user', 'distributor', 'party'], default: 'user' }, 
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    // This is not required for admin-created users
    required: function() {
      return this.role === 'user'; // Only require for regular users
    }
  },
  // admin is the system admin manage all the users and di
  //  there will be  a distributor admin account 
  // distributor admin can create users , list all users profile , suspend users profile , get all bills of users 
});
 
userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 8);
  }
  next(); 
});

userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

export default mongoose.model('User', userSchema);