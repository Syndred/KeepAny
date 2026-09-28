-- Tighten the existing guard without editing the checksum of migration 005.
-- Legacy rows remain readable; every new or updated lease must fit the signed
-- ten-second observation window. A revoked row is a permanent tombstone.
ALTER TABLE sync_bound_bindings
  ADD CONSTRAINT sync_bound_binding_signed_lease
  CHECK (state_expires_at <= state_observed_at + INTERVAL '10 seconds') NOT VALID;

CREATE OR REPLACE FUNCTION sync_bound_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bound binding tombstone must be retained';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'revoked binding is a permanent tombstone';
  END IF;
  IF NEW.epoch < OLD.epoch OR NEW.token_valid_after < OLD.token_valid_after
     OR NEW.state_observed_at < OLD.state_observed_at THEN
    RAISE EXCEPTION 'bound binding state cannot move backward';
  END IF;
  IF NEW.epoch = OLD.epoch THEN
    IF NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.instance_id_hash IS DISTINCT FROM OLD.instance_id_hash
       OR NEW.jkt IS DISTINCT FROM OLD.jkt
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.token_valid_after IS DISTINCT FROM OLD.token_valid_after
       OR cardinality(NEW.scopes) <> cardinality(OLD.scopes)
       OR NOT (NEW.scopes @> OLD.scopes AND OLD.scopes @> NEW.scopes) THEN
      RAISE EXCEPTION 'bound binding identity or state requires a new epoch';
    END IF;
    IF NEW.state_observed_at = OLD.state_observed_at
       AND NEW.state_expires_at > OLD.state_expires_at THEN
      RAISE EXCEPTION 'old observation cannot renew a binding lease';
    END IF;
  ELSIF NEW.token_valid_after <= OLD.token_valid_after THEN
    RAISE EXCEPTION 'new binding epoch must invalidate prior tokens';
  END IF;
  RETURN NEW;
END;
$$;
