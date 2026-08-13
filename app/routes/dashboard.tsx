import { useLoaderData, Link } from "react-router";
import { getDashboardStats } from "../lib/db-operations.server";
import { formatName } from "../lib/types";
import {
  Globe,
  Building2,
  Bus,
  MapPin,
  Clock,
  CircleDollarSign,
  Calendar,
  Route as RouteIcon,
  UploadCloud,
  Map,
  ArrowRight,
  TrendingUp,
} from "lucide-react";

export async function loader() {
  const stats = await getDashboardStats();
  return { stats };
}

export default function Dashboard() {
  const { stats } = useLoaderData<typeof loader>();
  const { totals, cities, vehicleStats } = stats;

  const statCards = [
    { title: "Ülkeler", count: totals.countries, icon: Globe, color: "text-blue-600 bg-blue-50 border-blue-200" },
    { title: "Şehirler", count: totals.cities, icon: Building2, color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
    { title: "Ajanslar", count: totals.agencies, icon: Building2, color: "text-violet-600 bg-violet-50 border-violet-200" },
    { title: "Hatlar (Routes)", count: totals.routes, icon: Bus, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
    { title: "Duraklar (Stops)", count: totals.stops, icon: MapPin, color: "text-amber-600 bg-amber-50 border-amber-200" },
    { title: "Seferler (Trips)", count: totals.trips, icon: Clock, color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
    { title: "Kalkış Saatleri", count: totals.stop_times, icon: Clock, color: "text-sky-600 bg-sky-50 border-sky-200" },
    { title: "Ücretler", count: totals.fares, icon: CircleDollarSign, color: "text-teal-600 bg-teal-50 border-teal-200" },
    { title: "Resmi Tatiller", count: totals.holidays, icon: Calendar, color: "text-rose-600 bg-rose-50 border-rose-200" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Genel Bakış Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Sistemdeki transit veri ağı, şehirler, hatlar ve veritabanı istatistikleri.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/import"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition"
          >
            <UploadCloud className="w-4 h-4" />
            <span>JSON Yükle</span>
          </Link>
          <Link
            to="/map"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-xs transition"
          >
            <Map className="w-4 h-4 text-blue-600" />
            <span>Haritayı Aç</span>
          </Link>
        </div>
      </div>

      {/* Primary Key Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs hover:shadow-xs transition flex items-center justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{card.title}</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">
                  {Number(card.count).toLocaleString("tr-TR")}
                </h3>
              </div>
              <div className={`p-3 rounded-xl border ${card.color}`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Grid: City breakdown & Vehicle breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* City Breakdown Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 shadow-2xs p-5 flex flex-col">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Şehir Bazlı Hat ve Duraklar</h2>
              <p className="text-xs text-slate-500">Sistemde tanımlı şehirlerin kapsam durumları</p>
            </div>
            <Link to="/data" className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1">
              <span>Tüm Veriyi Gör</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto flex-1">
            {cities.length === 0 ? (
              <div className="py-12 text-center text-slate-500">
                <p className="text-sm">Henüz kayıtlı şehir veya veri bulunmamaktadır.</p>
                <Link
                  to="/import"
                  className="inline-block mt-3 text-xs font-semibold text-blue-600 hover:underline"
                >
                  JSON Dosyası Yükle &rarr;
                </Link>
              </div>
            ) : (
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-semibold text-slate-500 bg-slate-50/50">
                    <th className="py-2.5 px-3">Şehir Adı</th>
                    <th className="py-2.5 px-3">Ülke</th>
                    <th className="py-2.5 px-3 text-right">Hat Sayısı</th>
                    <th className="py-2.5 px-3 text-right">Durak Sayısı</th>
                    <th className="py-2.5 px-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cities.map((city) => (
                    <tr key={city.city_id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-3 font-medium text-slate-900">{formatName(city.city_name)}</td>
                      <td className="py-3 px-3 text-slate-600">{formatName(city.country_name)}</td>
                      <td className="py-3 px-3 text-right font-semibold text-blue-600">
                        {city.routes_count}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-amber-600">
                        {city.stops_count}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <Link
                          to={`/map?city=${city.city_id}`}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium hover:underline"
                        >
                          <span>Haritada Gör</span>
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Vehicle Stats */}
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-2xs p-5 flex flex-col">
          <div className="pb-4 mb-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Ulaşım Modları Dağılımı</h2>
            <p className="text-xs text-slate-500">Araç türlerine göre toplam hat sayıları</p>
          </div>

          <div className="space-y-3 flex-1">
            {vehicleStats.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">Araç türü verisi bulunmuyor.</p>
            ) : (
              vehicleStats.map((v) => (
                <div key={v.vehicle_type} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="capitalize font-medium text-slate-800">{v.vehicle_type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{v.count} hat</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Callout Info Box */}
          <div className="mt-6 p-4 rounded-xl bg-blue-50/80 border border-blue-100 text-xs text-blue-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <span>Veri Güncelliği</span>
            </div>
            <p className="text-blue-700 leading-relaxed">
              Tüm hat ve durak verileri PostGIS uzamsal indeksleri (`GEOGRAPHY`) ile optimize edilmiştir.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
