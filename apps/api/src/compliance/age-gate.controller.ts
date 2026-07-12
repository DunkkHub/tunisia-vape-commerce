import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { AgeGateService } from './age-gate.service';
import { ConfirmAgeGateDto } from './dto/age-gate.dto';

@ApiTags('public-compliance')
@Controller('compliance')
@UseInterceptors(NoStoreInterceptor)
export class AgeGateController {
  constructor(private readonly ageGate: AgeGateService) {}

  @Post('age-gate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Record a signed storefront age self-attestation' })
  async confirm(
    @Body() input: ConfirmAgeGateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.ageGate.confirm(input, request, response);
  }
}
