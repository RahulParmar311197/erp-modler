import { useMemo, useState } from "react";
import type { FormEvent } from "react";

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
  subtotal: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  paidAmount: number | string;
  supplier: Supplier;
};

type PayablesPageProps = {
  token: string;
  bills: Bill[];
  suppliers: Supplier[];
  items: Item[];
  onRefresh: () => Promise<void>;
};

const API = "";

function money(value: number | string) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

export function PayablesPage({
  token,
  bills,
  suppliers,
  items,
  onRefresh,
}: PayablesPageProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [paymentBill, setPaymentBill] = useState<Bill | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNumber, setPaymentNumber] = useState("");

  const [billNumber, setBillNumber] = useState("");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [taxAmount, setTaxAmount] = useState("0");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  async function createBill(event: FormEvent) {
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

    if (
      !Number.isFinite(quantityNumber) ||
      !Number.isFinite(unitPriceNumber) ||
      !Number.isFinite(taxNumber) ||
      quantityNumber <= 0 ||
      unitPriceNumber < 0 ||
      taxNumber < 0
    ) {
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

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.errors?.[0]?.message ?? "Unable to create vendor bill",
        );
      }

      setBillNumber("");
      setQuantity("1");
      setUnitPrice("0");
      setTaxAmount("0");
      setShowCreate(false);

      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create vendor bill",
      );
    } finally {
      setSaving(false);
    }
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();

    if (!paymentBill || !paymentNumber.trim()) {
      setError("Payment number is required.");
      return;
    }

    const amount = Number(paymentAmount);
    const outstanding =
      Number(paymentBill.totalAmount) - Number(paymentBill.paidAmount);

    if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding) {
      setError(
        `Payment must be greater than 0 and no more than ${money(outstanding)}.`,
      );
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

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.errors?.[0]?.message ?? "Unable to record payment",
        );
      }

      setPaymentBill(null);
      setPaymentAmount("");
      setPaymentNumber("");

      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to record payment",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">PAYABLES</div>
            <h2>Accounts Payable</h2>
            <p>Supplier bills and outstanding balances.</p>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setShowCreate(true);
              setError("");
            }}
          >
            Create Vendor Bill
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="cards">
          <div className="card">
            <span>Bills</span>
            <strong>{bills.length}</strong>
          </div>

          <div className="card">
            <span>Invoiced</span>
            <strong>{money(totals.total)}</strong>
          </div>

          <div className="card">
            <span>Paid</span>
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
                <th>Bill</th>
                <th>Supplier</th>
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
                const outstanding = total - paid;

                return (
                  <tr key={bill.id}>
                    <td>
                      <strong>{bill.billNumber}</strong>
                    </td>

                    <td>
                      <strong>{bill.supplier?.name ?? "—"}</strong>
                      <small>{bill.supplier?.code ?? ""}</small>
                    </td>

                    <td>{money(total)}</td>
                    <td>{money(paid)}</td>
                    <td>
                      <strong>{money(outstanding)}</strong>
                    </td>

                    <td>
                      <span className={`status ${bill.status.toLowerCase()}`}>
                        {bill.status.replaceAll("_", " ")}
                      </span>
                    </td>

                    <td>
                      {(bill.status === "POSTED" ||
                        bill.status === "PARTIALLY_PAID") &&
                        outstanding > 0 && (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setPaymentBill(bill);
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

              {bills.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">No vendor bills found.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCreate(false)}
        >
          <form
            className="modal"
            onSubmit={createBill}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="eyebrow">PAYABLES</div>
                <h2>Create Vendor Bill</h2>
              </div>

              <button
                type="button"
                className="icon-button"
                onClick={() => setShowCreate(false)}
              >
                ×
              </button>
            </div>

            <label>
              Bill Number
              <input
                value={billNumber}
                onChange={(event) => setBillNumber(event.target.value)}
                placeholder="BILL-001"
                required
              />
            </label>

            <label>
              Supplier
              <select
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                required
              >
                <option value="">Select supplier</option>
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
                required
              >
                <option value="">Select item</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} — {item.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-grid">
              <label>
                Quantity
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  required
                />
              </label>

              <label>
                Unit Price
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitPrice}
                  onChange={(event) => setUnitPrice(event.target.value)}
                  required
                />
              </label>

              <label>
                Tax Amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={taxAmount}
                  onChange={(event) => setTaxAmount(event.target.value)}
                  required
                />
              </label>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={saving}
              >
                {saving ? "Saving..." : "Create Bill"}
              </button>
            </div>
          </form>
        </div>
      )}

      {paymentBill && (
        <div
          className="modal-backdrop"
          onClick={() => setPaymentBill(null)}
        >
          <form
            className="modal"
            onSubmit={recordPayment}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="eyebrow">PAYABLES</div>
                <h2>Record Vendor Payment</h2>
              </div>

              <button
                type="button"
                className="icon-button"
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
                <strong>{paymentBill.supplier?.name ?? "—"}</strong>
              </div>

              <div>
                <span>Outstanding</span>
                <strong>
                  {money(
                    Number(paymentBill.totalAmount) -
                      Number(paymentBill.paidAmount),
                  )}
                </strong>
              </div>
            </div>

            <label>
              Payment Number
              <input
                value={paymentNumber}
                onChange={(event) => setPaymentNumber(event.target.value)}
                placeholder="VP-001"
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
                onClick={() => setPaymentBill(null)}
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
