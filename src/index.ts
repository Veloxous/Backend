import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

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
  res.json({ status: "ok", service: "veloxous-backend" });
});

// Example webhook endpoint for Supabase / Soroban events
app.post("/webhooks/escrow", (req, res) => {
  const event = req.body;
  console.log("[webhook] Escrow event received:", event);
  // TODO: Validate webhook signature and process event
  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`Veloxous backend listening on port ${PORT}`);
});
