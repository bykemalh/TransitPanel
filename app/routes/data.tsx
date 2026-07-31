import { useLoaderData, useSearchParams, Form, useSubmit, useNavigation, useActionData } from "react-router";
import { useState } from "react";
import { getEntityData, deleteEntityItem, executeImportPayload } from "../lib/db-operations.server";
import type { EntityName } from "../lib/types";
import {
  Search,
  Trash2,
  Edit,
  Plus,
  ChevronLeft,
  ChevronRight,
  Database,
  X,
  Check,
  Code,
  Loader2,
  AlertOctagon,
} from "lucide-react";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const activeTab = (url.searchParams.get("tab") as EntityName) || "country";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const search = url.searchParams.get("q") || "";

  const entityData = await getEntityData(activeTab, page, 20, search);

  return {
    activeTab,
    entityData,
    search,
  };
}

export async function action({ request }: { request: Request }) {
  try {
    const formData = await request.formData();
    const intent = formData.get("intent") as string;
    const tab = formData.get("tab") as EntityName;

    if (intent === "delete") {
      const keysRaw = formData.get("keys") as string;
      const keys = JSON.parse(keysRaw);
      await deleteEntityItem(tab, keys);
      return { success: true, message: "Kayıt veritabanından silindi." };
    }

    if (intent === "save") {
      const jsonRaw = formData.get("json") as string;
      const parsedItem = JSON.parse(jsonRaw);
      await executeImportPayload({ [tab]: [parsedItem] }, "overwrite");
      return { success: true, message: "Kayıt veritabanına kaydedildi." };
    }

    return { success: false, message: "Bilinmeyen işlem." };
  } catch (err: any) {
    console.error("Data CRUD Action Error:", err);
    return {
      success: false,
      message: err.message || "Veritabanı işleminde bir hata oluştu.",
      detail: err.detail || err.hint || (err.code ? `PostgreSQL Hata Kodu: ${err.code}` : undefined),
    };
  }
}

export default function DataManagementPage() {
  const { activeTab, entityData, search } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const submit = useSubmit();
  const navigation = useNavigation();

  const isLoadingData = navigation.state === "loading";
  const isSubmitting = navigation.state === "submitting";
  const activeIntent = navigation.formData?.get("intent");

  const [editModalItem, setEditModalItem] = useState<any | null>(null);
  const [editJsonText, setEditJsonText] = useState<string>("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const tabs: { id: EntityName; label: string }[] = [
    { id: "country", label: "Ülkeler" },
    { id: "city", label: "Şehirler" },
    { id: "agency", label: "Ajanslar" },
    { id: "fare", label: "Ücretler" },
    { id: "holiday", label: "Tatiller" },
    { id: "route", label: "Hatlar (Routes)" },
    { id: "stop", label: "Duraklar (Stops)" },
    { id: "route_stop", label: "Hat-Duraklar" },
    { id: "shape", label: "Rota Çizgileri" },
    { id: "trip", label: "Seferler" },
    { id: "stop_time", label: "Saatler" },
  ];

  const handleTabChange = (tabId: EntityName) => {
    setSearchParams({ tab: tabId, page: "1", q: search });
  };

  const handlePageChange = (newPage: number) => {
    setSearchParams({ tab: activeTab, page: String(newPage), q: search });
  };

  const handleSearchChange = (term: string) => {
    setSearchParams({ tab: activeTab, page: "1", q: term });
  };

  const openEditModal = (item?: any) => {
    const templateItem = item || getEmptyTemplate(activeTab);
    setEditModalItem(templateItem);
    setEditJsonText(JSON.stringify(templateItem, null, 2));
    setJsonError(null);
  };

  const handleSaveModal = () => {
    try {
      const parsed = JSON.parse(editJsonText);
      const formData = new FormData();
      formData.append("intent", "save");
      formData.append("tab", activeTab);
      formData.append("json", JSON.stringify(parsed));
      submit(formData, { method: "post" });
      setEditModalItem(null);
    } catch (err: any) {
      setJsonError("Geçersiz JSON formatı: " + err.message);
    }
  };

  const handleDelete = (item: any) => {
    if (!confirm("Bu kaydı silmek istediğinize emin misiniz?")) return;
    const keys = getPrimaryKeyObject(activeTab, item);
    const formData = new FormData();
    formData.append("intent", "delete");
    formData.append("tab", activeTab);
    formData.append("keys", JSON.stringify(keys));
    submit(formData, { method: "post" });
  };

  const totalPages = Math.ceil(entityData.total / entityData.limit) || 1;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Veri Yönetimi (CRUD)</h1>
          <p className="text-sm text-slate-500 mt-1">
            Veritabanındaki 11 transit tablosunu doğrudan görüntüleyin, düzenleyin veya yeni kayıt ekleyin.
          </p>
        </div>
        <button
          onClick={() => openEditModal()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-xl shadow-xs transition"
        >
          <Plus className="w-4 h-4" />
          <span>Yeni {tabs.find((t) => t.id === activeTab)?.label} Ekle</span>
        </button>
      </div>

      {/* Action Error Alert Banner */}
      {actionData && !actionData.success && (
        <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-900 space-y-2 animate-in fade-in duration-200 shadow-md">
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-6 h-6 text-rose-600 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-sm text-rose-900">İşlem Başarısız Oldu!</h4>
              <p className="text-xs font-semibold text-rose-700 mt-0.5">{actionData.message}</p>
            </div>
          </div>
          {actionData.detail && (
            <div className="p-2.5 bg-rose-100/90 rounded-xl text-xs font-mono text-rose-950 overflow-x-auto border border-rose-200">
              <span>Detay: {actionData.detail}</span>
            </div>
          )}
        </div>
      )}

      {/* Loading Status Indicator Banner */}
      {(isLoadingData || isSubmitting) && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2 text-xs font-semibold text-blue-900">
          <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
          <span>
            {isSubmitting && activeIntent === "delete" && "Kayıt siliniyor..."}
            {isSubmitting && activeIntent === "save" && "Kayıt veritabanına işleniyor..."}
            {isLoadingData && "Tablo verileri yükleniyor..."}
          </span>
        </div>
      )}

      {/* Tabs Navigation Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-slate-200">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              disabled={isLoadingData}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition flex items-center gap-1.5 ${
                isActive
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80"
              }`}
            >
              {isActive && isLoadingData && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center justify-between gap-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Arama yapın..."
            defaultValue={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="text-xs text-slate-500 font-medium">
          Toplam <span className="font-bold text-slate-900">{entityData.total}</span> kayıt bulundu
        </div>
      </div>

      {/* Main Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden relative">
        <div className="overflow-x-auto">
          {entityData.data.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              Bu kategoride gösterilecek veri bulunamadı.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                  {getTableHeaders(activeTab).map((h) => (
                    <th key={h} className="py-3 px-4">
                      {h}
                    </th>
                  ))}
                  <th className="py-3 px-4 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entityData.data.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition">
                    {getTableColumns(activeTab, row).map((val, i) => (
                      <td key={i} className="py-3 px-4 text-slate-800 font-medium max-w-xs truncate">
                        {val}
                      </td>
                    ))}
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => openEditModal(row)}
                        disabled={isSubmitting}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition"
                      >
                        <Edit className="w-3 h-3 text-blue-600" />
                        <span>Düzenle</span>
                      </button>
                      <button
                        onClick={() => handleDelete(row)}
                        disabled={isSubmitting}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md transition disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3 text-rose-600" />
                        <span>Sil</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs bg-slate-50/50">
          <span className="text-slate-500">
            Sayfa <span className="font-bold text-slate-900">{entityData.page}</span> / {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={entityData.page <= 1 || isLoadingData}
              onClick={() => handlePageChange(entityData.page - 1)}
              className="p-1.5 border border-slate-200 rounded-lg bg-white disabled:opacity-40 hover:bg-slate-50 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={entityData.page >= totalPages || isLoadingData}
              onClick={() => handlePageChange(entityData.page + 1)}
              className="p-1.5 border border-slate-200 rounded-lg bg-white disabled:opacity-40 hover:bg-slate-50 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Edit / Create JSON Modal */}
      {editModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white max-w-2xl w-full rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">
                  {tabs.find((t) => t.id === activeTab)?.label} Kaydını Düzenle
                </h3>
              </div>
              <button
                onClick={() => setEditModalItem(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              <p className="text-xs text-slate-500">
                JSON formatında düzenleyin ve doğrulayın:
              </p>
              <textarea
                value={editJsonText}
                onChange={(e) => setEditJsonText(e.target.value)}
                rows={14}
                className="w-full p-3 font-mono text-xs bg-slate-900 text-emerald-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {jsonError && <p className="text-xs font-semibold text-rose-600">{jsonError}</p>}
            </div>

            <div className="p-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50">
              <button
                onClick={() => setEditModalItem(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition"
              >
                İptal
              </button>
              <button
                onClick={handleSaveModal}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Kaydediliyor...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Kaydet & Güncelle</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helpers for table display
function getTableHeaders(entity: EntityName): string[] {
  switch (entity) {
    case "country": return ["Ülke Kodu", "Adı", "Güncellenme"];
    case "city": return ["City ID", "Slug", "Ülke ID", "Adı", "Zaman Dilimi", "Enlem/Boylam"];
    case "agency": return ["Agency ID", "Şehir ID", "Ajans Adı", "Telefon", "Web"];
    case "fare": return ["Fare ID", "Ajans ID", "Adı", "Fiyat", "Para Birimi"];
    case "holiday": return ["Tarih", "Ülke ID", "Adı", "Sefer Günü Uygulaması"];
    case "route": return ["Route ID", "Ajans ID", "Kod", "Adı", "Araç Türü", "Desen"];
    case "stop": return ["Stop ID", "Şehir ID", "Durak Adı", "Enlem/Boylam", "Erişilebilirlik"];
    case "route_stop": return ["Route ID", "Yön", "Sıra", "Stop ID", "İlk/Son Durak"];
    case "shape": return ["Shape ID", "Route ID", "Yön", "Koordinat Nokta Sayısı"];
    case "trip": return ["Trip ID", "Route ID", "Yön", "Servis Günü"];
    case "stop_time": return ["Trip ID", "Sıra", "Stop ID", "Kalkış Saati"];
  }
}

function getTableColumns(entity: EntityName, row: any): string[] {
  switch (entity) {
    case "country":
      return [row.country_id, row.name, new Date(row.updated_at).toLocaleDateString("tr-TR")];
    case "city":
      return [row.city_id, row.slug, row.country_id, row.name, row.timezone, `${row.lat}, ${row.lon}`];
    case "agency":
      return [row.agency_id, row.city_id, row.name, row.phone || "-", row.website || "-"];
    case "fare":
      return [row.fare_id, row.agency_id, row.name, String(row.price), row.currency];
    case "holiday":
      return [row.date ? new Date(row.date).toLocaleDateString("tr-TR") : "-", row.country_id, row.name, row.applies_as];
    case "route":
      return [row.route_id, row.agency_id, row.code || "-", row.name, row.vehicle_type, row.route_pattern];
    case "stop":
      return [row.stop_id, row.city_id, row.name, `${row.lat}, ${row.lon}`, row.wheelchair_accessible ? "Var ✅" : "Yok ❌"];
    case "route_stop":
      return [row.route_id, String(row.direction), String(row.sequence), row.stop_id, row.is_first_stop ? "İlk" : row.is_last_stop ? "Son" : "Ara"];
    case "shape":
      return [row.shape_id, row.route_id, String(row.direction), `${Array.isArray(row.coordinates) ? row.coordinates.length : 0} nokta`];
    case "trip":
      return [row.trip_id, row.route_id, String(row.direction), row.service_type];
    case "stop_time":
      return [row.trip_id, String(row.sequence), row.stop_id, row.departure_time || "-"];
  }
}

function getPrimaryKeyObject(entity: EntityName, item: any): Record<string, any> {
  switch (entity) {
    case "country": return { country_id: item.country_id };
    case "city": return { city_id: item.city_id };
    case "agency": return { agency_id: item.agency_id };
    case "fare": return { fare_id: item.fare_id };
    case "holiday": return { country_id: item.country_id, date: item.date };
    case "route": return { route_id: item.route_id };
    case "stop": return { stop_id: item.stop_id };
    case "route_stop": return { route_id: item.route_id, direction: item.direction, sequence: item.sequence };
    case "shape": return { shape_id: item.shape_id };
    case "trip": return { trip_id: item.trip_id };
    case "stop_time": return { trip_id: item.trip_id, sequence: item.sequence };
  }
}

function getEmptyTemplate(entity: EntityName): any {
  const now = new Date().toISOString();
  switch (entity) {
    case "country": return { country_id: "TR", name: "Türkiye", updated_at: now, source: "manual" };
    case "city": return { city_id: "BUR", slug: "bursa", country_id: "TR", name: "Bursa", timezone: "Europe/Istanbul", center: { lat: 40.19, lon: 29.06 }, default_zoom: 12, updated_at: now, source: "manual" };
    case "agency": return { agency_id: "BUR_AG", city_id: "BUR", name: "Burulaş", phone: "4441616", website: "https://www.burulas.com.tr", updated_at: now, source: "manual" };
    case "fare": return { fare_id: "BUR-tam", agency_id: "BUR_AG", name: "Tam Bilet", name_en: "Full Ticket", fare_type: "flat", price: 20, currency: "TRY", updated_at: now, source: "manual" };
    case "holiday": return { date: "2026-10-29", country_id: "TR", name: "Cumhuriyet Bayramı", applies_as: "sunday", updated_at: now, source: "manual" };
    case "route": return { route_id: "BUR-1", agency_id: "BUR_AG", name: "1/A Heykel - Şehir Hastanesi", code: "1A", color: "#2563eb", vehicle_type: "bus", route_pattern: "round_trip", stop_mode: "fixed", updated_at: now, source: "manual" };
    case "stop": return { stop_id: "BUR_ST_001", city_id: "BUR", name: "Heykel Duragi", lat: 40.183, lon: 29.061, location_type: "stop", wheelchair_accessible: true, updated_at: now, source: "manual" };
    case "route_stop": return { route_id: "BUR-1", direction: 1, stop_id: "BUR_ST_001", sequence: 1, is_first_stop: true, is_last_stop: false, updated_at: now, source: "manual" };
    case "shape": return { shape_id: "SHP_BUR_1_1", route_id: "BUR-1", direction: 1, coordinates: [{ lat: 40.183, lon: 29.061 }, { lat: 40.185, lon: 29.065 }], updated_at: now, source: "manual" };
    case "trip": return { trip_id: "TRIP_BUR_1_101", route_id: "BUR-1", direction: 1, service_type: "monday", updated_at: now, source: "manual" };
    case "stop_time": return { trip_id: "TRIP_BUR_1_101", stop_id: "BUR_ST_001", sequence: 1, departure_time: "07:30:00", updated_at: now, source: "manual" };
  }
}
