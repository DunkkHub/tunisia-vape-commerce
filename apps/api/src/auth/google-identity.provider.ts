import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeChallengeMethod, OAuth2Client, type TokenPayload } from 'google-auth-library';
import type { Environment } from '../config/environment';

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  emailNormalized: string;
  fullName: string;
}

export class GoogleIdentityVerificationError extends Error {
  constructor() {
    super('Google identity verification failed.');
    this.name = 'GoogleIdentityVerificationError';
  }
}

const stripAsciiControls = (value: string): string =>
  [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const bidiControl =
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069);
      return codePoint < 32 || codePoint === 127 || bidiControl ? ' ' : character;
    })
    .join('');

export const validateGoogleTokenPayload = (
  payload: TokenPayload | undefined,
  expected: { clientId: string; nonce: string; nowSeconds?: number },
): VerifiedGoogleIdentity => {
  const nowSeconds = expected.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const issuerAllowed =
    payload?.iss === 'https://accounts.google.com' || payload?.iss === 'accounts.google.com';
  if (
    !payload ||
    !issuerAllowed ||
    payload.aud !== expected.clientId ||
    (payload.azp !== undefined && payload.azp !== expected.clientId) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= nowSeconds ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > nowSeconds + 60 ||
    payload.nonce !== expected.nonce ||
    payload.email_verified !== true ||
    typeof payload.sub !== 'string' ||
    payload.sub.length < 1 ||
    payload.sub.length > 255 ||
    typeof payload.email !== 'string' ||
    payload.email.length > 320
  ) {
    throw new GoogleIdentityVerificationError();
  }

  const email = payload.email.trim();
  const emailNormalized = email.toLocaleLowerCase('en-US');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized)) {
    throw new GoogleIdentityVerificationError();
  }
  const fullName = stripAsciiControls(payload.name ?? '')
    .trim()
    .slice(0, 120);
  return {
    subject: payload.sub,
    email,
    emailNormalized,
    fullName,
  };
};

@Injectable()
export class GoogleIdentityProvider {
  private readonly enabled: boolean;
  private readonly clientId?: string;
  private readonly callbackUrl?: string;
  private readonly client?: OAuth2Client;

  constructor(config: ConfigService<Environment, true>) {
    this.enabled = config.get('GOOGLE_OAUTH_ENABLED', { infer: true });
    this.clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
    this.callbackUrl = config.get('GOOGLE_CALLBACK_URL', { infer: true });
    const clientSecret = config.get('GOOGLE_CLIENT_SECRET', { infer: true });
    if (this.enabled && this.clientId && clientSecret && this.callbackUrl) {
      this.client = new OAuth2Client(this.clientId, clientSecret, this.callbackUrl);
    }
  }

  isEnabled(): boolean {
    return this.enabled && Boolean(this.client && this.clientId && this.callbackUrl);
  }

  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): string {
    const client = this.requiredClient();
    return client.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      include_granted_scopes: false,
      prompt: 'select_account',
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }

  async exchange(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<VerifiedGoogleIdentity> {
    const client = this.requiredClient();
    const callbackUrl = this.callbackUrl;
    const clientId = this.clientId;
    if (!callbackUrl || !clientId) throw new GoogleIdentityVerificationError();
    try {
      const { tokens } = await client.getToken({
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirect_uri: callbackUrl,
      });
      if (!tokens.id_token || tokens.id_token.length > 16_384) {
        throw new GoogleIdentityVerificationError();
      }
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId,
      });
      return validateGoogleTokenPayload(ticket.getPayload(), {
        clientId,
        nonce: input.nonce,
      });
    } catch {
      throw new GoogleIdentityVerificationError();
    }
  }

  private requiredClient(): OAuth2Client {
    if (!this.isEnabled()) throw new GoogleIdentityVerificationError();
    return this.client!;
  }
}
