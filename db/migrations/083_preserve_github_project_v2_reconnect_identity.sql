BEGIN;

ALTER TABLE public.github_projects_v2
  DROP CONSTRAINT IF EXISTS github_projects_v2_installation_id_fkey,
  ALTER COLUMN installation_id DROP NOT NULL;

ALTER TABLE public.github_projects_v2
  ADD CONSTRAINT github_projects_v2_installation_id_fkey
  FOREIGN KEY (installation_id)
  REFERENCES public.github_installations(id)
  ON DELETE SET NULL;

COMMIT;
