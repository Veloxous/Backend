-- Migration: 002_add_swaps_table
-- Description: Create swaps table and add necessary columns to listings for swap management

-- Create enum for swap states
CREATE TYPE swap_state AS ENUM (
    'proposed',
    'countered',
    'agreed',
    'collateralized',
    'shipped',
    'completed',
    'rejected',
    'cancelled'
);

-- Create swaps table
CREATE TABLE IF NOT EXISTS public.swaps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    listing_a_id UUID NOT NULL REFERENCES public.listings(id),
    listing_b_id UUID NOT NULL REFERENCES public.listings(id),
    proposer_id UUID NOT NULL REFERENCES auth.users(id),
    counterparty_id UUID NOT NULL REFERENCES auth.users(id),
    state swap_state NOT NULL DEFAULT 'proposed',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    agreed_at TIMESTAMPTZ,
    collateralized_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    party_a_collateral_amount NUMERIC,
    party_b_collateral_amount NUMERIC,
    top_up_amount NUMERIC,
    top_up_recipient UUID REFERENCES auth.users(id),
    counter_offer_details JSONB,
    CONSTRAINT different_listings CHECK (listing_a_id != listing_b_id)
);

-- Add swap-related columns to listings table
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS current_swap_id UUID REFERENCES public.swaps(id);
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS device_type VARCHAR(100) NOT NULL DEFAULT 'unknown';
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS estimated_value NUMERIC;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);

-- Enable RLS on swaps table
ALTER TABLE public.swaps ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.swaps TO authenticated;

-- RLS Policies for swaps
CREATE POLICY select_swaps ON public.swaps FOR SELECT USING (
    auth.uid() = proposer_id OR auth.uid() = counterparty_id
);

CREATE POLICY insert_swaps ON public.swaps FOR INSERT WITH CHECK (
    auth.uid() = proposer_id
);

CREATE POLICY update_swaps ON public.swaps FOR UPDATE USING (
    auth.uid() = proposer_id OR auth.uid() = counterparty_id
);

-- Create trigger to update updated_at
DROP TRIGGER IF EXISTS update_swaps_updated_at ON public.swaps;
CREATE TRIGGER update_swaps_updated_at
    BEFORE UPDATE ON public.swaps
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();

-- Prevent editing locked listings
CREATE OR REPLACE FUNCTION prevent_locked_listing_updates()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_locked = TRUE AND (
        NEW.device_type != OLD.device_type OR
        NEW.estimated_value != OLD.estimated_value
    ) THEN
        RAISE EXCEPTION 'Cannot modify a locked listing that is part of an active swap';
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS prevent_locked_listing_changes ON public.listings;
CREATE TRIGGER prevent_locked_listing_changes
    BEFORE UPDATE ON public.listings
    FOR EACH ROW
    EXECUTE PROCEDURE prevent_locked_listing_updates();