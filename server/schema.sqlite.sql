-- 停车攻略小程序 · SQLite 开发库建表脚本
-- 用于本地开发/调试，生产环境请使用 schema.mysql.sql
-- 运行：sqlite3 parking.db < schema.sqlite.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 城市
CREATE TABLE IF NOT EXISTS cities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  code          TEXT    UNIQUE,
  pinyin        TEXT,
  province      TEXT,
  lng           REAL,
  lat           REAL,
  hot_level     INTEGER DEFAULT 3,
  status        INTEGER DEFAULT 1,
  data_version  INTEGER DEFAULT 1,
  created_at    TEXT    DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cities_province ON cities(province);
CREATE INDEX IF NOT EXISTS idx_cities_hot     ON cities(hot_level);

-- 区县
CREATE TABLE IF NOT EXISTS districts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id    INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  code       TEXT,
  created_at TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_districts_city ON districts(city_id);

-- 目的地（景点/商圈/医院等）
CREATE TABLE IF NOT EXISTS places (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id      INTEGER NOT NULL,
  district_id  INTEGER,
  name         TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  address      TEXT,
  lng          REAL,
  lat          REAL,
  geohash      TEXT,
  heat         INTEGER DEFAULT 50,
  summary      TEXT,
  tags         TEXT,
  area_tips    TEXT,
  cover_image  TEXT,
  search_text  TEXT,
  view_count   INTEGER DEFAULT 0,
  status       INTEGER DEFAULT 1,
  created_at   TEXT    DEFAULT (datetime('now','localtime')),
  updated_at   TEXT    DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (city_id)     REFERENCES cities(id),
  FOREIGN KEY (district_id) REFERENCES districts(id)
);
CREATE INDEX IF NOT EXISTS idx_places_city_cat ON places(city_id, category, status);
CREATE INDEX IF NOT EXISTS idx_places_geohash  ON places(geohash);
CREATE INDEX IF NOT EXISTS idx_places_heat     ON places(city_id, heat DESC);
CREATE INDEX IF NOT EXISTS idx_places_search   ON places(search_text);

-- 停车场
CREATE TABLE IF NOT EXISTS parkings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id        INTEGER NOT NULL,
  name           TEXT    NOT NULL,
  address        TEXT,
  type           TEXT,
  total_spots    INTEGER,
  lng            REAL,
  lat            REAL,
  geohash        TEXT,
  free_minutes   INTEGER DEFAULT 0,
  daily_cap      REAL,
  night_flat     REAL,
  open_hours     TEXT,
  payment        TEXT,
  min_price_hour REAL,
  tips           TEXT,
  source         TEXT,
  confidence     TEXT    DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  verified_at    TEXT,
  status         INTEGER DEFAULT 1,
  created_at     TEXT    DEFAULT (datetime('now','localtime')),
  updated_at     TEXT    DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (city_id) REFERENCES cities(id)
);
CREATE INDEX IF NOT EXISTS idx_parkings_city   ON parkings(city_id, status);
CREATE INDEX IF NOT EXISTS idx_parkings_geohash ON parkings(geohash);
CREATE INDEX IF NOT EXISTS idx_parkings_price  ON parkings(city_id, min_price_hour);

-- 目的地-停车场关联
CREATE TABLE IF NOT EXISTS place_parking (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id       INTEGER NOT NULL,
  parking_id     INTEGER NOT NULL,
  distance_m     INTEGER,
  walk_minutes   INTEGER,
  is_recommended INTEGER DEFAULT 0,
  sort_weight    INTEGER DEFAULT 0,
  UNIQUE (place_id, parking_id),
  FOREIGN KEY (place_id)   REFERENCES places(id),
  FOREIGN KEY (parking_id) REFERENCES parkings(id)
);
CREATE INDEX IF NOT EXISTS idx_pp_place ON place_parking(place_id, sort_weight);

-- 收费规则
CREATE TABLE IF NOT EXISTS fee_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  parking_id    INTEGER NOT NULL,
  rule_type     TEXT    NOT NULL,
  start_minute  INTEGER,
  end_minute    INTEGER,
  time_start    TEXT,
  time_end      TEXT,
  price         REAL    NOT NULL,
  unit          TEXT    DEFAULT 'hour',
  unit_minutes  INTEGER DEFAULT 60,
  priority      INTEGER DEFAULT 0,
  description   TEXT,
  confidence    TEXT    DEFAULT 'medium',
  created_at    TEXT    DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (parking_id) REFERENCES parkings(id)
);
CREATE INDEX IF NOT EXISTS idx_fee_parking ON fee_rules(parking_id, priority);

-- 攻略提示
CREATE TABLE IF NOT EXISTS tips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT    NOT NULL,
  target_id   INTEGER NOT NULL,
  category    TEXT,
  content     TEXT    NOT NULL,
  source      TEXT    DEFAULT '编辑',
  like_count  INTEGER DEFAULT 0,
  status      INTEGER DEFAULT 1,
  created_at  TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tips_target ON tips(target_type, target_id, status);

-- 用户
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  openid             TEXT    UNIQUE,
  unionid            TEXT,
  nickname           TEXT,
  avatar             TEXT,
  default_city_id    INTEGER,
  contribution_count INTEGER DEFAULT 0,
  created_at         TEXT    DEFAULT (datetime('now','localtime')),
  last_login_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 用户上报实价
CREATE TABLE IF NOT EXISTS price_reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  parking_id       INTEGER NOT NULL,
  user_id          INTEGER,
  price_paid       REAL,
  duration_minutes INTEGER,
  images           TEXT,
  comment          TEXT,
  status           INTEGER DEFAULT 0,
  created_at       TEXT    DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (parking_id) REFERENCES parkings(id)
);
CREATE INDEX IF NOT EXISTS idx_reports_parking ON price_reports(parking_id, created_at);

-- 搜索日志
CREATE TABLE IF NOT EXISTS search_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword       TEXT,
  city_id       INTEGER,
  user_id       INTEGER,
  result_count  INTEGER DEFAULT 0,
  created_at    TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_keyword ON search_logs(keyword);
CREATE INDEX IF NOT EXISTS idx_logs_zero    ON search_logs(city_id, result_count, created_at);

-- 采集任务
CREATE TABLE IF NOT EXISTS crawl_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id      INTEGER,
  category     TEXT,
  keyword      TEXT,
  source       TEXT,
  status       TEXT    DEFAULT 'pending',
  item_count   INTEGER DEFAULT 0,
  last_run_at  TEXT,
  created_at   TEXT    DEFAULT (datetime('now','localtime'))
);
