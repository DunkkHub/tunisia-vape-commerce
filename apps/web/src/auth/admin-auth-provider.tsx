import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type PropsWithChildren, useMemo } from 'react';

import { adminAuthClient } from '../api/admin-client';
import { ADMIN_SESSION_QUERY_KEY, AdminAuthContext } from './admin-auth-context';

export function AdminAuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ADMIN_SESSION_QUERY_KEY,
    queryFn: () => adminAuthClient.session(),
    staleTime: 15_000,
  });
  const passwordMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      adminAuthClient.password(email, password),
  });
  const totpMutation = useMutation({
    mutationFn: ({ challengeId, code }: { challengeId: string; code: string }) =>
      adminAuthClient.totp(challengeId, code),
  });
  const logoutMutation = useMutation({ mutationFn: () => adminAuthClient.logout() });

  const value = useMemo(
    () => ({
      user: sessionQuery.data?.user ?? null,
      session: sessionQuery.data ?? null,
      isLoading: sessionQuery.isPending,
      beginLogin: (email: string, password: string) =>
        passwordMutation.mutateAsync({ email, password }),
      verifyTotp: async (challengeId: string, code: string) => {
        const session = await totpMutation.mutateAsync({ challengeId, code });
        queryClient.setQueryData(ADMIN_SESSION_QUERY_KEY, session);
        return session;
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
        queryClient.setQueryData(ADMIN_SESSION_QUERY_KEY, null);
        queryClient.removeQueries({ queryKey: ['admin'] });
      },
    }),
    [
      logoutMutation,
      passwordMutation,
      queryClient,
      sessionQuery.data,
      sessionQuery.isPending,
      totpMutation,
    ],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}
