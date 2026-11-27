CREATE OR REPLACE FUNCTION gothere_reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_records is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_records_append_only
  BEFORE UPDATE OR DELETE ON audit_records
  FOR EACH ROW EXECUTE FUNCTION gothere_reject_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_records_no_truncate
  BEFORE TRUNCATE ON audit_records
  FOR EACH STATEMENT EXECUTE FUNCTION gothere_reject_audit_mutation();
