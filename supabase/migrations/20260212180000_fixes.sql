-- Fix: Rename 'Кайковерт' to 'Гайковерт' (if DB already has old data)
UPDATE public.categories SET name = 'Гайковерт' WHERE name = 'Кайковерт';

-- Fix: Add write-off reason to inventory_items
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS write_off_reason TEXT DEFAULT '';

-- Fix: Atomic repair function (prevents race condition)
CREATE OR REPLACE FUNCTION public.record_repair(
  _item_id UUID,
  _cost NUMERIC,
  _notes TEXT DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert repair history record
  INSERT INTO public.repair_history (item_id, cost, notes)
  VALUES (_item_id, _cost, _notes);

  -- Atomically update repair count and total cost
  UPDATE public.inventory_items
  SET repair_count = repair_count + 1,
      total_repair_cost = total_repair_cost + _cost
  WHERE id = _item_id;
END;
$$;

-- Fix: movements INSERT policy (ensure issued_by matches current user)
DROP POLICY IF EXISTS "Authenticated can create movements" ON public.movements;
CREATE POLICY "Authenticated can create movements" ON public.movements
  FOR INSERT TO authenticated
  WITH CHECK (issued_by = auth.uid());
