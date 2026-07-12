import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('system')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'API descriptor' })
  descriptor(): { name: string; version: string; authenticationRealms: string[] } {
    return {
      name: 'Tunisia Vape Commerce API',
      version: 'v1',
      authenticationRealms: ['/auth/customer', '/auth/admin'],
    };
  }
}
