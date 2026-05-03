export type TriggerSource = "popup-scan" | "context-menu";

export interface ExtractRequestPayload {
  pageUrl: string;
  pageTitle: string;
  visibleText: string;
  selectedText?: string;
  titleHints?: string[];
  screenshotBase64?: string;
  timezone: string;
  locale?: string;
}

export interface EventCandidate {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  location?: string;
  description?: string;
  sourceUrl?: string;
  evidence: string[];
  confidence: number;
  assumptions: string[];
  duplicateHint?: {
    maybeDuplicate: boolean;
    reason?: string;
  };
}

export interface ExtractResponsePayload {
  candidates: EventCandidate[];
}

export interface CalendarInfo {
  id: string;
  summary: string;
  accessRole: string;
}

export interface StoredSettings {
  backendBaseUrl: string;
  timezone: string;
  locale: string;
  debug: boolean;
}

export interface PendingSession {
  source: TriggerSource;
  createdAt: string;
  tabId?: number;
  pageUrl: string;
  pageTitle: string;
  visibleText: string;
  selectedText?: string;
  screenshotBase64?: string;
  candidates: EventCandidate[];
}
