export interface SecurityEvent {
  id: string;
  eventId: string;
  timestamp: string;
  sourceIp: string;
  sourcePort: number;
  destIp: string;
  destPort: number;
  protocol: string;
  category: string;
  subcategory?: string;
  confidence: number;
  featureImportances?: Record<string, number>;
  sourceComponent: string;
  ja3Hash?: string;
  flowDuration?: number;
  packetCount?: number;
  byteCount?: number;
  responseTier: string;
  responseAction?: string;
}

export interface IncidentReport {
  id: string;
  eventId: string;
  playbookId?: string;
  responseTier: string;
  actionsTaken: string[];
  sourceIp: string;
  category: string;
  confidence: number;
  resolved: boolean;
  pendingApproval: boolean;
  notes?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ResponseAction {
  id: string;
  incidentId?: string;
  actionType: string;
  sourceIp: string;
  success: boolean;
  detail?: string;
  platform: string;
  ttlSeconds?: number;
  createdAt: string;
  expiresAt?: string;
  reversedAt?: string;
  reversedReason?: string;
}

export interface Playbook {
  id: string;
  name: string;
  category: string;
  description?: string;
  actions: string[];
  minConfidence: number;
  enabled: boolean;
  ttlSeconds: number;
}

export interface ActiveBlock {
  ip: string;
  action: string;
  category: string;
  confidence: number;
  blockedAt: string;
  expiresAt: string;
  incidentId: string;
}

export interface GeoThreat {
  sourceIp: string;
  latitude: number;
  longitude: number;
  country: string;
  city: string;
  category: string;
  eventCount: number;
  lastSeen: string;
  destIp?: string;
  destLatitude?: number;
  destLongitude?: number;
  destCountry?: string;
  destCity?: string;
}

export interface EventStats {
  total: number;
  lastHour: number;
  lastDay: number;
  byCategory: Record<string, number>;
  byTier: Record<string, number>;
}

export type Page<T> = {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
};

export interface AttackerDossier {
  ip: string;
  country: string;
  city: string;
  totalEvents: number;
  firstSeen: string;
  lastSeen: string;
  categories: Record<string, number>;
  honeypots: string[];
  threatScore: number;
  events: SecurityEvent[];
  incidents: IncidentReport[];
  actions: ResponseAction[];
}
