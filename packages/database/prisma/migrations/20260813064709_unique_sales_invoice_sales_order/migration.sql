/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,salesOrderId]` on the table `SalesInvoice` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "JournalEntry_tenantId_sourceType_sourceId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_tenantId_salesOrderId_key" ON "SalesInvoice"("tenantId", "salesOrderId");
