import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Param,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AUTH_AUDIENCES } from '../common/auth/auth.constants';
import { NoStoreInterceptor } from '../common/http/no-store.interceptor';
import { CustomerAuthService } from './customer-auth.service';
import {
  CustomerLoginDto,
  CustomerRegistrationDto,
  PasswordResetCompleteDto,
  PasswordResetRequestDto,
} from './dto/customer-auth.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { CustomerSessionGuard } from './guards/customer-session.guard';
import { TrustedOriginGuard } from './guards/trusted-origin.guard';
import { SessionService } from './session.service';

@ApiTags('customer-authentication')
@Controller('auth/customer')
@UseInterceptors(NoStoreInterceptor)
@UseGuards(TrustedOriginGuard)
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a storefront customer' })
  register(
    @Body() input: CustomerRegistrationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.register(input, request, response);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start a customer-only session' })
  login(
    @Body() input: CustomerLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.login(input, request, response);
  }

  @Post('password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @ApiOperation({ summary: 'Request a password reset without account enumeration' })
  async passwordReset(
    @Body() input: PasswordResetRequestDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.requestPasswordReset(input, request);
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ApiOperation({ summary: 'Consume a password-reset token and revoke existing customer sessions' })
  async passwordResetConfirm(
    @Body() input: PasswordResetCompleteDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.completePasswordReset(input, request);
  }

  @Get('session')
  @UseGuards(CustomerSessionGuard)
  @ApiOperation({ summary: 'Get the current customer session' })
  session(@Req() request: Request) {
    return this.sessions.customerResponse(request.auth!.userId, request.auth!.expiresAt);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CustomerSessionGuard, CsrfGuard)
  @ApiOperation({ summary: 'Revoke only the customer session' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revoke(request, response, AUTH_AUDIENCES.CUSTOMER);
  }

  @Get('sessions')
  @UseGuards(CustomerSessionGuard)
  @ApiOperation({ summary: 'List active customer sessions' })
  sessionsList(@Req() request: Request) {
    return this.sessions.list(
      request.auth!.userId,
      AUTH_AUDIENCES.CUSTOMER,
      request.auth!.sessionId,
    );
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CustomerSessionGuard, CsrfGuard)
  @ApiOperation({ summary: 'Revoke one customer session' })
  async revokeSession(
    @Param('id') sessionId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeById(
      request.auth!.userId,
      AUTH_AUDIENCES.CUSTOMER,
      sessionId,
      request,
      response,
    );
  }

  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CustomerSessionGuard, CsrfGuard)
  @ApiOperation({ summary: 'Revoke every customer session' })
  async revokeAllSessions(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeAll(request.auth!.userId, AUTH_AUDIENCES.CUSTOMER, response);
  }
}
