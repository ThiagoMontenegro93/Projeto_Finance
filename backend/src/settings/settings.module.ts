import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, Put } from '@nestjs/common';
import { Roles } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';

/** Configurações editáveis no painel. backup_email = quem recebe o backup de toda segunda 08:00. */
export const SETTING_KEYS = [
  'backup_email',
  'company_name',
  'default_interest_rate',
  'default_late_fee_daily_rate',
  'pix_key',
  'messages_auto_send',
] as const;
type Key = (typeof SETTING_KEYS)[number];

const DEFAULTS: Record<Key, string> = {
  backup_email: '',
  company_name: 'LendControl',
  default_interest_rate: '0.10',
  default_late_fee_daily_rate: '0.01',
  pix_key: '',
  messages_auto_send: 'false',
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async all(): Promise<Record<Key, string>> {
    const rows = await this.prisma.setting.findMany();
    const out = { ...DEFAULTS };
    for (const r of rows) if ((SETTING_KEYS as readonly string[]).includes(r.key)) out[r.key as Key] = r.value;
    return out;
  }

  async get(key: Key) {
    return (await this.all())[key];
  }

  async set(values: Partial<Record<string, string>>) {
    for (const [key, value] of Object.entries(values)) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new BadRequestException(`Configuração desconhecida: ${key}`);
      if (key === 'backup_email' && value && !value.split(/[,;]/).every((e) => /^\S+@\S+\.\S+$/.test(e.trim()))) {
        throw new BadRequestException('E-mail de backup inválido');
      }
      await this.prisma.setting.upsert({ where: { key }, create: { key, value: String(value ?? '') }, update: { value: String(value ?? '') } });
    }
    return this.all();
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.all();
  }

  @Put()
  @Roles('DONO')
  put(@Body() body: Record<string, string>) {
    return this.settings.set(body);
  }
}

@Global()
@Module({ providers: [SettingsService], controllers: [SettingsController], exports: [SettingsService] })
export class SettingsModule {}
