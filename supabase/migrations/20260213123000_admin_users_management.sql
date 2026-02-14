-- Admin users management RPCs
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  full_name TEXT,
  role public.app_role,
  created_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ
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
    u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  _user_id UUID,
  _role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  IF _user_id = auth.uid() AND _role <> 'admin' THEN
    RAISE EXCEPTION 'Cannot remove own admin role';
  END IF;

  UPDATE public.user_roles
  SET role = _role
  WHERE user_id = _user_id;

  IF NOT FOUND THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _role);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;

  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete current admin user';
  END IF;

  UPDATE public.movements
  SET issued_by = NULL
  WHERE issued_by = _user_id;

  DELETE FROM auth.users
  WHERE id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;
