import React, { useState } from 'react';

export default function PurchaseOrderEntry() {
  const [lines, setLines] = useState([{ itemId: '', uomId: '', quantity: '', unitPrice: '' }]);
  const [supplierId, setSupplierId] = useState('');
  const [organizationId, setOrganizationId] = useState('org-1');

  function addLine() {
    setLines([...lines, { itemId: '', uomId: '', quantity: '', unitPrice: '' }]);
  }

  function updateLine(i: number, key: string, value: string) {
    const copy = [...lines];
    // @ts-ignore
    copy[i][key] = value;
    setLines(copy);
  }

  async function savePO() {
    const payload = {
      organizationId,
      supplierId,
      lines: lines.map((l) => ({ itemId: l.itemId, uomId: l.uomId, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0) })),
    };

    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    alert('PO Created: ' + (data?.data?.poNumber ?? data?.data?.id ?? 'unknown'));
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Purchase Order (minimal)</h2>
      <div>
        <label>OrganizationId:</label>
        <input value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} />
      </div>
      <div>
        <label>SupplierId:</label>
        <input value={supplierId} onChange={(e) => setSupplierId(e.target.value)} />
      </div>

      <table>
        <thead>
          <tr>
            <th>ItemId</th>
            <th>UoM</th>
            <th>Quantity</th>
            <th>Unit Price</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td>
                <input value={line.itemId} onChange={(e) => updateLine(i, 'itemId', e.target.value)} />
              </td>
              <td>
                <input value={line.uomId} onChange={(e) => updateLine(i, 'uomId', e.target.value)} />
              </td>
              <td>
                <input value={line.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)} />
              </td>
              <td>
                <input value={line.unitPrice} onChange={(e) => updateLine(i, 'unitPrice', e.target.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addLine}>Add line</button>
      <button onClick={savePO}>Save PO</button>
    </div>
  );
}
