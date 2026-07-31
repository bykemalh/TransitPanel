-- =====================================================================
-- TransitJSON  ->  PostgreSQL + PostGIS Schema
-- =====================================================================
-- Kaynak: agency, city, country, fare, holiday, route, route_stop,
--         shape, stop, stop_time, trip JSON şemaları
--
-- Notlar:
--  - Tüm PK'ler JSON'daki *_id alanlarını TEXT olarak korur (kaynak
--    sistemle senkron kalmak için). İstersen sonradan surrogate BIGINT
--    id + UNIQUE(text_id) yapısına geçilebilir.
--  - PostGIS: stop/route geometrileri GEOGRAPHY(POINT/LINESTRING,4326)
--    olarak tutulur -> mesafe sorguları metre cinsinden doğru sonuç verir.
--  - Enum'lar JSON schema'daki enum listeleriyle birebir eşleşir.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- isim aramaları için (name ILIKE / similarity)
CREATE EXTENSION IF NOT EXISTS btree_gist; -- exclusion constraint'ler için (opsiyonel, aşağıda kullanılıyor)

-- ---------------------------------------------------------------------
-- ENUM TİPLERİ
-- ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE vehicle_type_enum AS ENUM (
    'bus','tram','metro','rail','ferry','cable_tram','gondola',
    'funicular','trolleybus','monorail','minibus','coach','water_taxi'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE route_pattern_enum AS ENUM ('round_trip','loop');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stop_mode_enum AS ENUM ('fixed','flexible');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE weekday_enum AS ENUM (
    'monday','tuesday','wednesday','thursday','friday','saturday','sunday'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE location_type_enum AS ENUM ('stop','station','entrance','generic_node');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shelter_type_enum AS ENUM ('none','open','closed','heated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fare_type_enum AS ENUM ('flat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method_enum AS ENUM (
    'cash','smart_card','credit_card','mobile','contactless','qr'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 1) COUNTRY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS country (
  country_id   TEXT PRIMARY KEY,                 -- ISO 3166-1 alpha-2 önerilir
  name         TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  source       TEXT
);

-- ---------------------------------------------------------------------
-- 2) CITY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS city (
  city_id       TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE
                  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country_id    TEXT NOT NULL REFERENCES country(country_id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  timezone      TEXT NOT NULL
                  CHECK (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$'),
  center_lat    DOUBLE PRECISION NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lon    DOUBLE PRECISION NOT NULL CHECK (center_lon BETWEEN -180 AND 180),
  center_geom   GEOGRAPHY(POINT,4326) GENERATED ALWAYS AS (
                  ST_SetSRID(ST_MakePoint(center_lon, center_lat),4326)::geography
                ) STORED,
  default_zoom  SMALLINT CHECK (default_zoom BETWEEN 1 AND 20),
  bounds_north  DOUBLE PRECISION,
  bounds_south  DOUBLE PRECISION,
  bounds_east   DOUBLE PRECISION,
  bounds_west   DOUBLE PRECISION,
  bounds_geom   GEOGRAPHY(POLYGON,4326) GENERATED ALWAYS AS (
                  CASE WHEN bounds_north IS NOT NULL AND bounds_south IS NOT NULL
                            AND bounds_east IS NOT NULL AND bounds_west IS NOT NULL
                  THEN ST_SetSRID(ST_MakeEnvelope(
                         bounds_west, bounds_south, bounds_east, bounds_north),4326)::geography
                  ELSE NULL END
                ) STORED,
  updated_at    TIMESTAMPTZ NOT NULL,
  source        TEXT,
  CHECK (bounds_north IS NULL OR bounds_south IS NULL OR bounds_north >= bounds_south),
  CHECK (bounds_east  IS NULL OR bounds_west  IS NULL OR bounds_east  >= bounds_west)
);

-- ---------------------------------------------------------------------
-- 3) AGENCY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agency (
  agency_id   TEXT PRIMARY KEY,
  city_id     TEXT NOT NULL REFERENCES city(city_id)
                ON UPDATE CASCADE ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  phone       TEXT,
  website     TEXT CHECK (website IS NULL OR website ~ '^https?://'),
  updated_at  TIMESTAMPTZ NOT NULL,
  source      TEXT
);

-- ---------------------------------------------------------------------
-- 4) FARE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fare (
  fare_id            TEXT PRIMARY KEY,
  agency_id          TEXT NOT NULL REFERENCES agency(agency_id)
                        ON UPDATE CASCADE ON DELETE CASCADE,
  name               TEXT NOT NULL,
  name_en            TEXT NOT NULL,
  fare_type          fare_type_enum NOT NULL DEFAULT 'flat',
  price              NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  currency           CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payment_methods    payment_method_enum[],
  transfer_duration  INTEGER CHECK (transfer_duration IS NULL OR transfer_duration >= 0),
  transfer_limit     INTEGER CHECK (transfer_limit IS NULL OR transfer_limit >= 0),
  updated_at         TIMESTAMPTZ NOT NULL,
  source             TEXT
);
CREATE INDEX IF NOT EXISTS idx_fare_agency ON fare(agency_id);

-- ---------------------------------------------------------------------
-- 5) HOLIDAY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holiday (
  date        DATE NOT NULL,
  country_id  TEXT NOT NULL REFERENCES country(country_id)
                ON UPDATE CASCADE ON DELETE CASCADE,
  name        TEXT NOT NULL,
  applies_as  weekday_enum NOT NULL DEFAULT 'sunday',
  updated_at  TIMESTAMPTZ NOT NULL,
  source      TEXT,
  PRIMARY KEY (country_id, date)
);
CREATE INDEX IF NOT EXISTS idx_holiday_date ON holiday(date);

-- ---------------------------------------------------------------------
-- 6) ROUTE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route (
  route_id      TEXT PRIMARY KEY,
  agency_id     TEXT NOT NULL REFERENCES agency(agency_id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  name          TEXT NOT NULL,
  code          TEXT,
  color         TEXT CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  vehicle_type  vehicle_type_enum NOT NULL,
  fare_id       TEXT REFERENCES fare(fare_id)
                  ON UPDATE CASCADE ON DELETE SET NULL,
  route_pattern route_pattern_enum NOT NULL,
  stop_mode     stop_mode_enum NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  source        TEXT
);
CREATE INDEX IF NOT EXISTS idx_route_agency ON route(agency_id);
CREATE INDEX IF NOT EXISTS idx_route_fare ON route(fare_id);

-- Route'un fare'i, route'un kendi agency'sinden farklı bir agency'e
-- ait OLMAMALI. JSON şemada zorlanmıyor -> burada trigger ile garanti ediyoruz.
CREATE OR REPLACE FUNCTION trg_route_fare_agency_match() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fare_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM fare f WHERE f.fare_id = NEW.fare_id AND f.agency_id = NEW.agency_id
    ) THEN
      RAISE EXCEPTION 'route.fare_id (%) agency_id (%) ile eşleşmiyor', NEW.fare_id, NEW.agency_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS route_fare_agency_check ON route;
CREATE TRIGGER route_fare_agency_check
BEFORE INSERT OR UPDATE ON route
FOR EACH ROW EXECUTE FUNCTION trg_route_fare_agency_match();

-- ---------------------------------------------------------------------
-- 7) STOP  (+ platforms alt tablosu)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stop (
  stop_id                  TEXT PRIMARY KEY,
  city_id                  TEXT NOT NULL REFERENCES city(city_id)
                             ON UPDATE CASCADE ON DELETE RESTRICT,
  name                     TEXT NOT NULL,
  lat                      DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon                      DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  geom                     GEOGRAPHY(POINT,4326) GENERATED ALWAYS AS (
                             ST_SetSRID(ST_MakePoint(lon, lat),4326)::geography
                           ) STORED,
  location_type            location_type_enum,          -- null => 'stop' kabul edilir
  wheelchair_accessible    BOOLEAN,
  has_ramp                 BOOLEAN,
  has_elevator             BOOLEAN,
  has_tactile_paving       BOOLEAN,
  has_audio_announcement   BOOLEAN,
  has_braille_signage      BOOLEAN,
  shelter_type             shelter_type_enum,
  has_bench                BOOLEAN,
  has_lighting             BOOLEAN,
  has_real_time_display    BOOLEAN,
  has_ticket_machine       BOOLEAN,
  has_trash_bin            BOOLEAN,
  has_wifi                 BOOLEAN,
  has_security_camera      BOOLEAN,
  has_bike_rack            BOOLEAN,
  updated_at               TIMESTAMPTZ NOT NULL,
  source                   TEXT
);

CREATE TABLE IF NOT EXISTS stop_platform (
  platform_id             TEXT NOT NULL,
  stop_id                 TEXT NOT NULL REFERENCES stop(stop_id)
                             ON UPDATE CASCADE ON DELETE CASCADE,
  code                    TEXT,
  direction                SMALLINT CHECK (direction IN (0,1,2)),
  lat                      DOUBLE PRECISION CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon                      DOUBLE PRECISION CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  geom                     GEOGRAPHY(POINT,4326) GENERATED ALWAYS AS (
                             CASE WHEN lat IS NOT NULL AND lon IS NOT NULL
                             THEN ST_SetSRID(ST_MakePoint(lon, lat),4326)::geography
                             ELSE NULL END
                           ) STORED,
  wheelchair_accessible    BOOLEAN,
  has_elevator             BOOLEAN,
  has_ramp                 BOOLEAN,
  has_tactile_paving       BOOLEAN,
  has_audio_announcement   BOOLEAN,
  has_shelter              BOOLEAN,
  shelter_type             shelter_type_enum,
  has_bench                BOOLEAN,
  has_lighting             BOOLEAN,
  updated_at                TIMESTAMPTZ NOT NULL,
  source                    TEXT,
  PRIMARY KEY (stop_id, platform_id)
);

-- ---------------------------------------------------------------------
-- 8) ROUTE_STOP
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_stop (
  route_id      TEXT NOT NULL REFERENCES route(route_id)
                  ON UPDATE CASCADE ON DELETE CASCADE,
  direction     SMALLINT NOT NULL CHECK (direction IN (0,1,2)),
  stop_id       TEXT NOT NULL REFERENCES stop(stop_id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  sequence      INTEGER NOT NULL CHECK (sequence >= 1),
  is_first_stop BOOLEAN,
  is_last_stop  BOOLEAN,
  updated_at    TIMESTAMPTZ NOT NULL,
  source        TEXT,
  PRIMARY KEY (route_id, direction, sequence),
  UNIQUE (route_id, direction, stop_id)   -- aynı durak aynı yönde bir kez
);
CREATE INDEX IF NOT EXISTS idx_route_stop_stop ON route_stop(stop_id);

-- route_pattern <-> direction tutarlılığı (loop => 0, round_trip => 1/2)
CREATE OR REPLACE FUNCTION trg_route_stop_direction_match() RETURNS TRIGGER AS $$
DECLARE
  v_pattern route_pattern_enum;
BEGIN
  SELECT route_pattern INTO v_pattern FROM route WHERE route_id = NEW.route_id;
  IF v_pattern = 'loop' AND NEW.direction <> 0 THEN
    RAISE EXCEPTION 'loop route (%), direction 0 olmalı, verilen: %', NEW.route_id, NEW.direction;
  ELSIF v_pattern = 'round_trip' AND NEW.direction NOT IN (1,2) THEN
    RAISE EXCEPTION 'round_trip route (%), direction 1 veya 2 olmalı, verilen: %', NEW.route_id, NEW.direction;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS route_stop_direction_check ON route_stop;
CREATE TRIGGER route_stop_direction_check
BEFORE INSERT OR UPDATE ON route_stop
FOR EACH ROW EXECUTE FUNCTION trg_route_stop_direction_match();

-- ---------------------------------------------------------------------
-- 9) SHAPE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shape (
  shape_id    TEXT PRIMARY KEY,
  route_id    TEXT NOT NULL REFERENCES route(route_id)
                ON UPDATE CASCADE ON DELETE CASCADE,
  direction   SMALLINT NOT NULL CHECK (direction IN (0,1,2)),
  coordinates JSONB NOT NULL,                 -- ham [{lat,lon}, ...] kaynağı korunur
  geom        GEOGRAPHY(LINESTRING,4326),     -- hızlı mekansal sorgular için türetilmiş
  updated_at  TIMESTAMPTZ NOT NULL,
  source      TEXT,
  UNIQUE (route_id, direction)   -- v1 kapsam kuralı: route+direction başına tek shape
);

-- coordinates JSONB -> geom LINESTRING otomatik üretimi
CREATE OR REPLACE FUNCTION trg_shape_build_geom() RETURNS TRIGGER AS $$
BEGIN
  NEW.geom := (
    SELECT ST_SetSRID(ST_MakeLine(ARRAY(
      SELECT ST_MakePoint((pt->>'lon')::double precision, (pt->>'lat')::double precision)
      FROM jsonb_array_elements(NEW.coordinates) AS pt
    )), 4326)::geography
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shape_build_geom ON shape;
CREATE TRIGGER shape_build_geom
BEFORE INSERT OR UPDATE ON shape
FOR EACH ROW EXECUTE FUNCTION trg_shape_build_geom();

CREATE OR REPLACE FUNCTION trg_shape_direction_match() RETURNS TRIGGER AS $$
DECLARE
  v_pattern route_pattern_enum;
BEGIN
  SELECT route_pattern INTO v_pattern FROM route WHERE route_id = NEW.route_id;
  IF v_pattern = 'loop' AND NEW.direction <> 0 THEN
    RAISE EXCEPTION 'loop route (%), shape direction 0 olmalı, verilen: %', NEW.route_id, NEW.direction;
  ELSIF v_pattern = 'round_trip' AND NEW.direction NOT IN (1,2) THEN
    RAISE EXCEPTION 'round_trip route (%), shape direction 1 veya 2 olmalı, verilen: %', NEW.route_id, NEW.direction;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shape_direction_check ON shape;
CREATE TRIGGER shape_direction_check
BEFORE INSERT OR UPDATE ON shape
FOR EACH ROW EXECUTE FUNCTION trg_shape_direction_match();

-- ---------------------------------------------------------------------
-- 10) TRIP
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip (
  trip_id       TEXT PRIMARY KEY,
  route_id      TEXT NOT NULL REFERENCES route(route_id)
                  ON UPDATE CASCADE ON DELETE CASCADE,
  direction     SMALLINT NOT NULL CHECK (direction IN (0,1,2)),
  service_type  weekday_enum NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  source        TEXT
);
CREATE INDEX IF NOT EXISTS idx_trip_route_dir_service ON trip(route_id, direction, service_type);

-- ---------------------------------------------------------------------
-- 11) STOP_TIME
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stop_time (
  trip_id         TEXT NOT NULL REFERENCES trip(trip_id)
                    ON UPDATE CASCADE ON DELETE CASCADE,
  stop_id         TEXT NOT NULL REFERENCES stop(stop_id)
                    ON UPDATE CASCADE ON DELETE RESTRICT,
  sequence        INTEGER NOT NULL CHECK (sequence >= 1),
  departure_time  TEXT CHECK (departure_time IS NULL OR departure_time ~ '^[0-9]{1,2}:[0-5][0-9]:[0-5][0-9]$'),
  departure_secs  INTEGER GENERATED ALWAYS AS (
                     CASE WHEN departure_time IS NOT NULL THEN
                       split_part(departure_time,':',1)::int * 3600
                       + split_part(departure_time,':',2)::int * 60
                       + split_part(departure_time,':',3)::int
                     ELSE NULL END
                   ) STORED,
  updated_at      TIMESTAMPTZ NOT NULL,
  source          TEXT,
  PRIMARY KEY (trip_id, sequence),
  CONSTRAINT check_first_departure CHECK (sequence <> 1 OR departure_time IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stop_time_stop ON stop_time(stop_id);
CREATE INDEX IF NOT EXISTS idx_stop_time_stop_dept ON stop_time(stop_id, departure_secs);

CREATE INDEX IF NOT EXISTS idx_city_center_geom   ON city  USING GIST (center_geom);
CREATE INDEX IF NOT EXISTS idx_city_bounds_geom   ON city  USING GIST (bounds_geom);
CREATE INDEX IF NOT EXISTS idx_stop_geom          ON stop  USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_stop_platform_geom ON stop_platform USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_shape_geom         ON shape USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_stop_name_trgm  ON stop  USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_route_name_trgm ON route USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_stop_city   ON stop(city_id);
CREATE INDEX IF NOT EXISTS idx_agency_city ON agency(city_id);
CREATE INDEX IF NOT EXISTS idx_city_country ON city(country_id);

-- * "Bu hattın bugünkü seferleri" gibi sorgular için kompozit index
--   (trip tablosunda zaten idx_trip_route_dir_service var, stop_time'da
--   trip_id + sequence PK olarak zaten kapsanıyor)
-- * En sık çalışacak API sorgusu -> "X durağının Y saatinden sonraki
--   kalkışları": idx_stop_time_stop_dept (stop_id, departure_secs)
--   kompozit index'i ile karşılanır (index-only scan).

-- =====================================================================
-- ETL / BULK LOAD PERFORMANS NOTU
-- =====================================================================
-- trip ve stop_time gibi büyük hacimli tablolarda (Bursa ölçeğinde
-- 120.000+ satır) satır-bazlı (ROW-level) PL/pgSQL trigger'lardan
-- bilerek kaçınıldı:
--   - trip: route_pattern <-> direction kontrolü trigger olarak KONULMADI.
--     Aynı kural zaten route_stop ve shape'te satır-bazlı trigger ile
--     zorlanıyor; trip seviyesinde tekrar route'a SELECT atmak sadece
--     ETL süresini uzatır, veri bütünlüğüne katkısı yoktur.
--   - stop_time: "ilk durak departure_time zorunlu" kuralı trigger yerine
--     CHECK constraint olarak yazıldı (check_first_departure). CHECK
--     constraint satırın kendi kolonlarına bakar, fonksiyon çağrısı ve
--     ekstra tablo erişimi olmadığı için COPY/bulk INSERT'i pratikte
--     yavaşlatmaz.
--
-- Toplu yükleme (COPY) sırasında hâlâ kalan trigger'lı tablolar
-- (route, route_stop, shape) görece küçük hacimli olduğu için (yüzlerce/
-- birkaç bin satır) etkisi ihmal edilebilir düzeydedir.
--
-- Ekstra hız için: büyük COPY işlemlerinden önce ilgili tablolardaki
-- index'leri DROP edip işlem bitince yeniden CREATE etmek (veya
-- CREATE INDEX CONCURRENTLY ile sonradan eklemek) de yaygın bir pratiktir.
--
-- ETL SONRASI DOĞRULAMA (trip için kaldırılan kontrolün yerine):
-- Tek seferlik, ucuz bir JOIN ile tutarsız satır var mı diye kontrol edilir:
--
-- SELECT t.trip_id, t.direction, r.route_pattern
-- FROM trip t JOIN route r ON r.route_id = t.route_id
-- WHERE (r.route_pattern = 'loop' AND t.direction <> 0)
--    OR (r.route_pattern = 'round_trip' AND t.direction NOT IN (1,2));
-- -- Sonuç boşsa veri tutarlı demektir.

-- =====================================================================
-- ÖRNEK KULLANIŞLI SORGULAR
-- =====================================================================
-- En yakın durakları bulma (500m içinde):
-- SELECT stop_id, name, ST_Distance(geom, ST_MakePoint(29.06,40.19)::geography) AS dist_m
-- FROM stop
-- WHERE ST_DWithin(geom, ST_MakePoint(29.06,40.19)::geography, 500)
-- ORDER BY dist_m;
--
-- Bir hattın güzergahını GeoJSON olarak çekme:
-- SELECT ST_AsGeoJSON(geom) FROM shape WHERE route_id = 'BUR-1' AND direction = 1;
--
-- X durağının 08:00'den sonraki kalkışları (idx_stop_time_stop_dept kullanır):
-- SELECT trip_id, departure_time FROM stop_time
-- WHERE stop_id = 'BUR_ST_001' AND departure_secs >= 28800
-- ORDER BY departure_secs;
-- =====================================================================