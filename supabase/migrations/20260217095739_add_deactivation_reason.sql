-- Add deactivation reason and timestamp columns to employees table
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS deactivation_reason text,
ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_employees_deactivated_at 
ON employees(deactivated_at) 
WHERE deactivated_at IS NOT NULL;

-- Add comment to document the column
COMMENT ON COLUMN employees.deactivation_reason IS 'Причина за деактивиране: Напуснал, Уволнен, Дългосрочен отпуск, Пенсиониран';
