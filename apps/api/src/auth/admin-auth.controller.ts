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
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto, AdminTotpDto } from './dto/admin-auth.dto';
import { AdminSessionGuard } from './guards/admin-session.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { TrustedOriginGuard } from './guards/trusted-origin.guard';
import { SessionService } from './session.service';

@ApiTags('administrator-authentication')
@Controller('auth/admin')
@UseInterceptors(NoStoreInterceptor)
@UseGuards(TrustedOriginGuard)
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify an administrator password and create a short TOTP challenge' })
  login(@Body() input: AdminLoginDto, @Req() request: Request) {
    return this.auth.beginLogin(input, request);
  }

  @Post('totp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 5 * 60_000 } })
  @ApiOperation({
    summary: 'Complete mandatory administrator TOTP and issue an admin-only session',
  })
  totp(
    @Body() input: AdminTotpDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.completeTotp(input, request, response);
  }

  @Get('session')
  @UseGuards(AdminSessionGuard)
  @ApiOperation({ summary: 'Get the current administrator session' })
  session(@Req() request: Request) {
    return this.sessions.adminResponse(
      request.auth!.userId,
      request.auth!.expiresAt,
      request.auth!.authenticatedAt,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, CsrfGuard)
  @ApiOperation({ summary: 'Revoke only the administrator session' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revoke(request, response, AUTH_AUDIENCES.ADMIN);
  }

  @Get('sessions')
  @UseGuards(AdminSessionGuard)
  @ApiOperation({ summary: 'List active administrator sessions' })
  sessionsList(@Req() request: Request) {
    return this.sessions.list(request.auth!.userId, AUTH_AUDIENCES.ADMIN, request.auth!.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, CsrfGuard)
  @ApiOperation({ summary: 'Revoke one administrator session' })
  async revokeSession(
    @Param('id') sessionId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeById(
      request.auth!.userId,
      AUTH_AUDIENCES.ADMIN,
      sessionId,
      request,
      response,
    );
  }

  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminSessionGuard, CsrfGuard)
  @ApiOperation({ summary: 'Revoke every administrator session' })
  async revokeAllSessions(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeAll(request.auth!.userId, AUTH_AUDIENCES.ADMIN, response);
  }
}
