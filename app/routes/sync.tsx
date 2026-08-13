import { useLoaderData, useSearchParams, useSubmit, useActionData, useNavigation } from "react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { getCountriesAndCities, getRoutesForCity, getMapRouteDetails, saveRouteEditorData } from "../lib/db-operations.server";
import { formatName, type MultilingualText } from "../lib/types";
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
  Focus,
  Play,
  Square,
  X,
  Terminal,
  Layers,
  Sparkles,
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
  const mapInstanceRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const layerGroupRef = useRef<any>(null);
  const lastFittedKeyRef = useRef<string>("");

  const routeColor = "#dc2626";
  const stopColor = "#2563eb";

  const [selectedDirection, setSelectedDirection] = useState<number>(1);
  const [routeSearchText, setRouteSearchText] = useState<string>("");
  const [valhallaUrl, setValhallaUrl] = useState<string>("https://valhala.bykemalh.me");
  const [isValhallaRouting, setIsValhallaRouting] = useState<boolean>(false);

  // Bulk Auto Snap State
  const [isBulkModalOpen, setIsBulkModalOpen] = useState<boolean>(false);
  const [isBulkRunning, setIsBulkRunning] = useState<boolean>(false);
  const [bulkLogs, setBulkLogs] = useState<Array<{ id: string; time: string; type: "info" | "success" | "warning" | "error"; text: string }>>([]);
  const [bulkProgress, setBulkProgress] = useState<{ totalRoutes: number; currentRouteIdx: number; successDirections: number; failedDirections: number }>({
    totalRoutes: 0,
    currentRouteIdx: 0,
    successDirections: 0,
    failedDirections: 0,
  });
  const abortBulkRef = useRef<boolean>(false);
  const logConsoleRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logConsoleRef.current) {
      logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
    }
  }, [bulkLogs]);

  const addBulkLog = (type: "info" | "success" | "warning" | "error", text: string) => {
    const time = new Date().toLocaleTimeString("tr-TR");
    const id = Math.random().toString(36).substring(2, 9);
    setBulkLogs((prev) => [...prev, { id, time, type, text }]);
  };

  const handleStartBulkSnap = async () => {
    if (routes.length === 0) {
      alert("Seçili şehirde işlenecek hat bulunamadı!");
      return;
    }

    setIsBulkRunning(true);
    abortBulkRef.current = false;
    setBulkLogs([]);
    setBulkProgress({
      totalRoutes: routes.length,
      currentRouteIdx: 0,
      successDirections: 0,
      failedDirections: 0,
    });

    addBulkLog("info", `🚀 Toplu Auto Snap işlemi başlatılıyor... (Şehir: ${formatName(activeCityObj?.name) || activeCityId}, Toplam ${routes.length} Hat)`);
    addBulkLog("info", `🌐 Valhalla Server URL: ${valhallaUrl}`);

    let totalSuccess = 0;
    let totalFailed = 0;

    for (let i = 0; i < routes.length; i++) {
      if (abortBulkRef.current) {
        addBulkLog("warning", "⏹️ Toplu snap işlemi kullanıcı tarafından durduruldu.");
        break;
      }

      const routeItem = routes[i];
      const routeName = `${routeItem.code ? `[${routeItem.code}] ` : ""}${formatName(routeItem.name)}`;

      setBulkProgress((prev) => ({
        ...prev,
        currentRouteIdx: i + 1,
      }));

      addBulkLog("info", `--------------------------------------------------`);
      addBulkLog("info", `📌 Hat [${i + 1}/${routes.length}]: ${routeName}`);

      try {
        const detailsRes = await fetch(`/api/route-details?routeId=${encodeURIComponent(routeItem.route_id)}`);
        const detailsData = await detailsRes.json();

        if (!detailsRes.ok || !detailsData.success || !detailsData.details) {
          addBulkLog("error", `❌ ${routeName}: Rota detayları çekilemedi (${detailsData.message || "Bilinmeyen sunucu hatası"})`);
          totalFailed++;
          continue;
        }

        const { route: routeObj, shapes, stops } = detailsData.details;
        const isLoop = routeObj.route_pattern === "loop";
        const targetDirections = isLoop ? [0] : [1, 2];

        for (const dir of targetDirections) {
          if (abortBulkRef.current) break;

          const dirLabel = isLoop ? "Ring (Yön 0)" : (dir === 1 ? "Gidiş (Yön 1)" : "Dönüş (Yön 2)");
          addBulkLog("info", `  🔄 ${routeName} - ${dirLabel}: Snap isteği gönderiliyor...`);

          let shape = shapes.find((s: any) => Number(s.direction) === dir);
          let rawCoords: Array<{ lat: number; lon: number }> = [];

          if (shape && shape.coordinates && Array.isArray(shape.coordinates) && shape.coordinates.length >= 2) {
            rawCoords = shape.coordinates.map((c: any) => ({ lat: Number(c.lat), lon: Number(c.lon) }));
          } else {
            const dirStops = stops.filter((s: any) => Number(s.direction) === dir);
            if (dirStops.length >= 2) {
              rawCoords = dirStops.map((s: any) => ({ lat: Number(s.lat), lon: Number(s.lon) }));
            }
          }

          if (rawCoords.length < 2) {
            addBulkLog("warning", `  ⚠️ ${routeName} - ${dirLabel}: Atlandı (En az 2 durak/nokta gerekli).`);
            continue;
          }

          const proxyPayload = {
            targetUrl: valhallaUrl.trim(),
            shape: rawCoords,
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
            filters: { action: "include" },
            directed: false,
          };

          const vRes = await fetch("/api/valhalla", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(proxyPayload),
          });

          const vData = await vRes.json();

          if (!vRes.ok || vData.error) {
            addBulkLog("error", `  ❌ ${routeName} - ${dirLabel}: Valhalla hatası (${vData.message || `HTTP ${vRes.status}`})`);
            totalFailed++;
            continue;
          }

          let snappedPoints: Array<{ lat: number; lon: number }> = [];

          if (vData.shape) {
            snappedPoints = decodeValhallaPolyline(vData.shape, 6);
          } else if (vData.trip && vData.trip.legs) {
            vData.trip.legs.forEach((leg: any) => {
              if (leg.shape) {
                snappedPoints.push(...decodeValhallaPolyline(leg.shape, 6));
              }
            });
          }

          if (snappedPoints.length === 0) {
            addBulkLog("warning", `  ⚠️ ${routeName} - ${dirLabel}: Valhalla nokta üretemedi.`);
            totalFailed++;
            continue;
          }

          const dirStops = stops
            .filter((s: any) => Number(s.direction) === dir)
            .map((s: any, idx: number) => ({
              stop_id: s.stop_id,
              city_id: s.city_id || activeCityId,
              name: s.stop_name,
              lat: Number(s.lat),
              lon: Number(s.lon),
              sequence: idx + 1,
            }));

          const saveRes = await fetch("/api/save-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              routeId: routeItem.route_id,
              direction: dir,
              shapeCoordinates: snappedPoints,
              stopsList: dirStops,
            }),
          });

          const saveData = await saveRes.json();

          if (!saveRes.ok || !saveData.success) {
            addBulkLog("error", `  ❌ ${routeName} - ${dirLabel}: Veritabanına kaydedilemedi (${saveData.message || "DB Hatası"})`);
            totalFailed++;
          } else {
            totalSuccess++;
            addBulkLog("success", `  ✅ ${routeName} - ${dirLabel}: ${snappedPoints.length} nokta ile yollara eşitlendi ve kaydedildi.`);

            if (routeItem.route_id === activeRouteId && dir === effectiveDirection) {
              setShapeCoords(snappedPoints);
            }
          }
        }
      } catch (err: any) {
        addBulkLog("error", `❌ ${routeName}: Hata oluştu (${err.message})`);
        totalFailed++;
      }

      setBulkProgress((prev) => ({
        ...prev,
        successDirections: totalSuccess,
        failedDirections: totalFailed,
      }));
    }

    setIsBulkRunning(false);
    addBulkLog("info", `--------------------------------------------------`);
    addBulkLog("info", `🎉 Toplu Snap İşlemi Bitti! Toplam ${totalSuccess} yön başarılı, ${totalFailed} yön hatalı/atlandı.`);
  };

  const handleStopBulkSnap = () => {
    abortBulkRef.current = true;
    addBulkLog("warning", "⏳ Durdurma isteği iletildi, mevcut hat tamamlanınca duracak...");
  };

  // Editing State
  const [editMode, setEditMode] = useState<"view" | "add_shape" | "add_stop">("view");
  const [shapeCoords, setShapeCoords] = useState<Array<{ lat: number; lon: number }>>([]);
  const [stopsList, setStopsList] = useState<Array<{ stop_id: string; city_id: string; name: string | MultilingualText; lat: number; lon: number; sequence: number }>>([]);

  const editModeRef = useRef<"view" | "add_shape" | "add_stop">("view");
  const stopsListRef = useRef<any[]>([]);
  const activeCityIdRef = useRef<string>("");

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  useEffect(() => {
    stopsListRef.current = stopsList;
  }, [stopsList]);

  useEffect(() => {
    activeCityIdRef.current = activeCityId;
  }, [activeCityId]);

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

  // Remove a shape coordinate point
  const handleRemoveShapePoint = (index: number) => {
    setShapeCoords((prev) => prev.filter((_, i) => i !== index));
  };

  // Remove a stop
  const handleRemoveStop = (stopId: string) => {
    setStopsList((prev) => prev.filter((s) => s.stop_id !== stopId));
  };

  // Render shapes and stops on Leaflet map
  const renderLeafletLayers = useCallback(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers();
    } else {
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    const layerGroup = layerGroupRef.current;
    let hasBounds = false;
    const boundsGroup = L.featureGroup();

    // 1. Draw Route Polyline Shape
    if (shapeCoords.length >= 2) {
      const latLons = shapeCoords.map((c) => [c.lat, c.lon]);

      // Outer white casing
      L.polyline(latLons, {
        color: "#ffffff",
        weight: 9,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layerGroup);

      // Main RED line
      const line = L.polyline(latLons, {
        color: routeColor,
        weight: 5,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layerGroup);

      line.addTo(boundsGroup);
      hasBounds = true;
    }

    // 2. Shape Waypoint Markers (draggable, red)
    shapeCoords.forEach((c, idx) => {
      const shapeIcon = L.divIcon({
        className: "custom-shape-marker",
        html: `<div style="background-color: ${routeColor}; border: 2px solid #ffffff; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: grab;"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([c.lat, c.lon], { icon: shapeIcon, draggable: true }).addTo(layerGroup);

      const popupContent = document.createElement("div");
      popupContent.className = "p-1.5 space-y-2 text-xs font-sans";
      popupContent.style.minWidth = "150px";
      popupContent.innerHTML = `
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

      marker.bindPopup(popupContent);
      marker.on("popupopen", () => {
        const btn = document.getElementById(`del-shape-${idx}`);
        if (btn) {
          btn.onclick = () => {
            handleRemoveShapePoint(idx);
            map.closePopup();
          };
        }
      });

      marker.on("dragend", (event: any) => {
        const newLatLng = event.target.getLatLng();
        const newLat = Number(newLatLng.lat.toFixed(6));
        const newLon = Number(newLatLng.lng.toFixed(6));
        setShapeCoords((prev) =>
          prev.map((item, i) => (i === idx ? { lat: newLat, lon: newLon } : item))
        );
      });

      marker.addTo(boundsGroup);
      hasBounds = true;
    });

    // 3. Stop Markers (draggable, blue numbered)
    stopsList.forEach((stop, idx) => {
      const stopIcon = L.divIcon({
        className: "custom-stop-marker",
        html: `<div style="background-color: ${stopColor}; border: 3px solid #ffffff; width: 26px; height: 26px; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: grab; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: #ffffff;">${idx + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const marker = L.marker([stop.lat, stop.lon], { icon: stopIcon, draggable: true }).addTo(layerGroup);

      const popupContent = document.createElement("div");
      popupContent.className = "p-1.5 space-y-2 text-xs font-sans";
      popupContent.style.minWidth = "180px";
      popupContent.innerHTML = `
        <div style="font-weight: bold; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px;">
          🚏 Durak #${idx + 1}
        </div>
        <div style="font-weight: bold; color: #0f172a; font-size: 13px;">
          ${formatName(stop.name)}
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

      marker.bindPopup(popupContent);
      marker.on("popupopen", () => {
        const renameBtn = document.getElementById(`rename-stop-${idx}`);
        if (renameBtn) {
          renameBtn.onclick = () => {
            const newName = prompt("Yeni Durak Adını Girin:", formatName(stop.name));
            if (newName && newName.trim()) {
              setStopsList((prev) =>
                prev.map((s) => (s.stop_id === stop.stop_id ? { ...s, name: { tr: newName.trim() } } : s))
              );
            }
            map.closePopup();
          };
        }
        const delBtn = document.getElementById(`del-stop-${idx}`);
        if (delBtn) {
          delBtn.onclick = () => {
            handleRemoveStop(stop.stop_id);
            map.closePopup();
          };
        }
      });

      marker.on("dragend", (event: any) => {
        const newLatLng = event.target.getLatLng();
        const newLat = Number(newLatLng.lat.toFixed(6));
        const newLon = Number(newLatLng.lng.toFixed(6));
        setStopsList((prev) =>
          prev.map((s) => (s.stop_id === stop.stop_id ? { ...s, lat: newLat, lon: newLon } : s))
        );
      });

      marker.addTo(boundsGroup);
      hasBounds = true;
    });

    // 4. Fit bounds ONLY when route or direction key changes!
    const currentKey = `${activeCityId}_${activeRouteId}_${effectiveDirection}`;
    if (lastFittedKeyRef.current !== currentKey && hasBounds) {
      const bounds = boundsGroup.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
        lastFittedKeyRef.current = currentKey;
      }
    }
  }, [shapeCoords, stopsList, activeCityId, activeRouteId, effectiveDirection]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let map: any;

    import("leaflet").then((module) => {
      const L = module.default;
      leafletRef.current = L;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
      });

      const centerLat = activeCityObj ? Number(activeCityObj.lat) : 40.19;
      const centerLon = activeCityObj ? Number(activeCityObj.lon) : 29.06;
      const defaultZoom = activeCityObj?.default_zoom || 12;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      map = L.map(mapContainerRef.current!, {
        center: [centerLat, centerLon],
        zoom: defaultZoom,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      mapInstanceRef.current = map;
      layerGroupRef.current = L.layerGroup().addTo(map);

      map.on("click", (e: any) => {
        const lat = Number(e.latlng.lat.toFixed(6));
        const lon = Number(e.latlng.lng.toFixed(6));
        const currentEditMode = editModeRef.current;
        if (currentEditMode === "add_shape") {
          setShapeCoords((prev) => [...prev, { lat, lon }]);
        } else if (currentEditMode === "add_stop") {
          const stopName = prompt("Yeni Durak Adını Girin:", `Durak #${stopsListRef.current.length + 1}`);
          if (stopName && stopName.trim()) {
            const newStop = {
              stop_id: `${activeCityIdRef.current}_ST_${Date.now()}`,
              city_id: activeCityIdRef.current,
              name: { tr: stopName.trim() },
              lat,
              lon,
              sequence: stopsListRef.current.length + 1,
            };
            setStopsList((prev) => [...prev, newStop]);
          }
        }
      });

      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 150);

      renderLeafletLayers();
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [activeCityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render layers when shapeCoords, stopsList or editMode change
  useEffect(() => {
    renderLeafletLayers();
  }, [renderLeafletLayers]);

  // Recenter map manually
  const handleRecenterMap = () => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    const allPoints: [number, number][] = [
      ...shapeCoords.map((c) => [c.lat, c.lon] as [number, number]),
      ...stopsList.map((s) => [s.lat, s.lon] as [number, number]),
    ];

    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
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
      ? formatName(r.name).toLowerCase().includes(routeSearchText.toLowerCase()) ||
        (r.code && r.code.toLowerCase().includes(routeSearchText.toLowerCase())) ||
        (r.slug && r.slug.toLowerCase().includes(routeSearchText.toLowerCase()))
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

        {/* Top Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsBulkModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
          >
            <Zap className="w-4 h-4 fill-white" />
            <span>Toplu Auto Snap ({routes.length} Hat)</span>
          </button>

          <button
            onClick={handleSaveToDb}
            disabled={isSaving || !activeRouteId}
            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition disabled:opacity-50 cursor-pointer"
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
                    {formatName(c.country_name)} - {formatName(c.name)}
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
                    <span className="truncate">{r.code ? `[${r.code}] ` : ""}{formatName(r.name)}</span>
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
                className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-2xs transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isValhallaRouting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                <span>Seçili Hat Yollara Eşitle (Snap)</span>
              </button>

              <button
                onClick={() => setIsBulkModalOpen(true)}
                className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-300 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                <span>Tüm Şehir Hatlarını Toplu Eşitle (Bulk)</span>
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
                      <span className="font-bold text-slate-800">#{i + 1}</span> <span className="font-semibold text-slate-900">{formatName(st.name)}</span>
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

        {/* Right Map Canvas Area (Leaflet OpenStreetMap) */}
        <div className="flex-1 h-full min-h-[500px] relative bg-slate-100">
          <div ref={mapContainerRef} className="w-full h-full absolute inset-0 z-10" />

          {/* Active Mode & Action Overlay Banner */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
            <div className="bg-white/95 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-slate-200 text-xs font-bold text-slate-900 flex items-center gap-2">
              {editMode === "add_shape" && <span className="text-blue-600 animate-pulse">✏️ Haritaya Tıklayarak Rota Çizgisine Nokta Ekleyin</span>}
              {editMode === "add_stop" && <span className="text-amber-600 animate-pulse">🚏 Haritaya Tıklayarak Yeni Durak Ekleyin</span>}
              {editMode === "view" && <span className="text-slate-700">🖐️ Sürükleyin veya Noktalara Tıklayarak Düzenleyin / Silin</span>}
            </div>
            <button
              onClick={handleRecenterMap}
              title="Haritayı Rota ve Duraklara Odakla"
              className="bg-white hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-full shadow-lg border border-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Focus className="w-4 h-4 text-blue-600" />
              <span>Ortala</span>
            </button>
          </div>
        </div>
      </div>

      {/* BULK AUTO SNAP MODAL */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl max-w-3xl w-full shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl">
                  <Zap className="w-5 h-5 fill-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    Toplu Valhalla Rota Eşitleme Motoru (Bulk Auto Snap)
                  </h3>
                  <p className="text-xs text-slate-400">
                    {activeCityObj ? `${formatName(activeCityObj.country_name)} - ${formatName(activeCityObj.name)}` : activeCityId} şehrine ait tüm hatların rotalarını Valhalla ile otonom olarak yollara çeker ve kaydeder.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (isBulkRunning) handleStopBulkSnap();
                  setIsBulkModalOpen(false);
                }}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
              {/* Config & Controls */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Seçili Şehir</label>
                  <div className="font-bold text-white flex items-center gap-1.5 truncate">
                    <Layers className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="truncate">{activeCityObj ? formatName(activeCityObj.name) : activeCityId} ({routes.length} Hat)</span>
                  </div>
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Valhalla Routing Server URL</label>
                  <input
                    type="text"
                    value={valhallaUrl}
                    onChange={(e) => setValhallaUrl(e.target.value)}
                    disabled={isBulkRunning}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg font-mono text-xs text-slate-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Progress Bar & Badges */}
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-300 flex items-center gap-1.5">
                    {isBulkRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" /> : <Terminal className="w-3.5 h-3.5 text-amber-400" />}
                    <span>İşlem Durumu: {isBulkRunning ? "İşleniyor..." : (bulkProgress.currentRouteIdx > 0 ? "Tamamlandı" : "Hazır")}</span>
                  </span>
                  <span className="font-mono text-amber-400">
                    {bulkProgress.totalRoutes > 0
                      ? `${Math.round((bulkProgress.currentRouteIdx / bulkProgress.totalRoutes) * 100)}% (${bulkProgress.currentRouteIdx}/${bulkProgress.totalRoutes} Hat)`
                      : "0%"}
                  </span>
                </div>

                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-amber-500 to-amber-400 h-full transition-all duration-300"
                    style={{
                      width: `${bulkProgress.totalRoutes > 0 ? (bulkProgress.currentRouteIdx / bulkProgress.totalRoutes) * 100 : 0}%`,
                    }}
                  />
                </div>

                {/* Counters */}
                <div className="grid grid-cols-4 gap-2 pt-1 text-center text-xs">
                  <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Toplam Hat</span>
                    <span className="font-mono font-bold text-slate-200">{bulkProgress.totalRoutes}</span>
                  </div>
                  <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">İşlenen</span>
                    <span className="font-mono font-bold text-amber-400">{bulkProgress.currentRouteIdx}</span>
                  </div>
                  <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Başarılı Yön</span>
                    <span className="font-mono font-bold text-emerald-400">{bulkProgress.successDirections}</span>
                  </div>
                  <div className="p-1.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Hata / Atlanan</span>
                    <span className="font-mono font-bold text-rose-400">{bulkProgress.failedDirections}</span>
                  </div>
                </div>
              </div>

              {/* Terminal Log Console */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-400 px-1">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-slate-400" />
                    <span>İşlem Canlı Günlüğü (Realtime Execution Logs)</span>
                  </span>
                  <button
                    onClick={() => setBulkLogs([])}
                    disabled={isBulkRunning}
                    className="text-[10px] text-slate-500 hover:text-slate-300 underline disabled:opacity-30 cursor-pointer"
                  >
                    Temizle
                  </button>
                </div>

                <div
                  ref={logConsoleRef}
                  className="h-64 bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs overflow-y-auto space-y-1 selection:bg-amber-500/30"
                >
                  {bulkLogs.length === 0 ? (
                    <p className="text-slate-600 italic text-center py-12">
                      Toplu snap işlemini başlatmak için aşağıdaki düğmeye tıklayın...
                    </p>
                  ) : (
                    bulkLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-slate-600 text-[10px] flex-shrink-0 font-mono">[{log.time}]</span>
                        <span
                          className={
                            log.type === "success"
                              ? "text-emerald-400"
                              : log.type === "error"
                              ? "text-rose-400"
                              : log.type === "warning"
                              ? "text-amber-400 font-semibold"
                              : "text-slate-300"
                          }
                        >
                          {log.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Arka planda tüm hatların şekilleri Valhalla ile yollara hizalanır.
              </span>

              <div className="flex items-center gap-2">
                {isBulkRunning ? (
                  <button
                    onClick={handleStopBulkSnap}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-white" />
                    <span>Durdur</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStartBulkSnap}
                    className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Toplu Eşitlemeyi Başlat</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
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
