export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  client: string | null;
  color: string;
  hourlyRateCents: number | null;
  archived: boolean;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  userId: string;
  projectId: string;
  note: string;
  startedAt: string;
  stoppedAt: string | null;
  createdAt: string;
  // joined fields
  projectName: string;
  projectColor: string;
  userName: string;
}

export interface ReportGroup {
  id: string;
  name: string;
  seconds: number;
  billableCents: number | null;
}

export interface ReportResult {
  groups: ReportGroup[];
  totalSeconds: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Maps a thrown error to a JSON-serializable { status, body } pair for API routes. */
export function apiErrorResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: err.message } };
  }
  console.error(err);
  return { status: 500, body: { error: "internal error" } };
}
