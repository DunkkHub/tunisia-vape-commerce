import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { Button } from '../../components/ui/button';
import { ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';
import { LocalDate, Price } from '../../components/ui/price';

const text = (form: FormData, key: string): string => {
  const entry = form.get(key);
  return typeof entry === 'string' ? entry.trim() : '';
};

export function AdminCashPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const collections = useQuery({
    queryKey: ['admin', 'cash', 'collections'],
    queryFn: adminDataClient.cashCollections,
  });
  const collection = useQuery({
    queryKey: ['admin', 'cash', 'collection', selectedCollectionId],
    queryFn: () => adminDataClient.cashCollection(selectedCollectionId),
    enabled: Boolean(selectedCollectionId),
  });
  const remittances = useQuery({
    queryKey: ['admin', 'cash', 'remittances'],
    queryFn: adminDataClient.cashRemittances,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'cash'] });
  };
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: refresh,
  });
  const record = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collection.data?.delivery?.version) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(text(form, 'collectedMillimes'));
    const reason = text(form, 'reasonDetail');
    action.mutate(() => adminDataClient.recordCashCollection(collection.data, amount, reason));
  };
  const createRemittance = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    action.mutate(() =>
      adminDataClient.createCashRemittance({
        courierId: text(form, 'courierId'),
        remittanceNumber: text(form, 'remittanceNumber'),
        declaredMillimes: Number(text(form, 'declaredMillimes')),
        collectionId: text(form, 'collectionId'),
        amountMillimes: Number(text(form, 'amountMillimes')),
      }),
    );
  };

  return (
    <div className="admin-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">COD</span>
          <h1>{t('admin.cash')}</h1>
          <p>Encaissements, remises et rapprochement en millimes.</p>
        </div>
        <Button type="button" variant="ghost" onClick={refresh}>
          <RefreshCw aria-hidden="true" size={18} /> {t('admin.refresh')}
        </Button>
      </header>
      <section className="admin-panel">
        <h2>
          <Banknote aria-hidden="true" size={18} /> Encaissements attendus
        </h2>
        {collections.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('admin.columns.order')}</th>
                <th>{t('admin.columns.courier')}</th>
                <th>{t('admin.columns.expected')}</th>
                <th>Encaissé</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {collections.data?.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.orderNumber}</td>
                  <td>{item.courierName ?? '—'}</td>
                  <td>
                    <Price millimes={item.expectedMillimes} />
                  </td>
                  <td>
                    <Price millimes={item.collectedMillimes} />
                  </td>
                  <td>{item.status}</td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSelectedCollectionId(item.id)}
                    >
                      Ouvrir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {collection.data && collection.data.status === 'EXPECTED' ? (
          <form className="admin-panel" onSubmit={record}>
            <h3>{collection.data.orderNumber}</h3>
            <FormField
              name="collectedMillimes"
              label="Montant physiquement encaissé (millimes)"
              type="number"
              min={0}
              defaultValue={collection.data.expectedMillimes}
              required
            />
            <FormField
              name="reasonDetail"
              label="Motif obligatoire si le montant diffère"
              maxLength={1000}
            />
            <Button type="submit" variant="admin" loading={action.isPending}>
              Enregistrer l’encaissement
            </Button>
          </form>
        ) : null}
      </section>

      <section className="admin-panel">
        <h2>Nouvelle remise de livreur</h2>
        <form className="admin-form-grid" onSubmit={createRemittance}>
          <FormField name="courierId" label="Identifiant du livreur" required />
          <FormField name="remittanceNumber" label="Numéro unique de remise" required />
          <SelectField name="collectionId" label="Encaissement" required>
            <option value="">—</option>
            {collections.data?.items
              .filter((item) => item.status === 'COLLECTED')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.orderNumber}
                </option>
              ))}
          </SelectField>
          <FormField name="amountMillimes" label="Montant alloué" type="number" min={1} required />
          <FormField
            name="declaredMillimes"
            label="Montant déclaré"
            type="number"
            min={1}
            required
          />
          <Button type="submit" variant="admin">
            Créer le brouillon
          </Button>
        </form>
      </section>

      <section className="admin-panel">
        <h2>Remises et rapprochement</h2>
        {remittances.data?.items.map((remittance) => (
          <article className="admin-panel" key={remittance.id}>
            <strong>{remittance.remittanceNumber}</strong> · {remittance.courierName} ·{' '}
            <Price millimes={remittance.declaredMillimes} /> · {remittance.status}
            {remittance.createdAt ? <LocalDate value={remittance.createdAt} /> : null}
            {remittance.status === 'DRAFT' ? (
              <Button
                type="button"
                variant="admin"
                onClick={() =>
                  action.mutate(() => adminDataClient.submitCashRemittance(remittance.id))
                }
              >
                Soumettre
              </Button>
            ) : null}
            {remittance.status === 'SUBMITTED' || remittance.status === 'RECEIVED' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const verified = Number(text(form, 'verifiedMillimes'));
                  const reason = text(form, 'reasonDetail');
                  action.mutate(() =>
                    adminDataClient.reconcileCashRemittance(remittance.id, verified, reason),
                  );
                }}
              >
                <FormField
                  name="verifiedMillimes"
                  label="Montant vérifié"
                  type="number"
                  min={0}
                  defaultValue={remittance.declaredMillimes}
                  required
                />
                <FormField name="reasonDetail" label="Motif si différence" />
                <Button type="submit" variant="admin">
                  Rapprocher
                </Button>
              </form>
            ) : null}
          </article>
        ))}
      </section>
      {collections.isError || collection.isError || remittances.isError || action.isError ? (
        <ErrorState compact />
      ) : null}
    </div>
  );
}
