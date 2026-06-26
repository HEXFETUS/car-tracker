/**
 * Wrapper around fetch that automatically attaches the current user's
 * type as an X-User-Type header for backend role-based authorization.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const stored = localStorage.getItem('car-tracker-user');
  let userType: string | undefined;
  let userId: string | undefined;

  if (stored) {
    try {
      const user = JSON.parse(stored);
      userType = user.userType;
      userId = user.id;
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
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
