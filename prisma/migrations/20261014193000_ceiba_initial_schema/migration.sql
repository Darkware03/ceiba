-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'invited', 'suspended', 'deactivated');

-- CreateEnum
CREATE TYPE "workspace_role" AS ENUM ('owner', 'admin', 'editor', 'executor', 'viewer');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('active', 'suspended', 'removed');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "lifecycle_status" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "collection_visibility" AS ENUM ('private', 'link_public', 'link_private');

-- CreateEnum
CREATE TYPE "share_permission" AS ENUM ('viewer', 'viewer_export', 'executor');

-- CreateEnum
CREATE TYPE "share_state" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "access_attempt_result" AS ENUM ('success', 'invalid_code', 'expired', 'revoked', 'rate_limited', 'locked_out');

-- CreateEnum
CREATE TYPE "http_method" AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "body_mode" AS ENUM ('none', 'raw_json', 'raw_text', 'raw_xml', 'raw_html', 'graphql', 'form_urlencoded', 'multipart_form_data', 'binary_file', 'custom');

-- CreateEnum
CREATE TYPE "param_kind" AS ENUM ('query', 'path');

-- CreateEnum
CREATE TYPE "auth_mode" AS ENUM ('inherit', 'none', 'explicit');

-- CreateEnum
CREATE TYPE "auth_type" AS ENUM ('none', 'basic', 'bearer', 'api_key_header', 'api_key_query', 'oauth2_client_credentials', 'oauth2_authorization_code_pkce', 'oauth2_refresh_token', 'digest', 'mtls_client_cert', 'custom');

-- CreateEnum
CREATE TYPE "credential_slot" AS ENUM ('username', 'password', 'bearer_token', 'api_key', 'client_id', 'client_secret', 'refresh_token', 'access_token', 'private_key', 'key_passphrase', 'client_certificate', 'ca_bundle', 'cookie_value', 'totp_seed');

-- CreateEnum
CREATE TYPE "secret_scope" AS ENUM ('user', 'workspace', 'collection', 'environment', 'api_request');

-- CreateEnum
CREATE TYPE "secret_state" AS ENUM ('active', 'rotating', 'revoked');

-- CreateEnum
CREATE TYPE "environment_kind" AS ENUM ('local', 'development', 'testing', 'staging', 'production', 'custom');

-- CreateEnum
CREATE TYPE "variable_scope" AS ENUM ('global', 'workspace', 'collection', 'api_request');

-- CreateEnum
CREATE TYPE "variable_value_kind" AS ENUM ('string', 'number', 'boolean', 'json', 'file', 'secret');

-- CreateEnum
CREATE TYPE "version_source" AS ENUM ('manual', 'auto_snapshot', 'import', 'restore');

-- CreateEnum
CREATE TYPE "execution_outcome" AS ENUM ('completed', 'timeout', 'cancelled', 'dns_failure', 'tls_failure', 'connection_error', 'blocked_by_policy', 'too_large', 'internal_error');

-- CreateEnum
CREATE TYPE "body_persistence" AS ENUM ('none', 'metadata_only', 'truncated', 'full');

-- CreateEnum
CREATE TYPE "storage_backend" AS ENUM ('object_store', 'local_fs', 'inline_db');

-- CreateEnum
CREATE TYPE "artifact_state" AS ENUM ('stored', 'expired', 'purged', 'discarded_by_policy');

-- CreateEnum
CREATE TYPE "test_kind" AS ENUM ('status_code', 'header_present', 'header_value', 'response_time', 'json_schema', 'required_property', 'exact_value', 'body_contains', 'expression', 'script', 'sequence');

-- CreateEnum
CREATE TYPE "test_result" AS ENUM ('passed', 'failed', 'skipped', 'errored');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('queued', 'running', 'passed', 'failed', 'cancelled', 'errored');

-- CreateEnum
CREATE TYPE "run_trigger" AS ENUM ('manual', 'scheduled', 'ci', 'shared_link');

-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('invitation_received', 'invitation_accepted', 'member_joined', 'comment_created', 'comment_mention', 'comment_resolved', 'collection_run_finished', 'version_restored', 'share_link_accessed', 'share_code_locked_out', 'system');

-- CreateEnum
CREATE TYPE "audit_target_type" AS ENUM ('user', 'session', 'workspace', 'workspace_member', 'invitation', 'project', 'collection', 'collection_folder', 'api_request', 'environment', 'variable', 'secret', 'auth_configuration', 'shared_link', 'share_access_code', 'collection_version', 'test_definition', 'collection_run', 'file', 'comment', 'system');

-- CreateEnum
CREATE TYPE "file_purpose" AS ENUM ('request_body_binary', 'form_field_file', 'client_certificate', 'ca_bundle', 'user_avatar', 'workspace_icon', 'collection_snapshot', 'response_artifact', 'import_source', 'export_bundle');

-- CreateEnum
CREATE TYPE "file_scan_status" AS ENUM ('pending', 'clean', 'rejected', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "redirect_policy" AS ENUM ('follow', 'follow_same_origin', 'never');

-- CreateEnum
CREATE TYPE "cookie_same_site" AS ENUM ('strict', 'lax', 'none');

-- CreateEnum
CREATE TYPE "import_format" AS ENUM ('postman_v2_0', 'postman_v2_1', 'openapi_3', 'swagger_2', 'curl', 'insomnia', 'har', 'ceiba_native');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "password_hash" TEXT,
    "password_updated_at" TIMESTAMPTZ(6),
    "display_name" TEXT NOT NULL,
    "avatar_file_id" UUID,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_id" UUID,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_selector" TEXT NOT NULL,
    "token_verifier_hash" BYTEA NOT NULL,
    "parent_session_id" UUID,
    "user_agent" TEXT,
    "client_ip" INET,
    "device_label" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon_file_id" UUID,
    "icon_emoji" TEXT,
    "owner_user_id" UUID NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "response_body_persistence" "body_persistence" NOT NULL DEFAULT 'none',
    "response_retention_days" INTEGER NOT NULL DEFAULT 7,
    "response_max_persist_bytes" BIGINT NOT NULL DEFAULT 262144,
    "history_retention_days" INTEGER NOT NULL DEFAULT 90,
    "allow_public_sharing" BOOLEAN NOT NULL DEFAULT true,
    "allow_shared_link_execution" BOOLEAN NOT NULL DEFAULT false,
    "status" "lifecycle_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by_user_id" UUID,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "workspace_role" NOT NULL DEFAULT 'viewer',
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "invited_by_user_id" UUID,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(6),
    "last_active_at" TIMESTAMPTZ(6),

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "workspace_role" NOT NULL DEFAULT 'viewer',
    "token_selector" TEXT NOT NULL,
    "token_verifier_hash" BYTEA NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "invited_by_user_id" UUID,
    "accepted_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "resend_count" INTEGER NOT NULL DEFAULT 0,
    "last_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "sort_key" TEXT NOT NULL,
    "status" "lifecycle_status" NOT NULL DEFAULT 'active',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by_user_id" UUID,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "collection_visibility" NOT NULL DEFAULT 'private',
    "default_auth_mode" "auth_mode" NOT NULL DEFAULT 'none',
    "default_auth_configuration_id" UUID,
    "default_timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "default_redirect_policy" "redirect_policy" NOT NULL DEFAULT 'follow',
    "default_max_redirects" SMALLINT NOT NULL DEFAULT 5,
    "tls_verify_peer" BOOLEAN NOT NULL DEFAULT true,
    "variables_doc" JSONB NOT NULL DEFAULT '{}',
    "schema_format" "import_format",
    "source_file_id" UUID,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "sort_key" TEXT NOT NULL,
    "status" "lifecycle_status" NOT NULL DEFAULT 'active',
    "current_version_number" INTEGER NOT NULL DEFAULT 0,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by_user_id" UUID,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_folders" (
    "id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "parent_folder_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "materialized_path" TEXT NOT NULL,
    "depth" SMALLINT NOT NULL DEFAULT 0,
    "auth_mode" "auth_mode" NOT NULL DEFAULT 'inherit',
    "auth_configuration_id" UUID,
    "sort_key" TEXT NOT NULL,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by_user_id" UUID,

    CONSTRAINT "collection_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_requests" (
    "id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "folder_id" UUID,
    "external_ref" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "method" "http_method" NOT NULL DEFAULT 'GET',
    "method_custom" TEXT,
    "url_template" TEXT NOT NULL,
    "body_mode" "body_mode" NOT NULL DEFAULT 'none',
    "auth_mode" "auth_mode" NOT NULL DEFAULT 'inherit',
    "auth_configuration_id" UUID,
    "timeout_ms" INTEGER,
    "redirect_policy" "redirect_policy",
    "max_redirects" SMALLINT,
    "tls_verify_peer" BOOLEAN,
    "client_certificate_id" UUID,
    "pre_request_script" TEXT,
    "post_response_script" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "sort_key" TEXT NOT NULL,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "last_executed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by_user_id" UUID,

    CONSTRAINT "api_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_headers" (
    "id" UUID NOT NULL,
    "api_request_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT,
    "secret_id" UUID,
    "description" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_headers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_params" (
    "id" UUID NOT NULL,
    "api_request_id" UUID NOT NULL,
    "kind" "param_kind" NOT NULL DEFAULT 'query',
    "name" TEXT NOT NULL,
    "value" TEXT,
    "secret_id" UUID,
    "description" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_bodies" (
    "id" UUID NOT NULL,
    "api_request_id" UUID NOT NULL,
    "mode" "body_mode" NOT NULL DEFAULT 'none',
    "content_type" TEXT,
    "raw_content" TEXT,
    "graphql_variables" JSONB,
    "binary_file_id" UUID,
    "charset" TEXT NOT NULL DEFAULT 'utf-8',
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "checksum_sha256" BYTEA,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_bodies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_body_fields" (
    "id" UUID NOT NULL,
    "request_body_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_value" TEXT,
    "secret_id" UUID,
    "file_id" UUID,
    "content_type" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "request_body_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_tags" (
    "api_request_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "tagged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tagged_by_user_id" UUID,

    CONSTRAINT "pk_request_tags" PRIMARY KEY ("api_request_id","tag_id")
);

-- CreateTable
CREATE TABLE "secrets" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "scope" "secret_scope" NOT NULL,
    "scope_id" UUID,
    "label" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "auth_tag" BYTEA,
    "aad_fingerprint" BYTEA NOT NULL,
    "kek_reference" TEXT NOT NULL,
    "dek_wrapped" BYTEA,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "state" "secret_state" NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMPTZ(6),
    "rotated_at" TIMESTAMPTZ(6),
    "rotated_from_secret_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_configurations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "auth_type" "auth_type" NOT NULL DEFAULT 'none',
    "api_key_param_name" TEXT,
    "bearer_prefix" TEXT NOT NULL DEFAULT 'Bearer',
    "oauth_authorization_url" TEXT,
    "oauth_token_url" TEXT,
    "oauth_refresh_url" TEXT,
    "oauth_redirect_uri" TEXT,
    "oauth_scopes" TEXT,
    "oauth_audience" TEXT,
    "oauth_use_pkce" BOOLEAN NOT NULL DEFAULT true,
    "oauth_pkce_method" TEXT NOT NULL DEFAULT 'S256',
    "oauth_client_auth_method" TEXT NOT NULL DEFAULT 'client_secret_post',
    "digest_algorithm" TEXT,
    "digest_qop" TEXT,
    "mtls_verify_peer" BOOLEAN NOT NULL DEFAULT true,
    "custom_scheme" TEXT,
    "extra_params" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_credentials" (
    "id" UUID NOT NULL,
    "auth_configuration_id" UUID NOT NULL,
    "slot" "credential_slot" NOT NULL,
    "secret_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "is_shareable" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_certificates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "host_pattern" TEXT NOT NULL,
    "port" INTEGER,
    "certificate_file_id" UUID NOT NULL,
    "private_key_secret_id" UUID NOT NULL,
    "passphrase_secret_id" UUID,
    "ca_bundle_file_id" UUID,
    "not_before" TIMESTAMPTZ(6),
    "not_after" TIMESTAMPTZ(6),
    "fingerprint_sha256" BYTEA,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "client_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cookie_jar_entries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "environment_id" UUID,
    "owner_user_id" UUID,
    "domain" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '/',
    "name" TEXT NOT NULL,
    "value_secret_id" UUID NOT NULL,
    "is_http_only" BOOLEAN NOT NULL DEFAULT false,
    "is_secure" BOOLEAN NOT NULL DEFAULT true,
    "same_site" "cookie_same_site" NOT NULL DEFAULT 'lax',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cookie_jar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "collection_id" UUID,
    "name" TEXT NOT NULL,
    "kind" "environment_kind" NOT NULL DEFAULT 'custom',
    "description" TEXT,
    "color" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_shared" BOOLEAN NOT NULL DEFAULT true,
    "owner_user_id" UUID,
    "sort_key" TEXT NOT NULL,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by_user_id" UUID,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environment_variables" (
    "id" UUID NOT NULL,
    "environment_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value_kind" "variable_value_kind" NOT NULL DEFAULT 'string',
    "initial_value" TEXT,
    "current_value" TEXT,
    "secret_id" UUID,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "environment_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variable_local_values" (
    "id" UUID NOT NULL,
    "environment_variable_id" UUID,
    "scoped_variable_id" UUID,
    "user_id" UUID NOT NULL,
    "local_value" TEXT,
    "secret_id" UUID,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variable_local_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoped_variables" (
    "id" UUID NOT NULL,
    "scope" "variable_scope" NOT NULL,
    "workspace_id" UUID,
    "collection_id" UUID,
    "api_request_id" UUID,
    "key" TEXT NOT NULL,
    "value_kind" "variable_value_kind" NOT NULL DEFAULT 'string',
    "value" TEXT,
    "secret_id" UUID,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoped_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_links" (
    "id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "public_slug" TEXT NOT NULL,
    "requires_access_code" BOOLEAN NOT NULL DEFAULT false,
    "permission" "share_permission" NOT NULL DEFAULT 'viewer',
    "allow_execution" BOOLEAN NOT NULL DEFAULT false,
    "allow_export" BOOLEAN NOT NULL DEFAULT false,
    "include_examples" BOOLEAN NOT NULL DEFAULT true,
    "state" "share_state" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "max_views" INTEGER,
    "view_count" BIGINT NOT NULL DEFAULT 0,
    "last_accessed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_access_codes" (
    "id" UUID NOT NULL,
    "shared_link_id" UUID NOT NULL,
    "code_selector" TEXT NOT NULL,
    "code_verifier_hash" BYTEA NOT NULL,
    "hash_algorithm" TEXT NOT NULL DEFAULT 'argon2id',
    "hash_params" JSONB NOT NULL DEFAULT '{}',
    "code_hint" TEXT,
    "label" TEXT,
    "state" "share_state" NOT NULL DEFAULT 'active',
    "max_attempts" INTEGER NOT NULL DEFAULT 10,
    "failed_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "max_uses" INTEGER,
    "use_count" BIGINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "rotated_from_code_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "share_access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_access_attempts" (
    "id" BIGSERIAL NOT NULL,
    "shared_link_id" UUID NOT NULL,
    "share_access_code_id" UUID,
    "result" "access_attempt_result" NOT NULL,
    "client_ip" INET,
    "client_ip_prefix" INET,
    "user_agent_hash" BYTEA,
    "authenticated_user_id" UUID,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_access_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_versions" (
    "id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "parent_version_id" UUID,
    "source" "version_source" NOT NULL DEFAULT 'manual',
    "label" TEXT,
    "change_summary" TEXT,
    "snapshot_file_id" UUID,
    "snapshot_inline" JSONB,
    "snapshot_sha256" BYTEA NOT NULL,
    "snapshot_size_bytes" BIGINT NOT NULL DEFAULT 0,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "secrets_excluded" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_history" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "collection_id" UUID,
    "api_request_id" UUID,
    "environment_id" UUID,
    "executed_by_user_id" UUID,
    "shared_link_id" UUID,
    "collection_run_id" UUID,
    "method" "http_method" NOT NULL,
    "method_custom" TEXT,
    "url_final" TEXT NOT NULL,
    "url_host" TEXT NOT NULL,
    "request_size_bytes" BIGINT,
    "status_code" SMALLINT,
    "status_text" TEXT,
    "outcome" "execution_outcome" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "duration_total_ms" INTEGER,
    "duration_ttfb_ms" INTEGER,
    "duration_dns_ms" INTEGER,
    "duration_tls_ms" INTEGER,
    "response_size_bytes" BIGINT,
    "response_content_type" TEXT,
    "redirect_count" SMALLINT NOT NULL DEFAULT 0,
    "request_headers_snapshot" JSONB,
    "response_headers_snapshot" JSONB,
    "response_artifact_id" UUID,
    "request_artifact_id" UUID,
    "body_persistence" "body_persistence" NOT NULL DEFAULT 'none',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "request_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_artifacts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "storage" "storage_backend" NOT NULL DEFAULT 'object_store',
    "storage_key" TEXT,
    "inline_content" BYTEA,
    "content_type" TEXT,
    "content_encoding" TEXT,
    "size_bytes" BIGINT NOT NULL,
    "stored_bytes" BIGINT NOT NULL,
    "is_truncated" BOOLEAN NOT NULL DEFAULT false,
    "checksum_sha256" BYTEA,
    "state" "artifact_state" NOT NULL DEFAULT 'stored',
    "retention_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "purged_at" TIMESTAMPTZ(6),

    CONSTRAINT "response_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "history_retention_days" INTEGER NOT NULL DEFAULT 90,
    "response_body_persistence" "body_persistence" NOT NULL DEFAULT 'none',
    "response_retention_days" INTEGER NOT NULL DEFAULT 7,
    "response_max_persist_bytes" BIGINT NOT NULL DEFAULT 262144,
    "persist_only_on_failure" BOOLEAN NOT NULL DEFAULT false,
    "audit_retention_days" INTEGER NOT NULL DEFAULT 365,
    "attempt_log_retention_days" INTEGER NOT NULL DEFAULT 90,
    "pinned_item_max_age_days" INTEGER,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_definitions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "collection_id" UUID,
    "api_request_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "test_kind" NOT NULL,
    "target_path" TEXT,
    "operator" TEXT,
    "expected_value" TEXT,
    "expected_json" JSONB,
    "max_response_time_ms" INTEGER,
    "script_body" TEXT,
    "sequence_position" INTEGER,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "fail_run_on_error" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "test_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "environment_id" UUID,
    "folder_id" UUID,
    "name" TEXT,
    "trigger" "run_trigger" NOT NULL DEFAULT 'manual',
    "status" "run_status" NOT NULL DEFAULT 'queued',
    "iterations" INTEGER NOT NULL DEFAULT 1,
    "delay_ms" INTEGER NOT NULL DEFAULT 0,
    "stop_on_failure" BOOLEAN NOT NULL DEFAULT false,
    "variable_overrides" JSONB,
    "total_requests" INTEGER NOT NULL DEFAULT 0,
    "completed_requests" INTEGER NOT NULL DEFAULT 0,
    "failed_requests" INTEGER NOT NULL DEFAULT 0,
    "total_tests" INTEGER NOT NULL DEFAULT 0,
    "passed_tests" INTEGER NOT NULL DEFAULT 0,
    "failed_tests" INTEGER NOT NULL DEFAULT 0,
    "total_duration_ms" BIGINT,
    "triggered_by_user_id" UUID,
    "shared_link_id" UUID,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "collection_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" BIGSERIAL NOT NULL,
    "test_definition_id" UUID,
    "collection_run_id" UUID,
    "request_history_id" UUID,
    "api_request_id" UUID,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "test_name_snapshot" TEXT NOT NULL,
    "kind" "test_kind" NOT NULL,
    "result" "test_result" NOT NULL,
    "expected_snapshot" TEXT,
    "actual_snapshot" TEXT,
    "failure_message" TEXT,
    "duration_ms" INTEGER,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "author_user_id" UUID,
    "parent_comment_id" UUID,
    "collection_id" UUID,
    "collection_folder_id" UUID,
    "api_request_id" UUID,
    "body_markdown" TEXT NOT NULL,
    "anchor" JSONB,
    "mentioned_user_ids" UUID[],
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "workspace_id" UUID,
    "kind" "notification_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actor_user_id" UUID,
    "collection_id" UUID,
    "api_request_id" UUID,
    "collection_run_id" UUID,
    "comment_id" UUID,
    "invitation_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),
    "emailed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" UUID,
    "actor_user_id" UUID,
    "actor_kind" TEXT NOT NULL DEFAULT 'user',
    "actor_ip" INET,
    "actor_user_agent_hash" BYTEA,
    "session_id" UUID,
    "shared_link_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" "audit_target_type" NOT NULL,
    "target_id" UUID,
    "target_label" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "owner_user_id" UUID,
    "purpose" "file_purpose" NOT NULL,
    "storage" "storage_backend" NOT NULL DEFAULT 'object_store',
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT,
    "content_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" BYTEA NOT NULL,
    "scan_status" "file_scan_status" NOT NULL DEFAULT 'pending',
    "scan_detail" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "reference_count" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_users_status_created" ON "users"("status", "created_at");

-- CreateIndex
CREATE INDEX "ix_users_deleted_at" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "ix_sessions_user_lastseen" ON "sessions"("user_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "ix_sessions_abs_expiry" ON "sessions"("absolute_expires_at");

-- CreateIndex
CREATE INDEX "ix_sessions_parent" ON "sessions"("parent_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sessions_selector" ON "sessions"("token_selector");

-- CreateIndex
CREATE INDEX "ix_workspaces_owner" ON "workspaces"("owner_user_id");

-- CreateIndex
CREATE INDEX "ix_workspaces_status" ON "workspaces"("status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_workspaces_slug" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "ix_member_user_status" ON "workspace_members"("user_id", "status");

-- CreateIndex
CREATE INDEX "ix_member_ws_role" ON "workspace_members"("workspace_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "uq_member_ws_user" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "ix_invitations_ws_email" ON "invitations"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "ix_invitations_status_expiry" ON "invitations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_invitations_selector" ON "invitations"("token_selector");

-- CreateIndex
CREATE INDEX "ix_projects_ws_order" ON "projects"("workspace_id", "status", "sort_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_projects_ws_slug" ON "projects"("workspace_id", "slug");

-- CreateIndex
CREATE INDEX "ix_collections_tree" ON "collections"("workspace_id", "project_id", "status", "sort_key");

-- CreateIndex
CREATE INDEX "ix_collections_visibility" ON "collections"("visibility", "status");

-- CreateIndex
CREATE INDEX "ix_collections_name_trgm" ON "collections" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "uq_collections_ws_slug" ON "collections"("workspace_id", "slug");

-- CreateIndex
CREATE INDEX "ix_folders_siblings" ON "collection_folders"("collection_id", "parent_folder_id", "sort_key");

-- CreateIndex
CREATE INDEX "ix_folders_path" ON "collection_folders"("materialized_path" text_pattern_ops);

-- CreateIndex
CREATE INDEX "ix_folders_collection" ON "collection_folders"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_folder_sibling_name" ON "collection_folders"("collection_id", "parent_folder_id", "name");

-- CreateIndex
CREATE INDEX "ix_requests_siblings" ON "api_requests"("collection_id", "folder_id", "sort_key");

-- CreateIndex
CREATE INDEX "ix_requests_collection_live" ON "api_requests"("collection_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ix_requests_method" ON "api_requests"("collection_id", "method");

-- CreateIndex
CREATE INDEX "ix_requests_name_trgm" ON "api_requests" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_requests_url_trgm" ON "api_requests" USING GIN ("url_template" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "uq_requests_external_ref" ON "api_requests"("collection_id", "external_ref");

-- CreateIndex
CREATE INDEX "ix_headers_request_order" ON "request_headers"("api_request_id", "sort_order");

-- CreateIndex
CREATE INDEX "ix_headers_request_name" ON "request_headers"("api_request_id", "name");

-- CreateIndex
CREATE INDEX "ix_headers_secret" ON "request_headers"("secret_id");

-- CreateIndex
CREATE INDEX "ix_params_request_order" ON "request_params"("api_request_id", "kind", "sort_order");

-- CreateIndex
CREATE INDEX "ix_params_secret" ON "request_params"("secret_id");

-- CreateIndex
CREATE INDEX "ix_bodies_file" ON "request_bodies"("binary_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bodies_request" ON "request_bodies"("api_request_id");

-- CreateIndex
CREATE INDEX "ix_bodyfields_order" ON "request_body_fields"("request_body_id", "sort_order");

-- CreateIndex
CREATE INDEX "ix_bodyfields_secret" ON "request_body_fields"("secret_id");

-- CreateIndex
CREATE INDEX "ix_bodyfields_file" ON "request_body_fields"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tags_ws_name" ON "tags"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "ix_request_tags_tag" ON "request_tags"("tag_id");

-- CreateIndex
CREATE INDEX "ix_secrets_scope" ON "secrets"("workspace_id", "scope", "scope_id");

-- CreateIndex
CREATE INDEX "ix_secrets_expiry" ON "secrets"("state", "expires_at");

-- CreateIndex
CREATE INDEX "ix_secrets_kek" ON "secrets"("kek_reference");

-- CreateIndex
CREATE INDEX "ix_secrets_rotation_chain" ON "secrets"("rotated_from_secret_id");

-- CreateIndex
CREATE INDEX "ix_authcfg_ws_name" ON "auth_configurations"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "ix_authcfg_type" ON "auth_configurations"("auth_type");

-- CreateIndex
CREATE INDEX "ix_authcred_secret" ON "auth_credentials"("secret_id");

-- CreateIndex
CREATE INDEX "ix_authcred_owner" ON "auth_credentials"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_authcred_slot_owner" ON "auth_credentials"("auth_configuration_id", "slot", "owner_user_id");

-- CreateIndex
CREATE INDEX "ix_clientcert_ws_host" ON "client_certificates"("workspace_id", "host_pattern");

-- CreateIndex
CREATE INDEX "ix_clientcert_expiry" ON "client_certificates"("not_after");

-- CreateIndex
CREATE INDEX "ix_cookie_expiry" ON "cookie_jar_entries"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cookie_identity" ON "cookie_jar_entries"("workspace_id", "environment_id", "domain", "path", "name", "owner_user_id");

-- CreateIndex
CREATE INDEX "ix_env_ws_shared" ON "environments"("workspace_id", "is_shared");

-- CreateIndex
CREATE INDEX "ix_env_owner" ON "environments"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_env_scope_name" ON "environments"("workspace_id", "collection_id", "name");

-- CreateIndex
CREATE INDEX "ix_envvar_order" ON "environment_variables"("environment_id", "sort_order");

-- CreateIndex
CREATE INDEX "ix_envvar_secret" ON "environment_variables"("secret_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_envvar_env_key" ON "environment_variables"("environment_id", "key");

-- CreateIndex
CREATE INDEX "ix_varlocal_user" ON "variable_local_values"("user_id");

-- CreateIndex
CREATE INDEX "ix_varlocal_secret" ON "variable_local_values"("secret_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_varlocal_envvar_user" ON "variable_local_values"("environment_variable_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_varlocal_scopedvar_user" ON "variable_local_values"("scoped_variable_id", "user_id");

-- CreateIndex
CREATE INDEX "ix_scopedvar_ws_scope" ON "scoped_variables"("workspace_id", "scope");

-- CreateIndex
CREATE INDEX "ix_scopedvar_collection" ON "scoped_variables"("collection_id");

-- CreateIndex
CREATE INDEX "ix_scopedvar_request" ON "scoped_variables"("api_request_id");

-- CreateIndex
CREATE INDEX "ix_scopedvar_secret" ON "scoped_variables"("secret_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_scopedvar_identity" ON "scoped_variables"("scope", "workspace_id", "collection_id", "api_request_id", "key");

-- CreateIndex
CREATE INDEX "ix_sharedlink_collection" ON "shared_links"("collection_id", "state");

-- CreateIndex
CREATE INDEX "ix_sharedlink_workspace" ON "shared_links"("workspace_id", "state");

-- CreateIndex
CREATE INDEX "ix_sharedlink_expiry" ON "shared_links"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sharedlink_slug" ON "shared_links"("public_slug");

-- CreateIndex
CREATE INDEX "ix_sharecode_link_state" ON "share_access_codes"("shared_link_id", "state");

-- CreateIndex
CREATE INDEX "ix_sharecode_expiry" ON "share_access_codes"("state", "expires_at");

-- CreateIndex
CREATE INDEX "ix_sharecode_rotation" ON "share_access_codes"("rotated_from_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sharecode_selector" ON "share_access_codes"("code_selector");

-- CreateIndex
CREATE INDEX "ix_attempt_link_time" ON "share_access_attempts"("shared_link_id", "attempted_at");

-- CreateIndex
CREATE INDEX "ix_attempt_ip_time" ON "share_access_attempts"("client_ip_prefix", "attempted_at");

-- CreateIndex
CREATE INDEX "ix_attempt_result_time" ON "share_access_attempts"("result", "attempted_at");

-- CreateIndex
CREATE INDEX "ix_attempt_time" ON "share_access_attempts"("attempted_at");

-- CreateIndex
CREATE INDEX "ix_version_collection_time" ON "collection_versions"("collection_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_version_parent" ON "collection_versions"("parent_version_id");

-- CreateIndex
CREATE INDEX "ix_version_file" ON "collection_versions"("snapshot_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_version_collection_number" ON "collection_versions"("collection_id", "version_number");

-- CreateIndex
CREATE INDEX "ix_history_ws_time" ON "request_history"("workspace_id", "executed_at");

-- CreateIndex
CREATE INDEX "ix_history_request_time" ON "request_history"("api_request_id", "executed_at");

-- CreateIndex
CREATE INDEX "ix_history_user_time" ON "request_history"("executed_by_user_id", "executed_at");

-- CreateIndex
CREATE INDEX "ix_history_collection_time" ON "request_history"("collection_id", "executed_at");

-- CreateIndex
CREATE INDEX "ix_history_ws_status" ON "request_history"("workspace_id", "status_code", "executed_at");

-- CreateIndex
CREATE INDEX "ix_history_host" ON "request_history"("url_host");

-- CreateIndex
CREATE INDEX "ix_history_expiry" ON "request_history"("expires_at");

-- CreateIndex
CREATE INDEX "ix_history_run" ON "request_history"("collection_run_id");

-- CreateIndex
CREATE INDEX "ix_history_artifact" ON "request_history"("response_artifact_id");

-- CreateIndex
CREATE INDEX "ix_artifact_purge" ON "response_artifacts"("state", "expires_at");

-- CreateIndex
CREATE INDEX "ix_artifact_ws_time" ON "response_artifacts"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_artifact_storage_key" ON "response_artifacts"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_retention_workspace" ON "retention_policies"("workspace_id");

-- CreateIndex
CREATE INDEX "ix_test_request_order" ON "test_definitions"("api_request_id", "sort_order");

-- CreateIndex
CREATE INDEX "ix_test_collection_order" ON "test_definitions"("collection_id", "sort_order");

-- CreateIndex
CREATE INDEX "ix_test_ws_kind" ON "test_definitions"("workspace_id", "kind");

-- CreateIndex
CREATE INDEX "ix_run_collection_time" ON "collection_runs"("collection_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_run_ws_status" ON "collection_runs"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ix_run_status_time" ON "collection_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "ix_run_expiry" ON "collection_runs"("expires_at");

-- CreateIndex
CREATE INDEX "ix_testrun_run" ON "test_runs"("collection_run_id", "executed_at");

-- CreateIndex
CREATE INDEX "ix_testrun_definition" ON "test_runs"("test_definition_id", "executed_at");

-- CreateIndex
CREATE INDEX "ix_testrun_result" ON "test_runs"("result", "executed_at");

-- CreateIndex
CREATE INDEX "ix_testrun_history" ON "test_runs"("request_history_id");

-- CreateIndex
CREATE INDEX "ix_testrun_expiry" ON "test_runs"("expires_at");

-- CreateIndex
CREATE INDEX "ix_comment_collection" ON "comments"("collection_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_comment_request" ON "comments"("api_request_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_comment_folder" ON "comments"("collection_folder_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_comment_parent" ON "comments"("parent_comment_id");

-- CreateIndex
CREATE INDEX "ix_comment_ws_time" ON "comments"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_notif_user_time" ON "notifications"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_notif_user_unread" ON "notifications"("recipient_user_id", "read_at");

-- CreateIndex
CREATE INDEX "ix_notif_ws_time" ON "notifications"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_notif_expiry" ON "notifications"("expires_at");

-- CreateIndex
CREATE INDEX "ix_audit_ws_time" ON "audit_logs"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_audit_actor_time" ON "audit_logs"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_audit_target" ON "audit_logs"("target_type", "target_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_audit_action_time" ON "audit_logs"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_audit_time" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "ix_files_ws_purpose" ON "files"("workspace_id", "purpose");

-- CreateIndex
CREATE INDEX "ix_files_checksum" ON "files"("checksum_sha256");

-- CreateIndex
CREATE INDEX "ix_files_scan_queue" ON "files"("scan_status", "uploaded_at");

-- CreateIndex
CREATE INDEX "ix_files_expiry" ON "files"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_files_storage_key" ON "files"("storage_key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "fk_users_avatar" FOREIGN KEY ("avatar_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "fk_users_mfa_secret" FOREIGN KEY ("mfa_secret_id") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_parent" FOREIGN KEY ("parent_session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "fk_ws_deleted_by" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "fk_ws_icon" FOREIGN KEY ("icon_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "fk_ws_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "fk_member_invited_by" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "fk_member_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "fk_member_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "fk_inv_accepted_by" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "fk_inv_invited_by" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "fk_inv_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_project_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_project_deleter" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "fk_project_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "fk_collection_auth" FOREIGN KEY ("default_auth_configuration_id") REFERENCES "auth_configurations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "fk_collection_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "fk_collection_deleter" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "fk_collection_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "fk_collection_source" FOREIGN KEY ("source_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "fk_collection_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_folders" ADD CONSTRAINT "fk_folder_auth" FOREIGN KEY ("auth_configuration_id") REFERENCES "auth_configurations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_folders" ADD CONSTRAINT "fk_folder_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_folders" ADD CONSTRAINT "fk_folder_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_folders" ADD CONSTRAINT "fk_folder_deleter" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_folders" ADD CONSTRAINT "fk_folder_parent" FOREIGN KEY ("parent_folder_id") REFERENCES "collection_folders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_requests" ADD CONSTRAINT "fk_request_auth" FOREIGN KEY ("auth_configuration_id") REFERENCES "auth_configurations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_requests" ADD CONSTRAINT "fk_request_cert" FOREIGN KEY ("client_certificate_id") REFERENCES "client_certificates"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_requests" ADD CONSTRAINT "fk_request_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_requests" ADD CONSTRAINT "fk_request_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_requests" ADD CONSTRAINT "fk_request_deleter" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_requests" ADD CONSTRAINT "fk_request_folder" FOREIGN KEY ("folder_id") REFERENCES "collection_folders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_headers" ADD CONSTRAINT "fk_header_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_headers" ADD CONSTRAINT "fk_header_secret" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_params" ADD CONSTRAINT "fk_param_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_params" ADD CONSTRAINT "fk_param_secret" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_bodies" ADD CONSTRAINT "fk_body_file" FOREIGN KEY ("binary_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_bodies" ADD CONSTRAINT "fk_body_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_body_fields" ADD CONSTRAINT "fk_bodyfield_body" FOREIGN KEY ("request_body_id") REFERENCES "request_bodies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_body_fields" ADD CONSTRAINT "fk_bodyfield_file" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_body_fields" ADD CONSTRAINT "fk_bodyfield_secret" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "fk_tag_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_tags" ADD CONSTRAINT "fk_reqtag_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_tags" ADD CONSTRAINT "fk_reqtag_tag" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_tags" ADD CONSTRAINT "fk_reqtag_user" FOREIGN KEY ("tagged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "fk_secret_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "fk_secret_rotation" FOREIGN KEY ("rotated_from_secret_id") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "fk_secret_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_configurations" ADD CONSTRAINT "fk_authcfg_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_configurations" ADD CONSTRAINT "fk_authcfg_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_credentials" ADD CONSTRAINT "fk_authcred_cfg" FOREIGN KEY ("auth_configuration_id") REFERENCES "auth_configurations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_credentials" ADD CONSTRAINT "fk_authcred_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_credentials" ADD CONSTRAINT "fk_authcred_secret" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_certificates" ADD CONSTRAINT "fk_cert_ca" FOREIGN KEY ("ca_bundle_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_certificates" ADD CONSTRAINT "fk_cert_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_certificates" ADD CONSTRAINT "fk_cert_file" FOREIGN KEY ("certificate_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_certificates" ADD CONSTRAINT "fk_cert_key" FOREIGN KEY ("private_key_secret_id") REFERENCES "secrets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_certificates" ADD CONSTRAINT "fk_cert_passphrase" FOREIGN KEY ("passphrase_secret_id") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_certificates" ADD CONSTRAINT "fk_cert_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cookie_jar_entries" ADD CONSTRAINT "fk_cookie_env" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cookie_jar_entries" ADD CONSTRAINT "fk_cookie_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cookie_jar_entries" ADD CONSTRAINT "fk_cookie_secret" FOREIGN KEY ("value_secret_id") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cookie_jar_entries" ADD CONSTRAINT "fk_cookie_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "fk_env_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "fk_env_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "fk_env_deleter" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "fk_env_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "fk_env_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "environment_variables" ADD CONSTRAINT "fk_envvar_env" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "environment_variables" ADD CONSTRAINT "fk_envvar_secret" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "variable_local_values" ADD CONSTRAINT "fk_varlocal_envvar" FOREIGN KEY ("environment_variable_id") REFERENCES "environment_variables"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "variable_local_values" ADD CONSTRAINT "fk_varlocal_scopedvar" FOREIGN KEY ("scoped_variable_id") REFERENCES "scoped_variables"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "variable_local_values" ADD CONSTRAINT "fk_varlocal_secret" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "variable_local_values" ADD CONSTRAINT "fk_varlocal_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scoped_variables" ADD CONSTRAINT "fk_scopedvar_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scoped_variables" ADD CONSTRAINT "fk_scopedvar_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scoped_variables" ADD CONSTRAINT "fk_scopedvar_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scoped_variables" ADD CONSTRAINT "fk_scopedvar_secret" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scoped_variables" ADD CONSTRAINT "fk_scopedvar_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "fk_share_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "fk_share_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "fk_share_revoker" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "fk_share_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_access_codes" ADD CONSTRAINT "fk_sharecode_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_access_codes" ADD CONSTRAINT "fk_sharecode_link" FOREIGN KEY ("shared_link_id") REFERENCES "shared_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_access_codes" ADD CONSTRAINT "fk_sharecode_revoker" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_access_codes" ADD CONSTRAINT "fk_sharecode_rotation" FOREIGN KEY ("rotated_from_code_id") REFERENCES "share_access_codes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_access_attempts" ADD CONSTRAINT "fk_attempt_code" FOREIGN KEY ("share_access_code_id") REFERENCES "share_access_codes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_access_attempts" ADD CONSTRAINT "fk_attempt_link" FOREIGN KEY ("shared_link_id") REFERENCES "shared_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "share_access_attempts" ADD CONSTRAINT "fk_attempt_user" FOREIGN KEY ("authenticated_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_versions" ADD CONSTRAINT "fk_version_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_versions" ADD CONSTRAINT "fk_version_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_versions" ADD CONSTRAINT "fk_version_file" FOREIGN KEY ("snapshot_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_versions" ADD CONSTRAINT "fk_version_parent" FOREIGN KEY ("parent_version_id") REFERENCES "collection_versions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_env" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_req_artifact" FOREIGN KEY ("request_artifact_id") REFERENCES "response_artifacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_resp_artifact" FOREIGN KEY ("response_artifact_id") REFERENCES "response_artifacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_run" FOREIGN KEY ("collection_run_id") REFERENCES "collection_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_share" FOREIGN KEY ("shared_link_id") REFERENCES "shared_links"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_user" FOREIGN KEY ("executed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "request_history" ADD CONSTRAINT "fk_history_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "response_artifacts" ADD CONSTRAINT "fk_artifact_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "fk_retention_user" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "fk_retention_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_definitions" ADD CONSTRAINT "fk_test_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_definitions" ADD CONSTRAINT "fk_test_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_definitions" ADD CONSTRAINT "fk_test_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_definitions" ADD CONSTRAINT "fk_test_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "fk_run_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "fk_run_env" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "fk_run_folder" FOREIGN KEY ("folder_id") REFERENCES "collection_folders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "fk_run_share" FOREIGN KEY ("shared_link_id") REFERENCES "shared_links"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "fk_run_user" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "fk_run_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "fk_testrun_definition" FOREIGN KEY ("test_definition_id") REFERENCES "test_definitions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "fk_testrun_history" FOREIGN KEY ("request_history_id") REFERENCES "request_history"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "fk_testrun_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "fk_testrun_run" FOREIGN KEY ("collection_run_id") REFERENCES "collection_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "fk_comment_author" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "fk_comment_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "fk_comment_folder" FOREIGN KEY ("collection_folder_id") REFERENCES "collection_folders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "fk_comment_parent" FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "fk_comment_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "fk_comment_resolver" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "fk_comment_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notif_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notif_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notif_comment" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notif_invitation" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notif_recipient" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notif_request" FOREIGN KEY ("api_request_id") REFERENCES "api_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notif_run" FOREIGN KEY ("collection_run_id") REFERENCES "collection_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notif_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_session" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_share" FOREIGN KEY ("shared_link_id") REFERENCES "shared_links"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "fk_file_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "fk_file_ws" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

