import User from '../models/User.js';
import jwt from 'jsonwebtoken';

const register = async (req, res) => {
  const { username, password, dealerId , city , phone , email } = req.body;
  try {
    const user = new User({ username, dealerId , password , phone , email , city });
    await user.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const login = async (req, res) => {
  const { dealerId, password } = req.body;
  if (!dealerId || !password) {
    return res.status(400).json({ error: "Dealer ID and password are required" });
  }

  try {
    const user = await User.findOne({ dealerId });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });
    res.json({ token, message: "User logged in successfully" });
  } catch (error) {
    res.status(500).json({ error: "Login failed. Please try again." });
  }
};

const adminLogin = async (req, res) => {  // this is the admin login
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = await user.comparePassword(password);
    const isAdmin = isPasswordValid && user.role === "admin";
    if (!isAdmin) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });
    return res.status(200).json({ message: "Admin logged in successfully", token });
  } catch (error) {
    return res.status(500).json({ error: "Admin login failed. Please try again." });
  }
};

const adminLogout = async (req, res) => {
  try {
    // Clear admin token cookie if using cookies
    res.clearCookie('adminToken');
    
    return res.status(200).json({
      success: true,
      message: 'Admin logged out successfully',
    });
  } catch (error) {
    console.error('Admin logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error during logout process',
      error: error.message,
    });
  }
};

export {
  adminLogin,
  register,
  login,
  adminLogout
}
