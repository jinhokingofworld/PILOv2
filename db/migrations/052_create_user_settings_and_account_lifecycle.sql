BEGIN;

ALTER TABLE public.users
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE public.users
  ADD CONSTRAINT users_deleted_at_order_check
  CHECK (deleted_at IS NULL OR deleted_at >= created_at);

CREATE INDEX idx_users_deleted_at
  ON public.users(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY
    REFERENCES public.users(id) ON DELETE CASCADE,

  display_name VARCHAR(100),
  job_title VARCHAR(100),
  bio VARCHAR(500),
  avatar_mode VARCHAR(20) NOT NULL DEFAULT 'provider',
  custom_avatar_url TEXT,
  avatar_color VARCHAR(7) NOT NULL DEFAULT '#6366F1',

  theme VARCHAR(20) NOT NULL DEFAULT 'system',
  density VARCHAR(20) NOT NULL DEFAULT 'comfortable',

  default_workspace_id UUID
    REFERENCES public.workspaces(id) ON DELETE SET NULL,
  default_landing_page VARCHAR(30) NOT NULL DEFAULT 'home',
  restore_last_workspace BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_settings_display_name_check
    CHECK (
      display_name IS NULL
      OR length(btrim(display_name)) BETWEEN 1 AND 100
    ),
  CONSTRAINT user_settings_job_title_check
    CHECK (
      job_title IS NULL
      OR length(btrim(job_title)) BETWEEN 1 AND 100
    ),
  CONSTRAINT user_settings_bio_check
    CHECK (
      bio IS NULL
      OR length(btrim(bio)) BETWEEN 1 AND 500
    ),
  CONSTRAINT user_settings_avatar_mode_check
    CHECK (avatar_mode IN ('provider', 'custom', 'initials')),
  CONSTRAINT user_settings_custom_avatar_url_check
    CHECK (
      custom_avatar_url IS NULL
      OR (
        length(btrim(custom_avatar_url)) BETWEEN 1 AND 2048
        AND btrim(custom_avatar_url) ~* '^https://[^[:space:]]+$'
      )
    ),
  CONSTRAINT user_settings_avatar_color_check
    CHECK (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT user_settings_theme_check
    CHECK (theme IN ('system', 'light', 'dark')),
  CONSTRAINT user_settings_density_check
    CHECK (density IN ('comfortable', 'compact')),
  CONSTRAINT user_settings_default_landing_page_check
    CHECK (
      default_landing_page IN (
        'home',
        'calendar',
        'board',
        'canvas'
      )
    )
);

CREATE INDEX idx_user_settings_default_workspace_id
  ON public.user_settings(default_workspace_id);

CREATE TRIGGER trg_user_settings_updated_at
BEFORE UPDATE ON public.user_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

COMMIT;
