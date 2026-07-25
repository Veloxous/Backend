-- Plan: 2 tests (RLS status, updated_at trigger)
SELECT plan(2);

-- Verify RLS enabled
SELECT ok(
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'listings' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')),
    'RLS should be enabled on the listings table'
);

-- Test updated_at trigger
INSERT INTO public.listings (id, owner_id) VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
-- Sleep briefly to ensure time difference
SELECT pg_sleep(1);
UPDATE public.listings SET owner_id = '00000000-0000-0000-0000-000000000002' WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT ok(
    (SELECT updated_at > created_at FROM public.listings WHERE id = '00000000-0000-0000-0000-000000000001'),
    'updated_at should be greater than created_at after update'
);

-- Finish tests
SELECT * FROM finish();

ROLLBACK;

