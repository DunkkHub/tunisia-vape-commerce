import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Boxes, SlidersHorizontal } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { adminDataClient } from '../../api/admin-data-client';
import { useAdminAuth } from '../../auth/admin-auth-context';
import { Button } from '../../components/ui/button';
import { ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate } from '../../components/ui/price';

type Operation = 'ADD' | 'REMOVE' | 'SET';
type Reason = 'PURCHASE_RECEIPT' | 'STOCK_COUNT_CORRECTION' | 'DAMAGE' | 'EXPIRY' | 'OTHER';

const stringValue = (value: FormDataEntryValue | null): string =>
  typeof value === 'string' ? value.trim() : '';

export function AdminInventoryDetailPage() {
  const { variantId = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAdminAuth();
  const canAdjust = Boolean(user?.permissions.includes('inventory.adjust'));
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const variant = useQuery({
    queryKey: ['admin', 'inventory', 'variant', variantId],
    queryFn: () => adminDataClient.inventoryVariant(variantId),
    enabled: Boolean(variantId),
  });
  const locations = useQuery({
    queryKey: ['admin', 'inventory', 'locations'],
    queryFn: adminDataClient.inventoryLocations,
    enabled: canAdjust,
  });
  const invalidate = () => {
    void variant.refetch();
    void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory'] });
  };
  const adjustment = useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: Parameters<typeof adminDataClient.adjustInventory>[1];
    }) => adminDataClient.adjustInventory(itemId, payload),
    onSuccess: () => {
      setActiveItem(null);
      invalidate();
    },
  });
  const threshold = useMutation({
    mutationFn: (lowStockThreshold: number) =>
      adminDataClient.updateLowStockThreshold(variantId, {
        lowStockThreshold,
        expectedVersion: variant.data!.version,
      }),
    onSuccess: invalidate,
  });
  const createLocation = useMutation({
    mutationFn: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const address = stringValue(form.get('address'));
      return adminDataClient.createInventoryLocation({
        code: stringValue(form.get('code')).toUpperCase(),
        name: stringValue(form.get('name')),
        ...(address ? { address } : {}),
      });
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inventory', 'locations'] }),
  });
  const createBucket = useMutation({
    mutationFn: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const note = stringValue(form.get('note'));
      return adminDataClient.createInventoryItem({
        variantId,
        locationId: stringValue(form.get('locationId')),
        initialQuantity: Number(stringValue(form.get('initialQuantity'))),
        ...(note ? { note } : {}),
      });
    },
    onSuccess: invalidate,
  });
  const submitAdjustment = (itemId: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!variant.data) return;
    const item = variant.data.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const form = new FormData(event.currentTarget);
    const operation = stringValue(form.get('operation')) as Operation;
    const reasonCode = stringValue(form.get('reasonCode')) as Reason;
    const rawAmount = Number(stringValue(form.get('amount')));
    const note = stringValue(form.get('note'));
    if (!Number.isInteger(rawAmount) || rawAmount < (operation === 'SET' ? 0 : 1)) return;
    adjustment.mutate({
      itemId,
      payload: {
        operation,
        ...(operation === 'SET' ? { targetOnHandQuantity: rawAmount } : { quantity: rawAmount }),
        reasonCode,
        ...(note ? { note } : {}),
        expectedVersion: item.version,
      },
    });
  };
  const submitThreshold = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(stringValue(new FormData(event.currentTarget).get('threshold')));
    if (Number.isInteger(value) && value >= 0) threshold.mutate(value);
  };

  if (variant.isPending) return <LoadingState label={t('common.loading')} tone="admin" />;
  if (variant.isError) return <ErrorState onRetry={() => void variant.refetch()} />;
  const data = variant.data;
  return (
    <div className="admin-page">
      <Link className="back-link" to="/admin/inventory">
        <ArrowLeft aria-hidden="true" size={17} />
        {t('admin.inventory')}
      </Link>
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{data.sku}</span>
          <h1>
            {data.productNameFr} / {data.nameFr}
          </h1>
          <p>{data.commitmentPolicy}</p>
        </div>
      </header>

      <section className="admin-stock-summary">
        <div className="admin-stock-summary__grid">
          <article>
            <span>{t('admin.columns.onHand')}</span>
            <strong>{data.onHandQuantity}</strong>
          </article>
          <article>
            <span>{t('admin.columns.reserved')}</span>
            <strong>{data.reservedQuantity}</strong>
          </article>
          <article>
            <span>{t('admin.columns.remaining')}</span>
            <strong>{data.availableQuantity}</strong>
          </article>
        </div>
      </section>

      {canAdjust ? (
        <>
          <section className="admin-panel">
            <h2>
              <SlidersHorizontal aria-hidden="true" size={18} /> Seuil de stock bas
            </h2>
            <form onSubmit={submitThreshold} className="admin-heading-actions">
              <FormField
                name="threshold"
                type="number"
                min={0}
                label="Seuil"
                defaultValue={data.lowStockThreshold}
              />
              <Button type="submit" variant="admin" loading={threshold.isPending}>
                Mettre à jour
              </Button>
            </form>
          </section>

          <section className="admin-panel">
            <h2>Premier stock / nouvel emplacement</h2>
            <form className="admin-form-grid" onSubmit={(event) => createLocation.mutate(event)}>
              <FormField name="code" label="Code emplacement (majuscules)" required />
              <FormField name="name" label="Nom de l’emplacement" required />
              <FormField name="address" label="Adresse facultative" />
              <Button type="submit" variant="admin" loading={createLocation.isPending}>
                Créer l’emplacement
              </Button>
            </form>
            <form className="admin-form-grid" onSubmit={(event) => createBucket.mutate(event)}>
              <SelectField name="locationId" label="Emplacement actif" required>
                <option value="">—</option>
                {locations.data?.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} · {location.name}
                  </option>
                ))}
              </SelectField>
              <FormField
                name="initialQuantity"
                label="Quantité physique initiale"
                type="number"
                min={0}
                required
              />
              <FormField name="note" label="Note de réception" maxLength={1000} />
              <Button type="submit" variant="admin" loading={createBucket.isPending}>
                Créer le stock et son mouvement initial
              </Button>
            </form>
          </section>
        </>
      ) : null}

      <section className="admin-panel">
        <h2>
          <Boxes aria-hidden="true" size={18} /> Emplacements et lots
        </h2>
        {data.items.map((item) => (
          <article className="admin-panel" key={item.id}>
            <header className="admin-page__heading">
              <div>
                <strong>
                  {item.location.name} · {item.batch?.batchNumber ?? item.lotKey}
                </strong>
                <p>
                  {item.onHandQuantity} physique · {item.reservedQuantity} réservé ·{' '}
                  {item.availableQuantity} disponible
                </p>
                <small>
                  <LocalDate value={item.updatedAt} />
                </small>
              </div>
              {canAdjust ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveItem((current) => (current === item.id ? null : item.id))}
                >
                  Ajuster
                </Button>
              ) : null}
            </header>
            {canAdjust && activeItem === item.id ? (
              <form onSubmit={(event) => submitAdjustment(item.id, event)}>
                <div className="admin-form-grid">
                  <SelectField name="operation" label="Opération" defaultValue="ADD">
                    <option value="ADD">Ajouter</option>
                    <option value="REMOVE">Retirer</option>
                    <option value="SET">Corriger vers une quantité exacte</option>
                  </SelectField>
                  <FormField name="amount" label="Quantité" type="number" min={0} required />
                  <SelectField name="reasonCode" label="Motif" defaultValue="PURCHASE_RECEIPT">
                    <option value="PURCHASE_RECEIPT">Réception fournisseur</option>
                    <option value="STOCK_COUNT_CORRECTION">Correction d’inventaire</option>
                    <option value="DAMAGE">Endommagé</option>
                    <option value="EXPIRY">Expiré</option>
                    <option value="OTHER">Autre</option>
                  </SelectField>
                  <FormField name="note" label="Note / explication" maxLength={1000} />
                </div>
                <Button type="submit" variant="admin" loading={adjustment.isPending}>
                  Enregistrer le mouvement
                </Button>
              </form>
            ) : null}
          </article>
        ))}
      </section>
      {adjustment.isError || threshold.isError || createLocation.isError || createBucket.isError ? (
        <ErrorState compact />
      ) : null}
    </div>
  );
}
