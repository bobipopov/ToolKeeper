-- Fix: movements.issued_by FK should SET NULL when a user is deleted.
-- admin_delete_user() does this manually, but the DB constraint should
-- also handle direct deletes for data integrity.

ALTER TABLE public.movements
  DROP CONSTRAINT IF EXISTS movements_issued_by_fkey;

ALTER TABLE public.movements
  ADD CONSTRAINT movements_issued_by_fkey
  FOREIGN KEY (issued_by) REFERENCES auth.users(id)
  ON DELETE SET NULL;
