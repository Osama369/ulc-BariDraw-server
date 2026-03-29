import { connectDB } from "./db/db.js";
import dotenv from "dotenv";
import { app } from "./app.js";
import Draw from "./models/Draw.js";

dotenv.config({ path: "./.env" });

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
    seedDraws();
    const port = process.env.PORT || 5000;
    app.listen(port, () => {
      console.log(`The server is running at ${port}`);
    });
  })
  .catch((err) => {
    console.log("Database Connection failed", err);
  });
