-- Least-privilege database role for the Fabric API application.
-- Run this as a Postgres superuser (e.g., the default 'postgres' role).
-- Then update DATABASE_URL to use fabric_app credentials.

-- 1. Create the role (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fabric_app') THEN
    CREATE ROLE fabric_app LOGIN PASSWORD 'CHANGE_ME_BEFORE_RUNNING';
  END IF;
END $$;

-- 2. Grant schema usage
GRANT USAGE ON SCHEMA public TO fabric_app;

-- 3. Grant DML-only on all application tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fabric_app;

-- 4. Grant sequence usage (for gen_random_uuid() and serial columns)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO fabric_app;

-- 5. Set default privileges for future tables (so migrations don't break access)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fabric_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO fabric_app;

-- 6. Explicitly deny DDL
-- (No GRANT for CREATE on schema or database — fabric_app cannot create/alter/drop tables)

-- 7. Deny superuser and replication
ALTER ROLE fabric_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
