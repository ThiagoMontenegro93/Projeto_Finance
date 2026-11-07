import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { ClientsModule } from './clients/clients.module';
import { AuthGuard } from './common/auth';
import { DashboardModule } from './dashboard/dashboard.module';
import { DocumentsModule } from './documents/documents.module';
import { LoansModule } from './loans/loans.module';
import { MessagesModule } from './messages/messages.module';
import { PrismaModule } from './prisma/prisma.service';
import { SettingsModule } from './settings/settings.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET ?? 'dev-secret', signOptions: { expiresIn: '12h' } }),
    PrismaModule,
    SettingsModule,
    AuthModule,
    WalletModule,
    ClientsModule,
    LoansModule,
    DocumentsModule,
    MessagesModule,
    DashboardModule,
    BackupModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
