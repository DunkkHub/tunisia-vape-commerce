import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPinned, Plus, RefreshCw, Truck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { adminDataClient } from '../../api/admin-data-client';
import { Button } from '../../components/ui/button';
import { ErrorState, LoadingState } from '../../components/ui/feedback';
import { FormField, SelectField } from '../../components/ui/form-field';
import { Price } from '../../components/ui/price';

const textEntry = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

export function AdminDeliveryPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedDeliveryId, setSelectedDeliveryId] = useState('');
  const deliveries = useQuery({
    queryKey: ['admin', 'deliveries', 'page=1&limit=20'],
    queryFn: () => adminDataClient.list('deliveries', 'page=1&limit=20'),
  });
  const zones = useQuery({
    queryKey: ['admin', 'delivery-config', 'zones'],
    queryFn: adminDataClient.deliveryZones,
  });
  const rates = useQuery({
    queryKey: ['admin', 'delivery-config', 'rates'],
    queryFn: adminDataClient.deliveryRates,
  });
  const pickups = useQuery({
    queryKey: ['admin', 'delivery-config', 'pickups'],
    queryFn: adminDataClient.pickupLocations,
  });
  const delivery = useQuery({
    queryKey: ['admin', 'delivery', selectedDeliveryId],
    queryFn: () => adminDataClient.delivery(selectedDeliveryId),
    enabled: Boolean(selectedDeliveryId),
  });
  const couriers = useQuery({
    queryKey: ['admin', 'delivery', 'couriers'],
    queryFn: adminDataClient.couriers,
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'delivery-config'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'deliveries'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'delivery', selectedDeliveryId] }),
    ]);
  };
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => void refresh(),
  });
  const createZone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    action.mutate(() =>
      adminDataClient.createDeliveryZone({
        code: textEntry(form, 'code'),
        nameFr: textEntry(form, 'nameFr'),
        nameAr: textEntry(form, 'nameAr'),
      }),
    );
  };
  const linkLocality = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const zone = zones.data?.items.find((item) => item.id === textEntry(form, 'zoneId'));
    const localityId = textEntry(form, 'localityId');
    if (zone && localityId) {
      action.mutate(() => adminDataClient.linkDeliveryZoneLocality(zone, localityId, true));
    }
  };
  const createRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const feeMillimes = Number(textEntry(form, 'feeMillimes'));
    action.mutate(() =>
      adminDataClient.createDeliveryRate({
        deliveryZoneId: textEntry(form, 'deliveryZoneId'),
        name: textEntry(form, 'name'),
        feeMillimes,
      }),
    );
  };
  const createPickup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    action.mutate(() =>
      adminDataClient.createPickupLocation({
        code: textEntry(form, 'code'),
        nameFr: textEntry(form, 'nameFr'),
        nameAr: textEntry(form, 'nameAr'),
        address: textEntry(form, 'address'),
      }),
    );
  };
  const loading = zones.isPending || rates.isPending || pickups.isPending;

  return (
    <div className="admin-page">
      <header className="admin-page__heading">
        <div>
          <span className="admin-kicker">{t('brand.adminShort')}</span>
          <h1>{t('admin.delivery')}</h1>
          <p>Livraisons manuelles, zones, tarifs et points de retrait.</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" size={18} /> {t('admin.refresh')}
        </Button>
      </header>

      <section className="admin-panel">
        <h2>
          <Truck aria-hidden="true" size={18} /> Livraisons en cours
        </h2>
        {deliveries.isPending ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Commande / suivi</th>
                <th>Zone</th>
                <th>Livreur</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data?.items.map((delivery) => (
                <tr key={delivery.id}>
                  <td>
                    {typeof delivery.trackingNumber === 'string'
                      ? delivery.trackingNumber
                      : delivery.id}
                  </td>
                  <td>{typeof delivery.zoneName === 'string' ? delivery.zoneName : '—'}</td>
                  <td>{typeof delivery.courierName === 'string' ? delivery.courierName : '—'}</td>
                  <td>{typeof delivery.status === 'string' ? delivery.status : '—'}</td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSelectedDeliveryId(delivery.id)}
                    >
                      Gérer
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {delivery.data ? (
        <section className="admin-panel">
          <h2>
            {delivery.data.orderNumber} · {delivery.data.status}
          </h2>
          <p>
            COD attendu : <Price millimes={delivery.data.expectedCodMillimes} /> · paiement{' '}
            {delivery.data.paymentStatus}
          </p>
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const courierId = textEntry(new FormData(event.currentTarget), 'courierId');
              if (courierId) {
                action.mutate(() => adminDataClient.assignDelivery(delivery.data, courierId));
              }
            }}
          >
            <SelectField name="courierId" label="Livreur actif" required>
              <option value="">—</option>
              {couriers.data?.map((courier) => (
                <option key={courier.id} value={courier.id}>
                  {courier.code} · {courier.name}
                </option>
              ))}
            </SelectField>
            <Button type="submit" variant="admin">
              Assigner
            </Button>
          </form>
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const target = textEntry(new FormData(event.currentTarget), 'targetStatus');
              if (target) {
                action.mutate(() => adminDataClient.transitionDelivery(delivery.data, target));
              }
            }}
          >
            <SelectField name="targetStatus" label="Transition opérationnelle" required>
              <option value="">—</option>
              {[
                'ON_HOLD',
                'CONFIRMED',
                'PREPARING',
                'READY_FOR_PICKUP',
                'ASSIGNED_TO_COURIER',
                'HANDED_TO_COURIER',
                'IN_TRANSIT',
                'OUT_FOR_DELIVERY',
                'RETURN_TO_SENDER',
              ].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </SelectField>
            <Button type="submit" variant="admin">
              Appliquer la transition
            </Button>
          </form>
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const outcome = textEntry(form, 'outcome');
              const explanation = textEntry(form, 'explanation');
              if (outcome) {
                action.mutate(() =>
                  adminDataClient.recordDeliveryAttempt(delivery.data, outcome, explanation),
                );
              }
            }}
          >
            <SelectField name="outcome" label="Résultat de tentative" required>
              <option value="CUSTOMER_UNAVAILABLE">Client injoignable</option>
              <option value="ADDRESS_NOT_FOUND">Adresse introuvable</option>
              <option value="CUSTOMER_REFUSED">Client a refusé</option>
              <option value="FAILED_AGE_VERIFICATION">Vérification d’âge échouée</option>
              <option value="PARTIAL_CASH_NOT_ALLOWED">Montant COD incomplet</option>
              <option value="RESCHEDULED">Report demandé</option>
              <option value="OTHER_FAILED">Autre échec</option>
            </SelectField>
            <FormField name="explanation" label="Explication" maxLength={1000} />
            <Button type="submit" variant="admin">
              Enregistrer la tentative
            </Button>
          </form>
          <Button
            type="button"
            variant="admin"
            disabled={
              delivery.data.paymentStatus !== 'CASH_COLLECTED_BY_COURIER' &&
              delivery.data.paymentStatus !== 'CASH_COLLECTED_AT_STORE'
            }
            onClick={() =>
              action.mutate(() =>
                adminDataClient.completeDelivery(
                  delivery.data,
                  delivery.data.ageVerificationRequired ? 'PASSED' : 'NOT_REQUIRED',
                ),
              )
            }
          >
            Marquer livré avec preuve COD et âge déjà enregistrée
          </Button>
        </section>
      ) : null}

      {loading ? <LoadingState label={t('common.loading')} tone="admin" /> : null}
      <section className="admin-panel">
        <h2>
          <MapPinned aria-hidden="true" size={18} /> Zones de livraison
        </h2>
        <form className="admin-form-grid" onSubmit={createZone}>
          <FormField name="code" label="Code" required />
          <FormField name="nameFr" label="Nom français" required />
          <FormField name="nameAr" label="Nom arabe" dir="rtl" required />
          <Button type="submit" variant="admin" loading={action.isPending}>
            <Plus aria-hidden="true" size={17} /> Créer une zone inactive
          </Button>
        </form>
        {zones.data?.items.map((zone) => (
          <article className="admin-panel" key={zone.id}>
            <strong>
              {zone.code} · {zone.nameFr}
            </strong>
            <p>
              {zone.localityCount} localité(s) · {zone.activeRateCount} tarif(s) actif(s) ·{' '}
              {zone.active ? 'ACTIVE' : 'INACTIVE'}
            </p>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                action.mutate(() => adminDataClient.setDeliveryZoneActive(zone, !zone.active))
              }
            >
              {zone.active ? 'Désactiver' : 'Activer'}
            </Button>
          </article>
        ))}
        <form className="admin-form-grid" onSubmit={linkLocality}>
          <SelectField name="zoneId" label="Zone" required>
            <option value="">—</option>
            {zones.data?.items.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.nameFr}
              </option>
            ))}
          </SelectField>
          <FormField name="localityId" label="Identifiant de localité pris en charge" required />
          <Button type="submit" variant="admin">
            Ajouter la localité
          </Button>
        </form>
      </section>

      <section className="admin-panel">
        <h2>Tarifs en millimes</h2>
        <form className="admin-form-grid" onSubmit={createRate}>
          <SelectField name="deliveryZoneId" label="Zone" required>
            <option value="">—</option>
            {zones.data?.items.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.nameFr}
              </option>
            ))}
          </SelectField>
          <FormField name="name" label="Nom du tarif" required />
          <FormField name="feeMillimes" type="number" min={0} label="Montant (millimes)" required />
          <Button type="submit" variant="admin">
            Créer le tarif inactif
          </Button>
        </form>
        {rates.data?.items.map((rate) => (
          <article className="admin-panel" key={rate.id}>
            <strong>{rate.name}</strong> · <Price millimes={rate.feeMillimes} /> ·{' '}
            {rate.active ? 'ACTIVE' : 'INACTIVE'}
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                action.mutate(() => adminDataClient.setDeliveryRateActive(rate, !rate.active))
              }
            >
              {rate.active ? 'Désactiver' : 'Activer'}
            </Button>
          </article>
        ))}
      </section>

      <section className="admin-panel">
        <h2>Points de retrait</h2>
        <form className="admin-form-grid" onSubmit={createPickup}>
          <FormField name="code" label="Code" required />
          <FormField name="nameFr" label="Nom français" required />
          <FormField name="nameAr" label="Nom arabe" dir="rtl" required />
          <FormField name="address" label="Adresse" required />
          <Button type="submit" variant="admin">
            Créer le point inactif
          </Button>
        </form>
        {pickups.data?.items.map((pickup) => (
          <article className="admin-panel" key={pickup.id}>
            <strong>{pickup.nameFr}</strong> · {pickup.address} ·{' '}
            {pickup.active ? 'ACTIVE' : 'INACTIVE'}
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                action.mutate(() => adminDataClient.setPickupActive(pickup, !pickup.active))
              }
            >
              {pickup.active ? 'Désactiver' : 'Activer'}
            </Button>
          </article>
        ))}
      </section>
      {deliveries.isError || zones.isError || rates.isError || pickups.isError || action.isError ? (
        <ErrorState compact />
      ) : null}
    </div>
  );
}
