interface ErrorPayload {
  statusCode?: number;
  code?: string;
  message?: string;
  requestId?: string;
  errors?: Record<string, string[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly fieldErrors: Record<string, string[]>;

  constructor(status: number, payload?: ErrorPayload) {
    super(payload?.message ?? 'The request could not be completed.');
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.code ?? 'REQUEST_FAILED';
    this.requestId = payload?.requestId;
    this.fieldErrors = payload?.errors ?? {};
  }
}

const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

function cookie(name: string) {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function isMutation(method?: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes((method ?? 'GET').toUpperCase());
}

function csrfCookieFor(headers: Headers) {
  const context = headers.get('X-Client-Context');
  const names =
    context === 'admin'
      ? ['__Host-vape_admin_csrf', 'vape_admin_csrf']
      : ['__Host-vape_customer_csrf', 'vape_customer_csrf'];
  for (const name of names) {
    const value = cookie(name);
    if (value) return value;
  }
  return undefined;
}

function activeLocale() {
  if (typeof document === 'undefined') return 'fr';
  return document.documentElement.lang === 'ar' ? 'ar' : 'fr';
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined;
  return response.json() as Promise<unknown>;
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export async function httpRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Accept-Language', activeLocale());

  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (isMutation(init.method)) {
    const csrfToken = csrfCookieFor(headers);
    if (csrfToken) headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
  });
  const payload = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, payload as ErrorPayload | undefined);
  }

  return unwrap<T>(payload);
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}
