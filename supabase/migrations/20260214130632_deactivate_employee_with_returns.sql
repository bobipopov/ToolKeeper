-- Create function to deactivate employee and return all their items atomically
CREATE OR REPLACE FUNCTION deactivate_employee_with_returns(
  _employee_id UUID,
  _issued_by_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _item_ids UUID[];
BEGIN
  -- Get all assigned item IDs for this employee
  SELECT ARRAY_AGG(DISTINCT item_id)
  INTO _item_ids
  FROM (
    SELECT DISTINCT ON (item_id) item_id
    FROM movements
    WHERE employee_id = _employee_id
      AND movement_type = 'issue'
    ORDER BY item_id, created_at DESC
  ) AS latest_issues
  WHERE item_id IN (
    SELECT id FROM inventory_items WHERE status = 'assigned'
  );

  -- If there are items, return them
  IF _item_ids IS NOT NULL AND array_length(_item_ids, 1) > 0 THEN
    -- Insert return movements
    INSERT INTO movements (item_id, employee_id, movement_type, condition, issued_by)
    SELECT
      unnest(_item_ids),
      _employee_id,
      'return',
      'Без забележки',
      _issued_by_user_id;

    -- Update items to in_stock (trigger will handle this automatically)
  END IF;

  -- Deactivate the employee
  UPDATE employees
  SET is_active = FALSE
  WHERE id = _employee_id;
END;
$$;

COMMENT ON FUNCTION deactivate_employee_with_returns IS 'Деактивира служител и връща всички негови артикули атомично в една транзакция';
