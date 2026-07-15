# Veloxous — Backend

> The high-performance API and data layer for Veloxous.

The backend infrastructure powering the Veloxous circular economy. Built with Node.js, Express, and Bun, it handles user matching, real-time communications, and acts as the bridge to our Supabase PostgreSQL database.

---

## ⚡ System Architecture

```text
[ System Architecture ]

+--------------------+     REST API & WebSockets     +--------------------+
| Next.js Client     | <---------------------------> | Node.js Backend    |
| (Frontend)         |                               | (Express / Bun)    |
+--------------------+                               +--------------------+
                                                       |            |
                                           ORM Queries |            | Indexes
                                                       |            | Events
                                                       v            v
                               +--------------------+    +--------------------+
                               | Supabase Database  |    | Stellar Blockchain |
                               | (PostgreSQL)       |    | (Soroban Contracts)|
                               +--------------------+    +--------------------+
```

---

## 🚀 Features
- **Data Management:** Handles structured data for Users, Gadget Listings, Bids, and Escrow Contracts.
- **API Endpoints:** RESTful API for frontend integration.
- **Stellar Indexing:** Listens to the Stellar blockchain for updates on the Soroban Escrow contracts to keep the database state synced.
- **Real-Time WebSockets:** Powers the real-time chat between buyers, sellers, and technicians.

## 🛠 Tech Stack
- **Runtime:** Node.js (via Bun)
- **Framework:** Express.js
- **Database:** Supabase (PostgreSQL)
- **Blockchain SDK:** @stellar/stellar-sdk

## 💻 Run Locally

Make sure you have [Bun](https://bun.sh/) installed.

```bash
bun install
bun run dev          # Starts the backend API
bun run test         # Runs the jest test suite
```

## 🔐 Environment Variables
Copy `.env.example` to `.env` and fill in the following:
```env
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
STELLAR_NETWORK=TESTNET
```
