-- CreateEnum
CREATE TYPE "VoucherTypeCode" AS ENUM ('SALES', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL', 'DEBIT_NOTE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "VoucherType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "voucherType" "VoucherTypeCode" NOT NULL,
    "prefix" TEXT,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "numberPadding" INTEGER NOT NULL DEFAULT 4,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "systemDefined" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "voucherTypeId" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "accountingPeriodId" TEXT,
    "voucherNumber" TEXT NOT NULL,
    "voucherDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "referenceNumber" TEXT,
    "narration" TEXT,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoucherType_tenantId_voucherType_idx" ON "VoucherType"("tenantId", "voucherType");

-- CreateIndex
CREATE INDEX "VoucherType_tenantId_active_idx" ON "VoucherType"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherType_tenantId_code_key" ON "VoucherType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_voucherTypeId_idx" ON "Voucher"("tenantId", "voucherTypeId");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_voucherDate_idx" ON "Voucher"("tenantId", "voucherDate");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_status_idx" ON "Voucher"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_fiscalYearId_idx" ON "Voucher"("tenantId", "fiscalYearId");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_accountingPeriodId_idx" ON "Voucher"("tenantId", "accountingPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_tenantId_voucherNumber_key" ON "Voucher"("tenantId", "voucherNumber");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_voucherId_idx" ON "VoucherLine"("tenantId", "voucherId");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_accountId_idx" ON "VoucherLine"("tenantId", "accountId");

-- AddForeignKey
ALTER TABLE "VoucherType" ADD CONSTRAINT "VoucherType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_voucherTypeId_fkey" FOREIGN KEY ("voucherTypeId") REFERENCES "VoucherType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "AccountingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
