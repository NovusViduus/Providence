import type {
  SecurityEvent, IncidentReport, ResponseAction, Playbook,
  ActiveBlock, GeoThreat, EventStats, Page,
} from '../types/events';
import { getToken, logout } from './auth';

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers as Record<string, string> };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Events
export const getEvents = (params?: string) => request<Page<SecurityEvent>>(`/events${params ? '?' + params : ''}`);
export const getEvent = (id: string) => request<SecurityEvent>(`/events/${id}`);
export const getEventStats = () => request<EventStats>('/events/stats');
export const getGeoEvents = (hours = 24) => request<GeoThreat[]>(`/events/geo?hours=${hours}`);

// Incidents
export const getIncidents = (params?: string) => request<Page<IncidentReport>>(`/incidents${params ? '?' + params : ''}`);
export const getIncident = (id: string) => request<IncidentReport>(`/incidents/${id}`);
export const approveIncident = (id: string) => request<void>(`/incidents/${id}/approve`, { method: 'POST' });
export const rejectIncident = (id: string) => request<void>(`/incidents/${id}/reject`, { method: 'POST' });
export const updateIncident = (id: string, data: object) =>
  request<IncidentReport>(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

// Playbooks
export const getPlaybooks = () => request<Playbook[]>('/playbooks');
export const updatePlaybook = (id: string, data: Partial<Playbook>) =>
  request<Playbook>(`/playbooks/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// Blocks & Actions
export const getActiveBlocks = () => request<Record<string, string>>('/blocks');
export const unblockIp = (ip: string) => request<void>(`/blocks/${ip}`, { method: 'DELETE' });
export const getActions = (params?: string) => request<Page<ResponseAction>>(`/actions${params ? '?' + params : ''}`);
export const getActiveThreats = () => request<Record<string, string>>('/threats/active');

// Dossier - aggregate data for a single attacker IP
export const getEventsByIp = (ip: string) => request<Page<SecurityEvent>>(`/events?sourceIp=${encodeURIComponent(ip)}&size=200`);
export const getIncidentsByIp = (ip: string) => request<Page<IncidentReport>>(`/incidents?size=200`);
export const getActionsByIp = (ip: string) => request<Page<ResponseAction>>(`/actions?sourceIp=${encodeURIComponent(ip)}&size=200`);
