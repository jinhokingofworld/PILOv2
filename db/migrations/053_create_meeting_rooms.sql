BEGIN;

CREATE TABLE public.meeting_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  room_key VARCHAR(100) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_by_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_rooms_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT meeting_rooms_room_key_check
    CHECK (length(btrim(room_key)) BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX unique_active_meeting_room_key
  ON public.meeting_rooms(workspace_id, room_key)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX unique_active_meeting_room_name
  ON public.meeting_rooms(workspace_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE INDEX idx_meeting_rooms_workspace_active
  ON public.meeting_rooms(workspace_id, created_at)
  WHERE archived_at IS NULL;

CREATE TRIGGER trg_meeting_rooms_updated_at
BEFORE UPDATE ON public.meeting_rooms
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meeting_rooms ENABLE ROW LEVEL SECURITY;

INSERT INTO public.meeting_rooms (
  workspace_id,
  room_key,
  name,
  created_by_id
)
SELECT
  workspaces.id,
  'MAIN_MEETING_ROOM',
  '기본 회의실',
  workspaces.owner_user_id
FROM public.workspaces
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_default_meeting_room_for_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.meeting_rooms (
    workspace_id,
    room_key,
    name,
    created_by_id
  )
  VALUES (
    NEW.id,
    'MAIN_MEETING_ROOM',
    '기본 회의실',
    NEW.owner_user_id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_workspaces_create_default_meeting_room
AFTER INSERT ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.create_default_meeting_room_for_workspace();

COMMIT;
