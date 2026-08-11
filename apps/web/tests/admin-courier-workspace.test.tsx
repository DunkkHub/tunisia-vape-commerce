import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminDataClient } from '../src/api/admin-data-client';
import type { AdminDeliveryDetail, AdminRecord } from '../src/api/types';
import { AppProviders } from '../src/app/providers';
import { AdminCourierWorkspace } from '../src/pages/admin/admin-courier-workspace';

const deliveryRow: AdminRecord = {
  id: 'delivery-1',
  trackingNumber: 'TJ-2026-00000001',
  orderNumber: 'TJ-2026-00000001',
  zoneName: 'bizerte',
  courierName: 'stou',
  status: 'PREPARING',
};

const deliveryDetail: AdminDeliveryDetail = {
  id: 'delivery-1',
  orderId: 'order-1',
  orderNumber: 'TJ-2026-00000001',
  orderStatus: 'PREPARING',
  paymentStatus: 'PENDING_COD',
  expectedCodMillimes: 8000,
  status: 'PREPARING',
  courier: null,
  trackingNumber: 'TJ-2026-00000001',
  courierFeeMillimes: null,
  assignedAt: null,
  handedToCourierAt: null,
  deliveredAt: null,
  nextAttemptAt: null,
  internalNotes: null,
  customerVisibleNotes: null,
  ageVerificationResult: 'NOT_CHECKED',
  ageVerificationRequired: true,
  cashCollectedResult: null,
  version: 7,
  attempts: [],
  events: [],
};

function renderWorkspace() {
  const Harness = () => {
    const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
    return (
      <AppProviders>
        <AdminCourierWorkspace
          zones={[]}
          canAssignSensitive
          canUpdateSensitive
          selectedDeliveryIds={selectedDeliveryIds}
          setSelectedDeliveryIds={setSelectedDeliveryIds}
        />
      </AppProviders>
    );
  };
  return render(<Harness />);
}

describe('administrator courier workspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(adminDataClient, 'courierRecords').mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
      totalPages: 0,
    });
    vi.spyOn(adminDataClient, 'list').mockResolvedValue({
      items: [deliveryRow],
      page: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
    });
    vi.spyOn(adminDataClient, 'delivery').mockResolvedValue(deliveryDetail);
    vi.spyOn(adminDataClient, 'couriers').mockResolvedValue([]);
  });

  it('opens delivery management from the tracking number when manifest selection is disabled', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const manifestCheckbox = await screen.findByRole('checkbox', {
      name: 'Sélectionner TJ-2026-00000001 pour un manifeste',
    });
    expect(manifestCheckbox).toBeDisabled();
    expect(screen.getByText('Assignez-la d’abord à un livreur.')).toBeVisible();
    expect(adminDataClient.delivery).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', {
        name: 'Gérer la livraison TJ-2026-00000001',
      }),
    );

    await waitFor(() => {
      expect(adminDataClient.delivery).toHaveBeenCalledWith('delivery-1');
      expect(adminDataClient.couriers).toHaveBeenCalledWith('delivery-1');
    });
  });
});
