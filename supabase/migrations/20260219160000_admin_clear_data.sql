-- RPC: admin_clear_data
-- Изтрива всички бизнес данни без да засяга потребители/настройки.
-- Използва се само за тестване на Restore.
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

  DELETE FROM public.repair_history;
  DELETE FROM public.movements;
  DELETE FROM public.inventory_items;
  DELETE FROM public.employees;
  DELETE FROM public.categories;

  ALTER TABLE public.movements ENABLE TRIGGER validate_employee_active_on_insert;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_data() TO authenticated;
COMMENT ON FUNCTION public.admin_clear_data IS 'Изтрива всички бизнес данни (само за тестване на Restore)';
