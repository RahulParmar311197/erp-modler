import { useEffect, useState } from "react";

type BalanceSheetRow = {
  accountId: string;
  code: string;
  name: string;
  amount: number;
};

type BalanceSheetData = {
  assets: BalanceSheetRow[];
  liabilities: BalanceSheetRow[];
  equity: BalanceSheetRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balance: number;
};

type BalanceSheetPageProps = {
  token: string;
};

const API = "";

function money(value: number | string) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function Section({
  title,
  rows,
  total,
}: {
  title: string;
  rows: BalanceSheetRow[];
  total: number;
}) {
  return (
    <div>
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th className="amount-cell">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.accountId}>
                <td>
                  <strong>{row.code}</strong>
                </td>
                <td>{row.name}</td>
                <td className="amount-cell">{money(row.amount)}</td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <div className="empty">No accounts found.</div>
                </td>
              </tr>
            )}

            <tr>
              <td colSpan={2}>
                <strong>Total {title}</strong>
              </td>
              <td className="amount-cell">
                <strong>{money(total)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BalanceSheetPage({
  token,
}: BalanceSheetPageProps) {
  const [toDate, setToDate] = useState("");
  const [report, setReport] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadReport() {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      if (toDate) {
        params.set("toDate", toDate);
      }

      const query = params.toString();
      const suffix = query ? `?${query}` : "";

      const response = await fetch(
        `${API}/api/gl/balance-sheet${suffix}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.errors?.[0]?.message ??
            "Unable to load Balance Sheet",
        );
      }

      setReport(result.data ?? null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load Balance Sheet",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, [token]);

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">ACCOUNTING</div>
            <h2>Balance Sheet</h2>
            <p>Assets, liabilities and equity at a point in time.</p>
          </div>
        </div>

        <div className="form-grid">
          <label>
            As of Date
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
              onClick={() => void loadReport()}
              disabled={loading}
            >
              {loading ? "Loading..." : "Run Report"}
            </button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      {report && (
        <>
          <section className="cards">
            <div className="card">
              <span>Total Assets</span>
              <strong>{money(report.totalAssets)}</strong>
            </div>

            <div className="card">
              <span>Total Liabilities</span>
              <strong>{money(report.totalLiabilities)}</strong>
            </div>

            <div className="card">
              <span>Total Equity</span>
              <strong>{money(report.totalEquity)}</strong>
            </div>

            <div className="card">
              <span>Balance Check</span>
              <strong>{money(report.balance)}</strong>
            </div>
          </section>

          <section className="panel">
            <Section
              title="Assets"
              rows={report.assets}
              total={report.totalAssets}
            />

            <Section
              title="Liabilities"
              rows={report.liabilities}
              total={report.totalLiabilities}
            />

            <Section
              title="Equity"
              rows={report.equity}
              total={report.totalEquity}
            />

            <div className="panel-header">
              <div>
                <h2>Balance Check</h2>
                <p>
                  Assets − Liabilities − Equity
                </p>
              </div>
              <strong>{money(report.balance)}</strong>
            </div>
          </section>
        </>
      )}
    </>
  );
}
