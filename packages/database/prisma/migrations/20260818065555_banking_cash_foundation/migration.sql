-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('DRAFT', 'RECONCILED');

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "glAccountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" "BankAccountType" NOT NULL,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "ifscCode" TEXT,
    "branchName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "openingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "statementRef" TEXT,
    "statementBalance" DECIMAL(65,30) NOT NULL,
    "reconciledAt" TIMESTAMP(3),
    "reconciledBy" TEXT,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankAccount_tenantId_organizationId_idx" ON "BankAccount"("tenantId", "organizationId");

-- CreateIndex
CREATE INDEX "BankAccount_tenantId_glAccountId_idx" ON "BankAccount"("tenantId", "glAccountId");

-- CreateIndex
CREATE INDEX "BankAccount_tenantId_accountType_idx" ON "BankAccount"("tenantId", "accountType");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_tenantId_code_key" ON "BankAccount"("tenantId", "code");

-- CreateIndex
CREATE INDEX "BankReconciliation_tenantId_bankAccountId_idx" ON "BankReconciliation"("tenantId", "bankAccountId");

-- CreateIndex
CREATE INDEX "BankReconciliation_tenantId_statementDate_idx" ON "BankReconciliation"("tenantId", "statementDate");

-- CreateIndex
CREATE INDEX "BankReconciliation_tenantId_status_idx" ON "BankReconciliation"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
