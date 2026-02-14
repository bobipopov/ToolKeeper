-- Add damage_notes column to movements table for detailed damage description
ALTER TABLE movements ADD COLUMN IF NOT EXISTS damage_notes TEXT;

COMMENT ON COLUMN movements.damage_notes IS 'Детайлно описание на повреда при връщане на артикул';
