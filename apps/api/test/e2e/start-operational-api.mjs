import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { fetch as undiciFetch } from 'undici';
import { createApplication } from '../../dist/application.js';
import { CatalogMediaImportService } from '../../dist/catalog-import/catalog-media-import.service.js';
import { CatalogMediaSourceClient } from '../../dist/catalog-import/catalog-media-source.js';

if (process.env.NODE_ENV !== 'test') {
  throw new Error('The operational API bootstrap is available only with NODE_ENV=test');
}

const fixtureOrigin = new URL(process.env.OPERATIONAL_E2E_MEDIA_FIXTURE_ORIGIN ?? '');
if (
  fixtureOrigin.protocol !== 'http:' ||
  fixtureOrigin.hostname !== '127.0.0.1' ||
  !fixtureOrigin.port ||
  fixtureOrigin.pathname !== '/' ||
  fixtureOrigin.username ||
  fixtureOrigin.password ||
  fixtureOrigin.search ||
  fixtureOrigin.hash
) {
  throw new Error('OPERATIONAL_E2E_MEDIA_FIXTURE_ORIGIN must be a loopback HTTP origin');
}

const sourceHostname = 'catalog-media-fixture.invalid';
const application = await createApplication();
const source = new CatalogMediaSourceClient(
  [sourceHostname],
  async (input, init) => {
    const requested = new URL(input);
    if (requested.protocol !== 'https:' || requested.hostname !== sourceHostname) {
      throw new Error('The operational media adapter received an unexpected source URL');
    }
    const target = new URL(requested.pathname, fixtureOrigin);
    const fixtureRequest = { ...(init ?? {}) };
    delete fixtureRequest.dispatcher;
    return undiciFetch(target, fixtureRequest);
  },
  async (hostname) => {
    if (hostname !== sourceHostname) throw new Error('Unexpected operational media hostname');
    return [{ address: '1.1.1.1', family: 4 }];
  },
);

// This assignment is confined to the disposable test process. Production creates the normal
// allowlisted, public-DNS-pinned source client in CatalogMediaImportService's constructor.
application.get(CatalogMediaImportService).operatorSource = source;

const config = application.get(ConfigService);
await application.listen(config.get('PORT'), '0.0.0.0');

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await application.close();
};
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
