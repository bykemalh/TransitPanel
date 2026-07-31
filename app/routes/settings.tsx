import { useLoaderData } from "react-router";
import { testDbConnection } from "../lib/db.server";
import { Database, Server, Map, Shield, CheckCircle2, AlertCircle } from "lucide-react";

export async function loader() {
  const dbStatus = await testDbConnection();
  return { dbStatus };
}

export default function SettingsPage() {
  const { dbStatus } = useLoaderData<typeof loader>();

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sistem Ayarları</h1>
        <p className="text-sm text-slate-500 mt-1">
          Veritabanı bağlantısı, harita sunucusu ve temel sistem yapılandırması.
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Database Status Box */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-slate-900 text-base">PostgreSQL / PostGIS Veritabanı</h3>
            </div>
            {dbStatus.success ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-emerald-700 bg-emerald-100">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Bağlı & Çalışıyor</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-rose-700 bg-rose-100">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Bağlantı Hatası</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="text-slate-500 font-medium">Sunucu Adresi</span>
              <p className="font-mono font-bold text-slate-900">45.143.11.184:5435</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="text-slate-500 font-medium">Veritabanı Adı</span>
              <p className="font-mono font-bold text-slate-900">postgres (postgis/postgis:16-3.4)</p>
            </div>
          </div>

          {dbStatus.success && (
            <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
              <span className="text-slate-500 font-medium">PostGIS Versiyon Detayı</span>
              <p className="font-mono text-[11px] text-slate-700 truncate">{dbStatus.postgis}</p>
            </div>
          )}
        </div>

        {/* Map Style Settings */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
            <Map className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-slate-900 text-base">Harita Sunucu Yapılandırması</h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Varsayılan Harita Stili (MapLibre Vector OSM)
              </label>
              <input
                type="text"
                readOnly
                value="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-slate-600"
              />
            </div>
            <p className="text-slate-500">
              Uygulama MapLibre GL vektör haritası ile varsayılan olarak Positron Light temasını kullanır.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
