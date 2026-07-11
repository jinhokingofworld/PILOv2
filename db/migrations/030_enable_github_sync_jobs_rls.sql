-- Keep GitHub worker jobs inaccessible through the public Data API.
ALTER TABLE public.github_sync_jobs ENABLE ROW LEVEL SECURITY;
