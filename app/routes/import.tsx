import { useState, useRef } from "react";
import { useSubmit, useActionData } from "react-router";
import { analyzeImportPayload } from "../lib/db-operations.server";
import { detectEntityFromJSON, validateEntityItem } from "../lib/schemas";
import type { EntityName, ImportConflictAnalysis } from "../lib/types";
import {
  UploadCloud,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  PlusCircle,
  XCircle,
  ShieldCheck,
  Loader2,
  AlertOctagon,
  Clock,
  Database,
  BarChart3,
} from "lucide-react";

export async function action({ request }: { request: Request }) {
  try {
    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent === "analyze") {
      const payloadRaw = formData.get("payload") as string;
      const payload = JSON.parse(payloadRaw) as Partial<Record<EntityName, any[]>>;
      const analysis = await analyzeImportPayload(payload);
      return { type: "analysis", analysis, payload };
    }

    return { type: "error", message: "Geçersiz işlem isteği." };
  } catch (err: any) {
    console.error("Import Action Error:", err);
    return {
      type: "error",
      message: err.message || "Analiz sırasında bir hata oluştu.",
      detail: err.detail || err.hint,
    };
  }
}

export default function ImportPage() {
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ name: string; entity: EntityName | null; count: number; valid: boolean; errors: string[] }>
  >([]);
  const [parsedPayload, setParsedPayload] = useState<Partial<Record<EntityName, any[]>>>({});
  const [isProcessingLocal, setIsProcessingLocal] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  // Streaming Live Progress State
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamProgress, setStreamProgress] = useState<{
    entity: EntityName | null;
    entityLabel: string;
    processedCount: number;
    totalCount: number;
    remainingCount: number;
    percent: number;
    entityStatuses: Partial<Record<EntityName, "pending" | "in_progress" | "completed">>;
  }>({
    entity: null,
    entityLabel: "",
    processedCount: 0,
    totalCount: 0,
    remainingCount: 0,
    percent: 0,
    entityStatuses: {},
  });

  const [streamSuccessMsg, setStreamSuccessMsg] = useState<string | null>(null);
  const [streamErrorMsg, setStreamErrorMsg] = useState<{ message: string; detail?: string } | null>(null);

  // Handle local File Selection / Drop
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsProcessingLocal(true);
    setProgressMsg("Dosyalar okunuyor...");
    const newFilesList: typeof uploadedFiles = [];
    const newPayload: Partial<Record<EntityName, any[]>> = { ...parsedPayload };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgressMsg(`Dosya ${i + 1}/${files.length} işleniyor: ${file.name}`);
      try {
        const text = await file.text();
        const jsonContent = JSON.parse(text);
        const entity = detectEntityFromJSON(file.name, jsonContent);

        if (!entity) {
          newFilesList.push({
            name: file.name,
            entity: null,
            count: 0,
            valid: false,
            errors: ["11 TransitJSON şemasından hiçbiri ile eşleşmedi."],
          });
          continue;
        }

        const items = Array.isArray(jsonContent) ? jsonContent : [jsonContent];
        let fileValid = true;
        const fileErrors: string[] = [];

        // Validate first 20 items against AJV Schema
        for (const item of items.slice(0, 20)) {
          const valRes = validateEntityItem(entity, item);
          if (!valRes.valid) {
            fileValid = false;
            fileErrors.push(...valRes.errors);
            break;
          }
        }

        newFilesList.push({
          name: file.name,
          entity,
          count: items.length,
          valid: fileValid,
          errors: fileErrors,
        });

        newPayload[entity] = (newPayload[entity] || []).concat(items);
      } catch (err: any) {
        newFilesList.push({
          name: file.name,
          entity: null,
          count: 0,
          valid: false,
          errors: ["JSON Okuma Hatası: " + err.message],
        });
      }
    }

    setUploadedFiles(newFilesList);
    setParsedPayload(newPayload);
    setIsProcessingLocal(false);
    setProgressMsg(null);
  };

  const handleStartAnalysis = () => {
    setStreamErrorMsg(null);
    setStreamSuccessMsg(null);
    const formData = new FormData();
    formData.append("intent", "analyze");
    formData.append("payload", JSON.stringify(parsedPayload));
    submit(formData, { method: "post" });
  };

  // High-Performance Stream Execute Handler
  const handleExecuteImportStream = async (mode: "overwrite" | "merge" | "skip") => {
    if (mode === "skip") {
      setStreamSuccessMsg("İşlem atlandı.");
      return;
    }

    setIsStreaming(true);
    setStreamErrorMsg(null);
    setStreamSuccessMsg(null);

    try {
      const response = await fetch("/api/import-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: parsedPayload, mode }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Sunucu hatası: HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataRaw = line.slice(6);
            try {
              const event = JSON.parse(dataRaw);

              if (event.type === "progress") {
                setStreamProgress({
                  entity: event.entity,
                  entityLabel: event.entityLabel,
                  processedCount: event.processedCount,
                  totalCount: event.totalCount,
                  remainingCount: event.remainingCount,
                  percent: event.percent,
                  entityStatuses: event.entityStatuses || {},
                });
              } else if (event.type === "completed") {
                setStreamSuccessMsg(event.message);
                setIsStreaming(false);
              } else if (event.type === "error") {
                setStreamErrorMsg({ message: event.message, detail: event.detail });
                setIsStreaming(false);
              }
            } catch (err) {
              console.error("SSE Parse Error:", err);
            }
          }
        }
      }
    } catch (err: any) {
      console.error("Stream Fetch Error:", err);
      setStreamErrorMsg({ message: err.message || "Canlı aktarım bağlantı hatası." });
      setIsStreaming(false);
    }
  };

  const analysis: ImportConflictAnalysis | undefined =
    actionData?.type === "analysis" ? actionData.analysis : undefined;

  const entityLabelsList: Record<EntityName, string> = {
    country: "Ülke Tanımları (country.json)",
    city: "Şehirler (city.json)",
    agency: "Ulaşım Ajansları (agency.json)",
    fare: "Ücret & Biletler (fare.json)",
    holiday: "Resmi Tatiller (holiday.json)",
    route: "Hatlar / Rotalar (route.json)",
    stop: "Duraklar & Platformlar (stop.json)",
    route_stop: "Hat-Durak Sıralaması (route_stop.json)",
    shape: "Güzergah Polylines (shape.json)",
    trip: "Seferler (trip.json)",
    stop_time: "Durak Kalkış Saatleri (stop_time.json)",
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">High-Speed Bulk JSON Aktarımı (Import)</h1>
        <p className="text-sm text-slate-500 mt-1">
          Toplu SQL paketi motoru ile yüz binlerce kaydı saniyeler içinde yükleyin ve canlı takip edin.
        </p>
      </div>

      {/* Action Error Alert Box */}
      {(actionData?.type === "error" || streamErrorMsg) && (
        <div className="p-5 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-900 space-y-2 animate-in fade-in duration-200 shadow-md">
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-6 h-6 text-rose-600 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-base text-rose-900">İşlem Sırasında Hata Oluştu!</h4>
              <p className="text-xs font-semibold text-rose-700 mt-0.5">
                {streamErrorMsg?.message || actionData?.message}
              </p>
            </div>
          </div>
          {(streamErrorMsg?.detail || actionData?.detail) && (
            <div className="mt-2 p-3 bg-rose-100/90 rounded-xl text-xs font-mono text-rose-950 overflow-x-auto border border-rose-200">
              <span>Detay: {streamErrorMsg?.detail || actionData?.detail}</span>
            </div>
          )}
        </div>
      )}

      {/* Success Alert */}
      {streamSuccessMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-sm">İşlem Başarıyla Tamamlandı!</h4>
              <p className="text-xs text-emerald-700">{streamSuccessMsg}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setUploadedFiles([]);
              setParsedPayload({});
              setStreamSuccessMsg(null);
            }}
            className="px-3 py-1.5 bg-white text-emerald-800 border border-emerald-300 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition shadow-xs"
          >
            Yeni Yükleme Yap
          </button>
        </div>
      )}

      {/* Real-Time Live Progress Dashboard Banner */}
      {isStreaming && (
        <div className="bg-white p-6 rounded-2xl border border-blue-200 shadow-xl space-y-5 animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin flex-shrink-0" />
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Yükleme Devam Ediyor: {streamProgress.entityLabel || "Veriler Yükleniyor..."}
                </h3>
                <p className="text-xs text-slate-500">PostGIS toplu SQL paket motoru aktif</p>
              </div>
            </div>
            <span className="text-xl font-extrabold text-blue-600 font-mono">
              %{streamProgress.percent}
            </span>
          </div>

          {/* Animated Progress Bar */}
          <div className="space-y-1.5">
            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
              <div
                className="bg-blue-600 h-full transition-all duration-300 ease-out"
                style={{ width: `${streamProgress.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>
                Eklendi: <strong className="text-emerald-600 font-bold">{streamProgress.processedCount.toLocaleString("tr-TR")}</strong> / {streamProgress.totalCount.toLocaleString("tr-TR")}
              </span>
              <span className="text-slate-500">
                Kalan Kayıt: <strong className="text-amber-600 font-bold">{streamProgress.remainingCount.toLocaleString("tr-TR")}</strong>
              </span>
            </div>
          </div>

          {/* Checklist of 11 Files Live Status */}
          <div className="pt-2 border-t border-slate-100">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Tablo Bazlı Canlı Durum
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              {Object.keys(parsedPayload).map((key) => {
                const ent = key as EntityName;
                const status = streamProgress.entityStatuses[ent] || "pending";
                const isCurrent = streamProgress.entity === ent;

                return (
                  <div
                    key={ent}
                    className={`p-2.5 rounded-xl border flex items-center justify-between ${
                      isCurrent
                        ? "bg-blue-50 border-blue-300 font-bold text-blue-900 shadow-2xs"
                        : status === "completed"
                        ? "bg-emerald-50/60 border-emerald-200 text-emerald-900"
                        : "bg-slate-50 border-slate-200 text-slate-500"
                    }`}
                  >
                    <span className="truncate">{entityLabelsList[ent]}</span>
                    {status === "completed" && <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                    {status === "in_progress" && <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />}
                    {status === "pending" && <span className="text-[10px] text-slate-400">Bekliyor</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Drag & Drop File Upload Area */}
      <div className="bg-white p-8 rounded-2xl border-2 border-dashed border-slate-300 hover:border-blue-500 transition text-center space-y-4">
        <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
          <UploadCloud className="w-7 h-7" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900">Transit JSON Dosyalarını Yükleyin</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            11 JSON dosyanızı (`country.json`, `city.json`, `route.json`, `stop.json` vs.) sürükleyip bırakın veya seçin.
          </p>
        </div>

        <div>
          <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-xs cursor-pointer transition">
            <FileJson className="w-4 h-4" />
            <span>Dosyaları Seçin</span>
            <input
              type="file"
              multiple
              accept=".json"
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Selected Files List & AJV Validation Summary */}
      {uploadedFiles.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm">
              Yüklenen Dosya Analizi ({uploadedFiles.length} Dosya)
            </h3>
            <button
              onClick={handleStartAnalysis}
              disabled={isStreaming || isProcessingLocal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-xs transition disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Veritabanı Çakışma & Diff Kontrolü Başlat</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {uploadedFiles.map((f, i) => (
              <div
                key={i}
                className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                  f.valid
                    ? "bg-slate-50 border-slate-200"
                    : "bg-rose-50/50 border-rose-200"
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="truncate text-slate-900">{f.name}</span>
                  {f.valid ? (
                    <span className="text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded text-[10px]">
                      Geçerli ✅
                    </span>
                  ) : (
                    <span className="text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded text-[10px]">
                      Hatalı ❌
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  Şema: <span className="font-bold text-slate-800">{f.entity || "Bilinmiyor"}</span> • Kayıt Sayısı:{" "}
                  <span className="font-bold text-slate-800">{f.count.toLocaleString("tr-TR")}</span>
                </div>
                {f.errors.length > 0 && (
                  <p className="text-[10px] text-rose-600 truncate">{f.errors[0]}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analysis & Diff Conflict Modal / Results Box */}
      {analysis && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-lg space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              {analysis.hasConflict ? (
                <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl">
                  <AlertTriangle className="w-5 h-5" />
                </div>
              ) : (
                <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              )}
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  {analysis.hasConflict
                    ? "Mevcut Verilerle Çakışma ve Değişiklik Tespit Edildi!"
                    : "Tüm Veriler Temiz ve Yeni Kayıt Olarak Eklenebilir."}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Etkilenen Şehirler: {analysis.affectedCities.join(", ") || "Yok"} • Etkilenen Hatlar:{" "}
                  {analysis.affectedRoutes.join(", ") || "Yok"}
                </p>
              </div>
            </div>
          </div>

          {/* Diff Tables per Entity */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Değişiklik Detayları (Diff Analysis)
            </h4>

            {analysis.diffs.map((diff) => (
              <div key={diff.entity} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="capitalize text-slate-900 text-sm">
                    {diff.entity} Tablosu
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-600">+ {diff.added.length.toLocaleString("tr-TR")} Eklenecek</span>
                    <span className="text-amber-600">✏️ {diff.modified.length.toLocaleString("tr-TR")} Değişen</span>
                    <span className="text-slate-400">✓ {diff.unchangedCount.toLocaleString("tr-TR")} Aynı</span>
                  </div>
                </div>

                {/* Modified items field diff preview */}
                {diff.modified.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-200/80">
                    <p className="text-[11px] font-semibold text-slate-600">Değiştirilecek Alanlar:</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {diff.modified.map((mod, idx) => (
                        <div key={idx} className="p-2 bg-white rounded-lg border border-slate-200 text-xs space-y-1">
                          <span className="font-mono font-bold text-blue-600">{mod.id}</span>
                          <div className="space-y-0.5 text-[11px]">
                            {mod.changes.map((ch, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="font-medium text-slate-500">{ch.field}:</span>
                                <span className="text-rose-600 line-through">{String(ch.oldVal)}</span>
                                <ArrowRight className="w-3 h-3 text-slate-400" />
                                <span className="text-emerald-600 font-bold">{String(ch.newVal)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* User Decision Action Buttons */}
          <div className="p-4 bg-slate-100 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-700">
              Sistemdeki verilerin üzerine yazılsın mı yoksa sadece eksikler mi eklensin?
            </span>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => handleExecuteImportStream("overwrite")}
                disabled={isStreaming}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
              >
                {isStreaming ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Yükleniyor...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Tümünü Güncelle / Değiştir</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleExecuteImportStream("merge")}
                disabled={isStreaming}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
              >
                {isStreaming ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Yükleniyor...</span>
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Sadece Eksikleri Ekle</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleExecuteImportStream("skip")}
                disabled={isStreaming}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-lg transition disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Es Geç / İptal Et</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
