-- ============================================================
-- Waste Management Platform - Database Schema
-- NOTE: Database creation and USE are handled by migrate.js
-- ============================================================

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id            CHAR(36)      NOT NULL,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,   -- PBKDF2 hash
  salt          VARCHAR(128)  NOT NULL,   -- random salt
  role          ENUM('USER','VERIFIER','ADMIN','MERCHANT') NOT NULL DEFAULT 'USER',
  points_balance INT UNSIGNED  NOT NULL DEFAULT 0,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TOKEN BLACKLIST (for logout / replay prevention)
-- ============================================================
CREATE TABLE token_blacklist (
  jti        CHAR(36)  NOT NULL,
  expires_at DATETIME  NOT NULL,
  PRIMARY KEY (jti),
  KEY idx_token_blacklist_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- RATE LIMIT STORE
-- ============================================================
CREATE TABLE rate_limit_store (
  key_hash   VARCHAR(64)  NOT NULL,
  count      INT UNSIGNED NOT NULL DEFAULT 1,
  window_end DATETIME     NOT NULL,
  PRIMARY KEY (key_hash),
  KEY idx_rate_limit_window (window_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- WASTE TYPES
-- ============================================================
CREATE TABLE waste_types (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100)  NOT NULL,
  description   TEXT,
  points_per_kg DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_waste_types_name (name),
  KEY idx_waste_types_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- WASTE SUBMISSIONS
-- ============================================================
CREATE TABLE waste_submissions (
  id            CHAR(36)      NOT NULL,
  user_id       CHAR(36)      NOT NULL,
  waste_type_id INT UNSIGNED  NOT NULL,
  weight_kg     DECIMAL(10,3) NOT NULL,
  location      VARCHAR(500)  NOT NULL,
  photo_ref     VARCHAR(500)  DEFAULT NULL,
  status        ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  points_earned INT UNSIGNED  DEFAULT NULL,
  submitted_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ws_user_id (user_id),
  KEY idx_ws_status (status),
  KEY idx_ws_submitted_at (submitted_at),
  CONSTRAINT fk_ws_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ws_waste_type FOREIGN KEY (waste_type_id) REFERENCES waste_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SUBMISSION VERIFICATIONS
-- ============================================================
CREATE TABLE submission_verifications (
  id            CHAR(36)     NOT NULL,
  submission_id CHAR(36)     NOT NULL,
  verifier_id   CHAR(36)     NOT NULL,
  action        ENUM('APPROVED','REJECTED') NOT NULL,
  notes         TEXT         DEFAULT NULL,
  verified_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sv_submission (submission_id),
  KEY idx_sv_verifier (verifier_id),
  CONSTRAINT fk_sv_submission FOREIGN KEY (submission_id) REFERENCES waste_submissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_sv_verifier FOREIGN KEY (verifier_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- REWARDS
-- ============================================================
CREATE TABLE rewards (
  id              CHAR(36)      NOT NULL,
  name            VARCHAR(200)  NOT NULL,
  description     TEXT,
  required_points INT UNSIGNED  NOT NULL,
  stock           INT UNSIGNED  NOT NULL DEFAULT 0,
  status          ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by      CHAR(36)      NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rewards_status (status),
  KEY idx_rewards_points (required_points),
  CONSTRAINT fk_rewards_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- REWARD REDEMPTIONS
-- ============================================================
CREATE TABLE reward_redemptions (
  id          CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NOT NULL,
  reward_id   CHAR(36)     NOT NULL,
  points_used INT UNSIGNED NOT NULL,
  redeemed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rr_user_id (user_id),
  KEY idx_rr_reward_id (reward_id),
  KEY idx_rr_redeemed_at (redeemed_at),
  CONSTRAINT fk_rr_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_rr_reward FOREIGN KEY (reward_id) REFERENCES rewards(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id          CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NOT NULL,
  type        VARCHAR(50)  NOT NULL,
  message     TEXT         NOT NULL,
  is_read     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_user_id (user_id),
  KEY idx_notif_read (is_read),
  KEY idx_notif_created (created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    CHAR(36)        DEFAULT NULL,
  action_type VARCHAR(100)    NOT NULL,
  metadata    JSON            DEFAULT NULL,
  ip_address  VARCHAR(45)     DEFAULT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_id),
  KEY idx_audit_action (action_type),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- MERCHANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS merchants (
  id          CHAR(36)      NOT NULL,
  user_id     CHAR(36)      NOT NULL,
  shop_name   VARCHAR(200)  NOT NULL,
  description TEXT,
  address     VARCHAR(500)  NOT NULL,
  status      ENUM('PENDING','ACTIVE','INACTIVE') NOT NULL DEFAULT 'PENDING',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_merchants_user (user_id),
  KEY idx_merchants_status (status),
  CONSTRAINT fk_merchants_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- VOUCHERS
-- Vouchers are generated when a user redeems a reward.
-- A merchant claims the voucher when warga shows the code.
-- ============================================================
CREATE TABLE IF NOT EXISTS vouchers (
  id                     CHAR(36)    NOT NULL,
  code                   VARCHAR(16) NOT NULL,         -- e.g. "A3X7-KP2M"
  user_id                CHAR(36)    NOT NULL,          -- voucher owner
  reward_id              CHAR(36)    NOT NULL,
  redemption_id          CHAR(36)    NOT NULL,
  merchant_id            CHAR(36)    DEFAULT NULL,      -- NULL = any merchant can claim
  status                 ENUM('ACTIVE','CLAIMED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  expires_at             DATETIME    NOT NULL,
  claimed_at             DATETIME    DEFAULT NULL,
  claimed_by_merchant_id CHAR(36)    DEFAULT NULL,
  created_at             DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vouchers_code (code),
  UNIQUE KEY uq_vouchers_redemption (redemption_id),
  KEY idx_vouchers_user (user_id),
  KEY idx_vouchers_status (status),
  KEY idx_vouchers_expires (expires_at),
  CONSTRAINT fk_vouchers_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_vouchers_reward FOREIGN KEY (reward_id) REFERENCES rewards(id),
  CONSTRAINT fk_vouchers_redemption FOREIGN KEY (redemption_id) REFERENCES reward_redemptions(id),
  CONSTRAINT fk_vouchers_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  CONSTRAINT fk_vouchers_claimed_by FOREIGN KEY (claimed_by_merchant_id) REFERENCES merchants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ALTER: add merchant_id to rewards (nullable — ties reward to a specific merchant)
-- Skipped silently by migrate.js if column already exists.
-- ============================================================
ALTER TABLE rewards ADD COLUMN merchant_id CHAR(36) DEFAULT NULL;
ALTER TABLE rewards ADD CONSTRAINT fk_rewards_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id);

-- ============================================================
-- ALTER: extend users role ENUM for existing databases
-- ============================================================
ALTER TABLE users MODIFY COLUMN role ENUM('USER','VERIFIER','ADMIN','MERCHANT') NOT NULL DEFAULT 'USER';

-- ============================================================
-- SEED: Default waste types
-- ============================================================
INSERT INTO waste_types (name, description, points_per_kg) VALUES
  ('Plastic',       'PET bottles, HDPE containers, etc.',   10.00),
  ('Paper',         'Cardboard, newspapers, office paper',   5.00),
  ('Glass',         'Glass bottles and containers',          8.00),
  ('Metal',         'Aluminum cans, steel scrap',           15.00),
  ('E-Waste',       'Electronics, batteries, cables',       25.00),
  ('Organic',       'Food waste, yard trimmings',            3.00);
