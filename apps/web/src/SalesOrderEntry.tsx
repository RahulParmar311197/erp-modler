import React, { useState } from 'react';

export default function SalesOrderEntry() {
  const [organizationId, setOrganizationId] = useState('org-1');
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState([{ itemId: '', uomId: '', quantity: '', unitPrice: '' }]);

  function addLine() { setLines([...lines, { itemId: '', uomId: '', quantity: '', unitPrice: '' }]); }
  function updateLine(i: number, key: string, value: string) { const copy = [...lines]; // @ts-ignore copy[i][key] = value; setLines(copy); }

  async function saveSO() {
    const payload = { organizationId, customerId, lines: lines.map(l => ({ itemId: l.itemId, uomId: l.uomId, quantity: Number(l.quantity||0), unitPrice: Number(l.unitPrice||0) })) };
    const res = await fetch('/api/sales/orders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json(); alert('SO Created: ' + (data?.data?.orderNumber ?? data?.data?.id ?? 'unknown'));
  }

  return (
    <div style={{padding:20}}>
      <h2>Sales Order (minimal)</h2>
      <div><label>OrganizationId:</label><input value={organizationId} onChange={(e)=>setOrganizationId(e.target.value)} /></div>
      <div><label>CustomerId:</label><input value={customerId} onChange={(e)=>setCustomerId(e.target.value)} /></div>
      <table><thead><tr><th>ItemId</th><th>UoM</th><th>Quantity</th><th>Unit Price</th></tr></thead>
      <tbody>{lines.map((line,i)=>(<tr key={i}><td><input value={line.itemId} onChange={(e)=>updateLine(i,'itemId',e.target.value)} /></td><td><input value={line.uomId} onChange={(e)=>updateLine(i,'uomId',e.target.value)} /></td><td><input value={line.quantity} onChange={(e)=>updateLine(i,'quantity',e.target.value)} /></td><td><input value={line.unitPrice} onChange={(e)=>updateLine(i,'unitPrice',e.target.value)} /></td></tr>))}</tbody></table>
      <button onClick={addLine}>Add line</button>
      <button onClick={saveSO}>Save SO</button>
    </div>
  );
}
