type Bill = {
  id: string;
  billNumber: string;
  status: string;
  totalAmount: string | number;
  supplier: {
    name: string;
  };
};

type ArInvoice = {
  id: string;
  invoiceNumber: string;
  totalAmount: number | string;
  status: string;
  customer?: {
    name: string;
  } | null;
};

type JournalEntry = {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  status: string;
};

type DashboardTotals = {
  receivables: number;
  payables: number;
  netOutstanding: number;
  stockQuantity: number;
};

type DashboardPageProps = {
  loading: boolean;
  totals: DashboardTotals;
  invoices: ArInvoice[];
  bills: Bill[];
  journalEntries: JournalEntry[];
};

export function DashboardPage({
  loading,
  totals,
  invoices,
  bills,
  journalEntries,
}: DashboardPageProps) {
  return (
    <>
      <section className="panel dashboard-panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">ERP MODLER</div>
            <h2>Dashboard</h2>
            <p>Financial and operational overview</p>
          </div>
        </div>

        {loading ? (
          <div className="empty">Loading dashboard...</div>
        ) : (
          <div className="cards dashboard-cards">
            <div className="card">
              <span>Receivables Outstanding</span>
              <strong>
                ₹{totals.receivables.toLocaleString("en-IN")}
              </strong>
            </div>

            <div className="card">
              <span>Payables Outstanding</span>
              <strong>
                ₹{totals.payables.toLocaleString("en-IN")}
              </strong>
            </div>

            <div className="card">
              <span>Net Position</span>
              <strong>
                ₹{totals.netOutstanding.toLocaleString("en-IN")}
              </strong>
            </div>

            <div className="card">
              <span>Stock Quantity</span>
              <strong>
                {totals.stockQuantity.toLocaleString("en-IN")}
              </strong>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Recent Sales Invoices</h2>
            <p>Latest customer billing activity</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.slice(0, 5).map((invoice) => (
                <tr key={invoice.id}>
                  <td><strong>{invoice.invoiceNumber}</strong></td>
                  <td>{invoice.customer?.name ?? "—"}</td>
                  <td>
                    ₹{Number(invoice.totalAmount).toLocaleString("en-IN")}
                  </td>
                  <td>
                    <span className={`status ${invoice.status.toLowerCase()}`}>
                      {invoice.status.replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}

              {invoices.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">No sales invoices found.</div>
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
            <h2>Recent Vendor Bills</h2>
            <p>Latest supplier billing activity</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Supplier</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.slice(0, 5).map((bill) => (
                <tr key={bill.id}>
                  <td><strong>{bill.billNumber}</strong></td>
                  <td>{bill.supplier.name}</td>
                  <td>
                    ₹{Number(bill.totalAmount).toLocaleString("en-IN")}
                  </td>
                  <td>
                    <span className={`status ${bill.status.toLowerCase()}`}>
                      {bill.status.replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}

              {bills.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">No vendor bills found.</div>
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
            <h2>Recent Journal Activity</h2>
            <p>Latest General Ledger entries</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Date</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {journalEntries.slice(0, 5).map((entry) => (
                <tr key={entry.id}>
                  <td><strong>{entry.entryNumber}</strong></td>
                  <td>
                    {new Date(entry.entryDate).toLocaleDateString("en-IN")}
                  </td>
                  <td>{entry.description || "—"}</td>
                  <td>
                    <span className={`status ${entry.status.toLowerCase()}`}>
                      {entry.status.replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}

              {journalEntries.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">No journal entries found.</div>
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
