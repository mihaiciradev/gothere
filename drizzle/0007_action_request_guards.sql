-- Backstop for the approval machine in src/actions/approvals.ts. What an approver reviewed (action, tenant,
-- parameters and their hash, requester, initiator) can never change after the request is created, and a request
-- can only move forward: pending_approval -> approved | rejected | expired; approved -> executed | failed | expired.

CREATE OR REPLACE FUNCTION gothere_guard_action_request() RETURNS trigger AS $$
BEGIN
  IF NEW.action_id <> OLD.action_id
     OR NEW.organization_id <> OLD.organization_id
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
--> statement-breakpoint
CREATE TRIGGER action_requests_guard
  BEFORE UPDATE ON action_requests
  FOR EACH ROW EXECUTE FUNCTION gothere_guard_action_request();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gothere_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are permanent', TG_TABLE_NAME
    USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_no_delete';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER action_requests_no_delete
  BEFORE DELETE ON action_requests
  FOR EACH ROW EXECUTE FUNCTION gothere_forbid_delete();
