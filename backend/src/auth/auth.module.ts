import { Body, Controller, Get, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsString } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';

class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.active || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    const payload: AuthUser = { id: user.id, role: user.role, name: user.name, ownerId: user.ownerId };
    return { accessToken: this.jwt.sign(payload), user: payload };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const { password, ...rest } = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    return rest;
  }
}

@Module({ providers: [AuthService], controllers: [AuthController] })
export class AuthModule {}
