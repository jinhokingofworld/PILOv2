CREATE FUNCTION public.runner_test_function()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 1;
END;
$$;
