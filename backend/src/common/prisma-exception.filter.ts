import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Converte erros do Prisma em respostas claras em português. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const fields = ((e.meta?.target as string[]) ?? []).join(', ');
    if (e.code === 'P2002') return res.status(409).json({ statusCode: 409, message: `Já existe um cadastro com este ${fields === 'cpf' ? 'CPF' : fields === 'email' ? 'e-mail' : fields}` });
    if (e.code === 'P2025') return res.status(404).json({ statusCode: 404, message: 'Registro não encontrado' });
    if (e.code === 'P2003') return res.status(400).json({ statusCode: 400, message: 'Referência inválida (registro vinculado não existe)' });
    return res.status(500).json({ statusCode: 500, message: 'Erro no banco de dados' });
  }
}
