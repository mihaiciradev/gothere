-- M4 guards.
-- 1. One unresolved incident per fingerprint: new occurrences attach to it (deduplication), resolved ones never reopen.
CREATE UNIQUE INDEX incidents_open_fingerprint_unique ON incidents (fingerprint) WHERE status <> 'resolved';
--> statement-breakpoint
-- 2. Operational events are evidence: append-only, like the audit trail.
CREATE OR REPLACE FUNCTION gothere_forbid_event_rewrite() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.incident_id IS DISTINCT FROM OLD.incident_id AND OLD.incident_id IS NULL
     AND NEW.id = OLD.id AND NEW.occurred_at = OLD.occurred_at AND NEW.fingerprint = OLD.fingerprint
     AND NEW.message = OLD.message AND NEW.context = OLD.context AND NEW.severity = OLD.severity THEN
    RETURN NEW; -- linking an event to its incident is the only permitted change
  END IF;
  RAISE EXCEPTION 'operational events are append-only'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'operational_events_append_only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER operational_events_append_only
  BEFORE UPDATE OR DELETE ON operational_events
  FOR EACH ROW EXECUTE FUNCTION gothere_forbid_event_rewrite();
--> statement-breakpoint
-- 3. Platform-scope action requests have no organization. Keep "one open request per parameters" for them too, and
--    make the immutability guard NULL-safe (a NULL tenant must not be changeable to a real one).
DROP INDEX IF EXISTS action_requests_open_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX action_requests_open_unique ON action_requests (action_id, organization_id, params_hash) NULLS NOT DISTINCT
  WHERE status IN ('pending_approval', 'approved');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gothere_guard_action_request() RETURNS trigger AS $$
BEGIN
  IF NEW.action_id <> OLD.action_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.params IS DISTINCT FROM OLD.params
     OR NEW.params_hash <> OLD.params_hash
     OR NEW.requested_by_user_id <> OLD.requested_by_user_id
     OR NEW.initiator <> OLD.initiator
     OR NEW.risk <> OLD.risk THEN
    RAISE EXCEPTION 'action request parameters are immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'action_requests_immutable';
  END IF;

  IF OLD.decided_by_user_id IS NOT NULL AND NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id THEN
    RAISE EXCEPTION 'action request decision is immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'action_requests_immutable';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'rejected', 'expired'))
    OR (OLD.status = 'approved' AND NEW.status IN ('executed', 'failed', 'expired'))
  ) THEN
    RAISE EXCEPTION 'invalid action request transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'action_requests_status_transition';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
