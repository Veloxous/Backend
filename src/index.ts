import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import reputationRoutes from "./routes/reputation";
import { startHourlyReputationJob } from "./jobs/calculate-reputation.job";
import { registerNotificationHandlers } from "./modules/reputation/notifications";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// Request logger middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
// Liveness probe
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "veloxous-backend", uptime: process.uptime() });
});

// Example webhook endpoint for Supabase / Soroban events
app.post("/webhooks/escrow", (req, res) => {
  const event = req.body;
  console.log("[webhook] Escrow event received:", event);
  // TODO: Validate webhook signature and process event
  res.status(200).send("OK");
});

// Reputation routes
app.use("/api", reputationRoutes);

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[error]", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`Veloxous backend listening on port ${PORT}`);
  startHourlyReputationJob();
  registerNotificationHandlers();
});
