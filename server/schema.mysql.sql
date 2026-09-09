-- 停车攻略小程序 · MySQL 8 生产库建表脚本
-- 设计要点：全表冗余 city_id 作为分片键；中文全文检索使用 ngram 分词器
-- 运行：mysql -u root -p parking < schema.mysql.sql

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS parking DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci;
USE parking;

-- 城市
CREATE TABLE IF NOT EXISTS cities (
  id            INT          NOT NULL AUTO_INCREMENT,
  name          VARCHAR(32)  NOT NULL,
  code          VARCHAR(12)  COMMENT '行政区划码 440100',
  pinyin        VARCHAR(64),
  province      VARCHAR(32),
  lng           DECIMAL(10,7),
  lat           DECIMAL(10,7),
  hot_level     TINYINT      DEFAULT 3 COMMENT '1-5 热门度',
  status        TINYINT      DEFAULT 1 COMMENT '0未开放 1开放 2建设中',
  data_version  INT          DEFAULT 1,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code),
  KEY idx_province (province),
  KEY idx_hot (hot_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='城市';

-- 区县
CREATE TABLE IF NOT EXISTS districts (
  id         INT         NOT NULL AUTO_INCREMENT,
  city_id    INT         NOT NULL,
  name       VARCHAR(32) NOT NULL,
  code       VARCHAR(12),
  created_at DATETIME    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_city (city_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='区县';

-- 目的地
CREATE TABLE IF NOT EXISTS places (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  city_id      INT          NOT NULL COMMENT '分片键',
  district_id  INT,
  name         VARCHAR(128) NOT NULL,
  category     VARCHAR(16)  NOT NULL COMMENT '景点/商圈/医院/枢纽/学校/政务',
  address      VARCHAR(255),
  lng          DECIMAL(10,7) COMMENT 'GCJ-02 火星坐标',
  lat          DECIMAL(10,7),
  geohash      VARCHAR(12),
  heat         SMALLINT     DEFAULT 50,
  summary      VARCHAR(255),
  tags         JSON,
  area_tips    TEXT         COMMENT '区域停车总攻略',
  cover_image  VARCHAR(255),
  search_text  VARCHAR(255) COMMENT '冗余检索字段 name+address+tags',
  view_count   INT          DEFAULT 0,
  status       TINYINT      DEFAULT 1,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_city_category (city_id, category, status),
  KEY idx_geohash (geohash),
  KEY idx_heat (city_id, heat),
  FULLTEXT KEY ft_search (search_text) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='目的地 POI';

-- 停车场
CREATE TABLE IF NOT EXISTS parkings (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  city_id        INT          NOT NULL COMMENT '分片键',
  name           VARCHAR(128) NOT NULL,
  address        VARCHAR(255),
  type           VARCHAR(16)  COMMENT '地下车库/地面/立体车库/路边泊位/商场配套',
  total_spots    INT          COMMENT 'NULL 表示未知',
  lng            DECIMAL(10,7),
  lat            DECIMAL(10,7),
  geohash        VARCHAR(12),
  free_minutes   SMALLINT     DEFAULT 0,
  daily_cap      DECIMAL(8,2) COMMENT '24小时封顶价',
  night_flat     DECIMAL(8,2) COMMENT '夜间一口价',
  open_hours     VARCHAR(64),
  payment        JSON         COMMENT '["微信","支付宝","ETC"]',
  min_price_hour DECIMAL(8,2) COMMENT '冗余最低时薪，用于比价排序',
  tips           TEXT,
  source         VARCHAR(128),
  confidence     ENUM('high','medium','low') DEFAULT 'medium',
  verified_at    DATETIME     COMMENT '最近核实时间',
  status         TINYINT      DEFAULT 1,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_city (city_id, status),
  KEY idx_geohash (geohash),
  KEY idx_price (city_id, min_price_hour),
  FULLTEXT KEY ft_name (name, address) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='停车场';

-- 目的地-停车场关联
CREATE TABLE IF NOT EXISTS place_parking (
  id             BIGINT  NOT NULL AUTO_INCREMENT,
  place_id       BIGINT  NOT NULL,
  parking_id     BIGINT  NOT NULL,
  distance_m     INT     COMMENT '步行距离（米）',
  walk_minutes   SMALLINT,
  is_recommended TINYINT DEFAULT 0,
  sort_weight    INT     DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_place_parking (place_id, parking_id),
  KEY idx_place (place_id, sort_weight)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='目的地停车场关联';

-- 收费规则
CREATE TABLE IF NOT EXISTS fee_rules (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  parking_id   BIGINT       NOT NULL,
  rule_type    VARCHAR(16)  NOT NULL COMMENT 'first/normal/night/cap/package/discount',
  start_minute INT          COMMENT '入场后起始分钟',
  end_minute   INT          COMMENT '结束分钟，NULL 不限',
  time_start   TIME         COMMENT '时段起点 22:00',
  time_end     TIME         COMMENT '时段终点 08:00',
  price        DECIMAL(8,2) NOT NULL,
  unit         VARCHAR(8)   DEFAULT 'hour' COMMENT 'hour/time/day/month',
  unit_minutes SMALLINT     DEFAULT 60 COMMENT '计费跳表单位（分钟）',
  priority     TINYINT      DEFAULT 0 COMMENT '越大越优先匹配',
  description  VARCHAR(255) COMMENT '人类可读描述',
  confidence   ENUM('high','medium','low') DEFAULT 'medium',
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_parking (parking_id, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收费规则';

-- 攻略提示
CREATE TABLE IF NOT EXISTS tips (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  target_type VARCHAR(16) NOT NULL COMMENT 'city/place/parking',
  target_id   BIGINT      NOT NULL,
  category    VARCHAR(16) COMMENT '省钱/避坑/限高/充电/缴费/错峰',
  content     TEXT        NOT NULL,
  source      VARCHAR(64) DEFAULT '编辑',
  like_count  INT         DEFAULT 0,
  status      TINYINT     DEFAULT 1 COMMENT '0待审 1通过 2驳回',
  created_at  DATETIME    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_target (target_type, target_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='攻略提示';

-- 用户
CREATE TABLE IF NOT EXISTS users (
  id                 BIGINT      NOT NULL AUTO_INCREMENT,
  openid             VARCHAR(64),
  unionid            VARCHAR(64),
  nickname           VARCHAR(64),
  avatar             VARCHAR(255),
  default_city_id    INT,
  contribution_count INT         DEFAULT 0,
  created_at         DATETIME    DEFAULT CURRENT_TIMESTAMP,
  last_login_at      DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户';

-- 用户上报实价
CREATE TABLE IF NOT EXISTS price_reports (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  parking_id       BIGINT       NOT NULL,
  user_id          BIGINT,
  price_paid       DECIMAL(8,2),
  duration_minutes INT,
  images           JSON         COMMENT '收费牌照片',
  comment          VARCHAR(255),
  status           TINYINT      DEFAULT 0 COMMENT '0待审 1采纳 2驳回',
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_parking (parking_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户上报实价';

-- 搜索日志
CREATE TABLE IF NOT EXISTS search_logs (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  keyword      VARCHAR(64),
  city_id      INT,
  user_id      BIGINT,
  result_count INT         DEFAULT 0 COMMENT '0结果热词是补数据风向标',
  created_at   DATETIME    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_keyword (keyword),
  KEY idx_zero (city_id, result_count, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='搜索日志';

-- 采集任务
CREATE TABLE IF NOT EXISTS crawl_tasks (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  city_id     INT,
  category    VARCHAR(16),
  keyword     VARCHAR(64),
  source      VARCHAR(32),
  status      VARCHAR(16) DEFAULT 'pending',
  item_count  INT         DEFAULT 0,
  last_run_at DATETIME,
  created_at  DATETIME    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_city (city_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='采集任务';
