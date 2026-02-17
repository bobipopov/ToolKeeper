-- Add written_off_at column to inventory_items table to track when items were written off
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS written_off_at timestamptz;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_inventory_items_written_off_at 
ON inventory_items(written_off_at) 
WHERE written_off_at IS NOT NULL;
