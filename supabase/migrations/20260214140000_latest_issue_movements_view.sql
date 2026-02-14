-- Create a VIEW for latest issue movements per item
-- This replaces client-side deduplication logic and improves performance

CREATE OR REPLACE VIEW latest_issue_movements AS
SELECT DISTINCT ON (item_id)
  id,
  item_id,
  employee_id,
  movement_type,
  condition,
  consumable_note,
  damage_notes,
  issued_by,
  created_at
FROM movements
WHERE movement_type = 'issue'
ORDER BY item_id, created_at DESC;

COMMENT ON VIEW latest_issue_movements IS 'Returns the most recent issue movement for each item, eliminating need for client-side deduplication';

-- Grant access to authenticated users
GRANT SELECT ON latest_issue_movements TO authenticated;
