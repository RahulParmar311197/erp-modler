import { PrismaClient } from "../../../../packages/database/generated/prisma/client";

type AuditInput = {
  tenantId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  previousState?: unknown;
  newState?: unknown;
};

export async function writeAuditEvent(
  prisma: PrismaClient,
  input: AuditInput,
) {
  return prisma.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      requestId: input.requestId ?? null,
      previousState: input.previousState as any,
      newState: input.newState as any,
    },
  });
}
