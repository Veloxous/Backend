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

-- Repair Job Lifecycle Tables

CREATE TABLE IF NOT EXISTS repair_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL,
    technician_id VARCHAR(64) NOT NULL,
    device_type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'quoted', 'accepted', 'in_progress', 'completed', 'cancelled')),
    total_quote NUMERIC(12, 2),
    escrow_funded BOOLEAN DEFAULT FALSE,
    escrow_transaction_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_repair_requests_user_id ON repair_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_repair_requests_technician_id ON repair_requests(technician_id);
CREATE INDEX IF NOT EXISTS idx_repair_requests_status ON repair_requests(status);

CREATE TABLE IF NOT EXISTS repair_milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repair_id UUID NOT NULL REFERENCES repair_requests(id) ON DELETE CASCADE,
    milestone_number INTEGER NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'approved', 'paid')),
    completed_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repair_id, milestone_number)
);

CREATE INDEX IF NOT EXISTS idx_repair_milestones_repair_id ON repair_milestones(repair_id);
CREATE INDEX IF NOT EXISTS idx_repair_milestones_status ON repair_milestones(status);
