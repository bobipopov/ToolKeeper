-- Add day_of_month support to backup_schedule
ALTER TABLE public.backup_schedule
ADD COLUMN IF NOT EXISTS day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31);

-- Drop and recreate admin_update_backup_schedule with the new parameter
DROP FUNCTION IF EXISTS public.admin_update_backup_schedule(BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_update_backup_schedule(
  p_enabled         BOOLEAN,
  p_hour            INTEGER,
  p_minute          INTEGER,
  p_day_of_week     INTEGER,   -- NULL unless weekly mode
  p_retention_count INTEGER,
  p_day_of_month    INTEGER    -- NULL unless monthly mode
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can update backup schedule';
  END IF;

  UPDATE public.backup_schedule SET
    enabled         = p_enabled,
    hour            = p_hour,
    minute          = p_minute,
    day_of_week     = p_day_of_week,
    day_of_month    = p_day_of_month,
    retention_count = p_retention_count,
    updated_at      = NOW()
  WHERE id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_backup_schedule(BOOLEAN, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;
