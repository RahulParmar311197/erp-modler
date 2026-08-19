import { useCallback, useEffect, useState } from "react";

type GlAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
};

type JournalLine = {
  accountId: string;
  debit: number | string;
  credit: number | string;
};

type JournalEntry = {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  status: string;
  lines?: JournalLine[];
};

type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
};

type ProfitAndLossRow = {
  accountId: string;
  code: string;
  name: string;
  amount: number;
};

type ProfitAndLoss = {
  revenue: ProfitAndLossRow[];
  expenses: ProfitAndLossRow[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
};

type GeneralLedgerPageProps = {
  token: string;
  glAccounts: GlAccount[];
  journalEntries: JournalEntry[];
};

const API = "";

function money(value: number | string) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

export function GeneralLedgerPage({
  token,
  glAccounts,
  journalEntries,
}: GeneralLedgerPageProps) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[]>([]);
  const [trialTotals, setTrialTotals] = useState({
    debit: 0,
    credit: 0,
    balance: 0,
  });
  const [profitAndLoss, setProfitAndLoss] =
    useState<ProfitAndLoss | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");

  const loadReports = useCallback(async () => {
    if (!token) return;

    setReportLoading(true);
    setReportError("");

    try {
      const params = new URLSearchParams();

      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);

      const query = params.toString();
      const suffix = query ? `?${query}` : "";

      const headers = {
        Authorization: `Bearer ${token}`,
      };

      const [trialResponse, pnlResponse] = await Promise.all([
        fetch(`${API}/api/gl/trial-balance${suffix}`, { headers }),
        fetch(`${API}/api/gl/profit-and-loss${suffix}`, { headers }),
      ]);

      const trialResult = await trialResponse.json();
      const pnlResult = await pnlResponse.json();

      if (!trialResponse.ok) {
        throw new Error(
          trialResult?.errors?.[0]?.message ??
            "Unable to load Trial Balance",
        );
      }

      if (!pnlResponse.ok) {
        throw new Error(
          pnlResult?.errors?.[0]?.message ??
            "Unable to load Profit & Loss",
        );
      }

      setTrialBalance(trialResult.data ?? []);
      setTrialTotals(
        trialResult.totals ?? {
          debit: 0,
          credit: 0,
          balance: 0,
        },
      );
      setProfitAndLoss(pnlResult.data ?? null);
    } catch (error) {
      setReportError(
        error instanceof Error
          ? error.message
          : "Unable to load accounting reports",
      );
    } finally {
      setReportLoading(false);
    }
  }, [fromDate, toDate, token]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const postedEntries = journalEntries.filter(
    (entry) => entry.status === "POSTED",
  ).length;

  return (
    <>
      <section className="panel gl-panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">ACCOUNTING</div>
            <h2>General Ledger</h2>
            <p>Chart of accounts and accounting reports.</p>
          </div>
        </div>

        <div className="gl-summary">
          <div className="card">
            <span>GL Accounts</span>
            <strong>{glAccounts.length}</strong>
          </div>

          <div className="card">
            <span>Journal Entries</span>
            <strong>{journalEntries.length}</strong>
          </div>

          <div className="card">
            <span>Posted Entries</span>
            <strong>{postedEntries}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {glAccounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.code}</strong>
                  </td>
                  <td>{account.name}</td>
                  <td>{account.type}</td>
                  <td>
                    {journalEntries.reduce(
                      (count, entry) =>
                        count +
                        (entry.lines?.filter(
                          (line) => line.accountId === account.id,
                        ).length ?? 0),
                      0,
                    )}{" "}
                    lines
                  </td>
                </tr>
              ))}

              {glAccounts.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">No GL accounts found.</div>
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
            <h2>Accounting Reports</h2>
            <p>Posted accounting activity for the selected period.</p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            From Date
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>

          <label>
            To Date
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label>

          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              className="primary-button"
              onClick={() => void loadReports()}
              disabled={reportLoading}
            >
              {reportLoading ? "Loading..." : "Run Reports"}
            </button>
          </div>
        </div>

        {reportError && (
          <div className="error-banner">{reportError}</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Trial Balance</h2>
            <p>Debit and credit balances for active GL accounts.</p>
          </div>
        </div>

        <div className="gl-summary">
          <div className="card">
            <span>Total Debit</span>
            <strong>{money(trialTotals.debit)}</strong>
          </div>

          <div className="card">
            <span>Total Credit</span>
            <strong>{money(trialTotals.credit)}</strong>
          </div>

          <div className="card">
            <span>Net Balance</span>
            <strong>{money(trialTotals.balance)}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {trialBalance.map((row) => (
                <tr key={row.accountId}>
                  <td>
                    <strong>{row.code}</strong>
                  </td>
                  <td>{row.name}</td>
                  <td>{row.type}</td>
                  <td>{money(row.debit)}</td>
                  <td>{money(row.credit)}</td>
                  <td>{money(row.balance)}</td>
                </tr>
              ))}

              {trialBalance.length === 0 && !reportLoading && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      No Trial Balance data found.
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
            <h2>Profit &amp; Loss</h2>
            <p>Revenue, expenses and net profit.</p>
          </div>
        </div>

        {profitAndLoss && (
          <>
            <div className="gl-summary">
              <div className="card">
                <span>Total Revenue</span>
                <strong>{money(profitAndLoss.totalRevenue)}</strong>
              </div>

              <div className="card">
                <span>Total Expenses</span>
                <strong>{money(profitAndLoss.totalExpenses)}</strong>
              </div>

              <div className="card">
                <span>Net Profit</span>
                <strong>{money(profitAndLoss.netProfit)}</strong>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Account</th>
                    <th>Category</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {profitAndLoss.revenue.map((row) => (
                    <tr key={`revenue-${row.accountId}`}>
                      <td>
                        <strong>{row.code}</strong>
                      </td>
                      <td>{row.name}</td>
                      <td>Revenue</td>
                      <td>{money(row.amount)}</td>
                    </tr>
                  ))}

                  {profitAndLoss.expenses.map((row) => (
                    <tr key={`expense-${row.accountId}`}>
                      <td>
                        <strong>{row.code}</strong>
                      </td>
                      <td>{row.name}</td>
                      <td>Expense</td>
                      <td>{money(row.amount)}</td>
                    </tr>
                  ))}

                  {profitAndLoss.revenue.length === 0 &&
                    profitAndLoss.expenses.length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          <div className="empty">
                            No Profit &amp; Loss activity found.
                          </div>
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Journal Entries</h2>
            <p>Posted and draft accounting transactions.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Date</th>
                <th>Description</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {journalEntries.map((entry) => {
                const debit = (entry.lines ?? []).reduce(
                  (sum, line) => sum + Number(line.debit),
                  0,
                );

                const credit = (entry.lines ?? []).reduce(
                  (sum, line) => sum + Number(line.credit),
                  0,
                );

                return (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.entryNumber}</strong>
                    </td>
                    <td>
                      {new Date(entry.entryDate).toLocaleDateString("en-IN")}
                    </td>
                    <td>{entry.description || "—"}</td>
                    <td>{money(debit)}</td>
                    <td>{money(credit)}</td>
                    <td>{entry.status}</td>
                  </tr>
                );
              })}

              {journalEntries.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      No journal entries found.
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
