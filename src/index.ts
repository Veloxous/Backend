import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { SorobanEventsWorker } from "./workers/soroban-events.worker";
import { SwapTimeoutWorker } from "./workers/swap-timeout.worker";
import swapsRouter from "./routes/swaps";
import repairRouter from "./routes/repair.routes";
import listingsRouter from "./routes/listings.routes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());
import authRouter from "./routes/auth.routes";
import { initDb } from "./db/db";

// Request logger middleware
app.use("/auth", authRouter);

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
// Liveness probe
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "veloxous-backend", uptime: process.uptime() });
});

// Swap routes
app.use("/swaps", swapsRouter);

// Repair routes
app.use("/repair", repairRouter);

// Listings routes
app.use("/listings", listingsRouter);

// Example webhook endpoint for Supabase / Soroban events
app.post("/webhooks/escrow", (req, res) => {
  const event = req.body;
  console.log("[webhook] Escrow event received:", event);
  // TODO: Validate webhook signature and process event
  res.status(200).send("OK");
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[error]", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, async () => {
  console.log(`Veloxous backend listening on port ${PORT}`);

  try {
    await initDb();
    console.log("Database initialized successfully.");
  } catch (error) {
    console.error("Database initialization failed:", error);
  }

  // Start background workers if not in test environment
  if (process.env.NODE_ENV !== 'test') {
    // Start Soroban Events Worker
    const sorobanWorker = new SorobanEventsWorker();
    sorobanWorker.start().catch(err => {
      console.error("Failed to start Soroban worker:", err);
    });

    // Start Swap Timeout Worker
    const swapWorker = new SwapTimeoutWorker();
    swapWorker.start().catch(err => {
      console.error("Failed to start swap timeout worker:", err);
    });
  }
});
