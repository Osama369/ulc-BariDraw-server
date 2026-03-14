import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import User from "../src/models/User.js";

// Load environment variables from .env
dotenv.config();

const seedAdmin = async () => {
  try {
    await connectDB();

    const {
      ADMIN_USERNAME,
      ADMIN_PASSWORD,
      ADMIN_EMAIL,
      ADMIN_PHONE,
      ADMIN_CITY = "",
    } = process.env;

    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_EMAIL || !ADMIN_PHONE) {
      console.error("Missing required admin env vars. Please set ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL, ADMIN_PHONE in .env");
      await mongoose.disconnect();
      process.exit(1);
    }

    // Check if any admin already exists
    const existingAdmin = await User.findOne({ role: "admin" });
    if (existingAdmin) {
      console.log("Admin user already exists:", existingAdmin.username);
      await mongoose.disconnect();
      process.exit(0);
    }

    const adminUser = new User({
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      phone: ADMIN_PHONE,
      city: ADMIN_CITY,
      password: ADMIN_PASSWORD,
      role: "admin",
      // multipliers default to 0 via schema defaults
    });

    await adminUser.save();
    console.log("Admin user created successfully with username:", ADMIN_USERNAME);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Error seeding admin user:", err.message || err);
    try {
      await mongoose.disconnect();
    } catch (e) {
      // ignore
    }
    process.exit(1);
  }
};

seedAdmin();
