import React, { useState } from 'react';

export default function GoodsReceiptEntry() {
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [lines, setLines] = useState([{ purchaseOrderLineId: '', itemId: '', warehouseId: '', quantity: '' }]);

  function addLine() {
    setLines([...lines, { purchaseOrderLineId: '', itemId: '', warehouseId: '', quantity: '' }]);
  }

  function updateLine(i: number, key: string, value: string) {
    const copy = [...lines];
    // @ts-ignore
    copy[i][key] = value;
    setLines(copy);
  }

  async function receive() {
    const payload = {
      purchaseOrderId,
      lines: lines.map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, itemId: l.itemId, warehouseId: l.warehouseId, quantity: Number(l.quantity || 0) })),
    };

    const res = await fetch('/api/receiving/goods-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    alert('GR Created: ' + (data?.data?.receiptNumber ?? data?.data?.id ?? 'unknown'));
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Goods Receipt (minimal)</h2>
      <div>
        <label>PurchaseOrderId:</label>
        <input value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)} />
      </div>
      <table>
        <thead>
          <tr>
            <th>PO Line Id</th>
            <th>ItemId</th>
            <th>WarehouseId</th>
            <th>Quantity</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td>
                <input value={line.purchaseOrderLineId} onChange={(e) => updateLine(i, 'purchaseOrderLineId', e.target.value)} />
              </td>
              <td>
                <input value={line.itemId} onChange={(e) => updateLine(i, 'itemId', e.target.value)} />
              </td>
              <td>
                <input value={line.warehouseId} onChange={(e) => updateLine(i, 'warehouseId', e.target.value)} />
              </td>
              <td>
                <input value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addLine}>Add line</button>
      <button onClick={receive}>Receive GR</button>
    </div>
  );
}
