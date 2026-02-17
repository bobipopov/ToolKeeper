-- Clean up duplicate user_roles entries (keep only the admin role if user has both)
DELETE FROM public.user_roles
WHERE role = 'user'
  AND user_id IN (
    SELECT user_id
    FROM public.user_roles
    WHERE role = 'admin'
  );

-- Fix update_last_activity to only update existing rows, not create new ones
CREATE OR REPLACE FUNCTION public.update_last_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update last_activity_at for the user's existing role(s)
  UPDATE public.user_roles
  SET last_activity_at = NOW()
  WHERE user_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION public.update_last_activity IS 'Актуализира последната активност на текущия потребител без да създава нови роли';
