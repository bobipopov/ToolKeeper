-- ============================================================
-- Security fixes based on Supabase Security Advisor
-- ============================================================

-- ─── Fix 1: Security Definer View ───────────────────────────
-- latest_issue_movements was running with owner privileges (bypassing RLS).
-- security_invoker = true makes it run with the calling user's privileges.
CREATE OR REPLACE VIEW public.latest_issue_movements
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (item_id)
  id,
  item_id,
  employee_id,
  movement_type,
  condition,
  consumable_note,
  damage_notes,
  issued_by,
  created_at
FROM public.movements
WHERE movement_type = 'issue'
ORDER BY item_id, created_at DESC;

COMMENT ON VIEW public.latest_issue_movements IS 'Returns the most recent issue movement for each item (security_invoker = true, respects RLS)';
GRANT SELECT ON public.latest_issue_movements TO authenticated;

-- ─── Fix 2: Function Search Path Mutable ────────────────────
-- Functions without SET search_path are vulnerable to search path hijacking.

CREATE OR REPLACE FUNCTION public.deactivate_employee_with_returns(
  _employee_id UUID,
  _issued_by_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT item_id)
  INTO _item_ids
  FROM (
    SELECT DISTINCT ON (item_id) item_id
    FROM movements
    WHERE employee_id = _employee_id
      AND movement_type = 'issue'
    ORDER BY item_id, created_at DESC
  ) AS latest_issues
  WHERE item_id IN (
    SELECT id FROM inventory_items WHERE status = 'assigned'
  );

  IF _item_ids IS NOT NULL AND array_length(_item_ids, 1) > 0 THEN
    INSERT INTO movements (item_id, employee_id, movement_type, condition, issued_by)
    SELECT
      unnest(_item_ids),
      _employee_id,
      'return',
      'Без забележки',
      _issued_by_user_id;
  END IF;

  UPDATE employees
  SET is_active = FALSE
  WHERE id = _employee_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_active_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _is_active BOOLEAN;
BEGIN
  SELECT is_active INTO _is_active
  FROM employees
  WHERE id = NEW.employee_id;

  IF _is_active IS NULL THEN
    RAISE EXCEPTION 'Employee with ID % does not exist', NEW.employee_id;
  END IF;

  IF _is_active = FALSE THEN
    RAISE EXCEPTION 'Cannot create movement for inactive employee. Please activate the employee first.';
  END IF;

  RETURN NEW;
END;
$$;

-- ─── Fix 3: Auth RLS Initialization Plan ────────────────────
-- Replace auth.uid() with (SELECT auth.uid()) so it is evaluated once
-- per query instead of once per row — improves performance and security.

-- profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()));

-- user_roles
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- categories
DROP POLICY IF EXISTS "Admins can manage categories" ON public.categories;
DROP POLICY IF EXISTS "Admins can update categories" ON public.categories;
DROP POLICY IF EXISTS "Admins can delete categories" ON public.categories;
CREATE POLICY "Admins can manage categories" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can update categories" ON public.categories
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can delete categories" ON public.categories
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- employees
DROP POLICY IF EXISTS "Admins can insert employees" ON public.employees;
DROP POLICY IF EXISTS "Admins can update employees" ON public.employees;
DROP POLICY IF EXISTS "Admins can delete employees" ON public.employees;
CREATE POLICY "Admins can insert employees" ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can update employees" ON public.employees
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can delete employees" ON public.employees
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- inventory_items
DROP POLICY IF EXISTS "Admins can insert items" ON public.inventory_items;
DROP POLICY IF EXISTS "Admins can update items" ON public.inventory_items;
DROP POLICY IF EXISTS "Admins can delete items" ON public.inventory_items;
CREATE POLICY "Admins can insert items" ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can update items" ON public.inventory_items
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can delete items" ON public.inventory_items
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- repair_history
DROP POLICY IF EXISTS "Admins can insert repairs" ON public.repair_history;
DROP POLICY IF EXISTS "Admins can update repairs" ON public.repair_history;
DROP POLICY IF EXISTS "Admins can delete repairs" ON public.repair_history;
CREATE POLICY "Admins can insert repairs" ON public.repair_history
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can update repairs" ON public.repair_history
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can delete repairs" ON public.repair_history
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- movements
DROP POLICY IF EXISTS "Admins can update movements" ON public.movements;
DROP POLICY IF EXISTS "Admins can delete movements" ON public.movements;
CREATE POLICY "Admins can update movements" ON public.movements
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Admins can delete movements" ON public.movements
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- backup_schedule
DROP POLICY IF EXISTS "Admins can manage backup schedule" ON public.backup_schedule;
CREATE POLICY "Admins can manage backup schedule" ON public.backup_schedule
  FOR ALL TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

-- storage.objects (backups bucket)
DROP POLICY IF EXISTS "Admins can manage backups" ON storage.objects;
CREATE POLICY "Admins can manage backups" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'backups' AND (SELECT public.has_role(auth.uid(), 'admin')))
  WITH CHECK (bucket_id = 'backups' AND (SELECT public.has_role(auth.uid(), 'admin')));
