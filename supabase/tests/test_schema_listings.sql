BEGIN;

-- Plan: 2 tests (column existence, default value)
SELECT plan(2);

-- Verify column existence
SELECT has_column('public', 'listings', 'deleted_at', 'Column deleted_at should exist in listings table');

-- Verify default value is NULL::timestamptz
SELECT col_default_is('public', 'listings', 'deleted_at', 'NULL::timestamp with time zone', 'Column deleted_at should have a default value of NULL');

-- Finish tests
SELECT * FROM finish();

ROLLBACK;
