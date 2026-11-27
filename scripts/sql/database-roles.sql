-- Least-privilege roles for deployed environments (Neon). Not executed automatically.
-- Run once per database as the owner, after replacing the passwords, BEFORE any public deployment.
--   gothere_migrator: owns the schema, runs `pnpm db:migrate` from CI or a trusted machine.
--   gothere_app:      used by the running application; data access only, no DDL.

CREATE ROLE gothere_migrator LOGIN PASSWORD 'replace-me-migrator';
CREATE ROLE gothere_app LOGIN PASSWORD 'replace-me-app';

GRANT CONNECT ON DATABASE neondb TO gothere_migrator, gothere_app; -- replace neondb with the database name
ALTER SCHEMA public OWNER TO gothere_migrator;
GRANT USAGE ON SCHEMA public TO gothere_app;

-- Existing objects (run after the first migration) …
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gothere_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gothere_app;
-- … and everything the migrator creates later.
ALTER DEFAULT PRIVILEGES FOR ROLE gothere_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gothere_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gothere_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gothere_app;

-- The audit trail is append-only for the application (triggers also block UPDATE/DELETE/TRUNCATE).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM gothere_app;
-- The app never truncates anything.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM gothere_app;
