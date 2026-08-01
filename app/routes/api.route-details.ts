import type { Route } from "./+types/api.route-details";
import { getMapRouteDetails } from "../lib/db-operations.server";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const url = new URL(request.url);
    const routeId = url.searchParams.get("routeId");

    if (!routeId) {
      return Response.json(
        { success: false, message: "routeId parametresi gerekli." },
        { status: 400 }
      );
    }

    const details = await getMapRouteDetails(routeId);
    if (!details) {
      return Response.json(
        { success: false, message: "Rota bulunamadı." },
        { status: 404 }
      );
    }

    return Response.json({ success: true, details });
  } catch (err: any) {
    console.error("[API route-details Error]:", err);
    return Response.json(
      { success: false, message: err.message || "Rota detayları alınamadı." },
      { status: 500 }
    );
  }
}
