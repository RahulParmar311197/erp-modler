import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API = "";

type Supplier = {
  id: string;
  code: string;
  name: string;
};

type Item = {
  id: string;
  sku: string;
  name: string;
};

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
  supplier: Supplier;
};

type LoginResponse = {
  data: {
    token: string;
  };
};

function App() {
  const [token, setToken] = useState("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [paymentBill, setPaymentBill] = useState<Bill | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNumber, setPaymentNumber] = useState("");
  const [arInvoices, setArInvoices] = useState<any[]>([]);
  const [glAccounts, setGlAccounts] = useState<any[]>([]);
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [arPaymentInvoice, setArPaymentInvoice] = useState<any | null>(null);
  const [arPaymentAmount, setArPaymentAmount] = useState("");
  const [arPaymentNumber, setArPaymentNumber] = useState("");


  const [billNumber, setBillNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [taxAmount, setTaxAmount] = useState("0");
  const [itemId, setItemId] = useState("");

  async function login() {
    const response = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  async function loadData(authToken: string) {
    const headers = {
      Authorization: `Bearer ${authToken}`,
    };

    const [billResponse, supplierResponse, itemResponse] =
      await Promise.all([
        fetch(`${API}/api/vendor-bills`, { headers }),
        fetch(`${API}/api/suppliers`, { headers }),
        fetch(`${API}/api/items`, { headers }),
      ]);

    if (!billResponse.ok) throw new Error("Unable to load vendor bills");
    if (!supplierResponse.ok) throw new Error("Unable to load suppliers");
    if (!itemResponse.ok) throw new Error("Unable to load items");

    const billsResult = await billResponse.json();
    const suppliersResult = await supplierResponse.json();
    const itemsResult = await itemResponse.json();

    setBills(billsResult.data ?? []);
    setSuppliers(suppliersResult.data ?? []);
    setItems(itemsResult.data ?? []);

    if (!supplierId && suppliersResult.data?.length) {
      setSupplierId(suppliersResult.data[0].id);
    }

    if (!itemId && itemsResult.data?.length) {
      setItemId(itemsResult.data[0].id);
    }
  }

  async function refresh() {
    if (token) {
      await loadData(token);
    }
  }

  async function loadGl(authToken: string) {
  const headers = {
    Authorization: `Bearer ${authToken}`,
  };

  const [accountsResponse, journalResponse] = await Promise.all([
    fetch(`${API}/api/gl/accounts`, { headers }),
    fetch(`${API}/api/gl/journal-entries`, { headers }),
  ]);

  if (!accountsResponse.ok || !journalResponse.ok) {
    throw new Error("Unable to load General Ledger");
  }

  const [accountsResult, journalResult] = await Promise.all([
    accountsResponse.json(),
    journalResponse.json(),
  ]);

  setGlAccounts(accountsResult.data ?? []);
  setJournalEntries(journalResult.data ?? []);
}

async function loadReceivables(authToken: string) {
    const response = await fetch(`${API}/api/sales-invoices`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error("Unable to load sales invoices");
    }

    const result = await response.json();
    setArInvoices(result.data ?? []);
  }

  useEffect(() => {
    async function initialize() {
      try {
        const authToken = await login();
        await loadData(authToken);
      await loadReceivables(authToken);
      await loadGl(authToken);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  async function createBill(event: React.FormEvent) {
    event.preventDefault();

    if (!supplierId || !itemId || !billNumber.trim()) {
      setError("Bill number, supplier and item are required.");
      return;
    }

    const quantityNumber = Number(quantity);
    const unitPriceNumber = Number(unitPrice);
    const taxNumber = Number(taxAmount);
    const subtotal = quantityNumber * unitPriceNumber;
    const total = subtotal + taxNumber;

    if (quantityNumber <= 0 || unitPriceNumber < 0 || taxNumber < 0) {
      setError("Enter valid amounts.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API}/api/vendor-bills`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "0acbfc53-94fe-457c-8e43-b048dc454a3d",
          supplierId,
          billNumber: billNumber.trim(),
          currency: "INR",
          subtotal,
          taxAmount: taxNumber,
          totalAmount: total,
          lines: [
            {
              itemId,
              description:
                items.find((item) => item.id === itemId)?.name ?? "Item",
              quantity: quantityNumber,
              unitPrice: unitPriceNumber,
              lineTotal: subtotal,
            },
          ],
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(
          result?.errors?.[0]?.message ?? "Unable to create vendor bill",
        );
      }

      setBillNumber("");
      setQuantity("1");
      setUnitPrice("0");
      setTaxAmount("0");
      setShowCreate(false);

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create bill");
    } finally {
      setSaving(false);
    }
  }

  async function postBill(id: string) {
    setError("");

    const response = await fetch(`${API}/api/vendor-bills/${id}/post`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(result?.errors?.[0]?.message ?? "Unable to post bill");
      return;
    }

    await refresh();
  }

  async function recordPayment(event: React.FormEvent) {
    event.preventDefault();

    if (!paymentBill || !paymentNumber.trim()) {
      setError("Payment number is required.");
      return;
    }

    const amount = Number(paymentAmount);
    const outstanding =
      Number(paymentBill.totalAmount) - Number(paymentBill.paidAmount);

    if (amount <= 0 || amount > outstanding) {
      setError(`Payment must be greater than 0 and no more than ₹${outstanding.toLocaleString("en-IN")}.`);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API}/api/vendor-payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supplierId: paymentBill.supplier.id,
          vendorBillId: paymentBill.id,
          paymentNumber: paymentNumber.trim(),
          amount,
          currency: paymentBill.currency,
          notes: "Recorded from Accounts Payable dashboard",
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(
          result?.errors?.[0]?.message ?? "Unable to record payment",
        );
      }

      setPaymentBill(null);
      setPaymentAmount("");
      setPaymentNumber("");

      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to record payment",
      );
    } finally {
      setSaving(false);
    }
  }

  const totals = useMemo(
    () =>
      bills.reduce(
        (result, bill) => {
          const total = Number(bill.totalAmount);
          const paid = Number(bill.paidAmount);

          result.total += total;
          result.paid += paid;
          result.outstanding += total - paid;

          return result;
        },
        { total: 0, paid: 0, outstanding: 0 },
      ),
    [bills],
  );

  async function recordArPayment(event: React.FormEvent) {
    event.preventDefault();

    if (!arPaymentInvoice || !arPaymentNumber.trim()) {
      setError("Payment number is required.");
      return;
    }

    const amount = Number(arPaymentAmount);
    const outstanding =
      Number(arPaymentInvoice.totalAmount) -
      Number(arPaymentInvoice.paidAmount);

    if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) {
      setError(
        `Payment must be greater than 0 and no more than ₹${outstanding.toLocaleString("en-IN")}.`,
      );
      return;
    }

    if (!token) {
      setError("Authentication token is missing.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `${API}/api/sales-invoices/${arPaymentInvoice.id}/payments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paymentNumber: arPaymentNumber.trim(),
            amount,
            notes: "AR payment recorded from dashboard",
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.errors?.[0]?.message ?? "Unable to record customer payment",
        );
      }

      await loadReceivables(token);

      setArPaymentInvoice(null);
      setArPaymentAmount("");
      setArPaymentNumber("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record payment");
    } finally {
      setSaving(false);
    }
  }

  const receivableTotals = useMemo(() => {
    return arInvoices.reduce(
      (result, invoice) => {
        const total = Number(invoice.totalAmount);
        const paid = Number(invoice.paidAmount);

        result.total += total;
        result.paid += paid;
        result.outstanding += total - paid;

        return result;
      },
      { total: 0, paid: 0, outstanding: 0 },
    );
  }, [arInvoices]);

  if (loading) {
    return <main className="app">Loading ERP MODLER...</main>;
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">ERP MODLER</div>
          <h1>Accounts Payable</h1>
        </div>

        <div className="top-actions">
          <span className="connection">
            <span className="dot" />
            API Connected
          </span>
          <span className="user">System Administrator</span>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

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
            <p>Create and manage supplier invoices.</p>
          </div>

          <button
            className="primary-button"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "Close" : "+ New Vendor Bill"}
          </button>
        </div>

        {showCreate && (
          <form className="create-form" onSubmit={createBill}>
            <div className="form-grid">
              <label>
                Bill Number
                <input
                  value={billNumber}
                  onChange={(event) => setBillNumber(event.target.value)}
                  placeholder="VB-TEST-002"
                />
              </label>

              <label>
                Supplier
                <select
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                >
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.code} — {supplier.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Item
                <select
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                >
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>

              <label>
                Unit Price
                <input
                  type="number"
                  min="0"
                  value={unitPrice}
                  onChange={(event) => setUnitPrice(event.target.value)}
                />
              </label>

              <label>
                Tax Amount
                <input
                  type="number"
                  min="0"
                  value={taxAmount}
                  onChange={(event) => setTaxAmount(event.target.value)}
                />
              </label>
            </div>

            <button className="primary-button" disabled={saving}>
              {saving ? "Creating..." : "Create Draft Bill"}
            </button>
          </form>
        )}

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
                  <th>Action</th>
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

                      <td>₹{total.toLocaleString("en-IN")}</td>
                      <td>₹{paid.toLocaleString("en-IN")}</td>
                      <td>₹{(total - paid).toLocaleString("en-IN")}</td>

                      <td>
                        <span className={`status ${bill.status.toLowerCase()}`}>
                          {bill.status.replaceAll("_", " ")}
                        </span>
                      </td>

                      <td>
                        {bill.status === "DRAFT" && (
                          <button
                            className="action-button"
                            onClick={() => void postBill(bill.id)}
                          >
                            Post
                          </button>
                        )}

                        {(bill.status === "POSTED" ||
                          bill.status === "PARTIALLY_PAID") && (
                          <button
                            className="action-button"
                            onClick={() => {
                              setPaymentBill(bill);
                              setPaymentAmount("");
                              setPaymentNumber("");
                            }}
                          >
                            Record Payment
                          </button>
                        )}

                        {bill.status === "PAID" && (
                          <span className="paid-label">Paid</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {paymentBill && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={recordPayment}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">ACCOUNTS PAYABLE</div>
                <h2>Record Payment</h2>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={() => setPaymentBill(null)}
              >
                ×
              </button>
            </div>

            <div className="payment-summary">
              <div>
                <span>Bill</span>
                <strong>{paymentBill.billNumber}</strong>
              </div>

              <div>
                <span>Supplier</span>
                <strong>{paymentBill.supplier.name}</strong>
              </div>

              <div>
                <span>Outstanding</span>
                <strong>
                  ₹
                  {(
                    Number(paymentBill.totalAmount) -
                    Number(paymentBill.paidAmount)
                  ).toLocaleString("en-IN")}
                </strong>
              </div>
            </div>

            <div className="form-grid single">
              <label>
                Payment Number
                <input
                  value={paymentNumber}
                  onChange={(event) => setPaymentNumber(event.target.value)}
                  placeholder="VP-TEST-003"
                  autoFocus
                />
              </label>

              <label>
                Payment Amount
                <input
                  type="number"
                  min="1"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  placeholder="500"
                />
              </label>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPaymentBill(null)}
              >
                Cancel
              </button>

              <button className="primary-button" disabled={saving}>
                {saving ? "Saving..." : "Record Payment"}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="panel ar-panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">RECEIVABLES</div>
            <h2>Accounts Receivable</h2>
            <p>Customer invoices and outstanding balances</p>
          </div>
        </div>

        <div className="cards">
          <div className="card">
            <span>Invoices</span>
            <strong>{arInvoices.length}</strong>
          </div>

          <div className="card">
            <span>Invoiced</span>
            <strong>₹{receivableTotals.total.toLocaleString("en-IN")}</strong>
          </div>

          <div className="card">
            <span>Collected</span>
            <strong>₹{receivableTotals.paid.toLocaleString("en-IN")}</strong>
          </div>

          <div className="card">
            <span>Outstanding</span>
            <strong>₹{receivableTotals.outstanding.toLocaleString("en-IN")}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {arInvoices.map((invoice) => {
                const total = Number(invoice.totalAmount);
                const paid = Number(invoice.paidAmount);

                return (
                  <tr key={invoice.id}>
                    <td><strong>{invoice.invoiceNumber}</strong></td>
                    <td>
                      <strong>{invoice.customer?.name ?? "—"}</strong>
                      <small>{invoice.customer?.code ?? ""}</small>
                    </td>
                    <td>₹{total.toLocaleString("en-IN")}</td>
                    <td>₹{paid.toLocaleString("en-IN")}</td>
                    <td>
                      <strong>
                        ₹{(total - paid).toLocaleString("en-IN")}
                      </strong>
                    </td>
                    <td>
                      <span className={`status ${invoice.status.toLowerCase()}`}>
                        {invoice.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>
                      {(invoice.status === "POSTED" ||
                        invoice.status === "PARTIALLY_PAID") &&
                        total - paid > 0 && (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setArPaymentInvoice(invoice);
                              setArPaymentAmount("");
                              setArPaymentNumber("");
                              setError("");
                            }}
                          >
                            Record Payment
                          </button>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {arPaymentInvoice && (
        <div
          className="modal-backdrop"
          onClick={() => setArPaymentInvoice(null)}
        >
          <form
            className="modal"
            onSubmit={recordArPayment}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="eyebrow">ACCOUNTS RECEIVABLE</div>
                <h2>Record Customer Payment</h2>
              </div>

              <button
                type="button"
                className="icon-button"
                onClick={() => setArPaymentInvoice(null)}
              >
                ×
              </button>
            </div>

            <div className="payment-summary">
              <div>
                <span>Invoice</span>
                <strong>{arPaymentInvoice.invoiceNumber}</strong>
              </div>
              <div>
                <span>Customer</span>
                <strong>{arPaymentInvoice.customer?.name ?? "—"}</strong>
              </div>
              <div>
                <span>Outstanding</span>
                <strong>
                  ₹
                  {(
                    Number(arPaymentInvoice.totalAmount) -
                    Number(arPaymentInvoice.paidAmount)
                  ).toLocaleString("en-IN")}
                </strong>
              </div>
            </div>

            <label>
              Payment Number
              <input
                value={arPaymentNumber}
                onChange={(event) => setArPaymentNumber(event.target.value)}
                placeholder="CP-001"
                required
              />
            </label>

            <label>
              Payment Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={arPaymentAmount}
                onChange={(event) => setArPaymentAmount(event.target.value)}
                placeholder="0.00"
                required
              />
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setArPaymentInvoice(null)}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={saving}
              >
                {saving ? "Saving..." : "Record Payment"}
              </button>
            </div>
          </form>
        </div>
      )}


      <section className="panel gl-panel">
        <div className="panel-header">
          <div>
            <h2>General Ledger</h2>
            <p>Chart of accounts and journal activity</p>
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
            <strong>
              {journalEntries.filter(
                (entry) => entry.status === "POSTED",
              ).length}
            </strong>
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
                  <td><strong>{account.code}</strong></td>
                  <td>{account.name}</td>
                  <td>{account.type}</td>
                  <td>
                    {journalEntries.reduce(
                      (count, entry) =>
                        count +
                        (entry.lines?.filter(
                          (line: any) =>
                            line.accountId === account.id,
                        ).length ?? 0),
                      0,
                    )}{" "}
                    lines
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel-header">
          <div>
            <h2>Journal Entries</h2>
            <p>Posted and draft accounting transactions</p>
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
                  (sum: number, line: any) =>
                    sum + Number(line.debit),
                  0,
                );

                const credit = (entry.lines ?? []).reduce(
                  (sum: number, line: any) =>
                    sum + Number(line.credit),
                  0,
                );

                return (
                  <tr key={entry.id}>
                    <td><strong>{entry.entryNumber}</strong></td>
                    <td>
                      {new Date(
                        entry.entryDate,
                      ).toLocaleDateString("en-IN")}
                    </td>
                    <td>{entry.description || "—"}</td>
                    <td>₹{debit.toLocaleString("en-IN")}</td>
                    <td>₹{credit.toLocaleString("en-IN")}</td>
                    <td>{entry.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </main>
  );
}

export default App;
