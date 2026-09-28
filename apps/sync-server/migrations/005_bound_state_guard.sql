-- A trusted mirror writer must advance state, never roll an observed binding back.
-- Keep revoked rows as tombstones. Deleting one would also erase proof history.
CREATE FUNCTION sync_bound_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bound binding tombstone must be retained';
  END IF;
  IF NEW.epoch < OLD.epoch OR NEW.token_valid_after < OLD.token_valid_after
     OR NEW.state_observed_at < OLD.state_observed_at THEN
    RAISE EXCEPTION 'bound binding state cannot move backward';
  END IF;
  IF NEW.epoch = OLD.epoch THEN
    IF NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.instance_id_hash IS DISTINCT FROM OLD.instance_id_hash
       OR NEW.jkt IS DISTINCT FROM OLD.jkt
       OR NEW.scopes IS DISTINCT FROM OLD.scopes THEN
      RAISE EXCEPTION 'bound binding identity requires a new epoch';
    END IF;
    IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
      RAISE EXCEPTION 'revoked binding requires a new epoch';
    END IF;
  ELSIF NEW.token_valid_after <= OLD.token_valid_after THEN
    RAISE EXCEPTION 'new binding epoch must invalidate prior tokens';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_bound_binding_guard_update
  BEFORE UPDATE OR DELETE ON sync_bound_bindings
  FOR EACH ROW EXECUTE FUNCTION sync_bound_binding_guard();
