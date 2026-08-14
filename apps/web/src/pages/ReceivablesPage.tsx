import { useMemo, useState } from "react";
import type { FormEvent } from "react";

type Customer = {
  id?: string;
  code?: string;
  name: string;
};

type ArInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate?: string;
  status: string;
  totalAmount: number | string;
  paidAmount: number | string;
  customer?: Customer | null;
};

type ReceivablesPageProps = {
  token: string;
  invoices: ArInvoice[];
  onRefresh: () => Promise<void>;
};

const API = "";

function money(value: number | string) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

export function ReceivablesPage({
  token,
  invoices,
  onRefresh,
}: ReceivablesPageProps) {
  const [paymentInvoice, setPaymentInvoice] = useState<ArInvoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNumber, setPaymentNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totals = useMemo(
    () =>
      invoices.reduce(
        (result, invoice) => {
          const total = Number(invoice.totalAmount);
          const paid = Number(invoice.paidAmount);

          result.total += total;
          result.paid += paid;
          result.outstanding += total - paid;

          return result;
        },
        { total: 0, paid: 0, outstanding: 0 },
      ),
    [invoices],
  );

  async function recordPayment(event: FormEvent) {
    event.preventDefault();

    if (!paymentInvoice || !paymentNumber.trim()) {
      setError("Payment number is required.");
      return;
    }

    const amount = Number(paymentAmount);
    const outstanding =
      Number(paymentInvoice.totalAmount) -
      Number(paymentInvoice.paidAmount);

    if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) {
      setError(
        `Payment must be greater than 0 and no more than ${money(outstanding)}.`,
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
        `${API}/api/sales-invoices/${paymentInvoice.id}/payments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paymentNumber: paymentNumber.trim(),
            amount,
            notes: "AR payment recorded from Receivables",
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.errors?.[0]?.message ??
            "Unable to record customer payment",
        );
      }

      await onRefresh();

      setPaymentInvoice(null);
      setPaymentAmount("");
      setPaymentNumber("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to record customer payment",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="panel ar-panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">RECEIVABLES</div>
            <h2>Accounts Receivable</h2>
            <p>Customer invoices and outstanding balances.</p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="cards">
          <div className="card">
            <span>Invoices</span>
            <strong>{invoices.length}</strong>
          </div>

          <div className="card">
            <span>Invoiced</span>
            <strong>{money(totals.total)}</strong>
          </div>

          <div className="card">
            <span>Collected</span>
            <strong>{money(totals.paid)}</strong>
          </div>

          <div className="card">
            <span>Outstanding</span>
            <strong>{money(totals.outstanding)}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {invoices.map((invoice) => {
                const total = Number(invoice.totalAmount);
                const paid = Number(invoice.paidAmount);
                const outstanding = total - paid;

                const canPay =
                  (invoice.status === "POSTED" ||
                    invoice.status === "PARTIALLY_PAID") &&
                  outstanding > 0;

                return (
                  <tr key={invoice.id}>
                    <td>
                      <strong>{invoice.invoiceNumber}</strong>
                    </td>

                    <td>
                      {invoice.invoiceDate
                        ? new Date(invoice.invoiceDate).toLocaleDateString(
                            "en-IN",
                          )
                        : "—"}
                    </td>

                    <td>
                      <strong>{invoice.customer?.name ?? "—"}</strong>
                      <small>{invoice.customer?.code ?? ""}</small>
                    </td>

                    <td>{money(total)}</td>
                    <td>{money(paid)}</td>

                    <td>
                      <strong>{money(outstanding)}</strong>
                    </td>

                    <td>
                      <span
                        className={`status ${invoice.status.toLowerCase()}`}
                      >
                        {invoice.status.replaceAll("_", " ")}
                      </span>
                    </td>

                    <td>
                      {canPay && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setPaymentInvoice(invoice);
                            setPaymentAmount("");
                            setPaymentNumber("");
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

              {invoices.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      No customer invoices found.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {paymentInvoice && (
        <div
          className="modal-backdrop"
          onClick={() => setPaymentInvoice(null)}
        >
          <form
            className="modal"
            onSubmit={recordPayment}
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
                onClick={() => setPaymentInvoice(null)}
              >
                ×
              </button>
            </div>

            <div className="payment-summary">
              <div>
                <span>Invoice</span>
                <strong>{paymentInvoice.invoiceNumber}</strong>
              </div>

              <div>
                <span>Customer</span>
                <strong>{paymentInvoice.customer?.name ?? "—"}</strong>
              </div>

              <div>
                <span>Outstanding</span>
                <strong>
                  {money(
                    Number(paymentInvoice.totalAmount) -
                      Number(paymentInvoice.paidAmount),
                  )}
                </strong>
              </div>
            </div>

            <label>
              Payment Number
              <input
                value={paymentNumber}
                onChange={(event) => setPaymentNumber(event.target.value)}
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
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                placeholder="0.00"
                required
              />
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPaymentInvoice(null)}
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
    </>
  );
}
