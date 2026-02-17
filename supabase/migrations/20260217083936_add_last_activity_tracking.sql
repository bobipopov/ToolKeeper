-- Add last_activity_at column to user_roles table
ALTER TABLE public.user_roles
ADD COLUMN last_activity_at TIMESTAMPTZ;

-- Drop and recreate admin_list_users to change return type
DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  full_name TEXT,
  role public.app_role,
  created_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can list users';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email::text AS email,
    COALESCE(p.full_name, '') AS full_name,
    COALESCE(ur.role, 'user'::public.app_role) AS role,
    u.created_at,
    u.last_sign_in_at,
    ur.last_activity_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

-- Create function to update last activity
CREATE OR REPLACE FUNCTION public.update_last_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update or insert user_role with last activity timestamp
  INSERT INTO public.user_roles (user_id, role, last_activity_at)
  VALUES (auth.uid(), 'user', NOW())
  ON CONFLICT (user_id, role)
  DO UPDATE SET last_activity_at = NOW();

  -- If user is admin, also update admin role activity
  IF public.has_role(auth.uid(), 'admin') THEN
    INSERT INTO public.user_roles (user_id, role, last_activity_at)
    VALUES (auth.uid(), 'admin', NOW())
    ON CONFLICT (user_id, role)
    DO UPDATE SET last_activity_at = NOW();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_last_activity() TO authenticated;

COMMENT ON FUNCTION public.update_last_activity IS 'Актуализира последната активност на текущия потребител';
