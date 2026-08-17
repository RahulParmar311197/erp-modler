-- AlterTable
ALTER TABLE "GlAccount" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "GlAccountGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nature" "GlAccountType" NOT NULL,
    "systemDefined" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlAccountGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlAccountGroup_tenantId_parentId_idx" ON "GlAccountGroup"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "GlAccountGroup_tenantId_nature_idx" ON "GlAccountGroup"("tenantId", "nature");

-- CreateIndex
CREATE UNIQUE INDEX "GlAccountGroup_tenantId_code_key" ON "GlAccountGroup"("tenantId", "code");

-- CreateIndex
CREATE INDEX "GlAccount_tenantId_groupId_idx" ON "GlAccount"("tenantId", "groupId");

-- AddForeignKey
ALTER TABLE "GlAccountGroup" ADD CONSTRAINT "GlAccountGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccountGroup" ADD CONSTRAINT "GlAccountGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GlAccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GlAccountGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
