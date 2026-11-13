-- Creates the solverr, solverr_web and glitchtip roles and databases, or brings their passwords and solverr_web's grants up to date.
-- Run as the postgres superuser by the db-roles service on every start; safe to run again. Passwords come from the
-- environment (deploy/postgres.env and deploy/pgbouncer.env), so they never appear in a command line.
\set ON_ERROR_STOP on
\getenv solverr_password SOLVERR_DB_PASSWORD
\getenv web_password SOLVERR_WEB_DB_PASSWORD
\getenv glitchtip_password GLITCHTIP_DB_PASSWORD

-- Stop on a missing or empty password: Postgres would clear the role's password and that role could no longer log in.
\if :{?solverr_password}
\else
  \set solverr_password ''
\endif
\if :{?web_password}
\else
  \set web_password ''
\endif
\if :{?glitchtip_password}
\else
  \set glitchtip_password ''
\endif
SELECT least(length(:'solverr_password'), length(:'web_password'), length(:'glitchtip_password')) = 0 AS password_missing \gset
\if :password_missing
  DO $$ BEGIN RAISE EXCEPTION 'Set SOLVERR_DB_PASSWORD and GLITCHTIP_DB_PASSWORD in deploy/postgres.env and SOLVERR_WEB_DB_PASSWORD in deploy/pgbouncer.env'; END $$;
\endif

-- The worker and migrations log in as solverr: it owns its database (and so its public schema) and nothing else.
SELECT 'CREATE ROLE solverr' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'solverr') \gexec
ALTER ROLE solverr WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'solverr_password';
SELECT 'CREATE DATABASE solverr OWNER solverr' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'solverr') \gexec

-- The website on Vercel logs in as solverr_web: it reads and writes rows but cannot change the schema, and its connection
-- limit keeps room for the worker, migrations, GlitchTip and backups however many function instances run at once.
SELECT 'CREATE ROLE solverr_web' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'solverr_web') \gexec
ALTER ROLE solverr_web WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 150 PASSWORD :'web_password';
-- The timeouts lib/db.ts asks for, also as role defaults: PgBouncer's DISCARD ALL between clients resets a connection to these,
-- and PgBouncer cannot see that reset, so it may skip setting them again for the next client. Keep both places equal.
ALTER ROLE solverr_web SET statement_timeout = '30s';
ALTER ROLE solverr_web SET idle_in_transaction_session_timeout = '60s';

SELECT 'CREATE ROLE glitchtip' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'glitchtip') \gexec
ALTER ROLE glitchtip WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'glitchtip_password';
SELECT 'CREATE DATABASE glitchtip OWNER glitchtip' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'glitchtip') \gexec

-- Each role can connect only to its own database; owners keep their rights, everyone else loses the default CONNECT.
REVOKE ALL ON DATABASE solverr FROM PUBLIC;
REVOKE ALL ON DATABASE glitchtip FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE solverr TO solverr_web;

-- solverr_web's rights on the tables solverr owns: the ones that exist now, and the ones later migrations create.
\connect solverr
GRANT USAGE ON SCHEMA public TO solverr_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO solverr_web;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solverr_web;
ALTER DEFAULT PRIVILEGES FOR ROLE solverr IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO solverr_web;
ALTER DEFAULT PRIVILEGES FOR ROLE solverr IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO solverr_web;
-- The worker's wal-archiving job reads pg_stat_archiver, which every role may read; no extra grant is needed.
