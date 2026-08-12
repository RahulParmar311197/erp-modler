import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API = "";

type Bill = {
  id: string;
  billNumber: string;
  status: string;
  billDate: string;
  currency: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  supplier: {
    name: string;
    code: string;
  };
};

type LoginResponse = {
  data: {
    token: string;
  };
};

function App() {
  const [, setToken] = useState("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function login() {
    const response = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenantCode: "MODLER",
        email: "admin@modler.local",
        password: "ModlerAdmin@2026!",
      }),
    });

    if (!response.ok) {
      throw new Error("Login failed");
    }

    const result = (await response.json()) as LoginResponse;
    setToken(result.data.token);
    return result.data.token;
  }

  async function loadBills(authToken: string) {
    const response = await fetch(`${API}/api/vendor-bills`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error("Unable to load vendor bills");
    }

    const result = await response.json();
    setBills(result.data ?? []);
  }

  useEffect(() => {
    async function initialize() {
      try {
        const authToken = await login();
        await loadBills(authToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  const totals = useMemo(() => {
    return bills.reduce(
      (result, bill) => {
        const total = Number(bill.totalAmount);
        const paid = Number(bill.paidAmount);

        result.total += total;
        result.paid += paid;
        result.outstanding += total - paid;

        return result;
      },
      {
        total: 0,
        paid: 0,
        outstanding: 0,
      },
    );
  }, [bills]);

  if (loading) {
    return <main className="app">Loading ERP MODLER...</main>;
  }

  if (error) {
    return (
      <main className="app">
        <div className="error">{error}</div>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">ERP MODLER</div>
          <h1>Accounts Payable</h1>
        </div>

        <div className="connection">
          <span className="dot" />
          API Connected
        </div>
      </header>

      <section className="cards">
        <div className="card">
          <span>Total Bills</span>
          <strong>{bills.length}</strong>
        </div>

        <div className="card">
          <span>Total Amount</span>
          <strong>₹{totals.total.toLocaleString("en-IN")}</strong>
        </div>

        <div className="card">
          <span>Paid</span>
          <strong>₹{totals.paid.toLocaleString("en-IN")}</strong>
        </div>

        <div className="card">
          <span>Outstanding</span>
          <strong>₹{totals.outstanding.toLocaleString("en-IN")}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Vendor Bills</h2>
            <p>Live data from the Accounts Payable API</p>
          </div>
        </div>

        {bills.length === 0 ? (
          <div className="empty">No vendor bills found.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Supplier</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Outstanding</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {bills.map((bill) => {
                  const total = Number(bill.totalAmount);
                  const paid = Number(bill.paidAmount);

                  return (
                    <tr key={bill.id}>
                      <td>
                        <strong>{bill.billNumber}</strong>
                      </td>

                      <td>
                        <strong>{bill.supplier.name}</strong>
                        <small>{bill.supplier.code}</small>
                      </td>

                      <td>
                        {new Date(bill.billDate).toLocaleDateString("en-IN")}
                      </td>

                      <td>
                        {bill.currency}{" "}
                        {total.toLocaleString("en-IN")}
                      </td>

                      <td>
                        {bill.currency}{" "}
                        {paid.toLocaleString("en-IN")}
                      </td>

                      <td>
                        {bill.currency}{" "}
                        {(total - paid).toLocaleString("en-IN")}
                      </td>

                      <td>
                        <span className={`status ${bill.status.toLowerCase()}`}>
                          {bill.status.replaceAll("_", " ")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
