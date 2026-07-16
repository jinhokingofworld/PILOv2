export type CalendarEventUser = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type CalendarEvent = {
  id: number;
  title: string;
  description: string | null;
  color: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  createdBy: string;
  createdByUser: CalendarEventUser;
  createdAt: string;
  updatedAt: string;
};

export type ListCalendarEventsQuery = {
  start: string;
  end: string;
};

export type CreateCalendarEventInput = {
  title: string;
  description?: string | null;
  color?: string;
  isAllDay?: boolean;
  startDate: string;
  endDate?: string;
  startTime?: string | null;
  endTime?: string | null;
};

export type UpdateCalendarEventInput = Partial<CreateCalendarEventInput>;

export type DeleteCalendarEventResult = {
  id: number;
};
