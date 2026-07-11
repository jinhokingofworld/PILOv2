-- Add an optional user-selected icon for Workspace navigation surfaces.

BEGIN;

ALTER TABLE public.workspaces
  ADD COLUMN icon TEXT,
  ADD CONSTRAINT workspaces_icon_length_check
    CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 32);

COMMIT;
