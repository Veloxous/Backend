-- src/db/schema.sql

CREATE TABLE IF NOT EXISTS indexer_state (
    key VARCHAR(50) PRIMARY KEY,
    last_processed_ledger INTEGER NOT NULL
);

-- Initialize the cursor at 0 if it doesn't exist (or we can initialize dynamically in code)
INSERT INTO indexer_state (key, last_processed_ledger) 
VALUES ('soroban_escrow_events', 0)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS escrow_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) UNIQUE NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    amount NUMERIC,
    party VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS failed_events (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) NOT NULL,
    raw_xdr TEXT NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
