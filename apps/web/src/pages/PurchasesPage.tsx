type Supplier = {
  id: string;
  code: string;
  name: string;
};

type PurchaseOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  supplier?: Supplier | null;
  totalAmount?: number | string;
};

type PurchasesPageProps = {
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
};

export function PurchasesPage({
  suppliers,
  purchaseOrders,
}: PurchasesPageProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">PURCHASES</div>
          <h2>Purchase Orders</h2>
          <p>Supplier orders and purchasing activity.</p>
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
            </tr>
          </thead>

          <tbody>
            {purchaseOrders.map((order) => (
              <tr key={order.id}>
                <td>
                  <strong>{order.orderNumber}</strong>
                </td>

                <td>{order.supplier?.name ?? "—"}</td>

                <td>
                  {new Date(order.orderDate).toLocaleDateString("en-IN")}
                </td>

                <td>
                  ₹{Number(order.totalAmount ?? 0).toLocaleString("en-IN")}
                </td>

                <td>
                  <span className={`status ${order.status.toLowerCase()}`}>
                    {order.status.replaceAll("_", " ")}
                  </span>
                </td>
              </tr>
            ))}

            {purchaseOrders.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">No purchase orders found.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
