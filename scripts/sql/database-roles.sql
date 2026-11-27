-- Least-privilege roles for a deployed database (Neon). Not executed automatically.
-- Run ONCE per Neon branch, in the Neon SQL Editor, connected as the project owner role (neondb_owner), on the
-- database the app uses (neondb). Replace the two passwords first (see docs/operations.md § Neon setup).
--
--   gothere_migrator  creates and owns the schema; used only by `pnpm db:migrate` from a trusted machine or CI,
--                     over the DIRECT (unpooled) connection.
--   gothere_app       used by the running application (Vercel) over the POOLED connection: data access only.
--
-- Create these roles here, with SQL. Roles created in the Neon Console or API join neon_superuser, which can read
-- and write every table — that would defeat the restriction.
-- Table-level grants for gothere_app are applied by `pnpm db:migrate` after every migration (DATABASE_APP_ROLE),
-- so tables added later are covered automatically.

CREATE ROLE gothere_migrator LOGIN PASSWORD 'REPLACE_WITH_MIGRATOR_PASSWORD';
CREATE ROLE gothere_app LOGIN PASSWORD 'REPLACE_WITH_APP_PASSWORD';

-- Both may connect to the application database.
GRANT CONNECT ON DATABASE neondb TO gothere_migrator, gothere_app;

-- The migrator creates tables, functions and triggers in public, and the migration journal schema ("drizzle").
GRANT USAGE, CREATE ON SCHEMA public TO gothere_migrator;
GRANT CREATE ON DATABASE neondb TO gothere_migrator;

-- The application can use the schema but never create objects in it.
GRANT USAGE ON SCHEMA public TO gothere_app;
REVOKE CREATE ON SCHEMA public FROM gothere_app;

-- Server-side limits that hold through the pooler (client startup parameters may not).
ALTER ROLE gothere_app SET statement_timeout = '10s';
ALTER ROLE gothere_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE gothere_migrator SET statement_timeout = '120s';

-- Check: both rows must show rolsuper = false, rolcreaterole = false, rolcreatedb = false, rolbypassrls = false.
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls,
       pg_has_role(rolname, 'neon_superuser', 'member') AS in_neon_superuser
FROM pg_roles WHERE rolname IN ('gothere_migrator', 'gothere_app');
