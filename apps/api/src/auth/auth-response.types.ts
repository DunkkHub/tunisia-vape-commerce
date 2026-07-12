export interface CustomerUserResponse {
  id: string;
  email: string | null;
  phone: string;
  fullName: string;
  emailVerified: boolean;
}

export interface AdminUserResponse {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  requiresRecentAuthentication: boolean;
}

export interface SessionResponse<TUser> {
  data: {
    user: TUser;
    expiresAt: string;
  };
}
