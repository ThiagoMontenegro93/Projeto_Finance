import {
  BadRequestException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException,
  Param, Post, Query, Res, UploadedFile, UseInterceptors, Body, Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentKind } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const TTL_SECONDS = 5 * 60; // URL assinada vale 5 minutos

/** Storage privado em disco (fora da pasta pública). Troque por S3/R2 implementando os mesmos métodos. */
@Injectable()
export class StorageService {
  private root = resolve(process.env.STORAGE_DIR ?? './storage/private');
  private secret = process.env.STORAGE_SIGNING_SECRET ?? process.env.JWT_SECRET ?? 'dev';

  async put(buffer: Buffer, ext: string) {
    const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
    const path = join(this.root, key);
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(path, buffer);
    return key;
  }

  read(key: string) {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root)) throw new ForbiddenException();
    return fs.readFile(path);
  }

  async remove(key: string) {
    await fs.rm(resolve(this.root, key), { force: true });
  }

  sign(id: string, now = Date.now()) {
    const exp = Math.floor(now / 1000) + TTL_SECONDS;
    const sig = createHmac('sha256', this.secret).update(`${id}.${exp}`).digest('hex');
    return { exp, sig };
  }

  verify(id: string, exp: number, sig: string) {
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac('sha256', this.secret).update(`${id}.${exp}`).digest();
    const got = Buffer.from(sig ?? '', 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  }
}

@Controller('documents')
export class DocumentsController {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() u: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { clientId: string; kind: DocumentKind },
  ) {
    if (!file) throw new BadRequestException('Arquivo obrigatório');
    if (!ALLOWED.includes(file.mimetype)) throw new BadRequestException('Formato não permitido (JPG, PNG, WEBP ou PDF)');
    if (!Object.values(DocumentKind).includes(body.kind)) throw new BadRequestException('Tipo de documento inválido');
    await this.prisma.client.findUniqueOrThrow({ where: { id: body.clientId } });
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[file.mimetype]!;
    const storageKey = await this.storage.put(file.buffer, ext);
    return this.prisma.document.create({
      data: { clientId: body.clientId, kind: body.kind, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storageKey, uploadedById: u.id },
    });
  }

  /** Gera URL assinada válida por 5 minutos. */
  @Get(':id/signed-url')
  async signed(@Param('id') id: string) {
    await this.prisma.document.findUniqueOrThrow({ where: { id } });
    const { exp, sig } = this.storage.sign(id);
    return { url: `/api/documents/${id}/file?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000) };
  }

  @Public()
  @Get(':id/file')
  async file(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (!this.storage.verify(id, Number(exp), sig)) throw new ForbiddenException('Link expirado ou inválido');
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException();
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(await this.storage.read(doc.storageKey));
  }

  @Delete(':id')
  @Roles('DONO')
  async remove(@Param('id') id: string) {
    const doc = await this.prisma.document.delete({ where: { id } });
    await this.storage.remove(doc.storageKey);
    return { ok: true };
  }
}

@Module({ providers: [StorageService], controllers: [DocumentsController], exports: [StorageService] })
export class DocumentsModule {}
