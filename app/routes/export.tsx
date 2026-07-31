import { useLoaderData } from "react-router";
import { useState } from "react";
import { getDashboardStats } from "../lib/db-operations.server";
import { DownloadCloud, FileJson, CheckCircle2, Archive, Loader2 } from "lucide-react";

export async function loader() {
  const stats = await getDashboardStats();
  return { totals: stats.totals };
}

export default function ExportPage() {
  const { totals } = useLoaderData<typeof loader>();
  const [isExporting, setIsExporting] = useState(false);

  const handleDownloadClick = () => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
    }, 2500);
  };

  const exportFiles = [
    { name: "country.json", title: "Ülke Tanımları", count: totals.countries },
    { name: "city.json", title: "Şehirler & Bounding Box", count: totals.cities },
    { name: "agency.json", title: "Ulaşım Ajansları", count: totals.agencies },
    { name: "fare.json", title: "Ücret & Bilet Tipleri", count: totals.fares },
    { name: "holiday.json", title: "Resmi Tatil Takvimi", count: totals.holidays },
    { name: "route.json", title: "Hatlar / Rotalar", count: totals.routes },
    { name: "stop.json", title: "Duraklar & Platformlar", count: totals.stops },
    { name: "route_stop.json", title: "Hat-Durak Sıralaması", count: totals.routes },
    { name: "shape.json", title: "Güzergah Polylines", count: totals.shapes },
    { name: "trip.json", title: "Somut Seferler", count: totals.trips },
    { name: "stop_time.json", title: "Durak Kalkış Saatleri", count: totals.stop_times },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Veri Dışa Aktarımı (Export)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Veritabanındaki tüm veriyi 11 TransitJSON şemasına tam uyumlu olacak şekilde tek bir `.zip` arşivinde indirin.
        </p>
      </div>

      {/* Exporting Progress Alert */}
      {isExporting && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-center gap-3 text-xs text-blue-900 animate-pulse">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
          <div>
            <span className="font-bold text-sm block">Zip Paketi Hazırlanıyor...</span>
            <span>Veritabanındaki 11 tablo JSON formatında taranıp `.zip` arşivine sıkıştırılıyor. İndirme birazdan başlayacak.</span>
          </div>
        </div>
      )}

      {/* Main Download Card */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-xs">
              <Archive className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">TransitJSON Zip Arşivi Paketle</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tüm 11 dosya otomatik JSON formatına dönüştürülüp sıkıştırılır.
              </p>
            </div>
          </div>

          <a
            href="/api/export-zip"
            download="transitjson_export.zip"
            onClick={handleDownloadClick}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl shadow-xs transition transform active:scale-95"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Hazırlanıyor...</span>
              </>
            ) : (
              <>
                <DownloadCloud className="w-5 h-5" />
                <span>Tüm Veriyi .ZIP Olarak İndir</span>
              </>
            )}
          </a>
        </div>

        {/* File Preview Grid */}
        <div className="pt-4 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            Paketlenecek 11 Dosya İçeriği
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {exportFiles.map((file) => (
              <div
                key={file.name}
                className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <FileJson className="w-5 h-5 text-blue-600" />
                  <div>
                    <span className="font-bold text-slate-900 block font-mono">{file.name}</span>
                    <span className="text-[11px] text-slate-500">{file.title}</span>
                  </div>
                </div>
                <div className="text-right font-semibold text-slate-700">
                  {Number(file.count).toLocaleString("tr-TR")} kayıt
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
