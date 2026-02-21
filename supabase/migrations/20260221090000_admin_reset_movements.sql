-- RPC: admin_reset_movements
-- Изтрива всички движения и ремонти, нулира статуса на инвентара.
-- Запазва: категории, служители, инвентарни артикули (само нулира техните статистики).
-- Използва се за подготовка за продуктион.

CREATE OR REPLACE FUNCTION public.admin_reset_movements()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can reset movements';
  END IF;

  ALTER TABLE public.movements DISABLE TRIGGER validate_employee_active_on_insert;

  DELETE FROM public.repair_history WHERE true;
  DELETE FROM public.movements WHERE true;

  -- Нулира статус и статистики на всички инвентарни артикули
  UPDATE public.inventory_items
  SET
    status = 'in_stock',
    repair_count = 0,
    total_repair_cost = 0,
    write_off_reason = NULL,
    written_off_at = NULL
  WHERE true;

  ALTER TABLE public.movements ENABLE TRIGGER validate_employee_active_on_insert;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_movements() TO authenticated;
COMMENT ON FUNCTION public.admin_reset_movements IS 'Нулира движения и статус на инвентара (подготовка за продуктион). Запазва категории, служители и артикули.';
