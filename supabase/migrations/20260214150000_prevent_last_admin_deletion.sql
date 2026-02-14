-- Prevent deleting or downgrading the last admin user

-- Update admin_set_user_role to prevent downgrading last admin
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  _user_id UUID,
  _role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _current_role public.app_role;
  _admin_count INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  IF _user_id = auth.uid() AND _role <> 'admin' THEN
    RAISE EXCEPTION 'Cannot remove own admin role';
  END IF;

  -- Get current role
  SELECT role INTO _current_role
  FROM public.user_roles
  WHERE user_id = _user_id;

  -- If downgrading from admin to user, check if this is the last admin
  IF _current_role = 'admin' AND _role <> 'admin' THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles
    WHERE role = 'admin';

    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin. There must be at least one admin user.';
    END IF;
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

-- Update admin_delete_user to prevent deleting last admin
CREATE OR REPLACE FUNCTION public.admin_delete_user(_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _user_role public.app_role;
  _admin_count INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can delete users';
  END IF;

  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete current admin user';
  END IF;

  -- Get user's role
  SELECT role INTO _user_role
  FROM public.user_roles
  WHERE user_id = _user_id;

  -- If user is admin, check if this is the last admin
  IF _user_role = 'admin' THEN
    SELECT COUNT(*) INTO _admin_count
    FROM public.user_roles
    WHERE role = 'admin';

    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot delete the last admin. There must be at least one admin user.';
    END IF;
  END IF;

  -- Clean up references first
  UPDATE public.movements
  SET issued_by = NULL
  WHERE issued_by = _user_id;

  -- Delete the user
  DELETE FROM auth.users
  WHERE id = _user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_set_user_role IS 'Set user role with validation to prevent removing last admin';
COMMENT ON FUNCTION public.admin_delete_user IS 'Delete user with validation to prevent deleting last admin';
