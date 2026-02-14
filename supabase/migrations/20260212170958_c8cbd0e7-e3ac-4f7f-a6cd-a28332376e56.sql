
-- Fix the permissive movements INSERT policy
DROP POLICY "Authenticated can create movements" ON public.movements;
CREATE POLICY "Authenticated can create movements" ON public.movements 
  FOR INSERT TO authenticated 
  WITH CHECK (issued_by = auth.uid());
