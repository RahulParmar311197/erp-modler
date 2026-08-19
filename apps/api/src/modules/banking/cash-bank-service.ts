import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";

type TransactionKind =
  | "RECEIPT"
  | "PAYMENT"
  | "CONTRA";

type TransactionLine = {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
};

type CreateCashBankTransactionInput = {
  tenantId: string;
  organizationId: string;
  voucherTypeCode: TransactionKind;
  voucherDate: Date;
  voucherNumber?: string;
  referenceNumber?: string;
  narration?: string;
  lines: TransactionLine[];
};

function amount(value: unknown): number {
  return Number(value ?? 0);
}

export async function createCashBankTransaction(
  prisma: PrismaClient,
  input: CreateCashBankTransactionInput,
) {
  const voucherType =
    await prisma.voucherType.findFirst({
      where: {
        tenantId: input.tenantId,
        code: input.voucherTypeCode,
        active: true,
      },
    });

  if (!voucherType) {
    throw new Error(
      `Voucher type ${input.voucherTypeCode} is not configured`,
    );
  }

  if (input.lines.length < 2) {
    throw new Error(
      "Transaction must contain at least two lines",
    );
  }

  const debitTotal = input.lines.reduce(
    (sum, line) => sum + amount(line.debit),
    0,
  );

  const creditTotal = input.lines.reduce(
    (sum, line) => sum + amount(line.credit),
    0,
  );

  if (
    Math.abs(debitTotal - creditTotal) >
    0.000001
  ) {
    throw new Error(
      "Transaction is not balanced",
    );
  }

  if (debitTotal <= 0) {
    throw new Error(
      "Transaction amount must be greater than zero",
    );
  }

  for (const line of input.lines) {
    if (!line.accountId?.trim()) {
      throw new Error(
        "Every transaction line requires an accountId",
      );
    }

    const debit = amount(line.debit);
    const credit = amount(line.credit);

    if (debit < 0 || credit < 0) {
      throw new Error(
        "Debit and credit cannot be negative",
      );
    }

    if (debit > 0 && credit > 0) {
      throw new Error(
        "A line cannot contain both debit and credit",
      );
    }
  }

  const accounts =
    await prisma.glAccount.findMany({
      where: {
        tenantId: input.tenantId,
        id: {
          in: input.lines.map(
            (line) => line.accountId,
          ),
        },
        active: true,
      },
    });

  const accountIds = new Set(
    accounts.map((account) => account.id),
  );

  for (const line of input.lines) {
    if (!accountIds.has(line.accountId)) {
      throw new Error(
        `GL account not found or inactive: ${line.accountId}`,
      );
    }
  }

  const voucher = await prisma.$transaction(
    async (tx) => {
      let voucherNumber =
        input.voucherNumber?.trim();

      if (!voucherNumber) {
        const updated =
          await tx.voucherType.update({
            where: {
              id: voucherType.id,
            },
            data: {
              nextNumber: {
                increment: 1,
              },
            },
          });

        const next =
          updated.nextNumber - 1;

        const padding =
          updated.numberPadding;

        const sequence =
          String(next).padStart(
            padding,
            "0",
          );

        voucherNumber =
          `${updated.prefix ?? ""}${sequence}`;
      }

      const duplicate =
        await tx.voucher.findFirst({
          where: {
            tenantId: input.tenantId,
            voucherNumber,
          },
        });

      if (duplicate) {
        throw new Error(
          "DUPLICATE_VOUCHER_NUMBER",
        );
      }

      const period =
        await tx.accountingPeriod.findFirst({
          where: {
            tenantId: input.tenantId,
            status: "OPEN",
            startDate: {
              lte: input.voucherDate,
            },
            endDate: {
              gte: input.voucherDate,
            },
          },
          orderBy: {
            periodNumber: "asc",
          },
        });

      if (!period) {
        throw new Error(
          "No open accounting period contains the transaction date",
        );
      }

      const fiscalYear =
        await tx.fiscalYear.findFirst({
          where: {
            id: period.fiscalYearId,
            tenantId: input.tenantId,
            status: "OPEN",
          },
        });

      if (!fiscalYear) {
        throw new Error(
          "Fiscal year is invalid or closed",
        );
      }

      const createdVoucher =
        await tx.voucher.create({
          data: {
            tenantId: input.tenantId,
            organizationId:
              input.organizationId,
            voucherTypeId:
              voucherType.id,
            fiscalYearId:
              fiscalYear.id,
            accountingPeriodId:
              period.id,
            voucherNumber,
            voucherDate:
              input.voucherDate,
            status: "POSTED",
            referenceNumber:
              input.referenceNumber?.trim() ||
              null,
            narration:
              input.narration?.trim() ||
              null,
            totalAmount: debitTotal,
          },
        });

      await tx.voucherLine.createMany({
        data: input.lines.map(
          (line) => ({
            tenantId:
              input.tenantId,
            voucherId:
              createdVoucher.id,
            accountId:
              line.accountId,
            debit: amount(
              line.debit,
            ),
            credit: amount(
              line.credit,
            ),
            description:
              line.description?.trim() ||
              null,
          }),
        ),
      });

      const entryNumber =
        `${voucherNumber}`;

      const existingJournal =
        await tx.journalEntry.findFirst({
          where: {
            tenantId:
              input.tenantId,
            entryNumber,
          },
        });

      if (existingJournal) {
        throw new Error(
          "Journal entry number already exists",
        );
      }

      const journal =
        await tx.journalEntry.create({
          data: {
            tenantId:
              input.tenantId,
            organizationId:
              input.organizationId,
            entryNumber,
            entryDate:
              input.voucherDate,
            description:
              input.narration?.trim() ||
              null,
            sourceType:
              "VOUCHER",
            sourceId:
              createdVoucher.id,
            fiscalYearId:
              fiscalYear.id,
            accountingPeriodId:
              period.id,
            status: "POSTED",
          },
        });

      await tx.journalLine.createMany({
        data: input.lines.map(
          (line) => ({
            tenantId:
              input.tenantId,
            journalEntryId:
              journal.id,
            accountId:
              line.accountId,
            debit: amount(
              line.debit,
            ),
            credit: amount(
              line.credit,
            ),
            description:
              line.description?.trim() ||
              null,
          }),
        ),
      });

      return tx.voucher.findUniqueOrThrow({
        where: {
          id: createdVoucher.id,
        },
        include: {
          organization: true,
          voucherType: true,
          fiscalYear: true,
          accountingPeriod: true,
          lines: {
            include: {
              account: true,
            },
          },
        },
      });
    },
  );

  return voucher;
}
