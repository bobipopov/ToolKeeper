-- Allow deleting employees that have movements.
-- Movements history is preserved with employee_id set to NULL.

ALTER TABLE public.movements
  ALTER COLUMN employee_id DROP NOT NULL;

ALTER TABLE public.movements
  DROP CONSTRAINT movements_employee_id_fkey;

ALTER TABLE public.movements
  ADD CONSTRAINT movements_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES public.employees(id)
  ON DELETE SET NULL;
