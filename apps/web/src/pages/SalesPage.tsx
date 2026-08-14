type Customer = {
  id: string;
  code: string;
  name: string;
};

type SalesOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  customer?: Customer | null;
  totalAmount?: number | string;
};

type SalesPageProps = {
  customers: Customer[];
  salesOrders: SalesOrder[];
};

export function SalesPage({ customers, salesOrders }: SalesPageProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">SALES</div>
          <h2>Sales Orders</h2>
          <p>Customer orders and sales pipeline.</p>
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
            </tr>
          </thead>

          <tbody>
            {salesOrders.map((order) => (
              <tr key={order.id}>
                <td>
                  <strong>{order.orderNumber}</strong>
                </td>

                <td>{order.customer?.name ?? "—"}</td>

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

            {salesOrders.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">No sales orders found.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
