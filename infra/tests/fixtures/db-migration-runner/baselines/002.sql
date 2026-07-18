DO $baseline_verification$
BEGIN
  IF to_regclass('public.restored_marker') IS NULL THEN
    RAISE EXCEPTION 'restored schema marker is missing';
  END IF;
END;
$baseline_verification$;
