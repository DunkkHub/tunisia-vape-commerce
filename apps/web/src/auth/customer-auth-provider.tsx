import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type PropsWithChildren, useMemo } from 'react';

import { customerAuthClient } from '../api/customer-client';
import {
  CUSTOMER_SESSION_QUERY_KEY,
  CustomerAuthContext,
  type CustomerLoginValues,
  type CustomerRegisterValues,
} from './customer-auth-context';

export function CustomerAuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: CUSTOMER_SESSION_QUERY_KEY,
    queryFn: () => customerAuthClient.session(),
    staleTime: 60_000,
  });
  const loginMutation = useMutation({
    mutationFn: (values: CustomerLoginValues) => customerAuthClient.login(values),
  });
  const registerMutation = useMutation({
    mutationFn: (values: CustomerRegisterValues) => customerAuthClient.register(values),
  });
  const logoutMutation = useMutation({ mutationFn: () => customerAuthClient.logout() });

  const value = useMemo(
    () => ({
      user: sessionQuery.data?.user ?? null,
      session: sessionQuery.data ?? null,
      isLoading: sessionQuery.isPending,
      login: async (values: CustomerLoginValues) => {
        const session = await loginMutation.mutateAsync(values);
        queryClient.setQueryData(CUSTOMER_SESSION_QUERY_KEY, session);
        return session;
      },
      register: async (values: CustomerRegisterValues) => {
        const session = await registerMutation.mutateAsync(values);
        queryClient.setQueryData(CUSTOMER_SESSION_QUERY_KEY, session);
        return session;
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
        queryClient.setQueryData(CUSTOMER_SESSION_QUERY_KEY, null);
        await queryClient.invalidateQueries({ queryKey: ['cart'] });
      },
    }),
    [
      loginMutation,
      logoutMutation,
      queryClient,
      registerMutation,
      sessionQuery.data,
      sessionQuery.isPending,
    ],
  );

  return <CustomerAuthContext.Provider value={value}>{children}</CustomerAuthContext.Provider>;
}
