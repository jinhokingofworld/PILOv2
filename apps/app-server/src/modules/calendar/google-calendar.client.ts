import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";

export interface GoogleCalendarTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface GoogleCalendarRemoteEvent {
  id?: string;
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
}

@Injectable()
export class GoogleCalendarClient {
  async exchangeCode(input: { code: string; clientId: string; clientSecret: string; redirectUri: string }): Promise<GoogleCalendarTokenResponse> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code" })
    });
    return this.readToken(response);
  }

  async refresh(input: { refreshToken: string; clientId: string; clientSecret: string }): Promise<GoogleCalendarTokenResponse> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret, grant_type: "refresh_token" })
    });
    return this.readToken(response);
  }

  async listCalendars(accessToken: string): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
    const response = await this.request("https://www.googleapis.com/calendar/v3/users/me/calendarList", accessToken);
    const body = await response.json() as { items?: Array<{ id?: string; summary?: string; primary?: boolean }> };
    return (body.items ?? []).flatMap((item) => item.id && item.summary ? [{ id: item.id, summary: item.summary, primary: item.primary === true }] : []);
  }

  async insertEvent(accessToken: string, calendarId: string, event: GoogleCalendarRemoteEvent): Promise<string> {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(event)
    });
    if (response.status === 409 && event.id) return event.id;
    if (!response.ok) throw badRequest("Google Calendar event creation failed");
    const body = await response.json() as { id?: string };
    if (!body.id) throw badRequest("Google Calendar event creation failed");
    return body.id;
  }

  async updateEvent(accessToken: string, calendarId: string, eventId: string, event: GoogleCalendarRemoteEvent): Promise<void> {
    await this.request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, accessToken, { method: "PUT", body: JSON.stringify(event) });
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (response.ok || response.status === 404 || response.status === 410) return;
    throw badRequest("Google Calendar request failed");
  }

  private async readToken(response: Response): Promise<GoogleCalendarTokenResponse> {
    const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!response.ok || !body.access_token) throw badRequest("Google Calendar token exchange failed");
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in };
  }

  private async request(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } });
    if (!response.ok) throw badRequest("Google Calendar request failed");
    return response;
  }
}
