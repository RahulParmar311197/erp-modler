import { useEffect, useMemo, useState } from "react";

type Customer = {
  id: string;
  code: string;
  name: string;
};

type SalesOrderLine = {
  id: string;
  itemId: string;
  quantity: number | string;
  shippedQty: number | string;
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

type SalesOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  customer?: Customer | null;
  totalAmount?: number | string;
  lines?: SalesOrderLine[];
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

type SalesPageProps = {
  token: string;
  customers: Customer[];
  salesOrders: SalesOrder[];
  onRefresh: () => Promise<void>;
};

const API = "";

function apiError(result: any, fallback: string) {
  return result?.errors?.[0]?.message ?? fallback;
}

function remainingQuantity(line: SalesOrderLine) {
  return Math.max(
    0,
    Number(line.quantity) - Number(line.shippedQty),
  );
}

export function SalesPage({
  token,
  customers,
  salesOrders,
  onRefresh,
}: SalesPageProps) {
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [shipmentNumber, setShipmentNumber] = useState("");
  const [invoiceOrderId, setInvoiceOrderId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
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
      salesOrders.find((order) => order.id === selectedOrderId) ?? null,
    [salesOrders, selectedOrderId],
  );

  const availableOrders = useMemo(
    () =>
      salesOrders.filter(
        (order) =>
          order.status === "APPROVED" ||
          order.status === "PARTIALLY_SHIPPED",
      ),
    [salesOrders],
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
              : "Unable to load shipment masters",
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

  function openShipment(order: SalesOrder) {
    setError("");
    setSelectedOrderId(order.id);
    setShipmentNumber(
      `SHIP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${order.orderNumber}`,
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

  function closeShipment() {
    setSelectedOrderId("");
    setShipmentNumber("");
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

  async function createInvoice(order: SalesOrder) {
    setError("");

    if (!token) {
      setError("Authentication token is missing.");
      return;
    }

    if (order.status !== "SHIPPED") {
      setError("Only shipped sales orders can be invoiced.");
      return;
    }

    const number = invoiceNumber.trim();

    if (!number) {
      setError("Invoice number is required.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        `${API}/api/sales-orders/${order.id}/invoice`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            invoiceNumber: number,
            invoiceDate: new Date().toISOString().slice(0, 10),
            notes: "Created from Sales",
          }),
        },
      );

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.errors?.[0]?.message ??
            "Unable to create sales invoice",
        );
      }

      setInvoiceOrderId("");
      setInvoiceNumber("");
      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create sales invoice",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createShipment(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (!selectedOrder) {
      setError("Select a sales order.");
      return;
    }

    if (!shipmentNumber.trim()) {
      setError("Shipment number is required.");
      return;
    }

    if (!warehouseId || !binId) {
      setError("Warehouse and bin are required.");
      return;
    }

    const lines = (selectedOrder.lines ?? [])
      .map((line) => ({
        salesOrderLineId: line.id,
        quantity: Number(quantities[line.id] ?? 0),
      }))
      .filter((line) => line.quantity > 0);

    if (lines.length === 0) {
      setError("Enter a shipment quantity for at least one line.");
      return;
    }

    for (const line of selectedOrder.lines ?? []) {
      const requested = Number(quantities[line.id] ?? 0);
      const remaining = remainingQuantity(line);

      if (requested < 0 || requested > remaining) {
        setError(
          `Shipment quantity for ${line.item?.sku ?? "item"} cannot exceed remaining quantity ${remaining}.`,
        );
        return;
      }
    }

    setSaving(true);

    try {
      const response = await fetch(
        `${API}/api/sales-orders/${selectedOrder.id}/ship`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            shipmentNumber: shipmentNumber.trim(),
            warehouseId,
            binId,
            notes: notes.trim() || undefined,
            lines,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to create shipment"),
        );
      }

      closeShipment();
      await onRefresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create shipment",
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
            <div className="eyebrow">SALES</div>
            <h2>Sales Orders</h2>
            <p>Customer orders and sales pipeline.</p>
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
            <span>Customers</span>
            <strong>{customers.length}</strong>
          </div>

          <div className="card">
            <span>Sales Orders</span>
            <strong>{salesOrders.length}</strong>
          </div>

          <div className="card">
            <span>Ready to Ship</span>
            <strong>{availableOrders.length}</strong>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      {selectedOrder && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">FULFILLMENT</div>
              <h2>Ship {selectedOrder.orderNumber}</h2>
              <p>
                {selectedOrder.customer?.name ?? "Customer"} — select
                quantities and the warehouse/bin to ship from.
              </p>
            </div>

            <button
              type="button"
              className="secondary-button"
              onClick={closeShipment}
              disabled={saving}
            >
              Cancel
            </button>
          </div>

          <form
            className="form-grid create-form"
            onSubmit={createShipment}
          >
            <label>
              Shipment Number
              <input
                value={shipmentNumber}
                onChange={(event) =>
                  setShipmentNumber(event.target.value)
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
                required
                disabled={!warehouseId || loadingMasters}
              >
                <option value="">Select bin</option>

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
                placeholder="Optional shipment notes"
              />
            </label>

            <div style={{ gridColumn: "1 / -1" }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Ordered</th>
                      <th>Shipped</th>
                      <th>Remaining</th>
                      <th>Ship Now</th>
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
                          <td>{Number(line.shippedQty)}</td>
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
                {saving ? "Posting Shipment..." : "Post Shipment"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Sales Orders</h2>
            <p>Orders available for review and shipment.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {salesOrders.map((order) => {
                const canShip =
                  (order.status === "APPROVED" ||
                    order.status === "PARTIALLY_SHIPPED") &&
                  (order.lines ?? []).some(
                    (line) => remainingQuantity(line) > 0,
                  );

                return (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.orderNumber}</strong>
                    </td>

                    <td>{order.customer?.name ?? "—"}</td>

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
                      {canShip ? (
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => openShipment(order)}
                        >
                          Ship
                        </button>
                      ) : order.status === "SHIPPED" ? (
                        invoiceOrderId === order.id ? (
                          <div
                            style={{
                              display: "flex",
                              gap: "6px",
                              alignItems: "center",
                            }}
                          >
                            <input
                              value={invoiceNumber}
                              onChange={(event) =>
                                setInvoiceNumber(event.target.value)
                              }
                              placeholder="INV-001"
                              style={{ minWidth: "130px" }}
                              disabled={saving}
                            />

                            <button
                              type="button"
                              className="primary-button"
                              onClick={() =>
                                void createInvoice(order)
                              }
                              disabled={saving}
                            >
                              {saving ? "Creating..." : "Create"}
                            </button>

                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                setInvoiceOrderId("");
                                setInvoiceNumber("");
                                setError("");
                              }}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setInvoiceOrderId(order.id);
                              setInvoiceNumber(
                                `INV-${new Date()
                                  .toISOString()
                                  .slice(0, 10)
                                  .replaceAll("-", "")}-${order.orderNumber}`,
                              );
                              setError("");
                            }}
                          >
                            Invoice
                          </button>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}

              {salesOrders.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      No sales orders found.
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
