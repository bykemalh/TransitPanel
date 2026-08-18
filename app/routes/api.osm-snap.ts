import type { Route } from "./+types/api.osm-snap";

/**
 * OSM Overpass API kullanarak raylı sistem rotalarını (tram, metro, tren, füniküler vb.)
 * gerçek ray geometrisine snap eden sunucu tarafı API endpoint'i.
 *
 * Akış:
 * 1. Shape noktalarından bounding box hesapla
 * 2. Overpass API ile bölgedeki railway geometrilerini çek
 * 3. Her shape noktasını en yakın ray segmentine geometrik olarak snap et
 * 4. Sıralı olarak snap edilmiş rotayı döndür
 */

const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const OVERPASS_TIMEOUT = 60; // saniye — sorgu zaman aşımı
const FETCH_TIMEOUT_MS = 50000; // 50 saniye — istemci tarafı zaman aşımı

/** Araç tipine göre OSM railway tag'i */
function getOsmRailwayTags(vehicleType: string): string[] {
  switch (vehicleType) {
    case "tram":
    case "cable_tram":
      return ["tram", "light_rail"];
    case "metro":
      return ["subway", "light_rail"];
    case "rail":
      return ["rail", "light_rail", "narrow_gauge"];
    case "monorail":
      return ["monorail"];
    case "funicular":
      return ["funicular"];
    case "gondola":
      return ["cable_car"];
    case "ferry":
    case "water_taxi":
      return ["__ferry__"]; // Özel durum: route=ferry kullanılacak
    default:
      return ["tram", "light_rail", "subway", "rail"];
  }
}

/** İki nokta arası Haversine mesafesi (metre) */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bir noktayı bir çizgi segmentine snap et — en yakın noktayı döndür */
function snapPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { lat: number; lon: number; dist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }

  const projLat = ax + t * dx;
  const projLon = ay + t * dy;
  const dist = haversineDistance(px, py, projLat, projLon);

  return { lat: Number(projLat.toFixed(6)), lon: Number(projLon.toFixed(6)), dist };
}

/** OSM Way listesinden tüm segmentleri çıkar */
function extractSegments(
  ways: Array<{ nodes: number[] }>,
  nodeMap: Map<number, { lat: number; lon: number }>
): Array<{ a: { lat: number; lon: number }; b: { lat: number; lon: number } }> {
  const segments: Array<{ a: { lat: number; lon: number }; b: { lat: number; lon: number } }> = [];

  for (const way of ways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const nodeA = nodeMap.get(way.nodes[i]);
      const nodeB = nodeMap.get(way.nodes[i + 1]);
      if (nodeA && nodeB) {
        segments.push({ a: nodeA, b: nodeB });
      }
    }
  }

  return segments;
}

/**
 * Shape noktalarını OSM ray geometrisine sıralı olarak snap eder.
 * Her nokta, önceki snap noktasına en yakın ray segmentinden başlayarak
 * en yakın noktaya snap edilir (yönlü/sıralı snap).
 */
function snapPointsToRailway(
  shapePoints: Array<{ lat: number; lon: number }>,
  segments: Array<{ a: { lat: number; lon: number }; b: { lat: number; lon: number } }>,
  allWayNodes: Array<Array<{ lat: number; lon: number }>>
): Array<{ lat: number; lon: number }> {
  if (segments.length === 0 || shapePoints.length === 0) return shapePoints;

  const result: Array<{ lat: number; lon: number }> = [];
  
  for (let pi = 0; pi < shapePoints.length; pi++) {
    const pt = shapePoints[pi];
    let bestSnap: { lat: number; lon: number; dist: number } | null = null;
    
    // Her segmentte en yakın noktayı ara
    for (const seg of segments) {
      const snap = snapPointToSegment(pt.lat, pt.lon, seg.a.lat, seg.a.lon, seg.b.lat, seg.b.lon);
      if (!bestSnap || snap.dist < bestSnap.dist) {
        bestSnap = snap;
      }
    }
    
    if (bestSnap && bestSnap.dist < 500) { // 500m max snap mesafesi
      result.push({ lat: bestSnap.lat, lon: bestSnap.lon });
    } else {
      // Snap edilemezse orijinal noktayı koru
      result.push(pt);
    }
  }

  // Ardışık aynı noktaları temizle
  const cleaned: Array<{ lat: number; lon: number }> = [result[0]];
  for (let i = 1; i < result.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    if (Math.abs(result[i].lat - prev.lat) > 0.000001 || Math.abs(result[i].lon - prev.lon) > 0.000001) {
      cleaned.push(result[i]);
    }
  }

  return cleaned;
}

/**
 * İki ardışık snap nokta arasındaki ray geometrisini interpolasyon ile
 * doldurur — böylece düz çizgiler yerine gerçek ray eğrilerini takip eder.
 */
function interpolateAlongRailway(
  snappedPoints: Array<{ lat: number; lon: number }>,
  allWayNodes: Array<Array<{ lat: number; lon: number }>>
): Array<{ lat: number; lon: number }> {
  if (snappedPoints.length < 2 || allWayNodes.length === 0) return snappedPoints;

  // Tüm way node'larını tek bir sıralı node listesine birleştir
  // (Yakın uçları birbirine bağlayarak)
  const flatNodes: Array<{ lat: number; lon: number }> = [];
  for (const wayNodes of allWayNodes) {
    if (flatNodes.length === 0) {
      flatNodes.push(...wayNodes);
    } else {
      // Son eklenen ile yeni way'in hangi ucu daha yakın?
      const lastNode = flatNodes[flatNodes.length - 1];
      const firstDist = haversineDistance(lastNode.lat, lastNode.lon, wayNodes[0].lat, wayNodes[0].lon);
      const lastDist = haversineDistance(lastNode.lat, lastNode.lon, wayNodes[wayNodes.length - 1].lat, wayNodes[wayNodes.length - 1].lon);

      if (lastDist < firstDist) {
        // Ters sıra ile ekle
        flatNodes.push(...[...wayNodes].reverse());
      } else {
        flatNodes.push(...wayNodes);
      }
    }
  }

  if (flatNodes.length < 2) return snappedPoints;

  const result: Array<{ lat: number; lon: number }> = [];

  for (let i = 0; i < snappedPoints.length - 1; i++) {
    const startPt = snappedPoints[i];
    const endPt = snappedPoints[i + 1];

    // flatNodes içinde start ve end'e en yakın indeksleri bul
    let startIdx = 0, endIdx = 0;
    let startMinDist = Infinity, endMinDist = Infinity;

    for (let j = 0; j < flatNodes.length; j++) {
      const d1 = haversineDistance(startPt.lat, startPt.lon, flatNodes[j].lat, flatNodes[j].lon);
      const d2 = haversineDistance(endPt.lat, endPt.lon, flatNodes[j].lat, flatNodes[j].lon);
      if (d1 < startMinDist) { startMinDist = d1; startIdx = j; }
      if (d2 < endMinDist) { endMinDist = d2; endIdx = j; }
    }

    // İki snap noktası arasındaki ray node'larını ekle
    result.push(startPt);

    if (startIdx !== endIdx && startMinDist < 200 && endMinDist < 200) {
      const step = startIdx < endIdx ? 1 : -1;
      for (let j = startIdx + step; j !== endIdx; j += step) {
        if (j >= 0 && j < flatNodes.length) {
          result.push({ lat: flatNodes[j].lat, lon: flatNodes[j].lon });
        }
      }
    }
  }
  result.push(snappedPoints[snappedPoints.length - 1]);

  // Ardışık duplikatları temizle
  const cleaned: Array<{ lat: number; lon: number }> = [result[0]];
  for (let i = 1; i < result.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    if (Math.abs(result[i].lat - prev.lat) > 0.000002 || Math.abs(result[i].lon - prev.lon) > 0.000002) {
      cleaned.push(result[i]);
    }
  }

  return cleaned;
}

export async function action({ request }: Route.ActionArgs) {
  try {
    const body = await request.json();
    const { shape, vehicleType } = body;

    if (!shape || !Array.isArray(shape) || shape.length < 2) {
      return Response.json(
        { error: true, message: "En az 2 shape noktası gerekli." },
        { status: 400 }
      );
    }

    // 1. Bounding box hesapla (0.01 derece ~ 1km padding)
    const PADDING = 0.008;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const pt of shape) {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lon < minLon) minLon = pt.lon;
      if (pt.lon > maxLon) maxLon = pt.lon;
    }
    minLat -= PADDING; maxLat += PADDING;
    minLon -= PADDING; maxLon += PADDING;

    // 2. Overpass query oluştur
    const railwayTags = getOsmRailwayTags(vehicleType || "tram");
    const isFerry = railwayTags.includes("__ferry__");

    let overpassQuery: string;
    if (isFerry) {
      overpassQuery = `[out:json][timeout:${OVERPASS_TIMEOUT}];
(
  way["route"="ferry"](${minLat},${minLon},${maxLat},${maxLon});
  relation["route"="ferry"](${minLat},${minLon},${maxLat},${maxLon});
);
out body;
>;
out skel qt;`;
    } else {
      const railwayFilter = railwayTags.map(t => `way["railway"="${t}"](${minLat},${minLon},${maxLat},${maxLon});`).join("\n  ");
      overpassQuery = `[out:json][timeout:${OVERPASS_TIMEOUT}];
(
  ${railwayFilter}
);
out body;
>;
out skel qt;`;
    }

    // 3. Overpass API'ye istek at
    let overpassData: any = null;
    let lastError: any = null;

    for (let si = 0; si < OVERPASS_SERVERS.length; si++) {
      const server = OVERPASS_SERVERS[si];
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const res = await fetch(server, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          overpassData = await res.json();
          break;
        } else {
          lastError = new Error(`Overpass ${server.split('/')[2]} HTTP ${res.status}`);
          // 429 veya 504 ise sonraki sunucuyu dene
        }
      } catch (err: any) {
        lastError = err.name === 'AbortError'
          ? new Error(`Overpass ${server.split('/')[2]} zaman aşımı (${FETCH_TIMEOUT_MS / 1000}s)`)
          : err;
      }

      // Sunucular arası kısa bekleme (rate limit koruması)
      if (si < OVERPASS_SERVERS.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!overpassData) {
      return Response.json(
        { error: true, message: `Overpass API'ye ulaşılamadı: ${lastError?.message}` },
        { status: 502 }
      );
    }

    // 4. Overpass verilerini parse et
    const nodeMap = new Map<number, { lat: number; lon: number }>();
    const ways: Array<{ nodes: number[]; tags?: Record<string, string> }> = [];

    for (const el of overpassData.elements || []) {
      if (el.type === "node" && el.lat != null && el.lon != null) {
        nodeMap.set(el.id, { lat: el.lat, lon: el.lon });
      } else if (el.type === "way" && el.nodes) {
        ways.push({ nodes: el.nodes, tags: el.tags });
      }
    }

    if (ways.length === 0) {
      return Response.json({
        error: true,
        message: `Bu bölgede ${isFerry ? "feribot" : "raylı sistem"} geometrisi bulunamadı. OSM'de bu hat henüz çizilmemiş olabilir.`,
        railwayTags,
        bbox: { minLat, maxLat, minLon, maxLon },
        nodesFound: nodeMap.size,
      }, { status: 404 });
    }

    // 5. Way node'larını çıkar
    const allWayNodes: Array<Array<{ lat: number; lon: number }>> = [];
    for (const way of ways) {
      const wayNodes: Array<{ lat: number; lon: number }> = [];
      for (const nodeId of way.nodes) {
        const node = nodeMap.get(nodeId);
        if (node) wayNodes.push(node);
      }
      if (wayNodes.length >= 2) {
        allWayNodes.push(wayNodes);
      }
    }

    // 6. Segmentleri oluştur ve snap yap
    const segments = extractSegments(ways, nodeMap);
    const snappedPoints = snapPointsToRailway(shape, segments, allWayNodes);

    // 7. Snap noktaları arasını ray geometrisi ile doldur
    const interpolated = interpolateAlongRailway(snappedPoints, allWayNodes);

    return Response.json({
      success: true,
      shape: interpolated,
      stats: {
        inputPoints: shape.length,
        outputPoints: interpolated.length,
        waysFound: ways.length,
        nodesFound: nodeMap.size,
        railwayTags,
      },
    });
  } catch (err: any) {
    console.error("[OSM Snap Error]:", err);
    return Response.json(
      { error: true, message: err.message || "OSM snap işleminde hata oluştu." },
      { status: 500 }
    );
  }
}
