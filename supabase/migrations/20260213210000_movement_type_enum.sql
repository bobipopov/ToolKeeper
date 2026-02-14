-- Convert movement_type from TEXT to a proper ENUM type.

CREATE TYPE public.movement_type AS ENUM ('issue', 'return');

-- Drop the composite index that references movement_type before altering the column.
DROP INDEX IF EXISTS idx_movements_type_created;

ALTER TABLE public.movements
  ALTER COLUMN movement_type TYPE public.movement_type
  USING movement_type::public.movement_type;

-- Recreate the composite index on the enum column.
CREATE INDEX idx_movements_type_created
  ON public.movements(movement_type, created_at DESC);
