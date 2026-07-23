import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { createApplication } from './application';
import type { Environment } from './config/environment';

async function bootstrap(): Promise<void> {
  const application = await createApplication();
  const config = application.get(ConfigService<Environment, true>);
  await application.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

void bootstrap();
