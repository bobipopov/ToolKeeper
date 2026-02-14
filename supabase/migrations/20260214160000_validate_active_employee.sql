-- Validate that employee is active when creating movements

-- Create trigger function to validate employee is active
CREATE OR REPLACE FUNCTION validate_active_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  _is_active BOOLEAN;
BEGIN
  -- Get employee's active status
  SELECT is_active INTO _is_active
  FROM employees
  WHERE id = NEW.employee_id;

  -- If employee not found or not active, reject the movement
  IF _is_active IS NULL THEN
    RAISE EXCEPTION 'Employee with ID % does not exist', NEW.employee_id;
  END IF;

  IF _is_active = FALSE THEN
    RAISE EXCEPTION 'Cannot create movement for inactive employee. Please activate the employee first.';
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on movements INSERT
DROP TRIGGER IF EXISTS validate_employee_active_on_insert ON movements;
CREATE TRIGGER validate_employee_active_on_insert
  BEFORE INSERT ON movements
  FOR EACH ROW
  EXECUTE FUNCTION validate_active_employee();

COMMENT ON FUNCTION validate_active_employee IS 'Validates that employee is active before creating a movement record';
COMMENT ON TRIGGER validate_employee_active_on_insert ON movements IS 'Prevents creating movements for inactive employees';
