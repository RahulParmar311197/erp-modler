import { useCallback, useEffect, useMemo, useState } from "react";

type BankAccount = {
  id: string;
  code: string;
  name: string;
  accountType: "BANK" | "CASH";
  bankName?: string | null;
  accountNumber?: string | null;
  currency: string;
  openingBalance: number | string;
  active: boolean;
  organization?: {
    id: string;
    code: string;
    name: string;
  } | null;
  glAccount?: {
    id: string;
    code: string;
    name: string;
  } | null;
};

type BankingTransaction = {
  id: string;
  voucherNumber: string;
  voucherDate: string;
  status: string;
  referenceNumber?: string | null;
  narration?: string | null;
  totalAmount: number | string;
  voucherType?: {
    code: string;
    name: string;
  } | null;
};

type Reconciliation = {
  id: string;
  statementDate: string;
  statementRef?: string | null;
  statementBalance: number | string;
  status: "DRAFT" | "RECONCILED";
  bookBalance: number;
  difference: number;
  bankAccount?: {
    id: string;
    code: string;
    name: string;
  } | null;
};

type BankingPageProps = {
  token: string;
};

const API = "";

function money(value: number | string) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function date(value: string) {
  return new Date(value).toLocaleDateString("en-IN");
}

export function BankingPage({ token }: BankingPageProps) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankingTransaction[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedType, setSelectedType] = useState<
    "ALL" | "BANK" | "CASH"
  >("ALL");

  const loadBanking = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const headers = {
        Authorization: `Bearer ${token}`,
      };

      const [
        accountsResponse,
        transactionsResponse,
        reconciliationsResponse,
      ] = await Promise.all([
        fetch(`${API}/api/banking/accounts`, { headers }),
        fetch(`${API}/api/banking/transactions`, { headers }),
        fetch(`${API}/api/banking/reconciliations`, { headers }),
      ]);

      const [
        accountsResult,
        transactionsResult,
        reconciliationsResult,
      ] = await Promise.all([
        accountsResponse.json(),
        transactionsResponse.json(),
        reconciliationsResponse.json(),
      ]);

      if (!accountsResponse.ok) {
        throw new Error(
          accountsResult?.errors?.[0]?.message ??
            "Unable to load bank accounts",
        );
      }

      if (!transactionsResponse.ok) {
        throw new Error(
          transactionsResult?.errors?.[0]?.message ??
            "Unable to load banking transactions",
        );
      }

      if (!reconciliationsResponse.ok) {
        throw new Error(
          reconciliationsResult?.errors?.[0]?.message ??
            "Unable to load reconciliations",
        );
      }

      setAccounts(accountsResult.data ?? []);
      setTransactions(transactionsResult.data ?? []);
      setReconciliations(reconciliationsResult.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load banking data",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadBanking();
  }, [loadBanking]);

  const filteredAccounts = useMemo(
    () =>
      selectedType === "ALL"
        ? accounts
        : accounts.filter(
            (account) => account.accountType === selectedType,
          ),
    [accounts, selectedType],
  );

  const bankCount = accounts.filter(
    (account) => account.accountType === "BANK",
  ).length;

  const cashCount = accounts.filter(
    (account) => account.accountType === "CASH",
  ).length;

  const reconciledCount = reconciliations.filter(
    (item) => item.status === "RECONCILED",
  ).length;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">ACCOUNTING</div>
            <h2>Banking</h2>
            <p>
              Bank and cash accounts, transactions, and reconciliation.
            </p>
          </div>

          <button
            className="secondary"
            type="button"
            onClick={() => void loadBanking()}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        <div className="gl-summary">
          <div className="card">
            <span>Bank Accounts</span>
            <strong>{bankCount}</strong>
          </div>

          <div className="card">
            <span>Cash Accounts</span>
            <strong>{cashCount}</strong>
          </div>

          <div className="card">
            <span>Transactions</span>
            <strong>{transactions.length}</strong>
          </div>

          <div className="card">
            <span>Reconciled</span>
            <strong>{reconciledCount}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">CASH & BANK</div>
            <h2>Accounts</h2>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {(["ALL", "BANK", "CASH"] as const).map((type) => (
              <button
                key={type}
                className={
                  selectedType === type
                    ? "primary"
                    : "secondary"
                }
                type="button"
                onClick={() => setSelectedType(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th>Bank</th>
                <th>GL Account</th>
                <th>Opening Balance</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredAccounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.code}</strong>
                  </td>

                  <td>{account.name}</td>

                  <td>{account.accountType}</td>

                  <td>
                    {account.bankName || "—"}
                  </td>

                  <td>
                    {account.glAccount
                      ? `${account.glAccount.code} — ${account.glAccount.name}`
                      : "—"}
                  </td>

                  <td>
                    {money(account.openingBalance)}
                  </td>

                  <td>
                    {account.active ? "ACTIVE" : "INACTIVE"}
                  </td>
                </tr>
              ))}

              {filteredAccounts.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      No bank or cash accounts found.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">VOUCHERS</div>
            <h2>Recent Banking Transactions</h2>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Voucher</th>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Narration</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <strong>
                      {transaction.voucherNumber}
                    </strong>
                  </td>

                  <td>
                    {date(transaction.voucherDate)}
                  </td>

                  <td>
                    {transaction.voucherType?.name ??
                      "—"}
                  </td>

                  <td>
                    {transaction.referenceNumber ||
                      "—"}
                  </td>

                  <td>
                    {transaction.narration || "—"}
                  </td>

                  <td>
                    {money(transaction.totalAmount)}
                  </td>

                  <td>{transaction.status}</td>
                </tr>
              ))}

              {transactions.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      No banking transactions found.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">RECONCILIATION</div>
            <h2>Bank Reconciliation</h2>
            <p>
              Statement balances compared with posted book balances.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Statement Date</th>
                <th>Reference</th>
                <th>Statement Balance</th>
                <th>Book Balance</th>
                <th>Difference</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {reconciliations.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>
                      {item.bankAccount?.code ?? "—"}
                    </strong>
                    <div>
                      {item.bankAccount?.name ?? "—"}
                    </div>
                  </td>

                  <td>{date(item.statementDate)}</td>

                  <td>
                    {item.statementRef || "—"}
                  </td>

                  <td>
                    {money(item.statementBalance)}
                  </td>

                  <td>
                    {money(item.bookBalance)}
                  </td>

                  <td>
                    {money(item.difference)}
                  </td>

                  <td>{item.status}</td>
                </tr>
              ))}

              {reconciliations.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      No reconciliation records found.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
