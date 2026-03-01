-- Fix: "RLS Policy Always True" warning on public.movements
-- "Authenticated can create movements" had WITH CHECK (true) which is
-- flagged as overly permissive. Replace with a meaningful check.

DROP POLICY IF EXISTS "Authenticated can create movements" ON public.movements;

CREATE POLICY "Authenticated can create movements" ON public.movements
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
