import { NextRequest, NextResponse } from 'next/server';
import { fetchPakistanPostTracking } from '@/lib/pakpost';
import { getParcelByAliasOrId } from '@/lib/config';
import { generateAuditCertificate } from '@/lib/certificate';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const alias = searchParams.get('alias');
  const id = searchParams.get('id');
  const format = searchParams.get('format') || 'json';

  let targetId = (id || '').trim().toUpperCase();

  if (alias) {
    const parcel = await getParcelByAliasOrId(alias);
    if (parcel) {
      targetId = parcel.id;
    }
  }

  if (!targetId) {
    return NextResponse.json(
      { error: 'Tracking ID or alias is required' },
      { status: 400 }
    );
  }

  const rawResult = await fetchPakistanPostTracking(targetId);
  if (!rawResult.found) {
    return NextResponse.json(
      { error: 'Parcel not found or no tracking checkpoints recorded.' },
      { status: 404 }
    );
  }

  const cert = generateAuditCertificate(rawResult);

  if (format === 'html' || format === 'print') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Carrier Verification Certificate - ${cert.trackingNo}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #fafafa; color: #111; padding: 40px; margin: 0; font-size: 13px; line-height: 1.5; }
    .card { max-width: 760px; margin: 0 auto; background: #fff; border: 1px solid #ddd; padding: 36px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; }
    h1 { margin: 0; font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .sub { color: #666; font-size: 11px; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; font-size: 12px; background: #f6f6f6; padding: 16px; border-radius: 6px; }
    .grid div b { display: block; color: #555; text-transform: uppercase; font-size: 10px; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
    th { text-align: left; padding: 8px 10px; background: #f0f0f0; border-bottom: 1px solid #ccc; font-size: 10px; text-transform: uppercase; }
    td { padding: 8px 10px; border-bottom: 1px solid #eee; }
    .sha { word-break: break-all; font-family: monospace; font-size: 10px; color: #666; background: #eee; padding: 6px 10px; border-radius: 4px; margin-top: 24px; }
    .footer { margin-top: 24px; font-size: 10px; color: #777; border-top: 1px solid #eee; padding-top: 12px; }
    @media print { body { padding: 0; background: #fff; } .card { border: none; box-shadow: none; padding: 0; } button { display: none; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        <h1>Postal Carrier Verification Certificate</h1>
        <div class="sub">Pakistan Post EMTTS & UPU Bilateral Telecommunication Record</div>
      </div>
      <div style="text-align: right;">
        <div style="font-family: monospace; font-weight: bold;">${cert.certificateId}</div>
        <div class="sub">Issued: ${new Date(cert.issuedAt).toUTCString()}</div>
      </div>
    </div>

    <div class="grid">
      <div><b>Tracking Number</b> ${cert.trackingNo}</div>
      <div><b>Carrier Telemetry</b> ${cert.carrier}</div>
      <div><b>Origin / Destination</b> ${cert.summary.origin} &rarr; ${cert.summary.destination}</div>
      <div><b>Latest Recorded Status</b> ${cert.summary.status}</div>
      ${cert.dispatchRoute ? `<div style="grid-column: span 2;"><b>UPU Postal Dispatch Corridor</b> ${cert.dispatchRoute.originExchange} &rarr; ${cert.dispatchRoute.destinationExchange} (${cert.dispatchRoute.lane})</div>` : ''}
    </div>

    <div style="font-weight: bold; text-transform: uppercase; font-size: 11px; margin-top: 20px;">
      Bilateral Chronological Audit Log (${cert.events.length} verified events)
    </div>
    <table>
      <thead>
        <tr>
          <th>Date & Time (PKT)</th>
          <th>Location</th>
          <th>Checkpoint Status</th>
          <th>Carrier</th>
        </tr>
      </thead>
      <tbody>
        ${cert.events.map((e) => `
          <tr>
            <td style="white-space: nowrap;">${e.date} ${e.time ? e.time : ''}</td>
            <td>${e.location}</td>
            <td style="font-weight: 500;">${e.status}</td>
            <td><span style="font-family: monospace; font-size: 10px; background: #e8e8e8; padding: 2px 5px; border-radius: 3px;">${e.carrier}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="sha">
      <b>SHA-256 Digest Integrity Proof:</b><br/>
      ${cert.sha256Digest}
    </div>

    <div class="footer">
      ${cert.legalNotice}
      <div style="margin-top: 16px; text-align: center;">
        <button onclick="window.print()" style="padding: 8px 16px; font-family: monospace; font-size: 11px; cursor: pointer; border: 1px solid #111; background: #111; color: #fff; border-radius: 4px;">Print / Save as PDF</button>
      </div>
    </div>
  </div>
</body>
</html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return NextResponse.json(cert, { status: 200 });
}
