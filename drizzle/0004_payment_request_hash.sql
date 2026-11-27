-- Bind payment Idempotency-Keys to request parameters. Rows created before this migration get a sentinel
-- that can never equal a sha256 hex digest, so replaying a pre-migration key with any parameters is rejected.
ALTER TABLE "payment_attempts" ADD COLUMN "request_hash" text;--> statement-breakpoint
UPDATE "payment_attempts" SET "request_hash" = 'legacy:unbound';--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "request_hash" SET NOT NULL;--> statement-breakpoint
-- A genuine provider success may follow a failure (late capture, failure we inferred ourselves).
-- It must always be recordable so the money is accepted or refunded, never lost.
CREATE OR REPLACE FUNCTION gothere_guard_payment_attempt() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency OR NEW.reservation_id <> OLD.reservation_id
     OR NEW.request_hash <> OLD.request_hash THEN
    RAISE EXCEPTION 'payment attempt amount, currency, reservation and request are immutable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_attempts_immutable';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'initiated' AND NEW.status IN ('pending', 'succeeded', 'failed', 'unknown'))
    OR (OLD.status = 'pending'   AND NEW.status IN ('succeeded', 'failed', 'unknown'))
    OR (OLD.status = 'unknown'   AND NEW.status IN ('pending', 'succeeded', 'failed'))
    OR (OLD.status = 'failed'    AND NEW.status = 'succeeded')
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
