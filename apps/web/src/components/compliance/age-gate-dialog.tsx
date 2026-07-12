import * as Dialog from '@radix-ui/react-dialog';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/button';

interface AgeGateDialogProps {
  open: boolean;
  minimumAge: number;
  pending: boolean;
  error: boolean;
  onConfirm: () => void;
}

export function AgeGateDialog({ open, minimumAge, pending, error, onConfirm }: AgeGateDialogProps) {
  const { t } = useTranslation();
  const [blocked, setBlocked] = useState(false);

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="age-gate__overlay" />
        <Dialog.Content
          className="age-gate"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          aria-describedby="age-gate-description"
        >
          <div className="age-gate__seal" aria-hidden="true">
            {blocked ? <ShieldX size={30} /> : <ShieldCheck size={30} />}
          </div>
          <span className="eyebrow">{t('ageGate.eyebrow')}</span>
          <Dialog.Title>{blocked ? t('ageGate.blockedTitle') : t('ageGate.title')}</Dialog.Title>
          <Dialog.Description id="age-gate-description">
            {blocked ? t('ageGate.blockedBody') : t('ageGate.body')}
          </Dialog.Description>
          {!blocked ? (
            <>
              <p className="age-gate__minimum">{t('ageGate.minimum', { age: minimumAge })}</p>
              <p className="age-gate__legal">{t('ageGate.legalNote')}</p>
              {error ? (
                <p className="form-banner form-banner--error" role="alert">
                  {t('ageGate.requestFailed')}
                </p>
              ) : null}
              <div className="age-gate__actions">
                <Button type="button" onClick={onConfirm} loading={pending}>
                  {t('ageGate.confirm', { age: minimumAge })}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setBlocked(true)}>
                  {t('ageGate.underage')}
                </Button>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
