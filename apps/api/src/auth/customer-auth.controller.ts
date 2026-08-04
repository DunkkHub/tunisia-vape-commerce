import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Param,
  Query,
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
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment';
import { CustomerAuthService } from './customer-auth.service';
import {
  CustomerLoginDto,
  CustomerRegistrationDto,
  GoogleOAuthCallbackDto,
  GoogleOAuthCompleteDto,
  GoogleOAuthStartDto,
  PasswordResetCompleteDto,
  PasswordResetRequestDto,
} from './dto/customer-auth.dto';
import { GoogleCustomerAuthService, GoogleOAuthFlowError } from './google-customer-auth.service';
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
    private readonly google: GoogleCustomerAuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Environment, true>,
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

  @Post('google/start')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 5 * 60_000 } })
  @ApiOperation({ summary: 'Create a customer-only Google authorization request' })
  googleStart(
    @Body() input: GoogleOAuthStartDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.google.start(input, request, response);
  }

  @Get('google/callback')
  @Throttle({ default: { limit: 20, ttl: 5 * 60_000 } })
  @ApiOperation({ summary: 'Consume the exact Google customer OAuth callback' })
  async googleCallback(
    @Query() input: GoogleOAuthCallbackDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const storefront = this.config.get('WEB_URL', { infer: true });
    try {
      const result = await this.google.callback(input, request, response);
      response.redirect(HttpStatus.SEE_OTHER, new URL(result.returnTo, storefront).toString());
    } catch (error) {
      const reason = error instanceof GoogleOAuthFlowError ? error.reason : 'provider';
      const target = new URL('/login', storefront);
      target.searchParams.set('oauthError', reason);
      response.redirect(HttpStatus.SEE_OTHER, target.toString());
    }
  }

  @Get('google/onboarding')
  @Throttle({ default: { limit: 20, ttl: 5 * 60_000 } })
  @ApiOperation({ summary: 'Read the pending customer Google onboarding mode' })
  googleOnboarding(@Req() request: Request) {
    return this.google.onboarding(request);
  }

  @Post('google/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ApiOperation({ summary: 'Complete a verified Google customer profile or account link' })
  googleComplete(
    @Body() input: GoogleOAuthCompleteDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.google.complete(input, request, response);
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
