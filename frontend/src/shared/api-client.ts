/**
 * Wrapper around fetch that automatically attaches the current user's
 * type as an X-User-Type header for backend role-based authorization.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const stored = localStorage.getItem('car-tracker-user');
  let userType: string | undefined;

  if (stored) {
    try {
      const user = JSON.parse(stored);
      userType = user.userType;
    } catch {
      // ignore parse errors
    }
  }

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };

  if (userType) {
    headers['X-User-Type'] = userType;
  }

  return fetch(input, {
    ...init,
    headers,
  });
}