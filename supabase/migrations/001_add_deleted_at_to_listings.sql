-- Migration: 001_init_listings_and_add_deleted_at
-- Description: Create listings table, add deleted_at column, and implement RLS policies.

DROP TABLE IF EXISTS public.listings CASCADE;

CREATE TABLE public.listings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL::timestamptz
);

-- Enable RLS
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listings TO authenticated;

-- Policy: SELECT
CREATE POLICY select_active_listings ON public.listings FOR SELECT USING (deleted_at IS NULL);

-- Policy: INSERT
CREATE POLICY insert_listings ON public.listings FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- Policy: UPDATE
CREATE POLICY update_listings ON public.listings FOR UPDATE USING (auth.uid() = owner_id);

-- Policy: DELETE
CREATE POLICY delete_listings ON public.listings FOR DELETE TO authenticated USING (false);

-- Create trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
CREATE TRIGGER update_listings_updated_at
    BEFORE UPDATE ON public.listings
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();
