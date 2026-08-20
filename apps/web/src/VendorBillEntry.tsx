import React, { useState } from 'react';

export default function VendorBillEntry() {
  const [organizationId, setOrganizationId] = useState('org-1');
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState([{ itemId: '', description: '', quantity: '', unitPrice: '' }]);

  function addLine() {
    setLines([...lines, { itemId: '', description: '', quantity: '', unitPrice: '' }]);
  }

  function updateLine(i: number, key: string, value: string) {
    const copy = [...lines];
    // @ts-ignore
    copy[i][key] = value;
    setLines(copy);
  }

  async function saveBill() {
    const payload = {
      organizationId,
      supplierId,
      lines: lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0) })),
    };

    const res = await fetch('/api/purchasing/vendor-bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    alert('Vendor Bill Created: ' + (data?.data?.billNumber ?? data?.data?.id ?? 'unknown'));
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Vendor Bill (minimal)</h2>
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
            <th>Description</th>
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
                <input value={line.description} onChange={(e) => updateLine(i, 'description', e.target.value)} />
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
      <button onClick={saveBill}>Save Bill</button>
    </div>
  );
}
