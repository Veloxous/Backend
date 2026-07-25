BEGIN;

-- Plan: 3 tests (column existence, default value, nullability)
SELECT plan(3);

-- Verify column existence
SELECT has_column('public', 'listings', 'deleted_at', 'Column deleted_at should exist in listings table');

-- Verify default value is NULL::timestamptz
SELECT col_default_is('public', 'listings', 'deleted_at', 'NULL::timestamp with time zone', 'Column deleted_at should have a default value of NULL');

-- Verify nullability
SELECT col_is_null('public', 'listings', 'deleted_at', 'Column deleted_at should be nullable');

-- Finish tests
SELECT * FROM finish();

ROLLBACK;
