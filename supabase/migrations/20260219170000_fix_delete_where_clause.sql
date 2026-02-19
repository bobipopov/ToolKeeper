-- Fix: pg_safeupdate requires WHERE clause on DELETE statements
-- Update both admin_clear_data and admin_restore_data

CREATE OR REPLACE FUNCTION public.admin_clear_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can clear data';
  END IF;

  ALTER TABLE public.movements DISABLE TRIGGER validate_employee_active_on_insert;

  DELETE FROM public.repair_history WHERE true;
  DELETE FROM public.movements WHERE true;
  DELETE FROM public.inventory_items WHERE true;
  DELETE FROM public.employees WHERE true;
  DELETE FROM public.categories WHERE true;

  ALTER TABLE public.movements ENABLE TRIGGER validate_employee_active_on_insert;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_data() TO authenticated;

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

  v_version := (p_data->>'version')::INTEGER;
  IF v_version IS NULL OR v_version < 1 THEN
    RAISE EXCEPTION 'Невалиден backup файл: липсва или неподдържана версия';
  END IF;

  IF p_data->'tables' IS NULL THEN
    RAISE EXCEPTION 'Невалиден backup файл: липсва обект "tables"';
  END IF;

  ALTER TABLE public.movements DISABLE TRIGGER validate_employee_active_on_insert;

  DELETE FROM public.repair_history WHERE true;
  DELETE FROM public.movements WHERE true;
  DELETE FROM public.inventory_items WHERE true;
  DELETE FROM public.employees WHERE true;
  DELETE FROM public.categories WHERE true;

  INSERT INTO public.categories (id, name, code_from, code_to, created_at)
  SELECT
    (r->>'id')::UUID,
    r->>'name',
    r->>'code_from',
    r->>'code_to',
    (r->>'created_at')::TIMESTAMPTZ
  FROM jsonb_array_elements(COALESCE(p_data->'tables'->'categories', '[]'::jsonb)) AS r;

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

  INSERT INTO public.repair_history (id, item_id, cost, notes, created_at)
  SELECT
    (r->>'id')::UUID,
    (r->>'item_id')::UUID,
    (r->>'cost')::NUMERIC,
    r->>'notes',
    (r->>'created_at')::TIMESTAMPTZ
  FROM jsonb_array_elements(COALESCE(p_data->'tables'->'repair_history', '[]'::jsonb)) AS r;

  ALTER TABLE public.movements ENABLE TRIGGER validate_employee_active_on_insert;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_restore_data(JSONB) TO authenticated;
