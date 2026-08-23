import { agencyConfig } from '@/config/agency';
import type {
  PdfExportOptions,
  RealTimeKpiData,
  Pilgrim,
  HajjPackage,
  HotelInventory,
  FlightLogistics,
  BusFleet,
  MutawwifGuide,
  FinancialSummary,
} from '@/types/kpi';

/* eslint-disable max-lines-per-function, complexity */
export function generateAndDownloadPdf(
  options: PdfExportOptions,
  kpiData: RealTimeKpiData,
  pilgrims: Pilgrim[],
  _packages: HajjPackage[],
  _hotels: HotelInventory[],
  _flights: FlightLogistics[],
  _buses: BusFleet[],
  _guides: MutawwifGuide[],
  financials: FinancialSummary
) {
  const isAr = options.lang === 'ar';
  const isFr = options.lang === 'fr';
  const dir = isAr ? 'rtl' : 'ltr';

  const fontStyle = isAr
    ? "font-family: 'Amiri', 'Tajawal', 'Traditional Arabic', sans-serif;"
    : "font-family: 'Tajawal', 'Inter', system-ui, sans-serif;";

  const formattedDate = new Date().toLocaleDateString(
    isAr ? 'ar-DZ' : isFr ? 'fr-DZ' : 'en-US',
    { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  );

  const titleText = isAr
    ? options.titleAr || 'التقرير التنفيذي الرسمي ومؤشرات الأداء - وكالة بوسالم للحج والعمرة'
    : isFr
    ? options.titleFr || 'Rapport Exécutif Officiel KPI - ${agencyConfig.name}'
    : options.title || 'Official Executive KPI Performance Audit Report - ${agencyConfig.name}';

  const subtitleText = isAr
    ? `تاريخ الإصدار: ${formattedDate} | الموسم: ${options.season.toUpperCase()}${agencyConfig.registrationNumber ? ` | ${agencyConfig.registrationNumber}` : ''}`
    : isFr
    ? `Date d'émission: ${formattedDate} | Saison: ${options.season.toUpperCase()}${agencyConfig.registrationNumber ? ` | ${agencyConfig.registrationNumber}` : ''}`
    : `Issue Date: ${formattedDate} | Season: ${options.season.toUpperCase()}${agencyConfig.registrationNumber ? ` | ${agencyConfig.registrationNumber}` : ''}`;

  const printableWindow = window.open('', '_blank', 'width=1100,height=900');
  if (!printableWindow) {
    alert('Please allow popups to generate the PDF report.');
    return;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html dir="${dir}" lang="${options.lang}">
    <head>
      <meta charset="utf-8" />
      <title>${titleText}</title>
      <style>
        
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          ${fontStyle}
          background: #ffffff;
          color: #2a1d13;
          padding: 40px;
          line-height: 1.5;
          font-size: 13px;
        }

        @media print {
          body { padding: 20px; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }

        .algeria-header {
          text-align: center;
          margin-bottom: 20px;
          border-bottom: 2px solid #c99a3e;
          padding-bottom: 15px;
        }

        .algeria-header h3 {
          font-family: 'Amiri', serif;
          font-size: 16px;
          color: #3f8a5b;
          font-weight: 700;
        }

        .header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 3px double #3f8a5b;
          padding-bottom: 20px;
          margin-bottom: 25px;
        }

        .agency-brand {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .logo-seal {
          width: 75px;
          height: 75px;
          border-radius: 50%;
          background: linear-gradient(135deg, #3f8a5b, #1f4830);
          color: #e0b65a;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          font-weight: bold;
          border: 3px solid #c99a3e;
          box-shadow: 0 4px 10px rgba(0,0,0,0.15);
        }

        .agency-title h1 {
          font-size: 24px;
          color: #163a26;
          font-weight: 900;
          margin-bottom: 4px;
        }

        .agency-title p {
          font-size: 12px;
          color: #7e522b;
        }

        .official-badge {
          text-align: ${dir === 'rtl' ? 'left' : 'right'};
          border-${dir === 'rtl' ? 'right' : 'left'}: 4px solid #c99a3e;
          padding-${dir === 'rtl' ? 'right' : 'left'}: 15px;
        }

        .report-title-card {
          background: linear-gradient(135deg, #fbf7f0, #f5ecdc);
          border: 1px solid #e8d6b8;
          border-radius: 12px;
          padding: 18px 22px;
          margin-bottom: 25px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .report-title-card h2 {
          font-size: 19px;
          color: #2a1d13;
          margin-bottom: 4px;
        }

        .report-title-card p {
          font-size: 12px;
          color: #7e522b;
        }

        .watermark {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-30deg);
          font-size: 70px;
          font-weight: bold;
          color: rgba(63, 138, 91, 0.05);
          pointer-events: none;
          white-space: nowrap;
          z-index: -1;
          font-family: 'Amiri', serif;
        }

        .section-title {
          font-size: 16px;
          font-weight: 800;
          color: #2e6e47;
          border-bottom: 2px solid #e8d6b8;
          padding-bottom: 6px;
          margin-top: 25px;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .grid-4 {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 20px;
        }

        .kpi-card {
          background: #fbf7f0;
          border: 1px solid #e8d6b8;
          border-radius: 10px;
          padding: 14px;
          text-align: center;
        }

        .kpi-card .val {
          font-size: 20px;
          font-weight: 900;
          color: #2e6e47;
          margin-top: 4px;
        }

        .kpi-card .lbl {
          font-size: 11px;
          color: #7e522b;
          text-transform: uppercase;
          font-weight: 700;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
          font-size: 12px;
        }

        th {
          background: #2e6e47;
          color: #ffffff;
          text-align: ${dir === 'rtl' ? 'right' : 'left'};
          padding: 10px 12px;
          font-weight: 700;
        }

        td {
          padding: 9px 12px;
          border-bottom: 1px solid #e8d6b8;
        }

        tr:nth-child(even) {
          background: #fbf7f0;
        }

        .status-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 700;
        }

        .status-green { background: #dcefe0; color: #1f4830; }
        .status-amber { background: #f5ecdc; color: #9d6a33; }

        .signature-block {
          margin-top: 40px;
          display: flex;
          justify-content: space-between;
          padding-top: 20px;
          border-top: 1px solid #e8d6b8;
        }

        .sig-box {
          text-align: center;
          width: 220px;
        }

        .sig-line {
          border-bottom: 1px dashed #c99a3e;
          margin-top: 45px;
          margin-bottom: 6px;
        }

        .print-btn {
          background: #3f8a5b;
          color: white;
          border: none;
          padding: 12px 28px;
          font-size: 14px;
          font-weight: 700;
          border-radius: 8px;
          cursor: pointer;
          margin-bottom: 20px;
          box-shadow: 0 4px 12px rgba(63, 138, 91, 0.3);
        }

        .print-btn:hover { background: #2e6e47; }
      </style>
    </head>
    <body>
      <div class="no-print" style="text-align: ${dir === 'rtl' ? 'left' : 'right'};">
        <button class="print-btn" onclick="window.print()">${isAr ? '🖨️ طباعة المحضر / التقرير الرسمـي (PDF)' : isFr ? '🖨️ Imprimer le Document Officiel (PDF)' : '🖨️ Print Official Report (PDF)'}</button>
      </div>

      <div class="algeria-header">
        <h3>الجمهورية الجزائرية الديمقراطية الشعبية</h3>
        <p style="font-size:12px; color:#5f3f28;">تقرير صادر عن الوكالة</p>
      </div>

      ${options.watermark ? `<div class="watermark">الديوان الوطني للحج والعمرة - الجزائر</div>` : ''}

      <div class="header-bar">
        <div class="agency-brand">
          <div class="logo-seal">🕋</div>
          <div class="agency-title">
            <h1>${agencyConfig.name}</h1>
            <p>${isAr ? `الجزائر${agencyConfig.wilaya ? ` • ${agencyConfig.wilaya}` : ''}${agencyConfig.registrationNumber ? ` • ${agencyConfig.registrationNumber}` : ''}` : `${agencyConfig.wilaya ? `${agencyConfig.wilaya} • ` : ''}Algeria${agencyConfig.registrationNumber ? ` • ${agencyConfig.registrationNumber}` : ''}`}</p>
          </div>
        </div>
        <div class="official-badge">
          <p style="font-weight:800; color:#2e6e47;">${isAr ? 'تقرير رسمي' : isFr ? 'DOCUMENT OFFICIEL' : 'OFFICIAL REPORT'}</p>
          <p style="font-size:11px; color:#7e522b;">REPORT-${Date.now().toString().slice(-6)}</p>
        </div>
      </div>

      <div class="report-title-card">
        <div>
          <h2>${titleText}</h2>
          <p>${subtitleText}</p>
        </div>
        <div style="text-align:${dir === 'rtl' ? 'left' : 'right'};">
          <span style="background:#c99a3e; color:#ffffff; padding:4px 12px; border-radius:6px; font-weight:800; font-size:11px;">
            🇩🇿 ${isAr ? 'إصدار رسمي' : isFr ? 'Édition officielle' : 'Official issue'}
          </span>
        </div>
      </div>

      ${
        options.includeExecutiveSummary
          ? `
          <div class="section-title">📊 ${isAr ? 'الملخص التنفيذي ومؤشرات الأداء للوفد الجزائري' : isFr ? 'Résumé Exécutif des KPI' : 'Executive Summary & Core KPIs'}</div>
          <div class="grid-4">
            <div class="kpi-card">
              <div class="lbl">${isAr ? 'إجمالي الحجاج' : isFr ? 'Total Pèlerins' : 'Total Pilgrims'}</div>
              <div class="val">${kpiData.totalPilgrims}</div>
            </div>
            <div class="kpi-card">
              <div class="lbl">${isAr ? 'المداخيل (بالدينار DZD)' : isFr ? 'Revenu (DZD)' : 'Revenue (DZD)'}</div>
              <div class="val">${(kpiData.totalRevenueDZD / 1000000).toFixed(2)}M DZD</div>
            </div>
            <div class="kpi-card">
              <div class="lbl">${isAr ? 'نسبة إشغال الفنادق' : isFr ? 'Occupation Hôtels' : 'Hotel Occupancy'}</div>
              <div class="val">${kpiData.occupancyRatePercent}%</div>
            </div>
            <div class="kpi-card">
              <div class="lbl">${isAr ? 'تأشيرات نسك الصادرة' : isFr ? 'Visas Délivrés' : 'Visa Clearance'}</div>
              <div class="val">${kpiData.visaApprovalRatePercent}%</div>
            </div>
          </div>
        `
          : ''
      }

      ${
        options.includePilgrimManifest
          ? `
          <div class="section-title">🕋 ${isAr ? 'قائمة الحجاج الجزائريين المسجلين (قرعة الحج 1447هـ)' : isFr ? 'Manifeste des Pèlerins Algériens' : 'Algerian Pilgrims Manifest'}</div>
          <table>
            <thead>
              <tr>
                <th>${isAr ? 'المرجع' : 'Ref'}</th>
                <th>${isAr ? 'اسم الحاج والمحرم' : isFr ? 'Nom Complet' : 'Full Name'}</th>
                <th>${isAr ? 'الولاية ومطار المغادرة' : isFr ? 'Wilaya & Aéroport' : 'Wilaya & Airport'}</th>
                <th>${isAr ? 'رقم جواز السفر' : isFr ? 'N° Passeport' : 'Passport No'}</th>
                <th>${isAr ? 'حالة التأشيرة' : isFr ? 'Statut Visa' : 'Visa Status'}</th>
                <th>${isAr ? 'المبلغ بالدينار (DZD)' : isFr ? 'Montant (DZD)' : 'Amount (DZD)'}</th>
              </tr>
            </thead>
            <tbody>
              ${pilgrims
                .slice(0, 15)
                .map(
                  (p) => `
                <tr>
                  <td><strong>${p.reference}</strong></td>
                  <td>
                    ${isAr ? p.fullNameAr || p.fullName : p.fullName}
                    ${p.mahramName ? `<br/><span style="font-size:10px; color:#7e522b;">👤 المحرم: ${p.mahramName}</span>` : ''}
                  </td>
                  <td>${p.wilaya || 'الجزائر العاصمة'} (${p.departureAirport || 'ALG'})</td>
                  <td><span style="font-family:monospace;">${p.passportNumber}</span></td>
                  <td><span class="status-pill status-${p.visaStatus === 'visa_issued' ? 'green' : 'amber'}">${p.visaStatus.toUpperCase()}</span></td>
                  <td><strong>${p.paidAmountDZD.toLocaleString()} DZD</strong></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `
          : ''
      }

      ${
        options.includeFinancials
          ? `
          <div class="section-title">💰 ${isAr ? 'التقرير المالي بالدينار الجزائري DZD والريال SAR' : isFr ? 'Bilan Financier DZD / SAR' : 'Financial Ledger (DZD & SAR)'}</div>
          <div class="grid-4">
            <div class="kpi-card">
              <div class="lbl">${isAr ? 'المبلغ المحصل' : 'Collected (DZD)'}</div>
              <div class="val">${(financials.collectedDZD / 1000000).toFixed(2)}M DZD</div>
            </div>
            <div class="kpi-card">
              <div class="lbl">${isAr ? 'المبالغ المتبقية' : 'Pending (DZD)'}</div>
              <div class="val" style="color:#9d6a33;">${(financials.pendingBalanceDZD / 1000000).toFixed(2)}M DZD</div>
            </div>
            <div class="kpi-card">
              <div class="lbl">${isAr ? 'تكاليف الجوية الجزائرية' : 'Air Algérie Cost'}</div>
              <div class="val">${(financials.flightExpensesSAR / 1000000).toFixed(2)}M SAR</div>
            </div>
            <div class="kpi-card">
              <div class="lbl">${isAr ? 'صافي الأرباح' : 'Net Profit'}</div>
              <div class="val" style="color:#2e6e47;">${(financials.netProfitDZD / 1000000).toFixed(2)}M DZD</div>
            </div>
          </div>
        `
          : ''
      }

      <div class="signature-block">
        <div class="sig-box">
          <p style="font-weight:800; color:#2e6e47;">${isAr ? 'مسؤول مكتب الحج بالوكالة' : 'Chef de Bureau Hajj'}</p>
          <div class="sig-line"></div>
          <p style="font-size:11px; color:#7e522b;">وكالة بوسالم - الجزائر</p>
        </div>
        <div class="sig-box">
          <p style="font-weight:800; color:#2e6e47;">${isAr ? 'إعداد الوكالة' : isFr ? 'Préparé par l’agence' : 'Prepared by the agency'}</p>
          <div class="sig-line"></div>
          <p style="font-size:11px; color:#7e522b;">ختم واعتماد السلطات</p>
        </div>
      </div>
    </body>
    </html>
  `;

  printableWindow.document.write(htmlContent);
  printableWindow.document.close();
}
