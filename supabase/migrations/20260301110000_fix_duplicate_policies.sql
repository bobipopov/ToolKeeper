-- ============================================================
-- Drop ALL existing RLS policies for affected tables (by name from pg_policies)
-- and recreate them cleanly with (SELECT auth.uid()) optimization.
-- This handles cases where policy names in production differ from migrations.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles', 'user_roles', 'categories', 'employees',
        'inventory_items', 'repair_history', 'movements', 'backup_schedule'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END;
$$;

-- Also drop storage policy
DROP POLICY IF EXISTS "Admins can manage backups" ON storage.objects;

-- ============================================================
-- Recreate all policies cleanly
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
CREATE POLICY "Authenticated can read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()));

-- ── user_roles ───────────────────────────────────────────────
CREATE POLICY "Authenticated can read roles" ON public.user_roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ── categories ───────────────────────────────────────────────
CREATE POLICY "Authenticated can read categories" ON public.categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert categories" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can update categories" ON public.categories
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete categories" ON public.categories
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ── employees ────────────────────────────────────────────────
CREATE POLICY "Authenticated can read employees" ON public.employees
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert employees" ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can update employees" ON public.employees
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete employees" ON public.employees
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ── inventory_items ──────────────────────────────────────────
CREATE POLICY "Authenticated can read items" ON public.inventory_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert items" ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can update items" ON public.inventory_items
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete items" ON public.inventory_items
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ── repair_history ───────────────────────────────────────────
CREATE POLICY "Authenticated can read repairs" ON public.repair_history
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert repairs" ON public.repair_history
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can update repairs" ON public.repair_history
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete repairs" ON public.repair_history
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ── movements ────────────────────────────────────────────────
CREATE POLICY "Authenticated can read movements" ON public.movements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can create movements" ON public.movements
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update movements" ON public.movements
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins can delete movements" ON public.movements
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ── backup_schedule ──────────────────────────────────────────
CREATE POLICY "Admins can manage backup schedule" ON public.backup_schedule
  FOR ALL TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

-- ── storage.objects (backups bucket) ─────────────────────────
CREATE POLICY "Admins can manage backups" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'backups' AND (SELECT public.has_role(auth.uid(), 'admin')))
  WITH CHECK (bucket_id = 'backups' AND (SELECT public.has_role(auth.uid(), 'admin')));
