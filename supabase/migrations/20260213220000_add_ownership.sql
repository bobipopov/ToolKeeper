-- Add ownership column to inventory_items: 'milkos' (own) or 'rent' (rented).

CREATE TYPE public.ownership_type AS ENUM ('milkos', 'rent');

ALTER TABLE public.inventory_items
  ADD COLUMN ownership public.ownership_type NOT NULL DEFAULT 'milkos';
