import { executeImportPayload } from "../lib/db-operations.server";
import type { EntityName } from "../lib/types";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { payload, mode } = await request.json();

  const entityLabels: Record<EntityName, string> = {
    country: "Ülke Tanımları (country.json)",
    city: "Şehirler (city.json)",
    agency: "Ulaşım Ajansları (agency.json)",
    fare: "Ücret & Biletler (fare.json)",
    holiday: "Resmi Tatiller (holiday.json)",
    route: "Hatlar / Rotalar (route.json)",
    stop: "Duraklar & Platformlar (stop.json)",
    route_stop: "Hat-Durak Sıralamaları (route_stop.json)",
    shape: "Güzergah Çizgileri (shape.json)",
    trip: "Seferler (trip.json)",
    stop_time: "Durak Kalkış Saatleri (stop_time.json)",
  };

  const entityTotals: Partial<Record<EntityName, number>> = {};
  const entityProcessed: Partial<Record<EntityName, number>> = {};
  const entityStatuses: Partial<Record<EntityName, "pending" | "in_progress" | "completed">> = {};

  Object.keys(payload).forEach((key) => {
    const ent = key as EntityName;
    if (payload[ent] && payload[ent].length > 0) {
      entityTotals[ent] = payload[ent].length;
      entityProcessed[ent] = 0;
      entityStatuses[ent] = "pending";
    }
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        sendEvent({
          type: "start",
          message: "Toplu aktarım başlatıldı...",
          entityStatuses,
        });

        await executeImportPayload(payload, mode, (entity, processedCount, totalCount) => {
          entityProcessed[entity] = processedCount;
          entityTotals[entity] = totalCount;

          if (processedCount < totalCount) {
            entityStatuses[entity] = "in_progress";
          } else {
            entityStatuses[entity] = "completed";
          }

          const percent = Math.round((processedCount / totalCount) * 100);
          const remainingCount = totalCount - processedCount;

          sendEvent({
            type: "progress",
            step: "Veritabanına Yükleniyor",
            entity,
            entityLabel: entityLabels[entity] || entity,
            processedCount,
            totalCount,
            remainingCount,
            percent,
            entityStatuses,
          });
        });

        sendEvent({
          type: "completed",
          message: "Tüm veriler başarıyla yüklendi!",
          entityStatuses,
        });

        controller.close();
      } catch (err: any) {
        console.error("Stream Import Error:", err);
        sendEvent({
          type: "error",
          message: err.message || "Veritabanı yüklemesinde hata oluştu.",
          detail: err.detail || err.hint || (err.code ? `PostgreSQL Kodu: ${err.code}` : undefined),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
