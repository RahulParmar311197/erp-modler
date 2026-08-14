import { useEffect, useMemo, useState } from "react";

type Supplier = {
  id: string;
  code: string;
  name: string;
};

type PurchaseOrderLine = {
  id: string;
  itemId: string;
  quantity: number | string;
  receivedQty: number | string;
  item?: {
    id: string;
    sku: string;
    name: string;
  } | null;
  uom?: {
    id: string;
    code: string;
    name: string;
  } | null;
};

type PurchaseOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  supplier?: Supplier | null;
  totalAmount?: number | string;
  lines?: PurchaseOrderLine[];
};

type Warehouse = {
  id: string;
  code: string;
  name: string;
};

type WarehouseBin = {
  id: string;
  code: string;
  name: string;
  zone?: {
    id: string;
    code: string;
    name: string;
    warehouse?: {
      id: string;
      code: string;
      name: string;
    } | null;
  } | null;
};

type PurchasesPageProps = {
  token: string;
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  onRefresh: () => Promise<void>;
};

const API = "";

function apiError(result: any, fallback: string) {
  return result?.errors?.[0]?.message ?? fallback;
}

function remainingQuantity(line: PurchaseOrderLine) {
  return Math.max(
    0,
    Number(line.quantity) - Number(line.receivedQty),
  );
}

export function PurchasesPage({
  token,
  suppliers,
  purchaseOrders,
  onRefresh,
}: PurchasesPageProps) {
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [binId, setBinId] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [bins, setBins] = useState<WarehouseBin[]>([]);
  const [loadingMasters, setLoadingMasters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedOrder = useMemo(
    () =>
      purchaseOrders.find(
        (order) => order.id === selectedOrderId,
      ) ?? null,
    [purchaseOrders, selectedOrderId],
  );

  const availableOrders = useMemo(
    () =>
      purchaseOrders.filter(
        (order) =>
          order.status === "APPROVED" ||
          order.status === "PARTIALLY_RECEIVED",
      ),
    [purchaseOrders],
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function loadMasters() {
      setLoadingMasters(true);

      try {
        const headers = {
          Authorization: `Bearer ${token}`,
        };

        const [warehousesResponse, binsResponse] =
          await Promise.all([
            fetch(`${API}/api/warehouses`, { headers }),
            fetch(`${API}/api/warehouse-bins`, { headers }),
          ]);

        const [warehousesResult, binsResult] =
          await Promise.all([
            warehousesResponse.json(),
            binsResponse.json(),
          ]);

        if (!warehousesResponse.ok) {
          throw new Error(
            apiError(
              warehousesResult,
              "Unable to load warehouses",
            ),
          );
        }

        if (!binsResponse.ok) {
          throw new Error(
            apiError(
              binsResult,
              "Unable to load warehouse bins",
            ),
          );
        }

        if (!cancelled) {
          setWarehouses(warehousesResult.data ?? []);
          setBins(binsResult.data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load receipt masters",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingMasters(false);
        }
      }
    }

    void loadMasters();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const selectedBins = useMemo(
    () =>
      bins.filter(
        (bin) =>
          bin.zone?.warehouse?.id === warehouseId,
      ),
    [bins, warehouseId],
  );

  function openReceipt(order: PurchaseOrder) {
    setError("");
    setSelectedOrderId(order.id);
    setReceiptNumber(
      `GRN-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${order.orderNumber}`,
    );
    setWarehouseId("");
    setBinId("");
    setNotes("");

    const nextQuantities: Record<string, string> = {};

    for (const line of order.lines ?? []) {
      const remaining = remainingQuantity(line);

      if (remaining > 0) {
        nextQuantities[line.id] = String(remaining);
      }
    }

    setQuantities(nextQuantities);
  }

  function closeReceipt() {
    setSelectedOrderId("");
    setReceiptNumber("");
    setWarehouseId("");
    setBinId("");
    setNotes("");
    setQuantities({});
    setError("");
  }

  function updateQuantity(lineId: string, value: string) {
    setQuantities((current) => ({
      ...current,
      [lineId]: value,
    }));
  }

  async function createReceipt(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (!selectedOrder) {
      setError("Select a purchase order.");
      return;
    }

    if (!receiptNumber.trim()) {
      setError("Receipt number is required.");
      return;
    }

    if (!warehouseId) {
      setError("Warehouse is required.");
      return;
    }

    const lines = (selectedOrder.lines ?? [])
      .map((line) => ({
        purchaseOrderLineId: line.id,
        warehouseId,
        binId: binId || undefined,
        quantity: Number(quantities[line.id] ?? 0),
      }))
      .filter((line) => line.quantity > 0);

    if (lines.length === 0) {
      setError("Enter a receipt quantity for at least one line.");
      return;
    }

    for (const line of selectedOrder.lines ?? []) {
      const requested = Number(quantities[line.id] ?? 0);
      const remaining = remainingQuantity(line);

      if (requested < 0 || requested > remaining) {
        setError(
          `Receipt quantity for ${line.item?.sku ?? "item"} cannot exceed remaining quantity ${remaining}.`,
        );
        return;
      }
    }

    setSaving(true);

    try {
      const response = await fetch(
        `${API}/api/goods-receipts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            purchaseOrderId: selectedOrder.id,
            receiptNumber: receiptNumber.trim(),
            notes: notes.trim() || undefined,
            lines,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to create goods receipt"),
        );
      }

      closeReceipt();
      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create goods receipt",
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
            <div className="eyebrow">PURCHASES</div>
            <h2>Purchase Orders</h2>
            <p>Supplier orders and purchasing activity.</p>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void onRefresh()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="cards">
          <div className="card">
            <span>Suppliers</span>
            <strong>{suppliers.length}</strong>
          </div>

          <div className="card">
            <span>Purchase Orders</span>
            <strong>{purchaseOrders.length}</strong>
          </div>

          <div className="card">
            <span>Ready to Receive</span>
            <strong>{availableOrders.length}</strong>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      {selectedOrder && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">RECEIVING</div>
              <h2>Receive {selectedOrder.orderNumber}</h2>
              <p>
                {selectedOrder.supplier?.name ?? "Supplier"} — enter
                quantities and the destination warehouse/bin.
              </p>
            </div>

            <button
              type="button"
              className="secondary-button"
              onClick={closeReceipt}
              disabled={saving}
            >
              Cancel
            </button>
          </div>

          <form
            className="form-grid create-form"
            onSubmit={createReceipt}
          >
            <label>
              Receipt Number
              <input
                value={receiptNumber}
                onChange={(event) =>
                  setReceiptNumber(event.target.value)
                }
                required
              />
            </label>

            <label>
              Warehouse
              <select
                value={warehouseId}
                onChange={(event) => {
                  setWarehouseId(event.target.value);
                  setBinId("");
                }}
                required
                disabled={loadingMasters}
              >
                <option value="">
                  {loadingMasters
                    ? "Loading..."
                    : "Select warehouse"}
                </option>

                {warehouses.map((warehouse) => (
                  <option
                    key={warehouse.id}
                    value={warehouse.id}
                  >
                    {warehouse.code} — {warehouse.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Bin
              <select
                value={binId}
                onChange={(event) =>
                  setBinId(event.target.value)
                }
                disabled={!warehouseId || loadingMasters}
              >
                <option value="">No bin</option>

                {selectedBins.map((bin) => (
                  <option key={bin.id} value={bin.id}>
                    {bin.code} — {bin.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Notes
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional receipt notes"
              />
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Ordered</th>
                      <th>Received</th>
                      <th>Remaining</th>
                      <th>Receive Now</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(selectedOrder.lines ?? []).map((line) => {
                      const remaining = remainingQuantity(line);

                      return (
                        <tr key={line.id}>
                          <td>
                            <strong>
                              {line.item?.sku ?? "—"}
                            </strong>
                            <div className="muted">
                              {line.item?.name ?? "Item"}
                            </div>
                          </td>
                          <td>{Number(line.quantity)}</td>
                          <td>{Number(line.receivedQty)}</td>
                          <td>{remaining}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              max={remaining}
                              step="any"
                              value={quantities[line.id] ?? ""}
                              onChange={(event) =>
                                updateQuantity(
                                  line.id,
                                  event.target.value,
                                )
                              }
                              disabled={remaining <= 0}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "end",
                gap: "8px",
              }}
            >
              <button
                type="submit"
                className="primary-button"
                disabled={saving || loadingMasters}
              >
                {saving ? "Posting Receipt..." : "Post Receipt"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Purchase Orders</h2>
            <p>Orders available for review and goods receipt.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Supplier</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {purchaseOrders.map((order) => {
                const canReceive =
                  (order.status === "APPROVED" ||
                    order.status === "PARTIALLY_RECEIVED") &&
                  (order.lines ?? []).some(
                    (line) => remainingQuantity(line) > 0,
                  );

                return (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.orderNumber}</strong>
                    </td>

                    <td>{order.supplier?.name ?? "—"}</td>

                    <td>
                      {new Date(
                        order.orderDate,
                      ).toLocaleDateString("en-IN")}
                    </td>

                    <td>
                      ₹
                      {Number(
                        order.totalAmount ?? 0,
                      ).toLocaleString("en-IN")}
                    </td>

                    <td>
                      <span
                        className={`status ${order.status.toLowerCase()}`}
                      >
                        {order.status.replaceAll("_", " ")}
                      </span>
                    </td>

                    <td>
                      {canReceive ? (
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => openReceipt(order)}
                        >
                          Receive
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}

              {purchaseOrders.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      No purchase orders found.
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
