import { connectDB } from "./db/db.js";
import dotenv from "dotenv";
import { app } from "./app.js";
import User from "./models/User.js";
import Draw from "./models/Draw.js";

dotenv.config({
  path: "./.env",
});

const seedAdmin = async () => {
  try {
    const admin = await User.findOne({ role: "admin" });
    if(!admin){
      await User.create({
        username: process.env.ADMIN_USERNAME,
        password: process.env.ADMIN_PASSWORD,
        role: "admin",
    });
  }
  } catch (error) {
    console.log("Error while creating admin", error);
  }
}

const seedDraws = async () => {
  try {
    const count = await Draw.countDocuments();
    if (count === 0) {
      console.log('Seeding default draws...');
      const now = new Date();
      await Draw.create([
        { title: 'GTL - Sample Draw 1', category: 'GTL', draw_date: now, city: 'Lahore', isActive: true },
        { title: 'Pakistan Prize - Sample 1', category: 'PAKISTAN', draw_date: now, city: 'Karachi', isActive: true },
      ]);
    }
  } catch (error) {
    console.log('Error while seeding draws', error);
  }
}

connectDB()
  .then(() => {
    seedAdmin();
    seedDraws();
    app.listen(process.env.PORT || 5000, () => {
      console.log(`The server is running at ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("Database Connection failed", err);
  });
