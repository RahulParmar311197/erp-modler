import type { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

type JournalLineInput = {
  accountCode: string;
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

  const accountCodes = [...new Set(input.lines.map((line) => line.accountCode))];

  const accounts = await prisma.glAccount.findMany({
    where: {
      tenantId: input.tenantId,
      code: {
        in: accountCodes,
      },
      active: true,
    },
  });

  const accountMap = new Map(
    accounts.map((account) => [account.code, account]),
  );

  for (const code of accountCodes) {
    const account = accountMap.get(code);

    if (!account) {
      throw new Error(
        `GL account ${code} does not exist or is inactive`,
      );
    }

    if (
      account.organizationId &&
      account.organizationId !== input.organizationId
    ) {
      throw new Error(
        `GL account ${code} does not belong to the journal organization`,
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
      status: "POSTED",
      lines: {
        create: input.lines.map((line) => ({
          tenantId: input.tenantId,
          accountId: accountMap.get(line.accountCode)!.id,
          description: line.description ?? null,
          debit: line.debit,
          credit: line.credit,
        })),
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
