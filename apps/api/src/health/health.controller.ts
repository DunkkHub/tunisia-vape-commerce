import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Process-only liveness probe' })
  live(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Safe readiness summary for required operational dependencies' })
  ready() {
    return this.health.ready();
  }
}
