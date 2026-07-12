import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgeGateGuard } from '../compliance/age-gate.guard';
import { CheckoutPolicyService } from './checkout-policy.service';
import { CheckoutQuoteService } from './checkout-quote.service';
import { CheckoutQuoteDto } from './dto/checkout-quote.dto';

@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly policies: CheckoutPolicyService,
    private readonly quotes: CheckoutQuoteService,
  ) {}

  @Get('policy')
  @ApiOperation({ summary: 'Evaluate every authoritative legal and operational checkout gate' })
  policy() {
    return this.policies.response();
  }

  @Post('quote')
  @UseGuards(AgeGateGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Calculate a non-reserving TND quote from authoritative catalog and delivery data',
  })
  quote(@Body() input: CheckoutQuoteDto) {
    return this.quotes.quote(input);
  }
}
