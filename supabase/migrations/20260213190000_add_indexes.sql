-- Add missing indexes on foreign key columns for query performance.

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
  ON public.user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_movements_item_id
  ON public.movements(item_id);

CREATE INDEX IF NOT EXISTS idx_movements_employee_id
  ON public.movements(employee_id);

CREATE INDEX IF NOT EXISTS idx_movements_issued_by
  ON public.movements(issued_by);

CREATE INDEX IF NOT EXISTS idx_movements_type_created
  ON public.movements(movement_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_items_category_id
  ON public.inventory_items(category_id);

CREATE INDEX IF NOT EXISTS idx_inventory_items_status
  ON public.inventory_items(status);
