-- Increase minimum password length from 6 to 8 characters.

DROP FUNCTION IF EXISTS public.admin_create_user(TEXT, TEXT, TEXT, public.app_role);

CREATE OR REPLACE FUNCTION public.admin_create_user(
  _email TEXT,
  _password TEXT,
  _full_name TEXT DEFAULT '',
  _role public.app_role DEFAULT 'user'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can create users';
  END IF;

  v_email := lower(trim(_email));

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF _password IS NULL OR length(_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'User with this email already exists';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, reauthentication_token,
    email_change_token_new, email_change_token_current,
    phone_change_token, phone_change, email_change, is_sso_user
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email'),
      'role', 'authenticated'
    ),
    jsonb_build_object('full_name', coalesce(_full_name, '')),
    now(), now(),
    '', '', '', '', '', '', '', '', false
  )
  RETURNING id INTO v_user_id;

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  VALUES (
    gen_random_uuid(),
    v_user_id,
    v_email,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(), now(), now()
  );

  UPDATE public.user_roles SET role = _role WHERE user_id = v_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (v_user_id, _role);
  END IF;

  UPDATE public.profiles
  SET full_name = coalesce(_full_name, '')
  WHERE id = v_user_id;

  RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, public.app_role) TO authenticated;
