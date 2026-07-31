import type { Route } from "./+types/api.valhalla";

export async function action({ request }: Route.ActionArgs) {
  try {
    const body = await request.json();
    const { targetUrl } = body;

    let baseValhallaUrl = (targetUrl || "https://valhala.bykemalh.me").trim().replace(/\/+$/, "");
    baseValhallaUrl = baseValhallaUrl.replace(/\/route$/, "");

    const serversToTry = [
      baseValhallaUrl,
      "https://valhalla1.openstreetmap.de",
      "https://valhalla.openstreetmap.de",
    ].filter((url, index, self) => url && self.indexOf(url) === index);

    // Detect mode: trace_route (shape-based) vs route (location-based)
    const isTrace = Array.isArray(body.shape) && body.shape.length > 0;
    const endpoint = isTrace ? "/trace_route" : "/route";

    // Valhalla limits single request to 20 locations / shape points max.
    // If shape > 20, split into overlapping chunks of max 20 points.
    const items = isTrace ? body.shape : (body.locations || []);
    const MAX_ITEMS = 20;
    const itemChunks: any[][] = [];
    if (items.length <= MAX_ITEMS) {
      itemChunks.push(items);
    } else {
      let idx = 0;
      while (idx < items.length - 1) {
        const chunk = items.slice(idx, idx + MAX_ITEMS);
        itemChunks.push(chunk);
        idx += MAX_ITEMS - 1; // overlap by 1 to stitch segments
      }
    }

    // Forward the body minus targetUrl, then re-attach the (possibly chunked) items.
    const { targetUrl: _t, locations: _l, shape: _s, ...rest } = body;
    const forwardedBody: any = { ...rest };

    let combinedShape: string | null = null;
    let combinedTripLegs: any[] = [];
    let firstSummary: any = null;
    let firstLocations: any[] = [];

    for (const chunk of itemChunks) {
      const payload: any = isTrace ? { ...forwardedBody, shape: chunk } : { ...forwardedBody, locations: chunk };

      let chunkData: any = null;
      let lastError: any = null;

      for (const serverUrl of serversToTry) {
        try {
          const fullEndpoint = `${serverUrl}${endpoint}`;
          const res = await fetch(fullEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "TransitPanel-Proxy/1.0",
            },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            chunkData = await res.json();
            break;
          } else {
            const errorText = await res.text();
            lastError = new Error(`HTTP ${res.status}: ${errorText}`);
          }
        } catch (err: any) {
          lastError = err;
        }
      }

      if (!chunkData || (!chunkData.trip && !chunkData.shape)) {
        return Response.json(
          { error: true, message: lastError?.message || "Valhalla sunucusuna ulaşılamadı." },
          { status: 502 }
        );
      }

      if (chunkData.trip?.summary && !firstSummary) firstSummary = chunkData.trip.summary;
      if (chunkData.trip?.locations && firstLocations.length === 0) {
        firstLocations = chunkData.trip.locations;
      }
      if (chunkData.trip?.legs) {
        combinedTripLegs.push(...chunkData.trip.legs);
      }
      if (chunkData.shape) {
        combinedShape = combinedShape
          ? combinedShape + chunkData.shape // polyline concat not strictly valid; safer to just use first
          : chunkData.shape;
      }
    }

    if (isTrace) {
      // trace_route returns top-level shape string
      return Response.json({ shape: combinedShape, trip: { legs: combinedTripLegs } });
    }

    return Response.json({
      trip: {
        legs: combinedTripLegs,
        summary: firstSummary,
        locations: firstLocations,
        status: 0,
      },
    });
  } catch (err: any) {
    console.error("[Valhalla Proxy Error]:", err);
    return Response.json(
      { error: true, message: err.message || "Proxy sunucusu hatası." },
      { status: 500 }
    );
  }
}
