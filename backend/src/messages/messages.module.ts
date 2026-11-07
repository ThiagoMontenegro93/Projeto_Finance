import { Body, Controller, Get, Injectable, Logger, Module, OnModuleInit, Post, Put, Query } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { num } from '../common/money';
import { addDays, currentValue, daysLate, toDay } from '../loan-engine/loan-engine';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { brDate, brl, DEFAULT_TEMPLATES, GUARANTOR_BODY, render, toIntlPhone, waMeLink, WEEKLY_CODE } from './templates';

export const loanScope = (u: AuthUser): Prisma.LoanWhereInput =>
  u.role === 'FUNCIONARIO' ? { lenderUserId: u.id } : u.role === 'DONO' ? { funderUserId: u.id } : {};

/** Cliente da Evolution API (WhatsApp via QR code). Sem configuração => fallback wa.me. */
@Injectable()
export class EvolutionService {
  private url = process.env.EVOLUTION_API_URL?.replace(/\/$/, '');
  private key = process.env.EVOLUTION_API_KEY ?? '';
  private instance = process.env.EVOLUTION_INSTANCE ?? 'lendcontrol';

  get configured() {
    return !!this.url && !!this.key;
  }

  private async call(path: string, init: RequestInit = {}) {
    const r = await fetch(`${this.url}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', apikey: this.key, ...(init.headers ?? {}) },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Evolution API ${r.status}: ${JSON.stringify(body)}`);
    return body as Record<string, any>;
  }

  async status() {
    if (!this.configured) return { configured: false, state: 'NAO_CONFIGURADO' };
    try {
      const r = await this.call(`/instance/connectionState/${this.instance}`);
      return { configured: true, state: r.instance?.state ?? r.state ?? 'desconhecido' };
    } catch (e) {
      return { configured: true, state: 'ERRO', error: String(e.message ?? e) };
    }
  }

  /** Retorna o QR code (base64) para parear o WhatsApp. Cria a instância se não existir. */
  async qr() {
    if (!this.configured) return { configured: false };
    try {
      await this.call('/instance/create', { method: 'POST', body: JSON.stringify({ instanceName: this.instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' }) });
    } catch {
      /* já existe */
    }
    const r = await this.call(`/instance/connect/${this.instance}`);
    return { configured: true, base64: r.base64 ?? r.qrcode?.base64, pairingCode: r.pairingCode };
  }

  async sendText(phone: string, text: string) {
    return this.call(`/message/sendText/${this.instance}`, { method: 'POST', body: JSON.stringify({ number: toIntlPhone(phone), text }) });
  }
}

export interface QueueItem {
  templateCode: string;
  clientId: string;
  clientName: string;
  installmentId: string;
  toPhone: string;
  recipient: 'CLIENTE' | 'FIADOR';
  body: string;
  waLink: string;
  alreadySent: boolean;
  missingPhone?: boolean;
}

@Injectable()
export class MessagesService implements OnModuleInit {
  private log = new Logger('Mensagens');
  constructor(private prisma: PrismaService, private evo: EvolutionService, private settings: SettingsService) {}

  async onModuleInit() {
    for (const t of DEFAULT_TEMPLATES) {
      await this.prisma.messageTemplate.upsert({ where: { code: t.code }, create: t, update: {} }).catch(() => undefined);
    }
  }

  /**
   * Fila do dia: parcelas que caem em D-2, D-0, D+1, D+3, D+7 (com fiador) e, depois disso,
   * lembrete semanal (D+14, D+21, …) até pagar. `scope` limita aos empréstimos do usuário.
   */
  async queue(today = new Date(), scope: Prisma.LoanWhereInput = {}): Promise<QueueItem[]> {
    const templates = await this.prisma.messageTemplate.findMany({ where: { active: true } });
    const pix = await this.settings.get('pix_key');
    const day = toDay(today);
    const items: QueueItem[] = [];
    for (const t of templates) {
      const weekly = t.code === WEEKLY_CODE;
      const due = addDays(day, -t.offsetDays);
      const insts = await this.prisma.installment.findMany({
        where: {
          status: 'PENDENTE',
          dueDate: weekly ? { lt: addDays(due, 1) } : { gte: due, lt: addDays(due, 1) },
          loan: { ...scope, status: 'ATIVO' },
        },
        include: { loan: { include: { client: { include: { guarantor: true } } } } },
      });
      for (const i of insts) {
        const days = daysLate(i.dueDate, today);
        if (weekly && days % 7 !== 0) continue;
        const logCode = weekly ? `${t.code}_D${days}` : t.code;
        const c = i.loan.client;
        const vars = {
          nome: c.name.split(' ')[0],
          parcela: `${i.number}/${i.loan.installmentsCount}`,
          valor: brl(num(i.amount)),
          valor_atual: brl(currentValue(num(i.amount), num(i.loan.lateFeeDailyRate), days)),
          vencimento: brDate(i.dueDate),
          dias: days,
          pix: pix || '(solicite a chave)',
          fiador: c.guarantor?.name ?? '-',
        };
        const recipients: Array<{ phone?: string | null; who: QueueItem['recipient']; body: string }> = [
          { phone: c.whatsapp || c.phone, who: 'CLIENTE', body: render(t.body, vars) },
        ];
        if (t.notifyGuarantor && c.guarantor) {
          recipients.push({ phone: c.guarantor.whatsapp || c.guarantor.phone, who: 'FIADOR', body: render(GUARANTOR_BODY, { ...vars, fiador: c.guarantor.name.split(' ')[0], nome: c.name }) });
        }
        for (const r of recipients) {
          if (!r.phone) {
            items.push({ templateCode: logCode, clientId: c.id, clientName: c.name, installmentId: i.id, toPhone: '', recipient: r.who, body: r.body, waLink: '', alreadySent: false, missingPhone: true });
            continue;
          }
          const sent = await this.prisma.messageLog.findUnique({
            where: { installmentId_templateCode_toPhone: { installmentId: i.id, templateCode: logCode, toPhone: r.phone } },
          });
          items.push({
            templateCode: logCode, clientId: c.id, clientName: c.name, installmentId: i.id, toPhone: r.phone,
            recipient: r.who, body: r.body, waLink: waMeLink(r.phone, r.body),
            alreadySent: !!sent && sent.status !== 'FALHA', // ENVIADO (Evolution) ou LINK_GERADO (wa.me registrado)
          });
        }
      }
    }
    return items;
  }

  /** Resumo diário para o Dono por e-mail (08:30): atrasos, vencimentos de hoje, aprovações e fila. */
  @Cron('30 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async ownerSummary(today = new Date()) {
    const to = (await this.settings.get('backup_email')) || '';
    const day = toDay(today);
    const overdue = await this.prisma.installment.findMany({
      where: { status: 'PENDENTE', dueDate: { lt: day }, loan: { status: 'ATIVO' } },
      include: { loan: { select: { lateFeeDailyRate: true, client: { select: { name: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    const dueToday = await this.prisma.installment.count({ where: { status: 'PENDENTE', dueDate: { gte: day, lt: addDays(day, 1) } } });
    const approvals = await this.prisma.payment.count({ where: { status: 'AGUARDANDO_APROVACAO' } });
    const queue = (await this.queue(today)).filter((q) => !q.alreadySent);
    const total = overdue.reduce((s, i) => s + currentValue(num(i.amount), num(i.loan.lateFeeDailyRate), daysLate(i.dueDate, today)), 0);
    const lines = [
      `Resumo de cobrança — ${brDate(day)}`,
      '',
      `Em atraso: ${overdue.length} parcela(s), ${brl(total)} com multa`,
      `Vencem hoje: ${dueToday}`,
      `Aguardando sua aprovação: ${approvals}`,
      `Mensagens da régua para enviar hoje: ${queue.length}`,
      '',
      ...overdue.slice(0, 30).map((i) => `• ${i.loan.client.name} — ${daysLate(i.dueDate, today)} dias — ${brl(num(i.amount))}`),
    ];
    const text = lines.join('\n');
    if (to && process.env.SMTP_HOST) {
      const t = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      await t.sendMail({ from: process.env.SMTP_FROM ?? process.env.SMTP_USER, to, subject: `LendControl — ${overdue.length} em atraso, ${queue.length} cobranças hoje`, text })
        .catch((e) => this.log.warn(`Resumo diário não enviado: ${e.message}`));
    }
    return { text, overdue: overdue.length, dueToday, approvals, queue: queue.length, emailedTo: to && process.env.SMTP_HOST ? to : null };
  }

  /** Envia a fila: Evolution API se conectada, senão registra o link wa.me para envio manual. */
  async sendQueue(today = new Date(), scope: Prisma.LoanWhereInput = {}) {
    const q = (await this.queue(today, scope)).filter((i) => !i.alreadySent && !i.missingPhone);
    const evo = (await this.evo.status()).state === 'open';
    const results = [];
    for (const item of q) {
      let status = 'LINK_GERADO';
      let error: string | undefined;
      if (evo) {
        try {
          await this.evo.sendText(item.toPhone, item.body);
          status = 'ENVIADO';
        } catch (e) {
          status = 'FALHA';
          error = String(e.message ?? e);
        }
      }
      const data = { clientId: item.clientId, installmentId: item.installmentId, templateCode: item.templateCode, toPhone: item.toPhone, body: item.body, channel: evo ? 'EVOLUTION' : 'WA_ME', status, link: item.waLink, error };
      await this.prisma.messageLog.upsert({
        where: { installmentId_templateCode_toPhone: { installmentId: item.installmentId, templateCode: item.templateCode, toPhone: item.toPhone } },
        create: data, update: data,
      });
      results.push({ ...item, status, error });
    }
    return { channel: evo ? 'EVOLUTION' : 'WA_ME', total: results.length, results };
  }

  @Cron('0 9 * * *', { timeZone: 'America/Sao_Paulo' })
  async daily() {
    if ((await this.settings.get('messages_auto_send')) !== 'true') return;
    const r = await this.sendQueue();
    this.log.log(`Régua de cobrança: ${r.total} mensagens (${r.channel})`);
  }
}

@Controller('messages')
export class MessagesController {
  constructor(private svc: MessagesService, private evo: EvolutionService, private prisma: PrismaService) {}

  @Get('queue')
  queue(@CurrentUser() u: AuthUser, @Query('date') date?: string) {
    return this.svc.queue(date ? new Date(date) : new Date(), loanScope(u));
  }

  @Post('send')
  send(@CurrentUser() u: AuthUser) {
    return this.svc.sendQueue(new Date(), loanScope(u));
  }

  @Get('summary')
  @Roles('DONO')
  summary() {
    return this.svc.ownerSummary();
  }

  @Get('templates')
  templates() {
    return this.prisma.messageTemplate.findMany({ orderBy: { offsetDays: 'asc' } });
  }

  @Put('templates')
  @Roles('DONO')
  async saveTemplates(@Body() body: Array<{ code: string; body: string; active?: boolean }>) {
    for (const t of body) await this.prisma.messageTemplate.update({ where: { code: t.code }, data: { body: t.body, active: t.active ?? true } });
    return this.templates();
  }

  @Get('log')
  logs() {
    return this.prisma.messageLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { client: { select: { name: true } } } });
  }

  @Get('whatsapp/status')
  status() {
    return this.evo.status();
  }

  @Get('whatsapp/qr')
  @Roles('DONO')
  qr() {
    return this.evo.qr();
  }
}

@Module({ providers: [EvolutionService, MessagesService], controllers: [MessagesController] })
export class MessagesModule {}
