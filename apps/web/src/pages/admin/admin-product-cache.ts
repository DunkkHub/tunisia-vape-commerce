import type { QueryClient } from '@tanstack/react-query';

const publicCommerceQueryKeys = [
  ['storefront', 'home'],
  ['catalog'],
  ['products'],
  ['product'],
  ['cart'],
  ['checkout'],
] as const;

export async function invalidatePublicProductCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    publicCommerceQueryKeys.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey: [...queryKey] }),
    ),
  );
}
