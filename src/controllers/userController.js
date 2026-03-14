import User from "../models/User.js";

const getAllUsers = async (req, res) => {   // admin will see all users at admin panel
  try {
    const users = await User.find({
      role: { $ne: 'admin' },        // Exclude admin users
      dealerId: { $ne: "XNHIL897" }  // Exclude specific dealer
    }).select("-password -__v");
    
    res.json(users);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createUser = async (req, res) => {  // can create user
  const { username, password, dealerId, city , phone , email, balance, singleFigure, doubleFigure, tripleFigure, fourFigure, commission,
    hinsaMultiplier, akraMultiplier, tandolaMultiplier, pangoraMultiplier } = req.body;
  const role = 'distributor'; // admin can create users with role 'distributor'
  const createdBy = req.user.id; // Get the admin ID from the authenticated user
  try {
    const user = new User({
      username,
      password,
      city,
      dealerId,
      phone,
      email,
      role,
      balance,
      singleFigure,
      doubleFigure,
      tripleFigure,
      fourFigure,
      commission,
      hinsaMultiplier,
      akraMultiplier,
      tandolaMultiplier,
      pangoraMultiplier,
      createdBy,
    }); 
    await user.save();
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getUserById = async (req, res) => {  // getUser only for user to get profile
  const { id } = req.params;
  try {
    const user = await User.findById(id).select("-password");
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    return res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  const updatedUserData = req.body;
  if (!updatedUserData) {
    return res.status(400).json({
      message: "Invalid user data",
    });
  }
  try {
    // const updatedUser = await User.findByIdAndUpdate(id, updatedUserData, {
    //   new: true,
    // }).select("-password");
    // if (!updatedUser) {
    //   return res.status(404).json({
    //     message: "User not found",
    //   });
    // }
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    
    // Previously, when a distributor increased a client's balance, we
    // deducted the difference from the distributor's own balance.
    // Business rule updated: distributor balance should NOT be affected
    // when assigning or updating client balances, so that logic is removed.
    // Update fields
    Object.keys(updatedUserData).forEach(key => {
      user[key] = updatedUserData[key];
    });
    
    // Save the user (this will trigger the pre-save hooks)
    await user.save();
    
    // Return the user without password
    const userResponse = user.toObject();
    delete userResponse.password;
    
    return res.status(200).json(userResponse);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    return res.status(200).json({
      message: "User deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const toggleUserActiveStatus = async (req, res) => {
  const { id } = req.params;
  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    user.isActive = !user.isActive;
    await user.save();
    return res.status(200).json({
      message: "User active status updated successfully",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const initializeUserBalance = async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    user.balance += amount;
    await user.save();
    return res.status(200).json({
      message: "User balance initialized successfully",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const deductUserBalance = async (req, res) => { // this would be call in user profile 
  const { id } = req.params;
  const { amount } = req.body;
  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }
    user.balance -= amount;
    await user.save();
    return res.status(200).json({
      message: "User balance deducted successfully",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const suspendedUsers = async (req, res) =>{
  try {
    const users = await User.find({isActive : false}).select("-password");
    return res.json(users);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

const activeUsers = async (req, res) =>{
  try {
    const users = await User.find({isActive : true}).select("-password");
    return res.json(users);
  } catch (error) {
    return res.status(400).json({ error: error.message });  
  }
}

const getDistributorUsers = async (req, res) => {
  try {
    // Get the distributor ID from the authenticated user
    const distributorId = req.user.id;
    // Find all users created by this distributor
    const users = await User.find({
      createdBy: distributorId,
      role: 'user'
    }).select("-password -__v");
    
    res.json(users);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getDistributorParties = async (req, res) => {
  try {
    const distributorId = req.user.id;
    const parties = await User.find({ createdBy: distributorId, role: 'party' }).select('-password -__v');
    res.json(parties);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createDistributorUser = async (req, res) => { 
  const { username, password, dealerId, city , phone , email, balance, singleFigure, doubleFigure, tripleFigure, fourFigure, commission,
    hinsaMultiplier, akraMultiplier, tandolaMultiplier, pangoraMultiplier, partyCode, accountType } = req.body;
  // accountType: 'user' | 'party' - default to user (client)
  const role = accountType === 'party' ? 'party' : 'user';
  const createdBy = req.user.id; // Get the distributor ID from the authenticated user
  try {
    // Old behavior: check distributor balance and deduct `balance` from
    // distributor when creating a client. New rule: distributor can assign
    // any starting balance to the client without reducing their own balance,
    // so we no longer check or modify dealer.balance here.
    // If creating a party account, ensure partyCode is provided and unique
    if(role === 'party'){
      if(!partyCode) return res.status(400).json({ error: 'partyCode is required for party accounts' });
      const exists = await User.findOne({ partyCode });
      if(exists) return res.status(400).json({ error: 'partyCode already in use' });
    }
    const user = new User({
      username,
      password,
      city,
      dealerId,
      phone,
      email,
      role,
      balance,
      singleFigure,
      doubleFigure,
      tripleFigure,
      fourFigure,
      commission,
      hinsaMultiplier,
      akraMultiplier,
      tandolaMultiplier,
      pangoraMultiplier,
      createdBy,
      partyCode,
    }); 
    await user.save();
    res.status(201).json({ message: "Distributor user created successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Distributor can delete users they created (party accounts)
const distributorDeleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // only allow distributor who created this user to delete
    if (String(user.createdBy) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this user' });
    }
    await User.findByIdAndDelete(id);
    return res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Distributor can update some fields of users they created
const distributorUpdateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (String(user.createdBy) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this user' });
    }
    // Prevent changing role or createdBy
    delete updates.role;
    delete updates.createdBy;
    // Apply updates
    Object.keys(updates).forEach(key => {
      user[key] = updates[key];
    });
    await user.save();
    const userResponse = user.toObject();
    delete userResponse.password;
    return res.status(200).json(userResponse);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export {
  getAllUsers,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  toggleUserActiveStatus, 
  initializeUserBalance,
  deductUserBalance,
  getDistributorUsers,
  createDistributorUser,
  distributorDeleteUser,
  distributorUpdateUser,
  getDistributorParties,
};
