import React, { useState } from 'react';

export default function ShipmentEntry() {
  const [salesOrderId, setSalesOrderId] = useState('');
  const [lines, setLines] = useState([{ salesOrderLineId: '', itemId: '', warehouseId: '', quantity: '' }]);
  function addLine() { setLines([...lines, { salesOrderLineId: '', itemId: '', warehouseId: '', quantity: '' }]); }
  function updateLine(i:number,key:string,value:string){ const copy=[...lines]; // @ts-ignore copy[i][key]=value; setLines(copy); }
  async function ship(){ const payload={ salesOrderId, lines: lines.map(l=>({ salesOrderLineId: l.salesOrderLineId, itemId: l.itemId, warehouseId: l.warehouseId, quantity: Number(l.quantity||0) })) }; const res=await fetch('/api/sales/shipments',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); const data=await res.json(); alert('Shipment Created: '+(data?.data?.shipmentNumber ?? data?.data?.id ?? 'unknown')); }
  return (<div style={{padding:20}}><h2>Shipment (minimal)</h2><div><label>SalesOrderId:</label><input value={salesOrderId} onChange={(e)=>setSalesOrderId(e.target.value)} /></div><table><thead><tr><th>SO Line Id</th><th>ItemId</th><th>WarehouseId</th><th>Quantity</th></tr></thead><tbody>{lines.map((line,i)=>(<tr key={i}><td><input value={line.salesOrderLineId} onChange={(e)=>updateLine(i,'salesOrderLineId',e.target.value)} /></td><td><input value={line.itemId} onChange={(e)=>updateLine(i,'itemId',e.target.value)} /></td><td><input value={line.warehouseId} onChange={(e)=>updateLine(i,'warehouseId',e.target.value)} /></td><td><input value={line.quantity} onChange={(e)=>updateLine(i,'quantity',e.target.value)} /></td></tr>))}</tbody></table><button onClick={addLine}>Add line</button><button onClick={ship}>Create Shipment</button></div>);
}
