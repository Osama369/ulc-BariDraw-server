import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { errorHandler } from "./middlewares/errorHandler.middleware.js";

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "10mb",
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);
app.use(cookieParser());

import userRoutes from "./routes/userRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import dataRoutes from "./routes/dataRoutes.js";
import drawRoutes from "./routes/drawRoutes.js";
import archiveRoutes from "./routes/archiveRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
app.use("/api/v1/auth", authRoutes); // Auth Routes
app.use("/api/v1/users", userRoutes); // User Routes
app.use("/api/v1/data", dataRoutes); // Data Routes 
app.use("/api/v1/draws", drawRoutes); // Draws Routes
// Party routes removed: party accounts are represented as `User` with role='party'
app.use('/api/v1/archives', archiveRoutes); // Archive Routes
app.use('/api/v1/invoices', invoiceRoutes); // Invoice Routes

app.use(errorHandler);

export { app };
