-- Backstop for the state machines in src/modules/{reservations,payments}/domain. Services enforce the same
-- rules with conditional updates; these triggers make an invalid transition impossible even for buggy code.

CREATE OR REPLACE FUNCTION gothere_guard_reservation_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'active' AND NEW.status IN ('converted', 'expired', 'released') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid reservation transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation', CONSTRAINT = 'reservations_status_transition';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER reservations_status_transition
  BEFORE UPDATE OF status ON reservations
  FOR EACH ROW EXECUTE FUNCTION gothere_guard_reservation_status();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION gothere_guard_payment_attempt() RETURNS trigger AS $$
BEGIN
  -- Financial facts are immutable once recorded.
  IF NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency OR NEW.reservation_id <> OLD.reservation_id THEN
    RAISE EXCEPTION 'payment attempt amount, currency and reservation are immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_attempts_immutable';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'initiated' AND NEW.status IN ('pending', 'succeeded', 'failed', 'unknown'))
    OR (OLD.status = 'pending'   AND NEW.status IN ('succeeded', 'failed', 'unknown'))
    OR (OLD.status = 'unknown'   AND NEW.status IN ('pending', 'succeeded', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid payment attempt transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_attempts_status_transition';
  END IF;

  IF NEW.disposition <> OLD.disposition AND NOT (
       (OLD.disposition = 'none' AND NEW.disposition IN ('accepted', 'refund_required'))
    OR (OLD.disposition = 'refund_required' AND NEW.disposition = 'refunded')
  ) THEN
    RAISE EXCEPTION 'invalid payment disposition transition % -> %', OLD.disposition, NEW.disposition
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_attempts_disposition_transition';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_attempts_guard
  BEFORE UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION gothere_guard_payment_attempt();
