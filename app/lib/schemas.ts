import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { EntityName } from "./types";

import countrySchema from "../../schema/country.schema.json";
import citySchema from "../../schema/city.schema.json";
import agencySchema from "../../schema/agency.schema.json";
import fareSchema from "../../schema/fare.schema.json";
import holidaySchema from "../../schema/holiday.schema.json";
import routeSchema from "../../schema/route.schema.json";
import stopSchema from "../../schema/stop.schema.json";
import routeStopSchema from "../../schema/route_stop.schema.json";
import shapeSchema from "../../schema/shape.schema.json";
import tripSchema from "../../schema/trip.schema.json";
import stopTimeSchema from "../../schema/stop_time.schema.json";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const rawSchemas: Record<EntityName, any> = {
  country: countrySchema,
  city: citySchema,
  agency: agencySchema,
  fare: fareSchema,
  holiday: holidaySchema,
  route: routeSchema,
  stop: stopSchema,
  route_stop: routeStopSchema,
  shape: shapeSchema,
  trip: tripSchema,
  stop_time: stopTimeSchema,
};

const validators: Partial<Record<EntityName, ReturnType<typeof ajv.compile>>> = {};

export function getValidator(entity: EntityName) {
  if (validators[entity]) {
    return validators[entity]!;
  }

  const schemaObj = rawSchemas[entity];
  if (!schemaObj) {
    throw new Error(`Schema not found for entity: ${entity}`);
  }

  const compiled = ajv.compile(schemaObj);
  validators[entity] = compiled;
  return compiled;
}

export function validateEntityItem(entity: EntityName, item: any): { valid: boolean; errors: string[] } {
  const validate = getValidator(entity);
  const valid = validate(item) as boolean;
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors || []).map(
    (e) => `${e.instancePath || "root"} ${e.message}`
  );
  return { valid: false, errors };
}

export function detectEntityFromJSON(filename: string, jsonContent: any): EntityName | null {
  const lowerName = filename.toLowerCase();

  // Try matching filename first
  if (lowerName.includes("country")) return "country";
  if (lowerName.includes("city")) return "city";
  if (lowerName.includes("agency")) return "agency";
  if (lowerName.includes("fare")) return "fare";
  if (lowerName.includes("holiday")) return "holiday";
  if (lowerName.includes("route_stop")) return "route_stop";
  if (lowerName.includes("route")) return "route";
  if (lowerName.includes("stop_time")) return "stop_time";
  if (lowerName.includes("stop")) return "stop";
  if (lowerName.includes("shape")) return "shape";
  if (lowerName.includes("trip")) return "trip";

  // If filename isn't obvious, inspect properties of first object item
  const sample = Array.isArray(jsonContent) ? jsonContent[0] : jsonContent;
  if (!sample || typeof sample !== "object") return null;

  if ("country_id" in sample && "name" in sample && !("city_id" in sample) && !("date" in sample)) return "country";
  if ("city_id" in sample && "slug" in sample && "timezone" in sample) return "city";
  if ("agency_id" in sample && "phone" in sample) return "agency";
  if ("fare_id" in sample && "price" in sample) return "fare";
  if ("date" in sample && "applies_as" in sample) return "holiday";
  if ("route_id" in sample && "vehicle_type" in sample) return "route";
  if ("stop_id" in sample && "lat" in sample && "lon" in sample && !("sequence" in sample)) return "stop";
  if ("route_id" in sample && "direction" in sample && "stop_id" in sample && "sequence" in sample) return "route_stop";
  if ("shape_id" in sample && "coordinates" in sample) return "shape";
  if ("trip_id" in sample && "service_type" in sample) return "trip";
  if ("trip_id" in sample && "stop_id" in sample && "sequence" in sample) return "stop_time";

  return null;
}
