-- Apply this complete migration once to a new Neon database.
BEGIN;

-- ============================================================
-- THUMMITE DATABASE SCHEMA
-- "Perfect and Truth" - B2B Raw Materials Marketplace
-- PostgreSQL Schema
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================
-- Neon PostgreSQL provides gen_random_uuid(); no optional PostGIS extension is required for the current schema.


-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('supplier', 'buyer', 'admin');
CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE subscription_tier AS ENUM ('free', 'standard', 'premium');
CREATE TYPE inquiry_status AS ENUM ('pending', 'responded', 'closed', 'cancelled');
CREATE TYPE listing_status AS ENUM ('active', 'inactive', 'out_of_stock');
CREATE TYPE buyer_type AS ENUM ('individual', 'organisation');


-- ============================================================
-- USERS TABLE
-- Core authentication table for all user types
-- ============================================================
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(255) NOT NULL UNIQUE,
    phone               VARCHAR(20) NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    role                user_role NOT NULL,
    is_email_verified   BOOLEAN DEFAULT FALSE,
    is_phone_verified   BOOLEAN DEFAULT FALSE,
    is_active           BOOLEAN DEFAULT TRUE,
    token_version       INT NOT NULL DEFAULT 0,
    last_login          TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- CATEGORIES TABLE
-- Hierarchical product categories
-- e.g. Metals & Steel (parent) > Steel Rods (child)
-- ============================================================
CREATE TABLE categories (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(100) NOT NULL,
    slug                VARCHAR(100) NOT NULL UNIQUE,
    parent_id           UUID REFERENCES categories(id) ON DELETE SET NULL,
    description         TEXT,
    icon_url            TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- SUPPLIER PROFILES TABLE
-- Extended profile for users with role = 'supplier'
-- ============================================================
CREATE TABLE supplier_profiles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    business_name           VARCHAR(255) NOT NULL,
    cac_number              VARCHAR(50) UNIQUE,                  -- CAC registration number
    cac_document_url        TEXT,                                -- Uploaded CAC certificate
    business_description    TEXT,
    logo_url                TEXT,
    banner_url              TEXT,

    -- Location
    address                 TEXT NOT NULL,
    city                    VARCHAR(100) NOT NULL,
    state                   VARCHAR(100) NOT NULL,
    latitude                DECIMAL(10, 8),                      -- For location-based search
    longitude               DECIMAL(11, 8),

    -- Contact
    whatsapp_number         VARCHAR(20),
    website_url             TEXT,

    -- Trust & Verification
    verification_status     verification_status DEFAULT 'pending',
    verified_at             TIMESTAMP,
    verified_by             UUID REFERENCES users(id),           -- Admin who verified

    -- Subscription
    subscription_tier       subscription_tier DEFAULT 'free',
    subscription_start      TIMESTAMP,
    subscription_end        TIMESTAMP,

    -- Metrics (updated periodically)
    total_listings          INT DEFAULT 0,
    total_inquiries         INT DEFAULT 0,
    response_rate           DECIMAL(5,2) DEFAULT 0.00,           -- Percentage
    average_rating          DECIMAL(3,2) DEFAULT 0.00,
    total_reviews           INT DEFAULT 0,

    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- BUYER PROFILES TABLE
-- Extended profile for users with role = 'buyer'
-- ============================================================
CREATE TABLE buyer_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    buyer_type          buyer_type NOT NULL DEFAULT 'organisation',
    username            VARCHAR(50),                              -- Required for individual buyers; unique case-insensitively
    business_name       VARCHAR(255),                            -- Required for organisation buyers
    industry            VARCHAR(100),                            -- e.g. Manufacturing, Construction
    address             TEXT,
    city                VARCHAR(100),
    state               VARCHAR(100),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

ALTER TABLE buyer_profiles ADD CONSTRAINT buyer_profiles_identity_check CHECK (
    (buyer_type = 'individual' AND username IS NOT NULL AND username ~ '^[A-Za-z0-9_.-]{3,50}$' AND business_name IS NULL)
    OR
    (buyer_type = 'organisation' AND business_name IS NOT NULL AND length(trim(business_name)) >= 2)
);
CREATE UNIQUE INDEX idx_buyer_profiles_username_lower ON buyer_profiles (lower(username)) WHERE username IS NOT NULL;


-- ============================================================
-- ADMIN PROFILES TABLE
-- Admin accounts are provisioned privately by the operator.
-- ============================================================
CREATE TABLE admin_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(255),
    role_title VARCHAR(100) DEFAULT 'Administrator',
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- EMAIL OTP TABLE
-- ============================================================
CREATE TABLE otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    otp VARCHAR(6) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PASSWORD RESET TOKENS
-- Only SHA-256 token hashes are stored; raw tokens are emailed once.
-- ============================================================
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- PRODUCT LISTINGS TABLE
-- Individual product/material listings by suppliers
-- ============================================================
CREATE TABLE product_listings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id             UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
    category_id             UUID NOT NULL REFERENCES categories(id),
    name                    VARCHAR(255) NOT NULL,
    slug                    VARCHAR(255) NOT NULL UNIQUE,
    description             TEXT,

    -- Pricing
    price_min               DECIMAL(15, 2),                      -- Price range minimum
    price_max               DECIMAL(15, 2),                      -- Price range maximum
    currency                VARCHAR(10) DEFAULT 'NGN',
    unit_of_measurement     VARCHAR(50),                         -- e.g. kg, ton, litre, piece

    -- Order details
    minimum_order_quantity  DECIMAL(10, 2),
    lead_time_days          INT,                                 -- How long to fulfill an order

    -- Availability
    status                  listing_status DEFAULT 'active',
    stock_available         BOOLEAN DEFAULT TRUE,

    -- Media
    images                  TEXT[],                              -- Array of image URLs

    -- Specifications (flexible key-value store)
    specifications          JSONB DEFAULT '{}',                  -- e.g. {"grade": "A36", "thickness": "5mm"}

    -- Search optimization
    tags                    TEXT[],                              -- e.g. ["steel", "metal", "rod"]
    search_vector           TSVECTOR,                            -- Full-text search vector

    -- Metrics
    view_count              INT DEFAULT 0,
    inquiry_count           INT DEFAULT 0,

    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- INQUIRIES TABLE
-- Every buyer-to-supplier connection through the platform
-- ============================================================
CREATE TABLE inquiries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id            UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
    supplier_id         UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
    listing_id          UUID REFERENCES product_listings(id) ON DELETE SET NULL,
    subject             VARCHAR(255),
    message             TEXT NOT NULL,
    quantity_needed     DECIMAL(10, 2),
    unit                VARCHAR(50),
    status              inquiry_status DEFAULT 'pending',
    responded_at        TIMESTAMP,
    closed_at           TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- INQUIRY MESSAGES TABLE
-- Threaded conversation within each inquiry
-- ============================================================
CREATE TABLE inquiry_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inquiry_id      UUID NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message         TEXT NOT NULL,
    attachments     TEXT[],                                      -- File/image URLs
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- REVIEWS TABLE
-- Buyers review suppliers after a transaction
-- ============================================================
CREATE TABLE reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
    supplier_id     UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
    inquiry_id      UUID REFERENCES inquiries(id) ON DELETE SET NULL,
    rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    is_verified     BOOLEAN DEFAULT FALSE,                       -- Was this a real transaction?
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(buyer_id, supplier_id, inquiry_id)                   -- One review per transaction
);


-- ============================================================
-- SAVED SUPPLIERS TABLE
-- Buyers can bookmark/save suppliers they like
-- ============================================================
CREATE TABLE saved_suppliers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
    supplier_id     UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(buyer_id, supplier_id)
);


-- ============================================================
-- SAVED LISTINGS TABLE
-- Buyers can bookmark specific product listings
-- ============================================================
CREATE TABLE saved_listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id        UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
    listing_id      UUID NOT NULL REFERENCES product_listings(id) ON DELETE CASCADE,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(buyer_id, listing_id)
);


-- ============================================================
-- NOTIFICATIONS TABLE
-- In-app notifications for both suppliers and buyers
-- ============================================================
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    type            VARCHAR(50),                                 -- e.g. 'inquiry', 'review', 'subscription'
    reference_id    UUID,                                        -- ID of related record
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- SUBSCRIPTION PLANS TABLE
-- Defines available subscription tiers and pricing
-- ============================================================
CREATE TABLE subscription_plans (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    subscription_tier NOT NULL UNIQUE,
    price_monthly           DECIMAL(10, 2) NOT NULL,
    max_listings            INT,                                 -- NULL means unlimited
    features                JSONB DEFAULT '[]',                  -- Array of feature strings
    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- SUBSCRIPTION TRANSACTIONS TABLE
-- Records every subscription payment
-- ============================================================
CREATE TABLE subscription_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id         UUID NOT NULL REFERENCES supplier_profiles(id) ON DELETE CASCADE,
    plan                subscription_tier NOT NULL,
    amount              DECIMAL(10, 2) NOT NULL,
    currency            VARCHAR(10) DEFAULT 'NGN',
    paystack_reference  VARCHAR(255) UNIQUE,                     -- Paystack transaction ref
    status              VARCHAR(50) DEFAULT 'pending',           -- pending, success, failed
    period_start        TIMESTAMP,
    period_end          TIMESTAMP,
    created_at          TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- INDEXES
-- For performance on common queries
-- ============================================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);

-- Admin profiles and OTPs
CREATE INDEX idx_admin_profiles_user_id ON admin_profiles(user_id);
CREATE INDEX idx_otps_user_id ON otps(user_id);
CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_expiry ON password_reset_tokens(expires_at);

-- Supplier profiles
CREATE INDEX idx_supplier_profiles_user_id ON supplier_profiles(user_id);
CREATE INDEX idx_supplier_profiles_state ON supplier_profiles(state);
CREATE INDEX idx_supplier_profiles_city ON supplier_profiles(city);
CREATE INDEX idx_supplier_profiles_verification ON supplier_profiles(verification_status);
CREATE INDEX idx_supplier_profiles_subscription ON supplier_profiles(subscription_tier);
CREATE INDEX idx_supplier_profiles_location ON supplier_profiles(latitude, longitude);

-- Product listings
CREATE INDEX idx_listings_supplier_id ON product_listings(supplier_id);
CREATE INDEX idx_listings_category_id ON product_listings(category_id);
CREATE INDEX idx_listings_status ON product_listings(status);
CREATE INDEX idx_listings_search_vector ON product_listings USING GIN(search_vector);
CREATE INDEX idx_listings_tags ON product_listings USING GIN(tags);
CREATE INDEX idx_listings_specs ON product_listings USING GIN(specifications);

-- Inquiries
CREATE INDEX idx_inquiries_buyer_id ON inquiries(buyer_id);
CREATE INDEX idx_inquiries_supplier_id ON inquiries(supplier_id);
CREATE INDEX idx_inquiries_status ON inquiries(status);

-- Notifications
CREATE UNIQUE INDEX idx_reviews_without_inquiry ON reviews (buyer_id, supplier_id) WHERE inquiry_id IS NULL;

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);


-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_admin_profiles_updated_at
    BEFORE UPDATE ON admin_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_supplier_profiles_updated_at
    BEFORE UPDATE ON supplier_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_buyer_profiles_updated_at
    BEFORE UPDATE ON buyer_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_listings_updated_at
    BEFORE UPDATE ON product_listings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_inquiries_updated_at
    BEFORE UPDATE ON inquiries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Auto-update full-text search vector on product listings
CREATE OR REPLACE FUNCTION update_listing_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector =
        setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_listings_search_vector
    BEFORE INSERT OR UPDATE ON product_listings
    FOR EACH ROW EXECUTE FUNCTION update_listing_search_vector();


-- Auto-increment inquiry count on listing when new inquiry created
CREATE OR REPLACE FUNCTION increment_listing_inquiry_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE product_listings
    SET inquiry_count = inquiry_count + 1
    WHERE id = NEW.listing_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_increment_inquiry_count
    AFTER INSERT ON inquiries
    FOR EACH ROW
    WHEN (NEW.listing_id IS NOT NULL)
    EXECUTE FUNCTION increment_listing_inquiry_count();


-- Auto-update supplier average rating when new review added
CREATE OR REPLACE FUNCTION update_supplier_rating()
RETURNS TRIGGER AS $$
DECLARE
    target_supplier_id UUID;
BEGIN
    target_supplier_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.supplier_id ELSE NEW.supplier_id END;
    UPDATE supplier_profiles
    SET
        average_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE supplier_id = target_supplier_id), 0),
        total_reviews = (SELECT COUNT(*) FROM reviews WHERE supplier_id = target_supplier_id)
    WHERE id = target_supplier_id;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_supplier_rating
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_supplier_rating();


-- ============================================================
-- SEED DATA - Subscription Plans
-- ============================================================
INSERT INTO subscription_plans (name, price_monthly, max_listings, features) VALUES
(
    'free',
    0.00,
    5,
    '["Up to 5 product listings", "Basic supplier profile", "Standard search visibility", "Buyer inquiries via platform"]'
),
(
    'standard',
    12000.00,
    NULL,
    '["Unlimited product listings", "Verified supplier badge", "Priority search placement", "Inquiry analytics dashboard", "WhatsApp inquiry alerts"]'
),
(
    'premium',
    35000.00,
    NULL,
    '["Everything in Standard", "Featured placement on homepage", "Category page promotion", "Buyer demand insights", "Dedicated support", "Profile banner"]'
);


-- ============================================================
-- SEED DATA - Categories
-- ============================================================
INSERT INTO categories (name, slug, parent_id, description) VALUES
('Metals & Steel', 'metals-steel', NULL, 'All metal and steel products'),
('Plastics & Polymers', 'plastics-polymers', NULL, 'Plastic raw materials and polymer products'),
('Industrial Chemicals', 'industrial-chemicals', NULL, 'Chemicals for industrial use'),
('Electrical & Electronics', 'electrical-electronics', NULL, 'Electrical components and raw materials'),
('Packaging Materials', 'packaging-materials', NULL, 'Packaging solutions for manufacturers'),
('Timber & Wood', 'timber-wood', NULL, 'Timber and wood products'),
('Textiles & Fabrics', 'textiles-fabrics', NULL, 'Raw fabric and textile materials'),
('Construction Materials', 'construction-materials', NULL, 'Materials for construction industry'),
('Agricultural Raw Materials', 'agricultural-raw-materials', NULL, 'Raw materials from agriculture');

-- Metals subcategories
INSERT INTO categories (name, slug, parent_id, description)
SELECT 'Steel Rods', 'steel-rods', id, 'Reinforcement steel rods' FROM categories WHERE slug = 'metals-steel';

INSERT INTO categories (name, slug, parent_id, description)
SELECT 'Aluminum Sheets', 'aluminum-sheets', id, 'Aluminum sheets and coils' FROM categories WHERE slug = 'metals-steel';

INSERT INTO categories (name, slug, parent_id, description)
SELECT 'Iron & Cast Iron', 'iron-cast-iron', id, 'Iron products and cast iron' FROM categories WHERE slug = 'metals-steel';

INSERT INTO categories (name, slug, parent_id, description)
SELECT 'Copper & Brass', 'copper-brass', id, 'Copper pipes, wires and brass' FROM categories WHERE slug = 'metals-steel';

-- Plastics subcategories
INSERT INTO categories (name, slug, parent_id, description)
SELECT 'PVC Materials', 'pvc-materials', id, 'PVC pipes, sheets and granules' FROM categories WHERE slug = 'plastics-polymers';

INSERT INTO categories (name, slug, parent_id, description)
SELECT 'Polyethylene', 'polyethylene', id, 'HDPE, LDPE and LLDPE materials' FROM categories WHERE slug = 'plastics-polymers';

INSERT INTO categories (name, slug, parent_id, description)
SELECT 'Polypropylene', 'polypropylene', id, 'PP granules and sheets' FROM categories WHERE slug = 'plastics-polymers';

COMMIT;
