import { customerAuthClient, type GoogleOAuthStartInput } from '../../api/customer-client';

const trustedGoogleAuthorizationOrigin = 'https://accounts.google.com';

const googleFailureMessages: Record<string, string> = {
  access_denied: 'auth.googleErrorAccessDenied',
  account_conflict: 'auth.googleErrorAccountConflict',
  account_unavailable: 'auth.googleErrorAccountUnavailable',
  configuration: 'auth.googleErrorUnavailable',
  provider: 'auth.googleErrorProvider',
  state: 'auth.googleErrorExpired',
};

export function safeCustomerReturnPath(value: string): string {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#') ||
    /^\/(?:admin|api)(?:[/?]|$)/i.test(value)
  ) {
    return '/account';
  }
  return value;
}

export function googleOAuthFailureMessageKey(reason: string | null): string | null {
  if (!reason) return null;
  return googleFailureMessages[reason] ?? 'auth.googleErrorGeneric';
}

export async function beginGoogleCustomerAuthentication(
  input: GoogleOAuthStartInput,
  redirect: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  const result = await customerAuthClient.startGoogle({
    ...input,
    returnTo: safeCustomerReturnPath(input.returnTo),
  });
  const authorizationUrl = new URL(result.authorizationUrl);
  if (
    authorizationUrl.origin !== trustedGoogleAuthorizationOrigin ||
    authorizationUrl.username ||
    authorizationUrl.password
  ) {
    throw new Error('The Google authorization destination is not trusted.');
  }
  redirect(authorizationUrl.toString());
}
