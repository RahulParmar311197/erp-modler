-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tenantId_sourceType_sourceId_key"
ON "JournalEntry"("tenantId", "sourceType", "sourceId");
