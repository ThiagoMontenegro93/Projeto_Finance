-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'DONO', 'FUNCIONARIO');

-- CreateEnum
CREATE TYPE "LoanMethod" AS ENUM ('DIARIO', 'SEMANAL', 'QUINZENAL', 'MENSAL');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ATIVO', 'QUITADO', 'PERDA');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDENTE', 'PAGO', 'JUROS_PAGO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('PARCELA', 'JUROS', 'QUITACAO');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('AGUARDANDO_APROVACAO', 'APROVADO', 'REJEITADO');

-- CreateEnum
CREATE TYPE "ScoreStatus" AS ENUM ('BOM', 'REGULAR', 'RUIM', 'PERDA');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('RG', 'CPF', 'CNH', 'COMPROVANTE_RESIDENCIA', 'SELFIE', 'RECIBO', 'COMPROVANTE_CLIENTE', 'CONTRATO', 'OUTRO');

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('REPASSE_CAPITAL', 'DEVOLUCAO_CAPITAL', 'REPASSE_RECEBIMENTO');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('APORTE', 'REPASSE_CAPITAL_SAIDA', 'REPASSE_CAPITAL_ENTRADA', 'EMPRESTIMO_SAIDA', 'RECEBIMENTO_PRINCIPAL', 'RECEBIMENTO_JUROS', 'RECEBIMENTO_MULTA', 'COMISSAO', 'REPASSE_RECEBIMENTO_SAIDA', 'REPASSE_RECEBIMENTO_ENTRADA', 'AJUSTE');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('AUTOMATICO', 'MANUAL', 'RESTAURACAO', 'MODELO');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('SUCESSO', 'FALHA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'FUNCIONARIO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "capitalDisponivel" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "capitalEmprestado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "comissaoAcumulada" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "saldoARepassar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commissionRate" DECIMAL(8,6) NOT NULL DEFAULT 0.30,
    "ownerId" TEXT,
    "webauthnCredentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "rg" TEXT,
    "birthDate" TIMESTAMP(3),
    "maritalStatus" TEXT,
    "profession" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "cep" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pixKey" TEXT,
    "pixKeyType" TEXT,
    "bank" TEXT,
    "income" DECIMAL(14,2),
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 1000,
    "interestRate" DECIMAL(8,6) NOT NULL DEFAULT 0.10,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelation" TEXT,
    "guarantorId" TEXT,
    "referredById" TEXT,
    "score" INTEGER NOT NULL DEFAULT 10,
    "scoreStatus" "ScoreStatus" NOT NULL DEFAULT 'BOM',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "notes" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "code" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "funderUserId" TEXT NOT NULL,
    "lenderUserId" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "interestRate" DECIMAL(8,6) NOT NULL,
    "method" "LoanMethod" NOT NULL,
    "installmentsCount" INTEGER NOT NULL,
    "installmentAmount" DECIMAL(14,2) NOT NULL,
    "lateFeeDailyRate" DECIMAL(8,6) NOT NULL DEFAULT 0.01,
    "startDate" TIMESTAMP(3) NOT NULL,
    "firstDueDate" TIMESTAMP(3) NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ATIVO',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "interestPart" DECIMAL(14,2) NOT NULL,
    "principalPart" DECIMAL(14,2) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDENTE',
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2),
    "rolledFromId" TEXT,

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentId" TEXT,
    "type" "PaymentType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "lateFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'APROVADO',
    "method" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "biometricVerified" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
    "receiptDocumentId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalTransfer" (
    "id" TEXT NOT NULL,
    "type" "TransferType" NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "loanId" TEXT,
    "paymentId" TEXT,
    "transferId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupStatus" NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "rowsCount" INTEGER NOT NULL DEFAULT 0,
    "emailedTo" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "code" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "notifyGuarantor" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "installmentId" TEXT,
    "templateCode" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "link" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_cpf_key" ON "Client"("cpf");

-- CreateIndex
CREATE INDEX "Client_scoreStatus_idx" ON "Client"("scoreStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_code_key" ON "Loan"("code");

-- CreateIndex
CREATE INDEX "Loan_lenderUserId_idx" ON "Loan"("lenderUserId");

-- CreateIndex
CREATE INDEX "Loan_status_idx" ON "Loan"("status");

-- CreateIndex
CREATE INDEX "Installment_dueDate_status_idx" ON "Installment"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_loanId_number_key" ON "Installment"("loanId", "number");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "CashLedger_userId_createdAt_idx" ON "CashLedger"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_installmentId_templateCode_toPhone_key" ON "MessageLog"("installmentId", "templateCode", "toPhone");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_guarantorId_fkey" FOREIGN KEY ("guarantorId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_funderUserId_fkey" FOREIGN KEY ("funderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_lenderUserId_fkey" FOREIGN KEY ("lenderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalTransfer" ADD CONSTRAINT "CapitalTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalTransfer" ADD CONSTRAINT "CapitalTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashLedger" ADD CONSTRAINT "CashLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
