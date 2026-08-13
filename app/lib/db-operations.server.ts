import { query, pool } from "./db.server";
import { toMultilingualName } from "./types";
import type { EntityName, ImportConflictAnalysis, DiffResult, MultilingualText } from "./types";

// =====================================================================
// DASHBOARD STATS
// =====================================================================
export async function getTableCounts() {
  const res = await query<{
    countries: number;
    cities: number;
    agencies: number;
    routes: number;
    stops: number;
    trips: number;
    stop_times: number;
    fares: number;
    holidays: number;
    shapes: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM country) as countries,
      (SELECT COUNT(*)::int FROM city) as cities,
      (SELECT COUNT(*)::int FROM agency) as agencies,
      (SELECT COUNT(*)::int FROM route) as routes,
      (SELECT COUNT(*)::int FROM stop) as stops,
      (SELECT COUNT(*)::int FROM trip) as trips,
      (SELECT COUNT(*)::int FROM stop_time) as stop_times,
      (SELECT COUNT(*)::int FROM fare) as fares,
      (SELECT COUNT(*)::int FROM holiday) as holidays,
      (SELECT COUNT(*)::int FROM shape) as shapes
  `);
  return res.rows[0];
}

export async function getDashboardStats() {
  // Run all 3 queries in parallel
  const [counts, citySummary, vehicleStats] = await Promise.all([
    getTableCounts(),
    query<{
      city_id: string;
      city_name: MultilingualText;
      country_name: MultilingualText;
      routes_count: number;
      stops_count: number;
    }>(`
      SELECT 
        c.city_id,
        c.name as city_name,
        co.name as country_name,
        (SELECT COUNT(*)::int FROM route r JOIN agency a ON r.agency_id = a.agency_id WHERE a.city_id = c.city_id) as routes_count,
        (SELECT COUNT(*)::int FROM stop s WHERE s.city_id = c.city_id) as stops_count
      FROM city c
      JOIN country co ON c.country_id = co.country_id
      ORDER BY c.name->>'tr' ASC
    `),
    query<{ vehicle_type: string; count: number }>(`
      SELECT vehicle_type, COUNT(*)::int as count 
      FROM route 
      GROUP BY vehicle_type 
      ORDER BY count DESC
    `),
  ]);

  return {
    totals: counts || {
      countries: 0,
      cities: 0,
      agencies: 0,
      routes: 0,
      stops: 0,
      trips: 0,
      stop_times: 0,
      fares: 0,
      holidays: 0,
      shapes: 0,
    },
    cities: citySummary.rows,
    vehicleStats: vehicleStats.rows,
  };
}

// =====================================================================
// MAP DATA LOADERS
// =====================================================================
export async function getCountriesAndCities() {
  const res = await query(`
    SELECT 
      c.city_id, c.slug, c.name, c.country_id, c.timezone,
      c.center_lat as lat, c.center_lon as lon, c.default_zoom,
      co.name as country_name
    FROM city c
    JOIN country co ON co.country_id = c.country_id
    ORDER BY co.name->>'tr', c.name->>'tr'
  `);
  return res.rows;
}

export async function getRoutesForCity(cityId: string) {
  const res = await query(
    `
    SELECT 
      r.route_id, r.slug, r.agency_id, r.name, r.code, r.color, 
      r.vehicle_type, r.route_pattern, r.stop_mode,
      a.name as agency_name
    FROM route r
    JOIN agency a ON r.agency_id = a.agency_id
    WHERE a.city_id = $1
    ORDER BY r.code, r.name->>'tr'
  `,
    [cityId]
  );
  return res.rows;
}

export async function getMapRouteDetails(routeId: string) {
  // Run all queries in parallel for maximum speed
  const [routeRes, shapesRes, stopsRes, tripsRes] = await Promise.all([
    // 1. Route info
    query(`SELECT * FROM route WHERE route_id = $1`, [routeId]),
    // 2. Shapes (geometries)
    query(
      `SELECT shape_id, route_id, direction, coordinates FROM shape WHERE route_id = $1`,
      [routeId]
    ),
    // 3. Route Stops
    query(
      `
      SELECT 
        rs.route_id, rs.direction, rs.sequence, rs.is_first_stop, rs.is_last_stop,
        s.stop_id, s.city_id, s.name as stop_name, s.lat, s.lon, s.location_type,
        s.wheelchair_accessible, s.shelter_type, s.has_real_time_display
      FROM route_stop rs
      JOIN stop s ON rs.stop_id = s.stop_id
      WHERE rs.route_id = $1
      ORDER BY rs.direction, rs.sequence
    `,
      [routeId]
    ),
    // 4. Trips & timetable summary
    query(
      `
      SELECT t.trip_id, t.direction, t.service_type,
             st.stop_id, st.sequence, st.departure_time
      FROM trip t
      JOIN stop_time st ON t.trip_id = st.trip_id
      WHERE t.route_id = $1
      ORDER BY t.direction, t.service_type, st.sequence, st.departure_secs
    `,
      [routeId]
    ),
  ]);

  const route = routeRes.rows[0];
  if (!route) return null;

  const shapes = shapesRes.rows.map((s: any) => {
    let coords = s.coordinates;
    if (typeof coords === "string") {
      try {
        coords = JSON.parse(coords);
      } catch (e) {
        coords = [];
      }
    }
    return {
      ...s,
      direction: Number(s.direction),
      coordinates: Array.isArray(coords) ? coords : [],
    };
  });

  const stops = stopsRes.rows.map((s: any) => ({
    ...s,
    direction: Number(s.direction),
    lat: Number(s.lat),
    lon: Number(s.lon),
  }));

  return {
    route,
    shapes,
    stops,
    trips: tripsRes.rows,
  };
}

// =====================================================================
// SAVE ROUTE EDITOR CHANGES
// =====================================================================
export async function saveRouteEditorData(
  routeId: string,
  direction: number,
  shapeCoordinates: Array<{ lat: number; lon: number }>,
  stops: Array<{ stop_id: string; city_id: string; name: string | MultilingualText; lat: number; lon: number; sequence: number }>
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated_at = new Date().toISOString();

    // 1. Upsert Shape
    const shapeId = `SHP_${routeId}_${direction}`;
    await client.query(
      `INSERT INTO shape (shape_id, route_id, direction, coordinates, updated_at, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (route_id, direction) DO UPDATE SET
         shape_id = EXCLUDED.shape_id,
         coordinates = EXCLUDED.coordinates,
         updated_at = EXCLUDED.updated_at,
         source = EXCLUDED.source`,
      [shapeId, routeId, direction, JSON.stringify(shapeCoordinates), updated_at, "route_editor"]
    );

    // 2. Clear existing route_stops for this route & direction
    await client.query("DELETE FROM route_stop WHERE route_id = $1 AND direction = $2", [routeId, direction]);

    // 3. Upsert Stops & RouteStops
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const seq = i + 1;
      const stopNameJson = JSON.stringify(toMultilingualName(s.name));

      // Upsert stop location
      await client.query(
        `INSERT INTO stop (stop_id, city_id, name, lat, lon, updated_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (stop_id) DO UPDATE SET
           name = EXCLUDED.name,
           lat = EXCLUDED.lat,
           lon = EXCLUDED.lon,
           updated_at = EXCLUDED.updated_at`,
        [s.stop_id, s.city_id, stopNameJson, s.lat, s.lon, updated_at, "route_editor"]
      );

      // Insert route_stop sequence
      await client.query(
        `INSERT INTO route_stop (route_id, direction, stop_id, sequence, is_first_stop, is_last_stop, updated_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (route_id, direction, stop_id) DO UPDATE SET
           sequence = EXCLUDED.sequence,
           is_first_stop = EXCLUDED.is_first_stop,
           is_last_stop = EXCLUDED.is_last_stop,
           updated_at = EXCLUDED.updated_at`,
        [routeId, direction, s.stop_id, seq, seq === 1, seq === stops.length, updated_at, "route_editor"]
      );
    }

    await client.query("COMMIT");
    return { success: true, message: "Rota ve durak değişiklikleri veritabanına kaydedildi." };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("Save Route Editor Error:", err);
    throw err;
  } finally {
    client.release();
  }
}

// =====================================================================
// CRUD DATA MANAGER
// =====================================================================
export async function getEntityData(entity: EntityName, page = 1, limit = 50, search = "") {
  const offset = (page - 1) * limit;
  let text = "";
  let countText = "";

  switch (entity) {
    case "country":
      countText = `SELECT COUNT(*)::int FROM country ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR country_id ILIKE $1)" : ""}`;
      text = `SELECT * FROM country ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR country_id ILIKE $1)" : ""} ORDER BY name->>'tr' LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "city":
      countText = `SELECT COUNT(*)::int FROM city ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR slug ILIKE $1 OR city_id ILIKE $1)" : ""}`;
      text = `SELECT city_id, slug, country_id, name, timezone, center_lat as "lat", center_lon as "lon", default_zoom, bounds_north, bounds_south, bounds_east, bounds_west, updated_at, source FROM city ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR slug ILIKE $1 OR city_id ILIKE $1)" : ""} ORDER BY name->>'tr' LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "agency":
      countText = `SELECT COUNT(*)::int FROM agency ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR agency_id ILIKE $1)" : ""}`;
      text = `SELECT * FROM agency ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR agency_id ILIKE $1)" : ""} ORDER BY name->>'tr' LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "fare":
      countText = `SELECT COUNT(*)::int FROM fare ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR fare_id ILIKE $1)" : ""}`;
      text = `SELECT * FROM fare ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR fare_id ILIKE $1)" : ""} ORDER BY name->>'tr' LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "holiday":
      countText = `SELECT COUNT(*)::int FROM holiday ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR country_id ILIKE $1)" : ""}`;
      text = `SELECT * FROM holiday ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR country_id ILIKE $1)" : ""} ORDER BY date DESC LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "route":
      countText = `SELECT COUNT(*)::int FROM route ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR slug ILIKE $1 OR code ILIKE $1 OR route_id ILIKE $1)" : ""}`;
      text = `SELECT * FROM route ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR slug ILIKE $1 OR code ILIKE $1 OR route_id ILIKE $1)" : ""} ORDER BY route_id LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "stop":
      countText = `SELECT COUNT(*)::int FROM stop ${search ? "WHERE (name->>'tr' ILIKE $1 OR name->>'en' ILIKE $1 OR stop_id ILIKE $1)" : ""}`;
      text = `
        SELECT s.*, 
          COALESCE((
            SELECT json_agg(p.*) FROM stop_platform p WHERE p.stop_id = s.stop_id
          ), '[]'::json) as platforms
        FROM stop s
        ${search ? "WHERE (s.name->>'tr' ILIKE $1 OR s.name->>'en' ILIKE $1 OR s.stop_id ILIKE $1)" : ""}
        ORDER BY s.stop_id
        LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}
      `;
      break;
    case "route_stop":
      countText = `SELECT COUNT(*)::int FROM route_stop ${search ? "WHERE route_id ILIKE $1 OR stop_id ILIKE $1" : ""}`;
      text = `SELECT * FROM route_stop ${search ? "WHERE route_id ILIKE $1 OR stop_id ILIKE $1" : ""} ORDER BY route_id, direction, sequence LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "shape":
      countText = `SELECT COUNT(*)::int FROM shape ${search ? "WHERE shape_id ILIKE $1 OR route_id ILIKE $1" : ""}`;
      text = `SELECT shape_id, route_id, direction, coordinates, updated_at, source FROM shape ${search ? "WHERE shape_id ILIKE $1 OR route_id ILIKE $1" : ""} ORDER BY shape_id LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "trip":
      countText = `SELECT COUNT(*)::int FROM trip ${search ? "WHERE trip_id ILIKE $1 OR route_id ILIKE $1" : ""}`;
      text = `SELECT * FROM trip ${search ? "WHERE trip_id ILIKE $1 OR route_id ILIKE $1" : ""} ORDER BY trip_id LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
    case "stop_time":
      countText = `SELECT COUNT(*)::int FROM stop_time ${search ? "WHERE trip_id ILIKE $1 OR stop_id ILIKE $1" : ""}`;
      text = `SELECT * FROM stop_time ${search ? "WHERE trip_id ILIKE $1 OR stop_id ILIKE $1" : ""} ORDER BY trip_id, sequence LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}`;
      break;
  }

  if (search) {
    const searchPattern = `%${search}%`;
    const [countRes, dataRes] = await Promise.all([
      query(countText, [searchPattern]),
      query(text, [searchPattern, limit, offset]),
    ]);
    return {
      total: countRes.rows[0].count,
      data: dataRes.rows,
      page,
      limit,
    };
  } else {
    const [countRes, dataRes] = await Promise.all([
      query(countText),
      query(text, [limit, offset]),
    ]);
    return {
      total: countRes.rows[0].count,
      data: dataRes.rows,
      page,
      limit,
    };
  }
}

export async function deleteEntityItem(entity: EntityName, primaryKeys: Record<string, any>) {
  switch (entity) {
    case "country":
      return query("DELETE FROM country WHERE country_id = $1", [primaryKeys.country_id]);
    case "city":
      return query("DELETE FROM city WHERE city_id = $1", [primaryKeys.city_id]);
    case "agency":
      return query("DELETE FROM agency WHERE agency_id = $1", [primaryKeys.agency_id]);
    case "fare":
      return query("DELETE FROM fare WHERE fare_id = $1", [primaryKeys.fare_id]);
    case "holiday":
      return query("DELETE FROM holiday WHERE country_id = $1 AND date = $2", [primaryKeys.country_id, primaryKeys.date]);
    case "route":
      return query("DELETE FROM route WHERE route_id = $1", [primaryKeys.route_id]);
    case "stop":
      return query("DELETE FROM stop WHERE stop_id = $1", [primaryKeys.stop_id]);
    case "route_stop":
      return query("DELETE FROM route_stop WHERE route_id = $1 AND direction = $2 AND sequence = $3", [primaryKeys.route_id, primaryKeys.direction, primaryKeys.sequence]);
    case "shape":
      return query("DELETE FROM shape WHERE shape_id = $1", [primaryKeys.shape_id]);
    case "trip":
      return query("DELETE FROM trip WHERE trip_id = $1", [primaryKeys.trip_id]);
    case "stop_time":
      return query("DELETE FROM stop_time WHERE trip_id = $1 AND sequence = $2", [primaryKeys.trip_id, primaryKeys.sequence]);
  }
}

// =====================================================================
// EXPORT ALL DATA FOR ZIP GENERATION
// =====================================================================
export async function exportAllData() {
  const country = (await query(`SELECT country_id, name, updated_at, source FROM country ORDER BY country_id`)).rows;

  const cityRaw = (await query(`
    SELECT city_id, slug, country_id, name, timezone, center_lat, center_lon, default_zoom,
           bounds_north, bounds_south, bounds_east, bounds_west, updated_at, source
    FROM city ORDER BY city_id
  `)).rows;
  const city = cityRaw.map((c) => ({
    city_id: c.city_id,
    slug: c.slug,
    country_id: c.country_id,
    name: c.name,
    timezone: c.timezone,
    center: { lat: Number(c.center_lat), lon: Number(c.center_lon) },
    ...(c.default_zoom ? { default_zoom: c.default_zoom } : {}),
    ...(c.bounds_north != null ? {
      bounds: {
        north: Number(c.bounds_north),
        south: Number(c.bounds_south),
        east: Number(c.bounds_east),
        west: Number(c.bounds_west),
      }
    } : {}),
    updated_at: c.updated_at,
    source: c.source,
  }));

  const agency = (await query(`SELECT agency_id, city_id, name, phone, website, updated_at, source FROM agency ORDER BY agency_id`)).rows;

  const fareRaw = (await query(`SELECT fare_id, agency_id, name, fare_type, price, currency, payment_methods, transfer_duration, transfer_limit, updated_at, source FROM fare ORDER BY fare_id`)).rows;
  const fare = fareRaw.map((f) => ({
    ...f,
    price: Number(f.price),
  }));

  const holiday = (await query(`SELECT date::text, country_id, name, applies_as, updated_at, source FROM holiday ORDER BY country_id, date`)).rows;

  const route = (await query(`SELECT route_id, slug, agency_id, name, code, color, vehicle_type, fare_id, route_pattern, stop_mode, updated_at, source FROM route ORDER BY route_id`)).rows;

  const stopRaw = (await query(`
    SELECT s.*, 
      COALESCE((
        SELECT json_agg(p.*) FROM stop_platform p WHERE p.stop_id = s.stop_id
      ), '[]'::json) as platforms
    FROM stop s ORDER BY s.stop_id
  `)).rows;

  const stop = stopRaw.map((s) => {
    const platforms = (s.platforms || []).map((p: any) => ({
      platform_id: p.platform_id,
      code: p.code,
      direction: p.direction,
      lat: p.lat != null ? Number(p.lat) : undefined,
      lon: p.lon != null ? Number(p.lon) : undefined,
      wheelchair_accessible: p.wheelchair_accessible,
      has_elevator: p.has_elevator,
      has_ramp: p.has_ramp,
      has_tactile_paving: p.has_tactile_paving,
      has_audio_announcement: p.has_audio_announcement,
      has_shelter: p.has_shelter,
      shelter_type: p.shelter_type,
      has_bench: p.has_bench,
      has_lighting: p.has_lighting,
      updated_at: p.updated_at,
      source: p.source,
    }));

    return {
      stop_id: s.stop_id,
      city_id: s.city_id,
      name: s.name,
      lat: Number(s.lat),
      lon: Number(s.lon),
      location_type: s.location_type,
      wheelchair_accessible: s.wheelchair_accessible,
      has_ramp: s.has_ramp,
      has_elevator: s.has_elevator,
      has_tactile_paving: s.has_tactile_paving,
      has_audio_announcement: s.has_audio_announcement,
      has_braille_signage: s.has_braille_signage,
      shelter_type: s.shelter_type,
      has_bench: s.has_bench,
      has_lighting: s.has_lighting,
      has_real_time_display: s.has_real_time_display,
      has_ticket_machine: s.has_ticket_machine,
      has_trash_bin: s.has_trash_bin,
      has_wifi: s.has_wifi,
      has_security_camera: s.has_security_camera,
      has_bike_rack: s.has_bike_rack,
      ...(platforms.length > 0 ? { platforms } : {}),
      updated_at: s.updated_at,
      source: s.source,
    };
  });

  const route_stop = (await query(`SELECT route_id, direction, stop_id, sequence, is_first_stop, is_last_stop, updated_at, source FROM route_stop ORDER BY route_id, direction, sequence`)).rows;

  const shape = (await query(`SELECT shape_id, route_id, direction, coordinates, updated_at, source FROM shape ORDER BY shape_id`)).rows;

  const trip = (await query(`SELECT trip_id, route_id, direction, service_type, updated_at, source FROM trip ORDER BY trip_id`)).rows;

  const stop_time = (await query(`SELECT trip_id, stop_id, sequence, departure_time, updated_at, source FROM stop_time ORDER BY trip_id, sequence`)).rows;

  return {
    "country.json": country,
    "city.json": city,
    "agency.json": agency,
    "fare.json": fare,
    "holiday.json": holiday,
    "route.json": route,
    "stop.json": stop,
    "route_stop.json": route_stop,
    "shape.json": shape,
    "trip.json": trip,
    "stop_time.json": stop_time,
  };
}

// =====================================================================
// IMPORT & DIFF LOGIC
// =====================================================================
export async function analyzeImportPayload(payload: Partial<Record<EntityName, any[]>>): Promise<ImportConflictAnalysis> {
  const affectedCities = new Set<string>();
  const affectedRoutes = new Set<string>();
  const diffs: DiffResult[] = [];

  // Identify cities and routes in payload
  if (payload.city) {
    for (const c of payload.city) {
      if (c.city_id) affectedCities.add(c.city_id);
    }
  }
  if (payload.stop) {
    for (const s of payload.stop) {
      if (s.city_id) affectedCities.add(s.city_id);
    }
  }
  if (payload.route) {
    for (const r of payload.route) {
      if (r.route_id) affectedRoutes.add(r.route_id);
    }
  }

  const uploadedCounts: Record<EntityName, number> = {
    country: payload.country?.length || 0,
    city: payload.city?.length || 0,
    agency: payload.agency?.length || 0,
    fare: payload.fare?.length || 0,
    holiday: payload.holiday?.length || 0,
    route: payload.route?.length || 0,
    stop: payload.stop?.length || 0,
    route_stop: payload.route_stop?.length || 0,
    shape: payload.shape?.length || 0,
    trip: payload.trip?.length || 0,
    stop_time: payload.stop_time?.length || 0,
  };

  const entities: EntityName[] = [
    "country", "city", "agency", "fare", "holiday", 
    "route", "stop", "route_stop", "shape", "trip", "stop_time"
  ];

  for (const ent of entities) {
    const items = payload[ent];
    if (!items || items.length === 0) continue;

    const diff = await calculateEntityDiff(ent, items);
    if (diff.added.length > 0 || diff.modified.length > 0 || diff.removed.length > 0) {
      diffs.push(diff);
    }
  }

  const hasConflict = diffs.some((d) => d.modified.length > 0 || d.removed.length > 0);

  return {
    hasConflict,
    affectedCities: Array.from(affectedCities),
    affectedRoutes: Array.from(affectedRoutes),
    diffs,
    uploadedCounts,
  };
}

async function calculateEntityDiff(entity: EntityName, uploadedItems: any[]): Promise<DiffResult> {
  let dbItemsMap = new Map<string, any>();

  const getKey = (item: any): string => {
    switch (entity) {
      case "country": return item.country_id;
      case "city": return item.city_id;
      case "agency": return item.agency_id;
      case "fare": return item.fare_id;
      case "holiday": return `${item.country_id}_${item.date}`;
      case "route": return item.route_id;
      case "stop": return item.stop_id;
      case "route_stop": return `${item.route_id}_${item.direction}_${item.stop_id}`;
      case "shape": return item.shape_id;
      case "trip": return item.trip_id;
      case "stop_time": return `${item.trip_id}_${item.sequence}`;
    }
  };

  const keys = uploadedItems.map(getKey).filter(Boolean);
  if (keys.length > 0) {
    let queryText = "";
    switch (entity) {
      case "country": queryText = "SELECT * FROM country WHERE country_id = ANY($1)"; break;
      case "city": queryText = "SELECT city_id, slug, country_id, name, timezone, center_lat as lat, center_lon as lon, default_zoom, updated_at, source FROM city WHERE city_id = ANY($1)"; break;
      case "agency": queryText = "SELECT * FROM agency WHERE agency_id = ANY($1)"; break;
      case "fare": queryText = "SELECT * FROM fare WHERE fare_id = ANY($1)"; break;
      case "route": queryText = "SELECT * FROM route WHERE route_id = ANY($1)"; break;
      case "stop": queryText = "SELECT stop_id, city_id, name, lat, lon, location_type, updated_at, source FROM stop WHERE stop_id = ANY($1)"; break;
      case "shape": queryText = "SELECT shape_id, route_id, direction, coordinates, updated_at, source FROM shape WHERE shape_id = ANY($1)"; break;
      case "trip": queryText = "SELECT * FROM trip WHERE trip_id = ANY($1)"; break;
    }

    if (queryText) {
      const dbRes = await query(queryText, [keys]);
      for (const row of dbRes.rows) {
        dbItemsMap.set(getKey(row), row);
      }
    }
  }

  const added: any[] = [];
  const modified: DiffResult["modified"] = [];
  let unchangedCount = 0;

  for (const item of uploadedItems) {
    const key = getKey(item);
    if (!dbItemsMap.has(key)) {
      added.push(item);
    } else {
      const dbVal = dbItemsMap.get(key);
      const fieldChanges: Array<{ field: string; oldVal: any; newVal: any }> = [];

      for (const prop of Object.keys(item)) {
        if (prop === "updated_at") continue;
        const oldVal = dbVal[prop];
        const newVal = item[prop];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          fieldChanges.push({ field: prop, oldVal, newVal });
        }
      }

      if (fieldChanges.length > 0) {
        modified.push({
          id: key,
          oldValue: dbVal,
          newValue: item,
          changes: fieldChanges,
        });
      } else {
        unchangedCount++;
      }
    }
  }

  return {
    entity,
    added,
    modified,
    removed: [],
    unchangedCount,
  };
}

// Helper to sanitize route slug
function generateRouteSlug(routeId: string, code?: string | null, name?: any): string {
  const rawBase = code || (typeof name === "object" && name?.tr ? name.tr : typeof name === "string" ? name : routeId);
  const clean = String(rawBase)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || `route-${routeId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// Complete Bulletproof Sanitizer & Normalizer for 100% Data Integrity
async function sanitizeAndNormalizePayload(client: any, payload: Partial<Record<EntityName, any[]>>) {
  // Normalize names across all entities
  if (payload.country) {
    payload.country.forEach((c) => { c.name = toMultilingualName(c.name); });
  }
  if (payload.city) {
    payload.city.forEach((c) => { c.name = toMultilingualName(c.name); });
  }
  if (payload.agency) {
    payload.agency.forEach((a) => { a.name = toMultilingualName(a.name); });
  }
  if (payload.fare) {
    payload.fare.forEach((f) => {
      f.name = toMultilingualName(f.name || (f as any).name_en);
    });
  }
  if (payload.holiday) {
    payload.holiday.forEach((h) => { h.name = toMultilingualName(h.name); });
  }
  if (payload.stop) {
    payload.stop.forEach((s) => { s.name = toMultilingualName(s.name); });
  }

  // 1. Build routePatternMap from DB and payload.route
  const routePatternMap = new Map<string, "loop" | "round_trip">();
  const dbRoutes = await client.query("SELECT route_id, route_pattern FROM route");
  for (const r of dbRoutes.rows) {
    routePatternMap.set(r.route_id, r.route_pattern);
  }
  if (payload.route) {
    for (const r of payload.route) {
      r.name = toMultilingualName(r.name);
      if (!r.slug) {
        r.slug = generateRouteSlug(r.route_id, r.code, r.name);
      }
      if (r.route_id && r.route_pattern) {
        routePatternMap.set(r.route_id, r.route_pattern);
      }
    }
  }

  // 2. Route Fare Agency Alignment
  if (payload.route) {
    for (const r of payload.route) {
      if (r.fare_id) {
        const checkFare = await client.query("SELECT agency_id FROM fare WHERE fare_id = $1", [r.fare_id]);
        if (checkFare.rows.length === 0 || checkFare.rows[0].agency_id !== r.agency_id) {
          r.fare_id = null; // Prevent trg_route_fare_agency_match exception
        }
      }
    }
  }

  // 3. Normalize route_stop directions and re-index sequences 1..N per (route_id, direction)
  if (payload.route_stop && payload.route_stop.length > 0) {
    for (const rs of payload.route_stop) {
      const pattern = routePatternMap.get(rs.route_id);
      if (pattern === "loop") {
        rs.direction = 0;
      } else if (pattern === "round_trip") {
        if (rs.direction !== 1 && rs.direction !== 2) {
          rs.direction = 1;
        }
      }
    }

    const routeStopGroups = new Map<string, any[]>();
    for (const rs of payload.route_stop) {
      const groupKey = `${rs.route_id}_${rs.direction}`;
      if (!routeStopGroups.has(groupKey)) {
        routeStopGroups.set(groupKey, []);
      }
      routeStopGroups.get(groupKey)!.push(rs);
    }

    const cleanRouteStops: any[] = [];
    for (const [_, groupItems] of routeStopGroups.entries()) {
      groupItems.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));

      const uniqueStopsMap = new Map<string, any>();
      for (const item of groupItems) {
        if (item.stop_id) {
          uniqueStopsMap.set(item.stop_id, item);
        }
      }
      const uniqueGroup = Array.from(uniqueStopsMap.values());

      uniqueGroup.forEach((item, idx) => {
        const seq = idx + 1;
        item.sequence = seq;
        item.is_first_stop = seq === 1;
        item.is_last_stop = seq === uniqueGroup.length;
        cleanRouteStops.push(item);
      });
    }

    payload.route_stop = cleanRouteStops;
  }

  // 4. Normalize shape directions and deduplicate by (route_id, direction)
  if (payload.shape && payload.shape.length > 0) {
    for (const sh of payload.shape) {
      const pattern = routePatternMap.get(sh.route_id);
      if (pattern === "loop") {
        sh.direction = 0;
      } else if (pattern === "round_trip") {
        if (sh.direction !== 1 && sh.direction !== 2) {
          sh.direction = 1;
        }
      }
    }

    const uniqueShapesMap = new Map<string, any>();
    for (const sh of payload.shape) {
      const key = `${sh.route_id}_${sh.direction}`;
      uniqueShapesMap.set(key, sh);
    }
    payload.shape = Array.from(uniqueShapesMap.values());
  }

  // 5. Normalize trip directions and deduplicate by trip_id
  if (payload.trip && payload.trip.length > 0) {
    for (const tr of payload.trip) {
      const pattern = routePatternMap.get(tr.route_id);
      if (pattern === "loop") {
        tr.direction = 0;
      } else if (pattern === "round_trip") {
        if (tr.direction !== 1 && tr.direction !== 2) {
          tr.direction = 1;
        }
      }
    }

    const uniqueTripsMap = new Map<string, any>();
    for (const tr of payload.trip) {
      if (tr.trip_id) uniqueTripsMap.set(tr.trip_id, tr);
    }
    payload.trip = Array.from(uniqueTripsMap.values());
  }

  // 6. Clean & re-index stop_time per trip_id, check sequence=1 departure_time
  if (payload.stop_time && payload.stop_time.length > 0) {
    const stopTimeGroups = new Map<string, any[]>();
    for (const st of payload.stop_time) {
      if (!st.trip_id) continue;
      if (!stopTimeGroups.has(st.trip_id)) {
        stopTimeGroups.set(st.trip_id, []);
      }
      stopTimeGroups.get(st.trip_id)!.push(st);
    }

    const cleanStopTimes: any[] = [];
    for (const [_, groupItems] of stopTimeGroups.entries()) {
      groupItems.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));

      const uniqueStopsMap = new Map<string, any>();
      for (const item of groupItems) {
        if (item.stop_id) {
          uniqueStopsMap.set(item.stop_id, item);
        }
      }
      const uniqueGroup = Array.from(uniqueStopsMap.values());

      uniqueGroup.forEach((item, idx) => {
        const seq = idx + 1;
        item.sequence = seq;
        if (seq === 1 && !item.departure_time) {
          item.departure_time = "00:00:00";
        }
        cleanStopTimes.push(item);
      });
    }

    payload.stop_time = cleanStopTimes;
  }
}

// Deduplicate array by conflict key before multi-row SQL INSERT
function deduplicateItems(entity: EntityName, items: any[]): any[] {
  const map = new Map<string, any>();
  for (const item of items) {
    let key = "";
    switch (entity) {
      case "country": key = item.country_id; break;
      case "city": key = item.city_id; break;
      case "agency": key = item.agency_id; break;
      case "fare": key = item.fare_id; break;
      case "holiday": key = `${item.country_id}_${item.date}`; break;
      case "route": key = item.route_id; break;
      case "stop": key = item.stop_id; break;
      case "route_stop": key = `${item.route_id}_${item.direction}_${item.sequence}`; break;
      case "shape": key = `${item.route_id}_${item.direction}`; break;
      case "trip": key = item.trip_id; break;
      case "stop_time": key = `${item.trip_id}_${item.sequence}`; break;
    }
    if (key) map.set(key, item);
  }
  return Array.from(map.values());
}

// =====================================================================
// HIGH-PERFORMANCE BULK IMPORT (BATCHING 1000-2000 ROWS PER QUERY)
// =====================================================================
export async function executeImportPayload(
  payload: Partial<Record<EntityName, any[]>>,
  mode: "overwrite" | "merge" | "skip",
  onProgress?: (entity: EntityName, processedCount: number, totalCount: number) => void
) {
  if (mode === "skip") {
    return { success: true, message: "İşlem atlandı." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Clean, auto-fix directions, re-index sequences & remove duplicate keys
    await sanitizeAndNormalizePayload(client, payload);

    // Clear relational child records before re-inserting in OVERWRITE mode
    if (mode === "overwrite") {
      if (payload.route_stop && payload.route_stop.length > 0) {
        const routeIds = Array.from(new Set(payload.route_stop.map((r) => r.route_id))).filter(Boolean);
        if (routeIds.length > 0) {
          await client.query("DELETE FROM route_stop WHERE route_id = ANY($1)", [routeIds]);
        }
      }

      if (payload.shape && payload.shape.length > 0) {
        const routeIds = Array.from(new Set(payload.shape.map((s) => s.route_id))).filter(Boolean);
        if (routeIds.length > 0) {
          await client.query("DELETE FROM shape WHERE route_id = ANY($1)", [routeIds]);
        }
      }

      if (payload.trip && payload.trip.length > 0) {
        const routeIds = Array.from(new Set(payload.trip.map((t) => t.route_id))).filter(Boolean);
        if (routeIds.length > 0) {
          await client.query("DELETE FROM trip WHERE route_id = ANY($1)", [routeIds]);
        }
      }

      if (payload.stop_time && payload.stop_time.length > 0 && (!payload.trip || payload.trip.length === 0)) {
        const tripIds = Array.from(new Set(payload.stop_time.map((st) => st.trip_id))).filter(Boolean);
        if (tripIds.length > 0) {
          await client.query("DELETE FROM stop_time WHERE trip_id = ANY($1)", [tripIds]);
        }
      }
    }

    const entityOrder: EntityName[] = [
      "country",
      "city",
      "agency",
      "fare",
      "holiday",
      "route",
      "stop",
      "route_stop",
      "shape",
      "trip",
      "stop_time",
    ];

    for (const ent of entityOrder) {
      const rawItems = payload[ent];
      if (!rawItems || rawItems.length === 0) continue;

      const uniqueItems = deduplicateItems(ent, rawItems);

      await bulkInsertBatch(client, ent, uniqueItems, mode, (processed, total) => {
        if (onProgress) onProgress(ent, processed, total);
      });
    }

    await client.query("COMMIT");
    return { success: true, message: "Veriler başarıyla yüklendi." };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("Import error:", err);
    throw err;
  } finally {
    client.release();
  }
}

// Bulk Batching Router
async function bulkInsertBatch(
  client: any,
  entity: EntityName,
  items: any[],
  mode: "overwrite" | "merge",
  onProgress?: (processed: number, total: number) => void
) {
  const BATCH_SIZE = 1000;
  const total = items.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    
    switch (entity) {
      case "country": await bulkInsertCountries(client, chunk); break;
      case "city": await bulkInsertCities(client, chunk); break;
      case "agency": await bulkInsertAgencies(client, chunk); break;
      case "fare": await bulkInsertFares(client, chunk); break;
      case "holiday": await bulkInsertHolidays(client, chunk); break;
      case "route": await bulkInsertRoutes(client, chunk); break;
      case "stop": await bulkInsertStops(client, chunk); break;
      case "route_stop": await bulkInsertRouteStops(client, chunk); break;
      case "shape": await bulkInsertShapes(client, chunk); break;
      case "trip": await bulkInsertTrips(client, chunk); break;
      case "stop_time": await bulkInsertStopTimes(client, chunk); break;
    }

    const currentProcessed = Math.min(i + BATCH_SIZE, total);
    if (onProgress) onProgress(currentProcessed, total);
  }
}

// ---------------------------------------------------------------------
// HIGH SPEED BULK SQL STATEMENTS
// ---------------------------------------------------------------------
async function bulkInsertCountries(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 4;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    params.push(
      item.country_id,
      JSON.stringify(toMultilingualName(item.name)),
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO country (country_id, name, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (country_id) DO UPDATE SET
      name = EXCLUDED.name,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertCities(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 14;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`);
    params.push(
      item.city_id,
      item.slug,
      item.country_id,
      JSON.stringify(toMultilingualName(item.name)),
      item.timezone,
      item.center?.lat ?? item.lat ?? 0,
      item.center?.lon ?? item.lon ?? 0,
      item.default_zoom || null,
      item.bounds?.north || null,
      item.bounds?.south || null,
      item.bounds?.east || null,
      item.bounds?.west || null,
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO city (city_id, slug, country_id, name, timezone, center_lat, center_lon, default_zoom, bounds_north, bounds_south, bounds_east, bounds_west, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (city_id) DO UPDATE SET
      slug = EXCLUDED.slug,
      country_id = EXCLUDED.country_id,
      name = EXCLUDED.name,
      timezone = EXCLUDED.timezone,
      center_lat = EXCLUDED.center_lat,
      center_lon = EXCLUDED.center_lon,
      default_zoom = EXCLUDED.default_zoom,
      bounds_north = EXCLUDED.bounds_north,
      bounds_south = EXCLUDED.bounds_south,
      bounds_east = EXCLUDED.bounds_east,
      bounds_west = EXCLUDED.bounds_west,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertAgencies(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 7;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
    params.push(
      item.agency_id,
      item.city_id,
      JSON.stringify(toMultilingualName(item.name)),
      item.phone || null,
      item.website || null,
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO agency (agency_id, city_id, name, phone, website, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (agency_id) DO UPDATE SET
      city_id = EXCLUDED.city_id,
      name = EXCLUDED.name,
      phone = EXCLUDED.phone,
      website = EXCLUDED.website,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertFares(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 11;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`);
    params.push(
      item.fare_id,
      item.agency_id,
      JSON.stringify(toMultilingualName(item.name || item.name_en)),
      item.fare_type || "flat",
      item.price,
      item.currency,
      item.payment_methods || null,
      item.transfer_duration || null,
      item.transfer_limit || null,
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO fare (fare_id, agency_id, name, fare_type, price, currency, payment_methods, transfer_duration, transfer_limit, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (fare_id) DO UPDATE SET
      agency_id = EXCLUDED.agency_id,
      name = EXCLUDED.name,
      fare_type = EXCLUDED.fare_type,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      payment_methods = EXCLUDED.payment_methods,
      transfer_duration = EXCLUDED.transfer_duration,
      transfer_limit = EXCLUDED.transfer_limit,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertHolidays(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 6;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(
      item.date,
      item.country_id,
      JSON.stringify(toMultilingualName(item.name)),
      item.applies_as || "sunday",
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO holiday (date, country_id, name, applies_as, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (country_id, date) DO UPDATE SET
      name = EXCLUDED.name,
      applies_as = EXCLUDED.applies_as,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertRoutes(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 12;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`);
    params.push(
      item.route_id,
      item.slug || generateRouteSlug(item.route_id, item.code, item.name),
      item.agency_id,
      JSON.stringify(toMultilingualName(item.name)),
      item.code || null,
      item.color || null,
      item.vehicle_type,
      item.fare_id || null,
      item.route_pattern,
      item.stop_mode,
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO route (route_id, slug, agency_id, name, code, color, vehicle_type, fare_id, route_pattern, stop_mode, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (route_id) DO UPDATE SET
      slug = EXCLUDED.slug,
      agency_id = EXCLUDED.agency_id,
      name = EXCLUDED.name,
      code = EXCLUDED.code,
      color = EXCLUDED.color,
      vehicle_type = EXCLUDED.vehicle_type,
      fare_id = EXCLUDED.fare_id,
      route_pattern = EXCLUDED.route_pattern,
      stop_mode = EXCLUDED.stop_mode,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertStops(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 23;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20}, $${base + 21}, $${base + 22}, $${base + 23})`);
    params.push(
      item.stop_id,
      item.city_id,
      JSON.stringify(toMultilingualName(item.name)),
      item.lat,
      item.lon,
      item.location_type || null,
      item.wheelchair_accessible ?? null,
      item.has_ramp ?? null,
      item.has_elevator ?? null,
      item.has_tactile_paving ?? null,
      item.has_audio_announcement ?? null,
      item.has_braille_signage ?? null,
      item.shelter_type || null,
      item.has_bench ?? null,
      item.has_lighting ?? null,
      item.has_real_time_display ?? null,
      item.has_ticket_machine ?? null,
      item.has_trash_bin ?? null,
      item.has_wifi ?? null,
      item.has_security_camera ?? null,
      item.has_bike_rack ?? null,
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO stop (
      stop_id, city_id, name, lat, lon, location_type, wheelchair_accessible,
      has_ramp, has_elevator, has_tactile_paving, has_audio_announcement,
      has_braille_signage, shelter_type, has_bench, has_lighting,
      has_real_time_display, has_ticket_machine, has_trash_bin, has_wifi,
      has_security_camera, has_bike_rack, updated_at, source
    ) VALUES ${valueRows.join(", ")}
    ON CONFLICT (stop_id) DO UPDATE SET
      city_id = EXCLUDED.city_id,
      name = EXCLUDED.name,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      location_type = EXCLUDED.location_type,
      wheelchair_accessible = EXCLUDED.wheelchair_accessible,
      has_ramp = EXCLUDED.has_ramp,
      has_elevator = EXCLUDED.has_elevator,
      has_tactile_paving = EXCLUDED.has_tactile_paving,
      has_audio_announcement = EXCLUDED.has_audio_announcement,
      has_braille_signage = EXCLUDED.has_braille_signage,
      shelter_type = EXCLUDED.shelter_type,
      has_bench = EXCLUDED.has_bench,
      has_lighting = EXCLUDED.has_lighting,
      has_real_time_display = EXCLUDED.has_real_time_display,
      has_ticket_machine = EXCLUDED.has_ticket_machine,
      has_trash_bin = EXCLUDED.has_trash_bin,
      has_wifi = EXCLUDED.has_wifi,
      has_security_camera = EXCLUDED.has_security_camera,
      has_bike_rack = EXCLUDED.has_bike_rack,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertRouteStops(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 8;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
    params.push(
      item.route_id,
      item.direction,
      item.stop_id,
      item.sequence,
      item.is_first_stop ?? null,
      item.is_last_stop ?? null,
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO route_stop (route_id, direction, stop_id, sequence, is_first_stop, is_last_stop, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (route_id, direction, sequence) DO UPDATE SET
      stop_id = EXCLUDED.stop_id,
      is_first_stop = EXCLUDED.is_first_stop,
      is_last_stop = EXCLUDED.is_last_stop,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertShapes(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 6;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(
      item.shape_id,
      item.route_id,
      item.direction,
      JSON.stringify(item.coordinates || []),
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO shape (shape_id, route_id, direction, coordinates, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (route_id, direction) DO UPDATE SET
      shape_id = EXCLUDED.shape_id,
      coordinates = EXCLUDED.coordinates,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertTrips(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 6;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(
      item.trip_id,
      item.route_id,
      item.direction,
      item.service_type,
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO trip (trip_id, route_id, direction, service_type, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (trip_id) DO UPDATE SET
      route_id = EXCLUDED.route_id,
      direction = EXCLUDED.direction,
      service_type = EXCLUDED.service_type,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}

async function bulkInsertStopTimes(client: any, items: any[]) {
  const params: any[] = [];
  const valueRows: string[] = [];

  items.forEach((item, idx) => {
    const base = idx * 6;
    valueRows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
    params.push(
      item.trip_id,
      item.stop_id,
      item.sequence,
      item.departure_time || null,
      item.updated_at || new Date().toISOString(),
      item.source || "import"
    );
  });

  const sql = `
    INSERT INTO stop_time (trip_id, stop_id, sequence, departure_time, updated_at, source)
    VALUES ${valueRows.join(", ")}
    ON CONFLICT (trip_id, sequence) DO UPDATE SET
      stop_id = EXCLUDED.stop_id,
      departure_time = EXCLUDED.departure_time,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source
  `;
  await client.query(sql, params);
}
