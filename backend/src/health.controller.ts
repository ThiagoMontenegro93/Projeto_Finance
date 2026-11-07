import { Controller, Get } from '@nestjs/common';
import { Public } from './common/auth';

/** Verificação de saúde usada pelo servidor de hospedagem (Render). */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  ok() {
    return { ok: true, version: '6.5.0' };
  }
}
