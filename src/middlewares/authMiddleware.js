import jwt from 'jsonwebtoken';

export const authMiddleware = (req, res, next) => {
  console.log("Incoming Request Headers:", req.headers);

  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    console.log("❌ No token provided");
    return res.status(401).json({ error: "Access denied, no token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    console.log("✅ Token Verified:", decoded);
    next();
  } catch (error) {
    console.log("❌ Invalid Token:", error.message);
    res.status(400).json({ error: "Invalid Session Token" });
  }
};

export const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Access denied, admin privileges required' });
  }
  next();
};