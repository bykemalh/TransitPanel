export type VehicleType =
  | 'bus'
  | 'tram'
  | 'metro'
  | 'rail'
  | 'ferry'
  | 'cable_tram'
  | 'gondola'
  | 'funicular'
  | 'trolleybus'
  | 'monorail'
  | 'minibus'
  | 'coach'
  | 'water_taxi';

export type RoutePattern = 'round_trip' | 'loop';
export type StopMode = 'fixed' | 'flexible';
export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type LocationType = 'stop' | 'station' | 'entrance' | 'generic_node';
export type ShelterType = 'none' | 'open' | 'closed' | 'heated';
export type FareType = 'flat';
export type PaymentMethod = 'cash' | 'smart_card' | 'credit_card' | 'mobile' | 'contactless' | 'qr';

export interface Country {
  country_id: string;
  name: string;
  updated_at: string;
  source?: string | null;
}

export interface CityCenter {
  lat: number;
  lon: number;
}

export interface CityBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface City {
  city_id: string;
  slug: string;
  country_id: string;
  name: string;
  timezone: string;
  center: CityCenter;
  default_zoom?: number | null;
  bounds?: CityBounds | null;
  updated_at: string;
  source?: string | null;
}

export interface Agency {
  agency_id: string;
  city_id: string;
  name: string;
  phone?: string | null;
  website?: string | null;
  updated_at: string;
  source?: string | null;
}

export interface Fare {
  fare_id: string;
  agency_id: string;
  name: string;
  name_en: string;
  fare_type: FareType;
  price: number;
  currency: string;
  payment_methods?: PaymentMethod[] | null;
  transfer_duration?: number | null;
  transfer_limit?: number | null;
  updated_at: string;
  source?: string | null;
}

export interface Holiday {
  date: string;
  country_id: string;
  name: string;
  applies_as: Weekday;
  updated_at: string;
  source?: string | null;
}

export interface Route {
  route_id: string;
  agency_id: string;
  name: string;
  code?: string | null;
  color?: string | null;
  vehicle_type: VehicleType;
  fare_id?: string | null;
  route_pattern: RoutePattern;
  stop_mode: StopMode;
  updated_at: string;
  source?: string | null;
}

export interface Platform {
  platform_id: string;
  code?: string | null;
  direction?: number | null;
  lat?: number | null;
  lon?: number | null;
  wheelchair_accessible?: boolean | null;
  has_elevator?: boolean | null;
  has_ramp?: boolean | null;
  has_tactile_paving?: boolean | null;
  has_audio_announcement?: boolean | null;
  has_shelter?: boolean | null;
  shelter_type?: ShelterType | null;
  has_bench?: boolean | null;
  has_lighting?: boolean | null;
  updated_at: string;
  source?: string | null;
}

export interface Stop {
  stop_id: string;
  city_id: string;
  name: string;
  lat: number;
  lon: number;
  location_type?: LocationType | null;
  wheelchair_accessible?: boolean | null;
  has_ramp?: boolean | null;
  has_elevator?: boolean | null;
  has_tactile_paving?: boolean | null;
  has_audio_announcement?: boolean | null;
  has_braille_signage?: boolean | null;
  shelter_type?: ShelterType | null;
  has_bench?: boolean | null;
  has_lighting?: boolean | null;
  has_real_time_display?: boolean | null;
  has_ticket_machine?: boolean | null;
  has_trash_bin?: boolean | null;
  has_wifi?: boolean | null;
  has_security_camera?: boolean | null;
  has_bike_rack?: boolean | null;
  platforms?: Platform[] | null;
  updated_at: string;
  source?: string | null;
}

export interface RouteStop {
  route_id: string;
  direction: number;
  stop_id: string;
  sequence: number;
  is_first_stop?: boolean | null;
  is_last_stop?: boolean | null;
  updated_at: string;
  source?: string | null;
}

export interface ShapeCoordinate {
  lat: number;
  lon: number;
}

export interface Shape {
  shape_id: string;
  route_id: string;
  direction: number;
  coordinates: ShapeCoordinate[];
  updated_at: string;
  source?: string | null;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  direction: number;
  service_type: Weekday;
  updated_at: string;
  source?: string | null;
}

export interface StopTime {
  trip_id: string;
  stop_id: string;
  sequence: number;
  departure_time?: string | null;
  updated_at: string;
  source?: string | null;
}

export type EntityName =
  | 'country'
  | 'city'
  | 'agency'
  | 'fare'
  | 'holiday'
  | 'route'
  | 'stop'
  | 'route_stop'
  | 'shape'
  | 'trip'
  | 'stop_time';

export interface DiffResult {
  entity: EntityName;
  added: any[];
  modified: Array<{
    id: string;
    oldValue: any;
    newValue: any;
    changes: Array<{ field: string; oldVal: any; newVal: any }>;
  }>;
  removed: any[];
  unchangedCount: number;
}

export interface ImportConflictAnalysis {
  hasConflict: boolean;
  affectedCities: string[];
  affectedRoutes: string[];
  diffs: DiffResult[];
  uploadedCounts: Record<EntityName, number>;
}
