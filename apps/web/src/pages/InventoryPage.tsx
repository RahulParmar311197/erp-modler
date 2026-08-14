type Item = {
  id: string;
  sku: string;
  name: string;
  active?: boolean;
  baseUom?: {
    code?: string;
    name?: string;
  } | null;
};

type Warehouse = {
  id: string;
  code: string;
  name: string;
};

type StockBalance = {
  id: string;
  itemId: string;
  warehouseId: string;
  binId?: string | null;
  quantity: number | string;
};

type StockMovement = {
  id: string;
  movementType?: string;
  quantity: number | string;
  createdAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
};

type InventoryPageProps = {
  items: Item[];
  warehouses: Warehouse[];
  stockBalances: StockBalance[];
  stockMovements: StockMovement[];
};

export function InventoryPage({
  items,
  warehouses,
  stockBalances,
  stockMovements,
}: InventoryPageProps) {
  const totalQuantity = stockBalances.reduce(
    (sum, balance) => sum + Number(balance.quantity),
    0,
  );

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">INVENTORY</div>
            <h2>Inventory Overview</h2>
            <p>Items, warehouses, stock balances and recent movements.</p>
          </div>
        </div>

        <div className="cards">
          <div className="card">
            <span>Items</span>
            <strong>{items.length}</strong>
          </div>

          <div className="card">
            <span>Warehouses</span>
            <strong>{warehouses.length}</strong>
          </div>

          <div className="card">
            <span>Stock Records</span>
            <strong>{stockBalances.length}</strong>
          </div>

          <div className="card">
            <span>Total Quantity</span>
            <strong>{totalQuantity.toLocaleString("en-IN")}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Stock Balances</h2>
            <p>Current inventory quantities by item and warehouse.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Warehouse</th>
                <th>Quantity</th>
              </tr>
            </thead>

            <tbody>
              {stockBalances.map((balance) => {
                const item = items.find((row) => row.id === balance.itemId);
                const warehouse = warehouses.find(
                  (row) => row.id === balance.warehouseId,
                );

                return (
                  <tr key={balance.id}>
                    <td>
                      <strong>{item?.name ?? "—"}</strong>
                    </td>
                    <td>{item?.sku ?? "—"}</td>
                    <td>{warehouse?.name ?? warehouse?.code ?? "—"}</td>
                    <td>
                      {Number(balance.quantity).toLocaleString("en-IN")}
                    </td>
                  </tr>
                );
              })}

              {stockBalances.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">No stock balances found.</div>
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
            <h2>Recent Stock Movements</h2>
            <p>Latest inventory movement activity.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Warehouse</th>
                <th>Movement</th>
                <th>Quantity</th>
                <th>Date</th>
              </tr>
            </thead>

            <tbody>
              {stockMovements.slice(0, 10).map((movement) => (
                <tr key={movement.id}>
                  <td>{movement.item?.name ?? "—"}</td>
                  <td>
                    {movement.warehouse?.name ??
                      movement.warehouse?.code ??
                      "—"}
                  </td>
                  <td>
                    <span
                      className={`status ${(movement.movementType ?? "movement").toLowerCase()}`}
                    >
                      {(movement.movementType ?? "MOVEMENT").replaceAll(
                        "_",
                        " ",
                      )}
                    </span>
                  </td>
                  <td>{Number(movement.quantity).toLocaleString("en-IN")}</td>
                  <td>
                    {new Date(movement.createdAt).toLocaleDateString("en-IN")}
                  </td>
                </tr>
              ))}

              {stockMovements.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">No stock movements found.</div>
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
