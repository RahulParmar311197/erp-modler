import type { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

type JournalLineInput = {
  accountId?: string;
  accountCode?: string;
  description?: string;
  debit: number;
  credit: number;
};

type JournalDb = Pick<PrismaClient, "journalEntry" | "glAccount">;

type PostJournalInput = {
  tenantId: string;
  organizationId: string;
  entryNumber: string;
  entryDate?: Date;
  description?: string;
  sourceType?: string;
  sourceId?: string;
  fiscalYearId?: string;
  accountingPeriodId?: string;
  lines: JournalLineInput[];
};

export async function postJournalEntry(
  prisma: JournalDb,
  input: PostJournalInput,
) {
  const debitTotal = input.lines.reduce(
    (sum, line) => sum + Number(line.debit),
    0,
  );

  const creditTotal = input.lines.reduce(
    (sum, line) => sum + Number(line.credit),
    0,
  );

  if (input.lines.length < 2) {
    throw new Error("Journal entry requires at least two lines");
  }

  if (Math.abs(debitTotal - creditTotal) > 0.000001) {
    throw new Error(
      `Journal entry is not balanced: debit ${debitTotal}, credit ${creditTotal}`,
    );
  }

  for (const line of input.lines) {
    if (!line.accountId && !line.accountCode) {
      throw new Error(
        "Every journal line requires accountId or accountCode",
      );
    }
  }

  const accountIds = [
    ...new Set(
      input.lines
        .map((line) => line.accountId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const accountCodes = [
    ...new Set(
      input.lines
        .map((line) => line.accountCode)
        .filter((code): code is string => Boolean(code)),
    ),
  ];

  const accounts = await prisma.glAccount.findMany({
    where: {
      tenantId: input.tenantId,
      active: true,
      OR: [
        ...(accountIds.length > 0
          ? [{ id: { in: accountIds } }]
          : []),
        ...(accountCodes.length > 0
          ? [{ code: { in: accountCodes } }]
          : []),
      ],
    },
  });

  const accountMapById = new Map(
    accounts.map((account) => [account.id, account]),
  );

  const accountMapByCode = new Map(
    accounts.map((account) => [account.code, account]),
  );

  for (const line of input.lines) {
    const account = line.accountId
      ? accountMapById.get(line.accountId)
      : line.accountCode
        ? accountMapByCode.get(line.accountCode)
        : undefined;

    if (!account) {
      throw new Error(
        `GL account ${
          line.accountId ?? line.accountCode ?? "unknown"
        } does not exist or is inactive`,
      );
    }

    if (
      account.organizationId &&
      account.organizationId !== input.organizationId
    ) {
      throw new Error(
        `GL account ${account.code} does not belong to the journal organization`,
      );
    }
  }

  return prisma.journalEntry.create({
    data: {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      entryNumber: input.entryNumber,
      entryDate: input.entryDate ?? new Date(),
      description: input.description ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      fiscalYearId: input.fiscalYearId ?? null,
      accountingPeriodId: input.accountingPeriodId ?? null,
      status: "POSTED",
      lines: {
        create: input.lines.map((line) => {
          const account = line.accountId
            ? accountMapById.get(line.accountId)
            : line.accountCode
              ? accountMapByCode.get(line.accountCode)
              : undefined;

          if (!account) {
            throw new Error(
              `GL account ${
                line.accountId ?? line.accountCode ?? "unknown"
              } does not exist or is inactive`,
            );
          }

          return {
            tenantId: input.tenantId,
            accountId: account.id,
            description: line.description ?? null,
            debit: line.debit,
            credit: line.credit,
          };
        }),
      },
    },
    include: {
      lines: {
        include: {
          account: true,
        },
      },
    },
  });
}
