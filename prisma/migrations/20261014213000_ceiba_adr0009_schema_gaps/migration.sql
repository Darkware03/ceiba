-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('platform_admin');

-- CreateEnum
CREATE TYPE "auth_token_purpose" AS ENUM ('email_verification', 'password_reset', 'mfa_challenge');

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "platform_role" NOT NULL DEFAULT 'platform_admin',
    "granted_by_user_id" UUID,
    "granted_reason" TEXT,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "revoked_reason" TEXT,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "auth_token_purpose" NOT NULL,
    "token_selector" TEXT NOT NULL,
    "token_verifier_hash" BYTEA NOT NULL,
    "target_email" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "locked_until" TIMESTAMPTZ(6),
    "client_ip" INET,
    "user_agent" TEXT,

    CONSTRAINT "user_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_sessions" (
    "id" UUID NOT NULL,
    "shared_link_id" UUID NOT NULL,
    "share_access_code_id" UUID,
    "permission" "share_permission" NOT NULL,
    "token_selector" TEXT NOT NULL,
    "token_verifier_hash" BYTEA NOT NULL,
    "client_ip" INET,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "share_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_platform_admin_role_revoked" ON "platform_admins"("role", "revoked_at");

-- CreateIndex
CREATE INDEX "ix_platform_admin_expiry" ON "platform_admins"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_platform_admin_user_role" ON "platform_admins"("user_id", "role");

-- CreateIndex
CREATE INDEX "ix_authtoken_user_purpose" ON "user_auth_tokens"("user_id", "purpose", "expires_at");

-- CreateIndex
CREATE INDEX "ix_authtoken_expiry" ON "user_auth_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_authtoken_selector" ON "user_auth_tokens"("purpose", "token_selector");

-- CreateIndex
CREATE INDEX "ix_sharesession_link" ON "share_sessions"("shared_link_id", "revoked_at");

-- CreateIndex
CREATE INDEX "ix_sharesession_code" ON "share_sessions"("share_access_code_id");

-- CreateIndex
CREATE INDEX "ix_sharesession_expiry" ON "share_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sharesession_selector" ON "share_sessions"("token_selector");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "fk_platform_admin_granter" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "fk_platform_admin_revoker" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "fk_platform_admin_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_auth_tokens" ADD CONSTRAINT "fk_authtoken_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_sessions" ADD CONSTRAINT "fk_sharesession_code" FOREIGN KEY ("share_access_code_id") REFERENCES "share_access_codes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_sessions" ADD CONSTRAINT "fk_sharesession_link" FOREIGN KEY ("shared_link_id") REFERENCES "shared_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

