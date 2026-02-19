-- ============================================================
-- Backup Feature Migration
-- ============================================================

-- 1. Storage bucket for backups (private, JSON only, 50MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('backups', 'backups', false, 52428800, ARRAY['application/json'])
ON CONFLICT (id) DO NOTHING;

-- 2. RLS policy: only admins can read/write/delete in the backups bucket
DROP POLICY IF EXISTS "Admins can manage backups" ON storage.objects;
CREATE POLICY "Admins can manage backups" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'));

-- 3. Singleton schedule table (only one row with id = 1 ever exists)
CREATE TABLE IF NOT EXISTS public.backup_schedule (
  id              INTEGER    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled         BOOLEAN    NOT NULL DEFAULT false,
  hour            INTEGER    NOT NULL DEFAULT 2 CHECK (hour BETWEEN 0 AND 23),
  minute          INTEGER    NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
  day_of_week     INTEGER    CHECK (day_of_week BETWEEN 0 AND 6), -- NULL = daily
  retention_count INTEGER    NOT NULL DEFAULT 10 CHECK (retention_count BETWEEN 1 AND 50),
  last_backup_at  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the singleton row
INSERT INTO public.backup_schedule DEFAULT VALUES ON CONFLICT DO NOTHING;

-- RLS on backup_schedule: only admins
ALTER TABLE public.backup_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage backup schedule" ON public.backup_schedule;
CREATE POLICY "Admins can manage backup schedule" ON public.backup_schedule
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 4. RPC: admin_get_backup_data
--    Returns all 5 tables as a single JSONB object.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_backup_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can create backups';
  END IF;

  RETURN jsonb_build_object(
    'version',    1,
    'created_at', NOW(),
    'tables', jsonb_build_object(
      'categories', (
        SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.created_at), '[]'::jsonb)
        FROM public.categories c
      ),
      'employees', (
        SELECT COALESCE(jsonb_agg(row_to_json(e)::jsonb ORDER BY e.created_at), '[]'::jsonb)
        FROM public.employees e
      ),
      'inventory_items', (
        SELECT COALESCE(jsonb_agg(row_to_json(i)::jsonb ORDER BY i.created_at), '[]'::jsonb)
        FROM public.inventory_items i
      ),
      'movements', (
        SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.created_at), '[]'::jsonb)
        FROM public.movements m
      ),
      'repair_history', (
        SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.created_at), '[]'::jsonb)
        FROM public.repair_history r
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_backup_data() TO authenticated;
COMMENT ON FUNCTION public.admin_get_backup_data IS 'Връща всички данни като JSONB за backup';

-- ============================================================
-- 5. RPC: admin_restore_data
--    Full replace: deletes all tables in reverse FK order,
--    then re-inserts from JSON. Runs atomically.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_restore_data(p_data JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can restore backups';
  END IF;

  -- Basic version check
  v_version := (p_data->>'version')::INTEGER;
  IF v_version IS NULL OR v_version < 1 THEN
    RAISE EXCEPTION 'Невалиден backup файл: липсва или неподдържана версия';
  END IF;

  IF p_data->'tables' IS NULL THEN
    RAISE EXCEPTION 'Невалиден backup файл: липсва обект "tables"';
  END IF;

  -- Temporarily disable the active-employee trigger to allow
  -- restoring historical movements for inactive employees
  ALTER TABLE public.movements DISABLE TRIGGER validate_employee_active_on_insert;

  -- Delete in reverse FK dependency order
  DELETE FROM public.repair_history;
  DELETE FROM public.movements;
  DELETE FROM public.inventory_items;
  DELETE FROM public.employees;
  DELETE FROM public.categories;

  -- Insert categories
  INSERT INTO public.categories (id, name, code_from, code_to, created_at)
  SELECT
    (r->>'id')::UUID,
    r->>'name',
    r->>'code_from',
    r->>'code_to',
    (r->>'created_at')::TIMESTAMPTZ
  FROM jsonb_array_elements(COALESCE(p_data->'tables'->'categories', '[]'::jsonb)) AS r;

  -- Insert employees
  INSERT INTO public.employees (id, name, position, is_active, deactivation_reason, deactivated_at, created_at)
  SELECT
    (r->>'id')::UUID,
    r->>'name',
    r->>'position',
    (r->>'is_active')::BOOLEAN,
    r->>'deactivation_reason',
    NULLIF(r->>'deactivated_at', '')::TIMESTAMPTZ,
    (r->>'created_at')::TIMESTAMPTZ
  FROM jsonb_array_elements(COALESCE(p_data->'tables'->'employees', '[]'::jsonb)) AS r;

  -- Insert inventory_items
  INSERT INTO public.inventory_items (
    id, inventory_code, category_id, price, status, ownership,
    repair_count, total_repair_cost, write_off_reason, written_off_at, notes, created_at
  )
  SELECT
    (r->>'id')::UUID,
    r->>'inventory_code',
    (r->>'category_id')::UUID,
    (r->>'price')::NUMERIC,
    r->>'status',
    (r->>'ownership')::public.ownership_type,
    (r->>'repair_count')::INTEGER,
    (r->>'total_repair_cost')::NUMERIC,
    r->>'write_off_reason',
    NULLIF(r->>'written_off_at', '')::TIMESTAMPTZ,
    r->>'notes',
    (r->>'created_at')::TIMESTAMPTZ
  FROM jsonb_array_elements(COALESCE(p_data->'tables'->'inventory_items', '[]'::jsonb)) AS r;

  -- Insert movements (issued_by may reference a deleted user → set NULL)
  INSERT INTO public.movements (
    id, item_id, employee_id, movement_type, condition,
    consumable_note, damage_notes, issued_by, created_at
  )
  SELECT
    (r->>'id')::UUID,
    (r->>'item_id')::UUID,
    (r->>'employee_id')::UUID,
    (r->>'movement_type')::public.movement_type,
    r->>'condition',
    r->>'consumable_note',
    r->>'damage_notes',
    NULLIF(r->>'issued_by', '')::UUID,
    (r->>'created_at')::TIMESTAMPTZ
  FROM jsonb_array_elements(COALESCE(p_data->'tables'->'movements', '[]'::jsonb)) AS r;

  -- Insert repair_history
  INSERT INTO public.repair_history (id, item_id, cost, notes, created_at)
  SELECT
    (r->>'id')::UUID,
    (r->>'item_id')::UUID,
    (r->>'cost')::NUMERIC,
    r->>'notes',
    (r->>'created_at')::TIMESTAMPTZ
  FROM jsonb_array_elements(COALESCE(p_data->'tables'->'repair_history', '[]'::jsonb)) AS r;

  -- Re-enable the trigger
  ALTER TABLE public.movements ENABLE TRIGGER validate_employee_active_on_insert;

END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_restore_data(JSONB) TO authenticated;
COMMENT ON FUNCTION public.admin_restore_data IS 'Пълно възстановяване на данни от JSONB backup';

-- ============================================================
-- 6. RPC: admin_get_backup_schedule
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_backup_schedule()
RETURNS SETOF public.backup_schedule
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can view backup schedule';
  END IF;

  RETURN QUERY SELECT * FROM public.backup_schedule WHERE id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_backup_schedule() TO authenticated;

-- ============================================================
-- 7. RPC: admin_update_backup_schedule
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_update_backup_schedule(
  p_enabled         BOOLEAN,
  p_hour            INTEGER,
  p_minute          INTEGER,
  p_day_of_week     INTEGER,  -- pass NULL for "daily"
  p_retention_count INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can update backup schedule';
  END IF;

  UPDATE public.backup_schedule SET
    enabled         = p_enabled,
    hour            = p_hour,
    minute          = p_minute,
    day_of_week     = p_day_of_week,
    retention_count = p_retention_count,
    updated_at      = NOW()
  WHERE id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_backup_schedule(BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;

-- ============================================================
-- 8. RPC: admin_record_backup_taken
--    Called after every successful auto-backup to stamp
--    last_backup_at. Only auto-backups update this field.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_record_backup_taken()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can record backup timestamps';
  END IF;

  UPDATE public.backup_schedule
  SET last_backup_at = NOW()
  WHERE id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_record_backup_taken() TO authenticated;
