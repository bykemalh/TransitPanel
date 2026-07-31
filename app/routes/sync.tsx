import { useLoaderData, useSearchParams, useSubmit, useActionData, useNavigation } from "react-router";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MlMap, Marker, Popup, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getCountriesAndCities, getRoutesForCity, getMapRouteDetails, saveRouteEditorData } from "../lib/db-operations.server";
import {
  MapPin,
  Bus,
  Clock,
  Navigation,
  Check,
  Search,
  Loader2,
  RotateCw,
  Plus,
  Save,
  Trash2,
  Route as RouteIcon,
  Zap,
  Move,
  CheckCircle2,
  AlertOctagon,
} from "lucide-react";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const selectedCityId = url.searchParams.get("city") || "";
  const selectedRouteId = url.searchParams.get("route") || "";

  // When both city and route are known, run all queries in parallel
  if (selectedCityId && selectedRouteId) {
    const [cities, routes, routeDetails] = await Promise.all([
      getCountriesAndCities(),
      getRoutesForCity(selectedCityId),
      getMapRouteDetails(selectedRouteId),
    ]);

    const activeCityObj = cities.find((c: any) => c.city_id === selectedCityId) || null;

    return {
      cities,
      routes,
      activeCityId: selectedCityId,
      activeRouteId: selectedRouteId,
      activeCityObj,
      routeDetails,
    };
  }

  const cities = await getCountriesAndCities();
  const activeCityId = selectedCityId || (cities.length > 0 ? cities[0].city_id : "");
  
  let routes: any[] = [];
  let routeDetails = null;

  if (activeCityId) {
    routes = await getRoutesForCity(activeCityId);
    const activeRouteId = selectedRouteId || (routes.length > 0 ? routes[0].route_id : "");
    if (activeRouteId) {
      routeDetails = await getMapRouteDetails(activeRouteId);
    }

    const activeCityObj = cities.find((c: any) => c.city_id === activeCityId) || null;

    return {
      cities,
      routes,
      activeCityId,
      activeRouteId,
      activeCityObj,
      routeDetails,
    };
  }

  return {
    cities,
    routes: [],
    activeCityId: "",
    activeRouteId: "",
    activeCityObj: null,
    routeDetails: null,
  };
}

export async function action({ request }: { request: Request }) {
  try {
    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent === "save_route_editor") {
      const routeId = formData.get("routeId") as string;
      const direction = parseInt(formData.get("direction") as string, 10);
      const shapeCoordsRaw = formData.get("shapeCoordinates") as string;
      const stopsRaw = formData.get("stopsList") as string;

      const shapeCoordinates = JSON.parse(shapeCoordsRaw);
      const stopsList = JSON.parse(stopsRaw);

      const result = await saveRouteEditorData(routeId, direction, shapeCoordinates, stopsList);
      return { success: true, message: result.message };
    }

    return { success: false, message: "Bilinmeyen işlem." };
  } catch (err: any) {
    console.error("Route Editor Action Error:", err);
    return {
      success: false,
      message: err.message || "Kaydetme sırasında hata oluştu.",
      detail: err.detail || err.hint,
    };
  }
}

export default function RouteEditorPage() {
  const { cities, routes, activeCityId, activeRouteId, activeCityObj, routeDetails } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [searchParams, setSearchParams] = useSearchParams();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MlMap | null>(null);
  const mapReadyRef = useRef<boolean>(false);
  const shapeMarkersRef = useRef<Marker[]>([]);
  const stopMarkersRef = useRef<Marker[]>([]);
  const mapClickHandlerRef = useRef<((e: any) => void) | null>(null);
  const routeColor = "#dc2626";
  const stopColor = "#2563eb";
  const MAPTILER_KEY =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_MAPTILER_KEY) || "";

  const [selectedDirection, setSelectedDirection] = useState<number>(1);
  const [routeSearchText, setRouteSearchText] = useState<string>("");
  const [valhallaUrl, setValhallaUrl] = useState<string>("https://valhala.bykemalh.me");
  const [isValhallaRouting, setIsValhallaRouting] = useState<boolean>(false);

  // Editing State
  const [editMode, setEditMode] = useState<"view" | "add_shape" | "add_stop">("view");
  const [shapeCoords, setShapeCoords] = useState<Array<{ lat: number; lon: number }>>([]);
  const [stopsList, setStopsList] = useState<Array<{ stop_id: string; city_id: string; name: string; lat: number; lon: number; sequence: number }>>([]);

  const activeRoute = routeDetails?.route || null;
  const isLoopRoute = activeRoute?.route_pattern === "loop";
  const effectiveDirection = isLoopRoute ? 0 : (selectedDirection === 0 ? 1 : selectedDirection);

  // Sync initial shapes and stops when routeDetails change
  useEffect(() => {
    if (!routeDetails) {
      setShapeCoords([]);
      setStopsList([]);
      return;
    }

    const targetShape = routeDetails.shapes.find((s: any) => Number(s.direction) === effectiveDirection) || routeDetails.shapes[0];
    if (targetShape && targetShape.coordinates && Array.isArray(targetShape.coordinates)) {
      setShapeCoords(targetShape.coordinates.map((c: any) => ({ lat: Number(c.lat), lon: Number(c.lon) })));
    } else {
      setShapeCoords([]);
    }

    let targetStops = routeDetails.stops.filter((s: any) => Number(s.direction) === effectiveDirection);
    if (targetStops.length === 0 && routeDetails.stops.length > 0) {
      targetStops = routeDetails.stops;
    }

    setStopsList(
      targetStops.map((s: any, idx: number) => ({
        stop_id: s.stop_id,
        city_id: s.city_id || activeCityId,
        name: s.stop_name,
        lat: Number(s.lat),
        lon: Number(s.lon),
        sequence: idx + 1,
      }))
    );
  }, [routeDetails, effectiveDirection]);

  // Handle city / route changes
  const handleCityChange = (cityId: string) => {
    setSearchParams({ city: cityId });
  };

  const handleRouteChange = (routeId: string) => {
    setSearchParams({ city: activeCityId, route: routeId });
  };

  // MapLibre Map Initialization
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const centerLat = activeCityObj ? Number(activeCityObj.lat) : 40.19;
    const centerLon = activeCityObj ? Number(activeCityObj.lon) : 29.06;
    const defaultZoom = activeCityObj?.default_zoom || 12;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
      mapReadyRef.current = false;
    }

    const style: StyleSpecification = {
      version: 8,
      glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${MAPTILER_KEY}`,
      sources: {
        maptiler: {
          type: "vector",
          url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}`,
        },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#f8f4ef" } },
        { id: "water", type: "fill", source: "maptiler", "source-layer": "water", paint: { "fill-color": "#a8c8e8" } },
        { id: "landcover-park", type: "fill", source: "maptiler", "source-layer": "landcover", filter: ["==", "class", "park"], paint: { "fill-color": "#d8e8d0", "fill-opacity": 0.7 } },
        { id: "landcover-wood", type: "fill", source: "maptiler", "source-layer": "landcover", filter: ["==", "class", "wood"], paint: { "fill-color": "#cde0c4", "fill-opacity": 0.6 } },
        { id: "landuse-residential", type: "fill", source: "maptiler", "source-layer": "landuse", filter: ["==", "class", "residential"], paint: { "fill-color": "#ececec" } },
        { id: "building", type: "fill", source: "maptiler", "source-layer": "building", paint: { "fill-color": "#d9d5cc", "fill-outline-color": "#bdb8ad" } },
        { id: "road-minor-casing", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["in", "class", "minor", "service", "tertiary"], paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 4] } },
        { id: "road-minor", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["in", "class", "minor", "service", "tertiary"], paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 16, 3] } },
        { id: "road-secondary-casing", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["in", "class", "secondary", "trunk"], paint: { "line-color": "#ffd591", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 16, 8] } },
        { id: "road-secondary", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["in", "class", "secondary", "trunk"], paint: { "line-color": "#ffd591", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 6] } },
        { id: "road-primary-casing", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["==", "class", "primary"], paint: { "line-color": "#f9a06b", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 16, 10] } },
        { id: "road-primary", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["==", "class", "primary"], paint: { "line-color": "#f9a06b", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 16, 7] } },
        { id: "road-motorway-casing", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["==", "class", "motorway"], paint: { "line-color": "#e89263", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2, 16, 12] } },
        { id: "road-motorway", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["==", "class", "motorway"], paint: { "line-color": "#e89263", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 16, 9] } },
        { id: "road-rail", type: "line", source: "maptiler", "source-layer": "transportation", filter: ["==", "class", "rail"], paint: { "line-color": "#a7b0b8", "line-dasharray": [2, 2] } },
        { id: "place-city", type: "symbol", source: "maptiler", "source-layer": "place", filter: ["==", "class", "city"], layout: { "text-field": "{name:latin}", "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 10, 16], "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#1a1a1a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
        { id: "place-town", type: "symbol", source: "maptiler", "source-layer": "place", filter: ["==", "class", "town"], layout: { "text-field": "{name:latin}", "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 12, 14], "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#333333", "text-halo-color": "#ffffff", "text-halo-width": 1.2 } },
        { id: "place-village", type: "symbol", source: "maptiler", "source-layer": "place", filter: ["==", "class", "village"], layout: { "text-field": "{name:latin}", "text-size": ["interpolate", ["linear"], ["zoom"], 8, 9, 14, 12], "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#555555", "text-halo-color": "#ffffff", "text-halo-width": 1 } },
        { id: "road-label", type: "symbol", source: "maptiler", "source-layer": "transportation_name", minzoom: 12, layout: { "text-field": "{name:latin}", "text-size": 11, "text-font": ["Noto Sans Regular"], "symbol-placement": "line" }, paint: { "text-color": "#3a3a3a", "text-halo-color": "#ffffff", "text-halo-width": 1.2 } },
      ],
    };

    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      style,
      center: [centerLon, centerLat],
      zoom: defaultZoom,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      // Add line source/layers (casing + main)
      if (!map.getSource("route-line")) {
        map.addSource("route-line", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "route-casing",
          type: "line",
          source: "route-line",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "route-main",
          type: "line",
          source: "route-line",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": routeColor, "line-width": 5, "line-opacity": 1 },
        });
      }
      mapReadyRef.current = true;
      renderMapLayers();
    });

    mapInstanceRef.current = map;

    setTimeout(() => {
      if (map) map.resize();
    }, 150);

    return () => {
      shapeMarkersRef.current.forEach((m) => m.remove());
      shapeMarkersRef.current = [];
      stopMarkersRef.current.forEach((m) => m.remove());
      stopMarkersRef.current = [];
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        mapReadyRef.current = false;
      }
    };
  }, [activeCityId, MAPTILER_KEY]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render layers when shapeCoords, stopsList or editMode change
  useEffect(() => {
    if (mapReadyRef.current) renderMapLayers();
  }, [shapeCoords, stopsList, editMode, activeRouteId]); // eslint-disable-line react-hooks/exhaustive-deps

  function renderMapLayers() {
    const map = mapInstanceRef.current;
    if (!map || !mapReadyRef.current) return;

    // 1. Update route line source
    const lineSrc = map.getSource("route-line") as maplibregl.GeoJSONSource | undefined;
    if (lineSrc) {
      if (shapeCoords.length >= 2) {
        lineSrc.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: shapeCoords.map((c) => [c.lon, c.lat]),
          },
        });
      } else {
        lineSrc.setData({ type: "FeatureCollection", features: [] });
      }
    }

    // 2. Clear existing markers
    shapeMarkersRef.current.forEach((m) => m.remove());
    shapeMarkersRef.current = [];
    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];

    // 3. Shape waypoint markers (draggable, red)
    shapeCoords.forEach((c, idx) => {
      const el = document.createElement("div");
      el.style.cssText = `background-color: ${routeColor}; border: 2px solid #ffffff; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: grab;`;
      el.title = `Rota Noktası #${idx + 1}`;

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([c.lon, c.lat])
        .addTo(map);

      const popupEl = document.createElement("div");
      popupEl.className = "p-1.5 space-y-2 text-xs font-sans";
      popupEl.style.minWidth = "150px";
      popupEl.innerHTML = `
        <div style="font-weight: bold; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px;">
          📍 Rota Noktası #${idx + 1}
        </div>
        <div style="font-size: 11px; font-family: monospace; color: #64748b;">
          ${c.lat}, ${c.lon}
        </div>
        <button id="del-shape-${idx}" style="width: 100%; padding: 4px 8px; background-color: #e11d48; color: #ffffff; font-weight: bold; border-radius: 6px; border: none; cursor: pointer; font-size: 11px;">
          🗑️ Noktayı Sil
        </button>
      `;
      const popup = new maplibregl.Popup({ offset: 10, closeButton: true }).setDOMContent(popupEl);
      marker.setPopup(popup);
      popup.on("open", () => {
        const btn = document.getElementById(`del-shape-${idx}`);
        if (btn) btn.onclick = () => {
          handleRemoveShapePoint(idx);
          popup.remove();
        };
      });
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        const newLat = Number(ll.lat.toFixed(6));
        const newLon = Number(ll.lng.toFixed(6));
        setShapeCoords((prev) => prev.map((item, i) => (i === idx ? { lat: newLat, lon: newLon } : item)));
      });
      shapeMarkersRef.current.push(marker);
    });

    // 4. Stop markers (draggable, blue with number)
    stopsList.forEach((stop, idx) => {
      const el = document.createElement("div");
      el.style.cssText = `background-color: ${stopColor}; border: 3px solid #ffffff; width: 24px; height: 24px; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: grab; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: #ffffff;`;
      el.textContent = String(idx + 1);

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([stop.lon, stop.lat])
        .addTo(map);

      const popupEl = document.createElement("div");
      popupEl.className = "p-1.5 space-y-2 text-xs font-sans";
      popupEl.style.minWidth = "180px";
      popupEl.innerHTML = `
        <div style="font-weight: bold; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px;">
          🚏 Durak #${idx + 1}
        </div>
        <div style="font-weight: bold; color: #0f172a; font-size: 13px;">
          ${stop.name}
        </div>
        <div style="font-size: 11px; font-family: monospace; color: #64748b;">
          Konum: ${stop.lat}, ${stop.lon}
        </div>
        <div style="display: flex; gap: 6px; padding-top: 4px;">
          <button id="rename-stop-${idx}" style="flex: 1; padding: 4px 6px; background-color: #2563eb; color: #ffffff; font-weight: bold; border-radius: 6px; border: none; cursor: pointer; font-size: 11px;">
            ✏️ Adı Değiştir
          </button>
          <button id="del-stop-${idx}" style="flex: 1; padding: 4px 6px; background-color: #e11d48; color: #ffffff; font-weight: bold; border-radius: 6px; border: none; cursor: pointer; font-size: 11px;">
            🗑️ Durağı Sil
          </button>
        </div>
      `;
      const popup = new maplibregl.Popup({ offset: 14, closeButton: true }).setDOMContent(popupEl);
      marker.setPopup(popup);
      popup.on("open", () => {
        const renameBtn = document.getElementById(`rename-stop-${idx}`);
        if (renameBtn) renameBtn.onclick = () => {
          const newName = prompt("Yeni Durak Adını Girin:", stop.name);
          if (newName && newName.trim()) {
            setStopsList((prev) =>
              prev.map((s) => (s.stop_id === stop.stop_id ? { ...s, name: newName.trim() } : s))
            );
          }
          popup.remove();
        };
        const delBtn = document.getElementById(`del-stop-${idx}`);
        if (delBtn) delBtn.onclick = () => {
          handleRemoveStop(stop.stop_id);
          popup.remove();
        };
      });
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        const newLat = Number(ll.lat.toFixed(6));
        const newLon = Number(ll.lng.toFixed(6));
        setStopsList((prev) =>
          prev.map((s) => (s.stop_id === stop.stop_id ? { ...s, lat: newLat, lon: newLon } : s))
        );
      });
      stopMarkersRef.current.push(marker);
    });

    // 5. Fit bounds if we have any data
    const allPoints: [number, number][] = [
      ...shapeCoords.map((c) => [c.lon, c.lat] as [number, number]),
      ...stopsList.map((s) => [s.lon, s.lat] as [number, number]),
    ];
    if (allPoints.length >= 1) {
      const bounds = new maplibregl.LngLatBounds(allPoints[0], allPoints[0]);
      for (const p of allPoints.slice(1)) bounds.extend(p);
      try {
        map.fitBounds(bounds, { padding: 50, duration: 600, maxZoom: 17 });
      } catch {
        // ignore invalid bounds
      }
    }

    // 6. Click listener for adding shape points or stops
    if (mapClickHandlerRef.current) {
      map.off("click", mapClickHandlerRef.current);
      mapClickHandlerRef.current = null;
    }
    const clickHandler = (e: any) => {
      const lat = Number(e.lngLat.lat.toFixed(6));
      const lon = Number(e.lngLat.lng.toFixed(6));
      if (editMode === "add_shape") {
        setShapeCoords((prev) => [...prev, { lat, lon }]);
      } else if (editMode === "add_stop") {
        const stopName = prompt("Yeni Durak Adını Girin:", `Durak #${stopsList.length + 1}`);
        if (stopName) {
          const newStop = {
            stop_id: `${activeCityId}_ST_${Date.now()}`,
            city_id: activeCityId,
            name: stopName,
            lat,
            lon,
            sequence: stopsList.length + 1,
          };
          setStopsList((prev) => [...prev, newStop]);
        }
      }
    };
    mapClickHandlerRef.current = clickHandler;
    map.on("click", clickHandler);
  }

  // Remove a shape coordinate point
  const handleRemoveShapePoint = (index: number) => {
    setShapeCoords((prev) => prev.filter((_, i) => i !== index));
  };

  // Remove a stop
  const handleRemoveStop = (stopId: string) => {
    setStopsList((prev) => prev.filter((s) => s.stop_id !== stopId));
  };

  // Valhalla Routing Auto-Snap Handler (via Server Proxy to bypass CORS)
  // Snap existing shape points to road network using trace_route.
  const handleValhallaSnap = async () => {
    if (shapeCoords.length < 2) {
      alert("Snap için en az 2 shape noktası gereklidir!");
      return;
    }

    setIsValhallaRouting(true);
    try {
      const shape = shapeCoords.map((c) => ({ lat: c.lat, lon: c.lon }));
      const proxyPayload = {
        targetUrl: valhallaUrl.trim(),
        shape,
        costing: "bus",
        costing_options: {
          bus: {
            use_highways: 0.1,
            use_tolls: 0.5,
            use_ferry: 0,
          },
        },
        shape_match: "map_snap",
        shape_format: "polyline6",
        filters: {
          action: "include",
        },
        directed: false,
      };

      const res = await fetch("/api/valhalla", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proxyPayload),
      });

      const valhallaData = await res.json();

      if (!res.ok || valhallaData.error) {
        throw new Error(valhallaData.message || `Proxy sunucu hatası: HTTP ${res.status}`);
      }

      // trace_route returns a single shape string at the top level
      if (valhallaData.shape) {
        const decoded = decodeValhallaPolyline(valhallaData.shape, 6);
        if (decoded.length > 0) {
          setShapeCoords(decoded);
        } else {
          throw new Error("Valhalla shape decode boş döndü.");
        }
      } else if (valhallaData.trip && valhallaData.trip.legs) {
        // Fallback: some servers return legs[].shape
        const newShapePoints: Array<{ lat: number; lon: number }> = [];
        valhallaData.trip.legs.forEach((leg: any) => {
          if (leg.shape) {
            const decoded = decodeValhallaPolyline(leg.shape, 6);
            newShapePoints.push(...decoded);
          }
        });
        if (newShapePoints.length > 0) {
          setShapeCoords(newShapePoints);
        }
      } else {
        throw new Error("Valhalla yanıtında shape bulunamadı.");
      }
    } catch (err: any) {
      alert("Valhalla Shape Snap Hatası: " + err.message);
    } finally {
      setIsValhallaRouting(false);
    }
  };

  // Save changes to PostGIS DB
  const handleSaveToDb = () => {
    if (!activeRouteId) return;
    const formData = new FormData();
    formData.append("intent", "save_route_editor");
    formData.append("routeId", activeRouteId);
    formData.append("direction", String(effectiveDirection));
    formData.append("shapeCoordinates", JSON.stringify(shapeCoords));
    formData.append("stopsList", JSON.stringify(stopsList));
    submit(formData, { method: "post" });
  };

  const filteredRoutesList = routes.filter((r) =>
    routeSearchText
      ? r.name.toLowerCase().includes(routeSearchText.toLowerCase()) ||
        (r.code && r.code.toLowerCase().includes(routeSearchText.toLowerCase()))
      : true
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0 z-30">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <RouteIcon className="w-5 h-5 text-blue-600" />
            <span>İnteraktif Rota & Durak Sürükleme Düzenleyicisi</span>
          </h1>
          <p className="text-xs text-slate-500">
            Harita üzerindeki durakları ve rota çizgi noktalarını tıklayarak silin, adını değiştirin veya sürükleyin.
          </p>
        </div>

        {/* Top Action Save Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveToDb}
            disabled={isSaving || !activeRouteId}
            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Veritabanına Kaydediliyor...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Değişiklikleri Veritabanına Kaydet</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Interactive Split View */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Left Control Toolbar */}
        <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col z-20 shadow-md">
          {/* Action Success / Error Banners */}
          {actionData && (
            <div className={`p-3 text-xs font-semibold flex items-center gap-2 ${
              actionData.success ? "bg-emerald-50 text-emerald-900 border-b border-emerald-200" : "bg-rose-50 text-rose-900 border-b border-rose-200"
            }`}>
              {actionData.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <AlertOctagon className="w-4 h-4 text-rose-600 flex-shrink-0" />}
              <span>{actionData.message}</span>
            </div>
          )}

          {/* Selectors */}
          <div className="p-4 border-b border-slate-100 space-y-3 bg-slate-50/50">
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Şehir</label>
              <select
                value={activeCityId}
                onChange={(e) => handleCityChange(e.target.value)}
                className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
              >
                {cities.map((c) => (
                  <option key={c.city_id} value={c.city_id}>
                    {c.country_name} - {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Hat / Rota</label>
              <div className="relative mb-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Hat ara..."
                  value={routeSearchText}
                  onChange={(e) => setRouteSearchText(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-md text-xs"
                />
              </div>
              <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
                {filteredRoutesList.map((r) => (
                  <button
                    key={r.route_id}
                    onClick={() => handleRouteChange(r.route_id)}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition ${
                      r.route_id === activeRouteId ? "bg-blue-50 text-blue-700 font-bold" : "hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <span className="truncate">{r.code ? `[${r.code}] ` : ""}{r.name}</span>
                    {r.route_id === activeRouteId && <Check className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Direction */}
            {activeRoute && (
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Yön</label>
                {isLoopRoute ? (
                  <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs font-semibold text-blue-900 flex items-center justify-between">
                    <span className="flex items-center gap-1"><RotateCw className="w-3.5 h-3.5 text-blue-600" /> Ring (Loop)</span>
                    <span className="px-1.5 py-0.5 bg-blue-600 text-white text-[10px] rounded">Yön 0</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      onClick={() => setSelectedDirection(1)}
                      className={`py-1.5 rounded-lg border font-semibold ${effectiveDirection === 1 ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700"}`}
                    >
                      Gidiş (1)
                    </button>
                    <button
                      onClick={() => setSelectedDirection(2)}
                      className={`py-1.5 rounded-lg border font-semibold ${effectiveDirection === 2 ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700"}`}
                    >
                      Dönüş (2)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interactive Edit Toolbar */}
          <div className="p-4 border-b border-slate-100 space-y-3 bg-white">
            <label className="block text-[11px] font-bold uppercase text-slate-500">Harita Etkileşim Modu</label>
            <div className="grid grid-cols-3 gap-1.5 text-xs font-semibold">
              <button
                onClick={() => setEditMode("view")}
                className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition ${
                  editMode === "view" ? "bg-blue-50 border-blue-400 text-blue-900" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Move className="w-4 h-4 text-blue-600" />
                <span>İncele / Sürükle</span>
              </button>

              <button
                onClick={() => setEditMode("add_shape")}
                className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition ${
                  editMode === "add_shape" ? "bg-blue-600 text-white border-blue-600" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>Nokta Çiz</span>
              </button>

              <button
                onClick={() => setEditMode("add_stop")}
                className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition ${
                  editMode === "add_stop" ? "bg-amber-500 text-white border-amber-500" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <MapPin className="w-4 h-4" />
                <span>Durak Ekle</span>
              </button>
            </div>

            {/* Valhalla Auto-Snap Control */}
            <div className="pt-2 space-y-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-1.5"><Zap className="w-4 h-4 text-amber-500" /> Valhalla Routing Server</span>
              </div>
              <input
                type="text"
                value={valhallaUrl}
                onChange={(e) => setValhallaUrl(e.target.value)}
                placeholder="Valhalla Server URL"
                className="w-full px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
              />
              <button
                onClick={handleValhallaSnap}
                disabled={isValhallaRouting || stopsList.length < 2}
                className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-2xs transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isValhallaRouting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                <span>Valhalla ile Yollara Eşitle (Auto Snap)</span>
              </button>
            </div>
          </div>

          {/* Current Shapes & Stops Status Lists */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Shape Points Count */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-900">
                <span>Rota Çizgi Noktaları (`shape`)</span>
                <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-mono">{shapeCoords.length} Nokta</span>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {shapeCoords.map((pt, i) => (
                  <div key={i} className="flex items-center justify-between bg-white px-2 py-1 rounded border border-slate-200 font-mono text-[11px]">
                    <span>#{i + 1}: {pt.lat}, {pt.lon}</span>
                    <button onClick={() => handleRemoveShapePoint(i)} className="text-rose-600 hover:underline">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Stops List */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-900">
                <span>Durak Listesi (`stop`)</span>
                <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono">{stopsList.length} Durak</span>
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1">
                {stopsList.map((st, i) => (
                  <div key={st.stop_id} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-slate-200 text-xs">
                    <div className="truncate">
                      <span className="font-bold text-slate-800">#{i + 1}</span> <span className="font-semibold text-slate-900">{st.name}</span>
                      <span className="block text-[10px] text-slate-400 font-mono">{st.lat}, {st.lon}</span>
                    </div>
                    <button onClick={() => handleRemoveStop(st.stop_id)} className="text-rose-600 hover:underline flex-shrink-0 ml-2">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Map Canvas Area (MapLibre Vector Tiles via MapTiler) */}
        <div className="flex-1 h-full min-h-[500px] relative bg-slate-100">
          <div ref={mapContainerRef} className="w-full h-full absolute inset-0 z-10" />

          {/* Active Mode Banner */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-white/95 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-slate-200 text-xs font-bold text-slate-900 flex items-center gap-2">
            {editMode === "add_shape" && <span className="text-blue-600 animate-pulse">✏️ Haritaya Tıklayarak Rota Çizgisine Nokta Ekleyin</span>}
            {editMode === "add_stop" && <span className="text-amber-600 animate-pulse">🚏 Haritaya Tıklayarak Yeni Durak Ekleyin</span>}
            {editMode === "view" && <span className="text-slate-700">🖐️ Sürükleyin veya Noktalara Tıklayarak Düzenleyin / Silin</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper: Decode Valhalla Polyline 6 format
function decodeValhallaPolyline(str: string, precision: number) {
  let index = 0, lat = 0, lng = 0, coordinates: Array<{ lat: number; lon: number }> = [];
  let factor = Math.pow(10, precision || 6);

  while (index < str.length) {
    let byte = 0, shift = 0, result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    let deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    let deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push({ lat: Number((lat / factor).toFixed(6)), lon: Number((lng / factor).toFixed(6)) });
  }

  return coordinates;
}
