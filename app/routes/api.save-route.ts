import type { Route } from "./+types/api.save-route";
import { saveRouteEditorData } from "../lib/db-operations.server";

export async function action({ request }: Route.ActionArgs) {
  try {
    const body = await request.json();
    const { routeId, direction, shapeCoordinates, stopsList } = body;

    if (!routeId || direction == null || !Array.isArray(shapeCoordinates) || !Array.isArray(stopsList)) {
      return Response.json(
        { success: false, message: "Geçersiz veya eksik parametreler." },
        { status: 400 }
      );
    }

    const result = await saveRouteEditorData(
      routeId,
      Number(direction),
      shapeCoordinates,
      stopsList
    );

    return Response.json({ success: true, message: result.message });
  } catch (err: any) {
    console.error("[API save-route Error]:", err);
    return Response.json(
      { success: false, message: err.message || "Kaydetme sırasında hata oluştu." },
      { status: 500 }
    );
  }
}
