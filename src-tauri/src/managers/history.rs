use anyhow::Result;
use chrono::{DateTime, Local, Utc};
use log::{debug, error, info};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_specta::Event;

/// Database migrations for transcription history.
/// Each migration is applied in order. The library tracks which migrations
/// have been applied using SQLite's user_version pragma.
///
/// Note: For users upgrading from tauri-plugin-sql, migrate_from_tauri_plugin_sql()
/// converts the old _sqlx_migrations table tracking to the user_version pragma,
/// ensuring migrations don't re-run on existing databases.
static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS transcription_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            saved BOOLEAN NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            transcription_text TEXT NOT NULL
        );",
    ),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_processed_text TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_prompt TEXT;"),
    M::up("ALTER TABLE transcription_history ADD COLUMN post_process_requested BOOLEAN NOT NULL DEFAULT 0;"),
    M::up(
        "CREATE TABLE IF NOT EXISTS transcription_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            history_entry_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            prompt TEXT,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (history_entry_id) REFERENCES transcription_history(id) ON DELETE CASCADE
        );",
    ),
    M::up(
        "CREATE INDEX IF NOT EXISTS idx_transcription_versions_entry_id ON transcription_versions(history_entry_id);",
    ),
    M::up("ALTER TABLE transcription_versions ADD COLUMN model_name TEXT;"),
    M::up("ALTER TABLE transcription_versions ADD COLUMN target TEXT NOT NULL DEFAULT 'post_processed';"),
    M::up("ALTER TABLE transcription_history ADD COLUMN source TEXT NOT NULL DEFAULT 'voice';"),
    M::up(
        "CREATE TABLE IF NOT EXISTS document_tabs (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            is_archived INTEGER NOT NULL DEFAULT 0
        );",
    ),
    M::up("ALTER TABLE document_tabs ADD COLUMN history_entry_id INTEGER;"),
    M::up("ALTER TABLE document_tabs ADD COLUMN auto_labeled INTEGER NOT NULL DEFAULT 0;"),
];

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct PaginatedHistory {
    pub entries: Vec<HistoryEntry>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, tauri_specta::Event)]
#[serde(tag = "action")]
pub enum HistoryUpdatePayload {
    #[serde(rename = "added")]
    Added { entry: HistoryEntry },
    #[serde(rename = "updated")]
    Updated { entry: HistoryEntry },
    #[serde(rename = "deleted")]
    Deleted { id: i64 },
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct HistoryEntry {
    pub id: i64,
    pub file_name: String,
    pub timestamp: i64,
    pub saved: bool,
    pub title: String,
    pub transcription_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
    pub post_process_requested: bool,
    pub version_count: i64,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DocumentTab {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub history_entry_id: Option<i64>,
    pub auto_labeled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct TranscriptionVersion {
    pub id: i64,
    pub history_entry_id: i64,
    pub text: String,
    pub prompt: Option<String>,
    pub model_name: Option<String>,
    pub target: String,
    pub timestamp: i64,
}

pub struct HistoryManager {
    app_handle: AppHandle,
    recordings_dir: PathBuf,
    db_path: PathBuf,
}

impl HistoryManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create recordings directory in app data dir
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        let recordings_dir = app_data_dir.join("recordings");
        let db_path = app_data_dir.join("history.db");

        // Ensure recordings directory exists
        if !recordings_dir.exists() {
            fs::create_dir_all(&recordings_dir)?;
            debug!("Created recordings directory: {:?}", recordings_dir);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            recordings_dir,
            db_path,
        };

        // Initialize database and run migrations synchronously
        manager.init_database()?;

        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing database at {:?}", self.db_path);

        let mut conn = Connection::open(&self.db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        // Handle migration from tauri-plugin-sql to rusqlite_migration
        // tauri-plugin-sql used _sqlx_migrations table, rusqlite_migration uses user_version pragma
        self.migrate_from_tauri_plugin_sql(&conn)?;
        Self::repair_legacy_insiders_schema(&conn)?;

        // Create migrations object and run to latest version
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        // Validate migrations in debug builds
        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid migrations");

        // Get current version before migration
        let version_before: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        debug!("Database version before migration: {}", version_before);

        // Apply any pending migrations
        migrations.to_latest(&mut conn)?;

        // Get version after migration
        let version_after: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version_after > version_before {
            info!(
                "Database migrated from version {} to {}",
                version_before, version_after
            );
        } else {
            debug!("Database already at latest version {}", version_after);
        }

        Ok(())
    }

    fn repair_legacy_insiders_schema(conn: &Connection) -> Result<()> {
        let current_version: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if current_version < 8 {
            return Ok(());
        }

        let has_versions = Self::table_exists(conn, "transcription_versions")?;
        let has_source = Self::column_exists(conn, "transcription_history", "source")?;
        let has_post_process_requested =
            Self::column_exists(conn, "transcription_history", "post_process_requested")?;

        if has_versions && has_source && !has_post_process_requested {
            info!("Repairing pre-v0.8.3 insiders history schema");
            conn.execute(
                "ALTER TABLE transcription_history ADD COLUMN post_process_requested BOOLEAN NOT NULL DEFAULT 0",
                [],
            )?;
            conn.pragma_update(None, "user_version", MIGRATIONS.len() as i32)?;
        }

        Ok(())
    }

    fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
        Ok(conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )?)
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for row in rows {
            if row? == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Migrate from tauri-plugin-sql's migration tracking to rusqlite_migration's.
    /// tauri-plugin-sql used a _sqlx_migrations table, while rusqlite_migration uses
    /// SQLite's user_version pragma. This function checks if the old system was in use
    /// and sets the user_version accordingly so migrations don't re-run.
    fn migrate_from_tauri_plugin_sql(&self, conn: &Connection) -> Result<()> {
        // Check if the old _sqlx_migrations table exists
        let has_sqlx_migrations: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !has_sqlx_migrations {
            return Ok(());
        }

        // Check current user_version
        let current_version: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if current_version > 0 {
            // Already migrated to rusqlite_migration system
            return Ok(());
        }

        // Get the highest version from the old migrations table
        let old_version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations WHERE success = 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if old_version > 0 {
            info!(
                "Migrating from tauri-plugin-sql (version {}) to rusqlite_migration",
                old_version
            );

            // Set user_version to match the old migration state
            conn.pragma_update(None, "user_version", old_version)?;

            // Optionally drop the old migrations table (keeping it doesn't hurt)
            // conn.execute("DROP TABLE IF EXISTS _sqlx_migrations", [])?;

            info!(
                "Migration tracking converted: user_version set to {}",
                old_version
            );
        }

        Ok(())
    }

    fn get_connection(&self) -> Result<Connection> {
        let conn = Connection::open(&self.db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(conn)
    }

    fn map_history_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
        Ok(HistoryEntry {
            id: row.get("id")?,
            file_name: row.get("file_name")?,
            timestamp: row.get("timestamp")?,
            saved: row.get("saved")?,
            title: row.get("title")?,
            transcription_text: row.get("transcription_text")?,
            post_processed_text: row.get("post_processed_text")?,
            post_process_prompt: row.get("post_process_prompt")?,
            post_process_requested: row.get("post_process_requested")?,
            version_count: row.get("version_count")?,
            source: row.get("source")?,
        })
    }

    pub fn recordings_dir(&self) -> &std::path::Path {
        &self.recordings_dir
    }

    /// Save a new history entry to the database.
    /// The WAV file should already have been written to the recordings directory.
    pub fn save_entry(
        &self,
        file_name: String,
        transcription_text: String,
        post_process_requested: bool,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
    ) -> Result<HistoryEntry> {
        let timestamp = Utc::now().timestamp();
        let title = self.format_timestamp_title(timestamp);

        let saved_entry = self.save_to_database(
            file_name,
            timestamp,
            title,
            transcription_text,
            post_process_requested,
            post_processed_text,
            post_process_prompt,
            "voice",
        )?;

        self.cleanup_old_entries()?;

        let conn = self.get_connection()?;
        if let Some(entry) = Self::get_entry_by_id_with_conn(&conn, saved_entry.id)? {
            if let Err(e) = (HistoryUpdatePayload::Added {
                entry: entry.clone(),
            })
            .emit(&self.app_handle)
            {
                error!("Failed to emit history update event: {}", e);
            }
            Ok(entry)
        } else {
            Ok(saved_entry)
        }
    }

    fn save_to_database(
        &self,
        file_name: String,
        timestamp: i64,
        title: String,
        transcription_text: String,
        post_process_requested: bool,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
        source: &str,
    ) -> Result<HistoryEntry> {
        let conn = self.get_connection()?;
        conn.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_prompt,
                post_process_requested,
                source
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                &file_name,
                timestamp,
                false,
                &title,
                &transcription_text,
                &post_processed_text,
                &post_process_prompt,
                post_process_requested,
                source
            ],
        )?;

        let entry = HistoryEntry {
            id: conn.last_insert_rowid(),
            file_name,
            timestamp,
            saved: false,
            title,
            transcription_text,
            post_processed_text,
            post_process_prompt,
            post_process_requested,
            version_count: 0,
            source: source.to_string(),
        };

        debug!("Saved {} entry to database", source);
        Ok(entry)
    }

    /// Update an existing history entry with new transcription results (used by retry).
    pub fn update_transcription(
        &self,
        id: i64,
        transcription_text: String,
        post_processed_text: Option<String>,
        post_process_prompt: Option<String>,
    ) -> Result<HistoryEntry> {
        let conn = self.get_connection()?;
        let updated = conn.execute(
            "UPDATE transcription_history
             SET transcription_text = ?1,
                 post_processed_text = ?2,
                 post_process_prompt = ?3
             WHERE id = ?4",
            params![
                transcription_text,
                post_processed_text,
                post_process_prompt,
                id
            ],
        )?;

        if updated == 0 {
            return Err(anyhow::anyhow!("History entry {} not found", id));
        }

        let entry = conn.query_row(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, post_process_requested, source,
             (SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = transcription_history.id) AS version_count
             FROM transcription_history WHERE id = ?1",
            params![id],
            Self::map_history_entry,
        )?;

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(entry)
    }

    /// Save a text operation result to history (no audio file)
    pub fn save_text_operation(
        &self,
        input_text: String,
        result_text: String,
        prompt_name: String,
    ) -> Result<HistoryEntry> {
        let timestamp = Utc::now().timestamp();
        let title = self.format_timestamp_title(timestamp);
        let file_name = format!("text-op-{}", timestamp);

        let entry = self.save_to_database(
            file_name,
            timestamp,
            title,
            input_text,
            false,
            Some(result_text),
            Some(prompt_name),
            "text",
        )?;

        if let Err(e) = (HistoryUpdatePayload::Added {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(entry)
    }

    pub fn cleanup_old_entries(&self) -> Result<()> {
        let retention_period = crate::settings::get_recording_retention_period(&self.app_handle);

        match retention_period {
            crate::settings::RecordingRetentionPeriod::Never => {
                // Don't delete anything
                Ok(())
            }
            crate::settings::RecordingRetentionPeriod::PreserveLimit => {
                // Use the old count-based logic with history_limit
                let limit = crate::settings::get_history_limit(&self.app_handle);
                self.cleanup_by_count(limit)
            }
            _ => {
                // Use time-based logic
                self.cleanup_by_time(retention_period)
            }
        }
    }

    fn delete_entries_and_files(&self, entries: &[(i64, String)]) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }

        let conn = self.get_connection()?;
        let mut deleted_count = 0;

        for (id, file_name) in entries {
            // Delete database entry
            let affected = conn.execute(
                "DELETE FROM transcription_history WHERE id = ?1",
                params![id],
            )?;
            if affected == 0 {
                continue;
            }
            deleted_count += affected;

            // Delete WAV file
            let file_path = self.recordings_dir.join(file_name);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    error!("Failed to delete WAV file {}: {}", file_name, e);
                } else {
                    debug!("Deleted old WAV file: {}", file_name);
                }
            }

            if let Err(e) = (HistoryUpdatePayload::Deleted { id: *id }).emit(&self.app_handle) {
                error!("Failed to emit history update event: {}", e);
            }
        }

        Ok(deleted_count)
    }

    fn cleanup_by_count(&self, limit: usize) -> Result<()> {
        let conn = self.get_connection()?;

        // Retention settings apply to recordings, not text-operation history.
        let mut stmt = conn.prepare(
            "SELECT id, file_name FROM transcription_history WHERE saved = 0 AND source = 'voice' ORDER BY timestamp DESC"
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>("id")?, row.get::<_, String>("file_name")?))
        })?;

        let mut entries: Vec<(i64, String)> = Vec::new();
        for row in rows {
            entries.push(row?);
        }

        if entries.len() > limit {
            let entries_to_delete = &entries[limit..];
            let deleted_count = self.delete_entries_and_files(entries_to_delete)?;

            if deleted_count > 0 {
                debug!("Cleaned up {} old history entries by count", deleted_count);
            }
        }

        Ok(())
    }

    fn cleanup_by_time(
        &self,
        retention_period: crate::settings::RecordingRetentionPeriod,
    ) -> Result<()> {
        let conn = self.get_connection()?;

        // Calculate cutoff timestamp (current time minus retention period)
        let now = Utc::now().timestamp();
        let cutoff_timestamp = match retention_period {
            crate::settings::RecordingRetentionPeriod::Days3 => now - (3 * 24 * 60 * 60), // 3 days in seconds
            crate::settings::RecordingRetentionPeriod::Weeks2 => now - (2 * 7 * 24 * 60 * 60), // 2 weeks in seconds
            crate::settings::RecordingRetentionPeriod::Months3 => now - (3 * 30 * 24 * 60 * 60), // 3 months in seconds (approximate)
            _ => unreachable!("Should not reach here"),
        };

        // Retention settings apply to recordings, not text-operation history.
        let mut stmt = conn.prepare(
            "SELECT id, file_name FROM transcription_history WHERE saved = 0 AND source = 'voice' AND timestamp < ?1",
        )?;

        let rows = stmt.query_map(params![cutoff_timestamp], |row| {
            Ok((row.get::<_, i64>("id")?, row.get::<_, String>("file_name")?))
        })?;

        let mut entries_to_delete: Vec<(i64, String)> = Vec::new();
        for row in rows {
            entries_to_delete.push(row?);
        }

        let deleted_count = self.delete_entries_and_files(&entries_to_delete)?;

        if deleted_count > 0 {
            debug!(
                "Cleaned up {} old history entries based on retention period",
                deleted_count
            );
        }

        Ok(())
    }

    pub async fn get_history_entries(
        &self,
        source: Option<&str>,
        cursor: Option<i64>,
        limit: Option<usize>,
    ) -> Result<PaginatedHistory> {
        let conn = self.get_connection()?;
        let limit = limit.map(|l| l.min(100));

        let select = "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, post_process_requested, source,
             (SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = transcription_history.id) AS version_count
             FROM transcription_history";

        let (where_clause, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
            match (source, cursor) {
                (Some(source), Some(cursor)) => (
                    " WHERE source = ?1 AND id < ?2".to_string(),
                    vec![Box::new(source.to_string()), Box::new(cursor)],
                ),
                (Some(source), None) => (
                    " WHERE source = ?1".to_string(),
                    vec![Box::new(source.to_string())],
                ),
                (None, Some(cursor)) => (" WHERE id < ?1".to_string(), vec![Box::new(cursor)]),
                (None, None) => ("".to_string(), vec![]),
            };

        let mut sql = format!("{}{} ORDER BY id DESC", select, where_clause);
        let mut params_vec = params_vec;
        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT ?{}", params_vec.len() + 1));
            params_vec.push(Box::new((limit + 1) as i64));
        }

        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), Self::map_history_entry)?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }

        let has_more = limit.is_some_and(|lim| entries.len() > lim);
        if has_more {
            entries.pop();
        }

        Ok(PaginatedHistory { entries, has_more })
    }

    #[cfg(test)]
    fn get_latest_entry_with_conn(conn: &Connection) -> Result<Option<HistoryEntry>> {
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, source,
             post_process_requested,
             (SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = transcription_history.id) AS version_count
             FROM transcription_history
             ORDER BY timestamp DESC
             LIMIT 1",
        )?;

        let entry = stmt.query_row([], Self::map_history_entry).optional()?;

        Ok(entry)
    }

    /// Get the latest entry with non-empty transcription text.
    pub fn get_latest_completed_entry(&self) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        Self::get_latest_completed_entry_with_conn(&conn)
    }

    fn get_latest_completed_entry_with_conn(conn: &Connection) -> Result<Option<HistoryEntry>> {
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, post_process_requested, source,
             (SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = transcription_history.id) AS version_count
             FROM transcription_history
             WHERE transcription_text != ''
             ORDER BY timestamp DESC
             LIMIT 1",
        )?;

        let entry = stmt.query_row([], Self::map_history_entry).optional()?;
        Ok(entry)
    }

    pub async fn toggle_saved_status(&self, id: i64) -> Result<HistoryEntry> {
        let conn = self.get_connection()?;

        // Get current saved status
        let current_saved: bool = conn.query_row(
            "SELECT saved FROM transcription_history WHERE id = ?1",
            params![id],
            |row| row.get("saved"),
        )?;

        let new_saved = !current_saved;

        conn.execute(
            "UPDATE transcription_history SET saved = ?1 WHERE id = ?2",
            params![new_saved, id],
        )?;

        debug!("Toggled saved status for entry {}: {}", id, new_saved);

        let entry = Self::get_entry_by_id_with_conn(&conn, id)?
            .ok_or_else(|| anyhow::anyhow!("History entry {} not found after toggle", id))?;

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(entry)
    }

    pub fn get_audio_file_path(&self, file_name: &str) -> PathBuf {
        self.recordings_dir.join(file_name)
    }

    pub async fn get_entry_by_id(&self, id: i64) -> Result<Option<HistoryEntry>> {
        let conn = self.get_connection()?;
        Self::get_entry_by_id_with_conn(&conn, id)
    }

    fn get_entry_by_id_with_conn(conn: &Connection, id: i64) -> Result<Option<HistoryEntry>> {
        let mut stmt = conn.prepare(
            "SELECT id, file_name, timestamp, saved, title, transcription_text, post_processed_text, post_process_prompt, post_process_requested, source,
             (SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = transcription_history.id) AS version_count
             FROM transcription_history WHERE id = ?1",
        )?;

        let entry = stmt.query_row([id], Self::map_history_entry).optional()?;

        Ok(entry)
    }

    pub async fn delete_entry(&self, id: i64) -> Result<()> {
        let conn = self.get_connection()?;

        // Get the entry to find the file name
        if let Some(entry) = self.get_entry_by_id(id).await? {
            // Delete the audio file first
            let file_path = self.get_audio_file_path(&entry.file_name);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    error!("Failed to delete audio file {}: {}", entry.file_name, e);
                    // Continue with database deletion even if file deletion fails
                }
            }
        }

        // Delete from database
        let affected = conn.execute(
            "DELETE FROM transcription_history WHERE id = ?1",
            params![id],
        )?;
        if affected == 0 {
            return Err(anyhow::anyhow!("History entry {} not found", id));
        }

        debug!("Deleted history entry with id: {}", id);

        if let Err(e) = (HistoryUpdatePayload::Deleted { id }).emit(&self.app_handle) {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(())
    }

    /// Save a version and update post-processed text atomically in a single transaction
    pub fn save_version_and_update(
        &self,
        id: i64,
        text: &str,
        prompt: &str,
        model_name: Option<&str>,
    ) -> Result<HistoryEntry> {
        let mut conn = self.get_connection()?;
        let timestamp = Utc::now().timestamp();

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, text, Some(prompt), model_name, "post_processed", timestamp],
        )?;
        tx.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
            params![text, prompt, id],
        )?;
        tx.commit()?;

        debug!(
            "Saved version and updated post-processed text for entry {}",
            id
        );

        let entry = Self::get_entry_by_id_with_conn(&conn, id)?
            .ok_or_else(|| anyhow::anyhow!("History entry {} not found after update", id))?;

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(entry)
    }

    /// Save an alternate post-processed version without changing the active transcript.
    pub fn save_version(
        &self,
        id: i64,
        text: &str,
        prompt: &str,
        model_name: Option<&str>,
    ) -> Result<HistoryEntry> {
        let conn = self.get_connection()?;
        let timestamp = Utc::now().timestamp();

        let affected = conn.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, text, Some(prompt), model_name, "post_processed", timestamp],
        )?;
        if affected == 0 {
            return Err(anyhow::anyhow!(
                "Failed to save version for history entry {}",
                id
            ));
        }

        let entry = Self::get_entry_by_id_with_conn(&conn, id)?
            .ok_or_else(|| anyhow::anyhow!("History entry {} not found after version save", id))?;

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(entry)
    }

    /// Save a manual text edit with version tracking.
    /// `target` must be `"transcription"` or `"post_processed"`.
    pub fn update_entry_text(&self, id: i64, target: &str, new_text: &str) -> Result<HistoryEntry> {
        let mut conn = self.get_connection()?;
        let timestamp = Utc::now().timestamp();

        let tx = conn.transaction()?;

        // Insert version record for undo
        tx.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, new_text, Option::<String>::None, Some("Manual edit"), target, timestamp],
        )?;

        // Update the appropriate column
        match target {
            "transcription" => {
                let affected = tx.execute(
                    "UPDATE transcription_history SET transcription_text = ?1 WHERE id = ?2",
                    params![new_text, id],
                )?;
                if affected == 0 {
                    return Err(anyhow::anyhow!("History entry {} not found", id));
                }
            }
            "post_processed" => {
                let affected = tx.execute(
                    "UPDATE transcription_history SET post_processed_text = ?1 WHERE id = ?2",
                    params![new_text, id],
                )?;
                if affected == 0 {
                    return Err(anyhow::anyhow!("History entry {} not found", id));
                }
            }
            _ => {
                return Err(anyhow::anyhow!("Invalid target: {}", target));
            }
        }

        tx.commit()?;

        debug!("Saved manual edit for entry {} (target: {})", id, target);

        let entry = Self::get_entry_by_id_with_conn(&conn, id)?
            .ok_or_else(|| anyhow::anyhow!("History entry {} not found after edit", id))?;

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(entry)
    }

    pub fn rename_history_entry(&self, id: i64, title: &str) -> Result<HistoryEntry> {
        let conn = self.get_connection()?;

        let affected = conn.execute(
            "UPDATE transcription_history SET title = ?1 WHERE id = ?2",
            params![title, id],
        )?;

        if affected == 0 {
            return Err(anyhow::anyhow!("History entry {} not found", id));
        }

        let entry = Self::get_entry_by_id_with_conn(&conn, id)?
            .ok_or_else(|| anyhow::anyhow!("History entry {} not found after rename", id))?;

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(entry)
    }

    /// Restore a previous version or the original transcription.
    /// If `version_id` is Some, restores that version's text and prompt.
    /// If `version_id` is None, restores the original (sets post_processed_text to NULL).
    /// The transcription_versions table is never modified — it's append-only history.
    pub fn restore_version(&self, entry_id: i64, version_id: Option<i64>) -> Result<HistoryEntry> {
        let conn = self.get_connection()?;

        match version_id {
            None => {
                // Restore to original: clear post-processed text
                let affected = conn.execute(
                    "UPDATE transcription_history SET post_processed_text = NULL, post_process_prompt = NULL WHERE id = ?1",
                    params![entry_id],
                )?;
                if affected == 0 {
                    return Err(anyhow::anyhow!("History entry {} not found", entry_id));
                }
            }
            Some(vid) => {
                // Look up the version
                let (text, prompt, target): (String, Option<String>, String) = conn
                    .query_row(
                        "SELECT text, prompt, target FROM transcription_versions WHERE id = ?1 AND history_entry_id = ?2",
                        params![vid, entry_id],
                        |row| Ok((row.get("text")?, row.get("prompt")?, row.get("target")?)),
                    )
                    .map_err(|_| anyhow::anyhow!("VERSION_NOT_FOUND"))?;

                if target == "transcription" {
                    let affected = conn.execute(
                        "UPDATE transcription_history SET transcription_text = ?1 WHERE id = ?2",
                        params![text, entry_id],
                    )?;
                    if affected == 0 {
                        return Err(anyhow::anyhow!("History entry {} not found", entry_id));
                    }
                } else {
                    let affected = conn.execute(
                        "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
                        params![text, prompt, entry_id],
                    )?;
                    if affected == 0 {
                        return Err(anyhow::anyhow!("History entry {} not found", entry_id));
                    }
                }
            }
        }

        debug!("Restored version {:?} for entry {}", version_id, entry_id);

        let entry = Self::get_entry_by_id_with_conn(&conn, entry_id)?
            .ok_or_else(|| anyhow::anyhow!("History entry {} not found after restore", entry_id))?;

        if let Err(e) = (HistoryUpdatePayload::Updated {
            entry: entry.clone(),
        })
        .emit(&self.app_handle)
        {
            error!("Failed to emit history update event: {}", e);
        }

        Ok(entry)
    }

    /// Get all post-processing versions for a history entry
    pub fn get_versions(&self, history_entry_id: i64) -> Result<Vec<TranscriptionVersion>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, history_entry_id, text, prompt, model_name, target, timestamp FROM transcription_versions WHERE history_entry_id = ?1 ORDER BY timestamp ASC",
        )?;

        let rows = stmt.query_map(params![history_entry_id], |row| {
            Ok(TranscriptionVersion {
                id: row.get("id")?,
                history_entry_id: row.get("history_entry_id")?,
                text: row.get("text")?,
                prompt: row.get("prompt")?,
                model_name: row.get("model_name")?,
                target: row.get("target")?,
                timestamp: row.get("timestamp")?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn format_timestamp_title(&self, timestamp: i64) -> String {
        if let Some(utc_datetime) = DateTime::from_timestamp(timestamp, 0) {
            // Convert UTC to local timezone
            let local_datetime = utc_datetime.with_timezone(&Local);
            local_datetime.format("%B %e, %Y - %l:%M%p").to_string()
        } else {
            format!("Recording {}", timestamp)
        }
    }

    // --- Document Tab CRUD ---

    pub fn create_document_tab(&self, id: String, title: String) -> Result<DocumentTab> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO document_tabs (id, title, content, created_at, updated_at) VALUES (?1, ?2, '', ?3, ?3)",
            params![id, title, now],
        )?;
        Ok(DocumentTab {
            id,
            title,
            content: String::new(),
            created_at: now,
            updated_at: now,
            history_entry_id: None,
            auto_labeled: false,
        })
    }

    pub fn get_open_tabs(&self) -> Result<Vec<DocumentTab>> {
        let conn = self.get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, content, created_at, updated_at, history_entry_id, auto_labeled FROM document_tabs WHERE is_archived = 0 ORDER BY created_at ASC",
        )?;
        let tabs = stmt
            .query_map([], |row| {
                Ok(DocumentTab {
                    id: row.get("id")?,
                    title: row.get("title")?,
                    content: row.get("content")?,
                    created_at: row.get("created_at")?,
                    updated_at: row.get("updated_at")?,
                    history_entry_id: row.get("history_entry_id")?,
                    auto_labeled: row.get::<_, i32>("auto_labeled").unwrap_or(0) != 0,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(tabs)
    }

    pub fn get_document_tab(&self, id: &str) -> Result<Option<DocumentTab>> {
        let conn = self.get_connection()?;
        let tab = conn.query_row(
            "SELECT id, title, content, created_at, updated_at, history_entry_id, auto_labeled FROM document_tabs WHERE id = ?1 AND is_archived = 0",
            params![id],
            |row| {
                Ok(DocumentTab {
                    id: row.get("id")?,
                    title: row.get("title")?,
                    content: row.get("content")?,
                    created_at: row.get("created_at")?,
                    updated_at: row.get("updated_at")?,
                    history_entry_id: row.get("history_entry_id")?,
                    auto_labeled: row.get::<_, i32>("auto_labeled").unwrap_or(0) != 0,
                })
            },
        ).optional()?;
        Ok(tab)
    }

    pub fn update_document_tab(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.get_connection()?;
        let now = Utc::now().timestamp();
        conn.execute(
            "UPDATE document_tabs SET content = ?1, updated_at = ?2 WHERE id = ?3 AND is_archived = 0",
            params![content, now, id],
        )?;
        Ok(())
    }

    pub fn rename_document_tab(&self, id: &str, title: &str) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE document_tabs SET title = ?1 WHERE id = ?2 AND is_archived = 0",
            params![title, id],
        )?;
        Ok(())
    }

    pub fn link_tab_to_history_entry(&self, tab_id: &str, entry_id: i64) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE document_tabs SET history_entry_id = ?1, auto_labeled = 1 WHERE id = ?2",
            params![entry_id, tab_id],
        )?;
        Ok(())
    }

    pub fn mark_tab_auto_labeled(&self, id: &str) -> Result<()> {
        let conn = self.get_connection()?;
        conn.execute(
            "UPDATE document_tabs SET auto_labeled = 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn ensure_tab_history_entry(&self, tab_id: &str, initial_text: &str) -> Result<i64> {
        let mut conn = self.get_connection()?;

        let existing: Option<i64> = conn
            .query_row(
                "SELECT history_entry_id FROM document_tabs WHERE id = ?1 AND is_archived = 0",
                params![tab_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        if let Some(entry_id) = existing {
            return Ok(entry_id);
        }

        let title: String = conn.query_row(
            "SELECT title FROM document_tabs WHERE id = ?1",
            params![tab_id],
            |row| row.get(0),
        )?;

        let timestamp = Utc::now().timestamp();
        let file_name = format!("tab-{}", tab_id);

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO transcription_history (
                file_name, timestamp, saved, title, transcription_text,
                post_processed_text, post_process_prompt, post_process_requested, source
            ) VALUES (?1, ?2, 0, ?3, ?4, NULL, NULL, 0, 'text')",
            params![file_name, timestamp, title, initial_text],
        )?;
        let entry_id = tx.last_insert_rowid();
        tx.execute(
            "UPDATE document_tabs SET history_entry_id = ?1 WHERE id = ?2",
            params![entry_id, tab_id],
        )?;
        tx.commit()?;

        debug!("Created history entry {} for tab {}", entry_id, tab_id);
        Ok(entry_id)
    }

    pub fn save_tab_version(
        &self,
        tab_id: &str,
        text: &str,
        prompt: &str,
        model_name: Option<&str>,
    ) -> Result<i64> {
        let conn = self.get_connection()?;

        let history_entry_id: Option<i64> = conn
            .query_row(
                "SELECT history_entry_id FROM document_tabs WHERE id = ?1 AND is_archived = 0",
                params![tab_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        let entry_id = history_entry_id
            .ok_or_else(|| anyhow::anyhow!("Tab {} has no linked history entry", tab_id))?;

        drop(conn);
        self.save_version_and_update(entry_id, text, prompt, model_name)?;

        Ok(entry_id)
    }

    pub fn close_document_tab(&self, id: &str, archive: bool) -> Result<Option<HistoryEntry>> {
        if archive {
            let tab = self.get_document_tab(id)?;
            if let Some(tab) = tab {
                if !tab.content.is_empty() {
                    if let Some(entry_id) = tab.history_entry_id {
                        let conn = self.get_connection()?;
                        conn.execute(
                            "UPDATE transcription_history SET transcription_text = ?1 WHERE id = ?2",
                            params![tab.content, entry_id],
                        )?;
                        conn.execute(
                            "UPDATE document_tabs SET is_archived = 1 WHERE id = ?1",
                            params![id],
                        )?;

                        let entry = Self::get_entry_by_id_with_conn(&conn, entry_id)?;
                        return Ok(entry);
                    }

                    let entry = self.save_text_operation(tab.content, String::new(), tab.title)?;

                    let conn = self.get_connection()?;
                    conn.execute(
                        "UPDATE document_tabs SET is_archived = 1 WHERE id = ?1",
                        params![id],
                    )?;

                    return Ok(Some(entry));
                }
            }
        }

        let conn = self.get_connection()?;
        conn.execute("DELETE FROM document_tabs WHERE id = ?1", params![id])?;
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use rusqlite_migration::Migrations;

    /// Create an in-memory database with all migrations applied.
    /// This uses the same MIGRATIONS constant as production code,
    /// ensuring tests validate the actual schema.
    fn setup_migrated_conn() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("enable foreign keys");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations.to_latest(&mut conn).expect("run migrations");
        conn
    }

    fn insert_entry(conn: &Connection, timestamp: i64, text: &str, post_processed: Option<&str>) {
        conn.execute(
            "INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_prompt,
                post_process_requested,
                source
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                format!("handy-{}.wav", timestamp),
                timestamp,
                false,
                format!("Recording {}", timestamp),
                text,
                post_processed,
                Option::<String>::None,
                false,
                "voice"
            ],
        )
        .expect("insert history entry");
    }

    #[test]
    fn migrations_apply_cleanly() {
        // Verifies that all migrations can be applied to a fresh database
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations
            .to_latest(&mut conn)
            .expect("migrations should apply cleanly");

        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read user_version");
        assert_eq!(version, MIGRATIONS.len() as i32);
    }

    #[test]
    fn repairs_legacy_insiders_schema_without_losing_history() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE transcription_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                saved BOOLEAN NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                transcription_text TEXT NOT NULL,
                post_processed_text TEXT,
                post_process_prompt TEXT,
                source TEXT NOT NULL DEFAULT 'voice'
            );
            CREATE TABLE transcription_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                history_entry_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                prompt TEXT,
                timestamp INTEGER NOT NULL,
                model_name TEXT,
                target TEXT NOT NULL DEFAULT 'post_processed',
                FOREIGN KEY (history_entry_id) REFERENCES transcription_history(id) ON DELETE CASCADE
            );
            INSERT INTO transcription_history (
                file_name,
                timestamp,
                saved,
                title,
                transcription_text,
                post_processed_text,
                post_process_prompt,
                source
            ) VALUES (
                'handy-100.wav',
                100,
                0,
                'Recording 100',
                'raw text',
                'processed text',
                'clean this',
                'voice'
            );
            PRAGMA user_version = 8;
            ",
        )
        .expect("create legacy insiders schema");

        HistoryManager::repair_legacy_insiders_schema(&conn).expect("repair schema");

        assert!(HistoryManager::column_exists(
            &conn,
            "transcription_history",
            "post_process_requested"
        )
        .expect("check repaired column"));

        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read repaired user_version");
        assert_eq!(version, MIGRATIONS.len() as i32);

        let (count, post_process_requested): (i64, bool) = conn
            .query_row(
                "SELECT COUNT(*), post_process_requested FROM transcription_history",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read repaired history row");
        assert_eq!(count, 1);
        assert!(!post_process_requested);
    }

    #[test]
    fn get_latest_entry_returns_none_when_empty() {
        let conn = setup_migrated_conn();
        let entry = HistoryManager::get_latest_entry_with_conn(&conn).expect("fetch latest entry");
        assert!(entry.is_none());
    }

    #[test]
    fn get_latest_entry_returns_newest_entry() {
        let conn = setup_migrated_conn();
        insert_entry(&conn, 100, "first", None);
        insert_entry(&conn, 200, "second", Some("processed"));

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch latest entry")
            .expect("entry exists");

        assert_eq!(entry.timestamp, 200);
        assert_eq!(entry.transcription_text, "second");
        assert_eq!(entry.post_processed_text.as_deref(), Some("processed"));
    }

    #[test]
    fn update_post_processed_text_updates_entry() {
        let conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", None);

        // Uses the same SQL as HistoryManager::update_post_processed_text
        conn.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
            params!["enhanced text", "clean this", 1],
        )
        .expect("update post processed text");

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch entry")
            .expect("entry exists");

        assert_eq!(entry.post_processed_text.as_deref(), Some("enhanced text"));
        assert_eq!(entry.post_process_prompt.as_deref(), Some("clean this"));
        // Original transcription text is preserved
        assert_eq!(entry.transcription_text, "raw text");
    }

    #[test]
    fn save_version_and_update_is_atomic() {
        let mut conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", None);

        // Mirrors HistoryManager::save_version_and_update - transaction wrapping both operations
        let tx = conn.transaction().expect("begin transaction");
        tx.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, timestamp) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![1, "enhanced text", Some("prompt"), Option::<String>::None, 200],
        )
        .expect("insert version");
        tx.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
            params!["enhanced text", "prompt", 1],
        )
        .expect("update entry");
        tx.commit().expect("commit transaction");

        // Verify both the version and the entry were updated
        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch entry")
            .expect("entry exists");
        assert_eq!(entry.post_processed_text.as_deref(), Some("enhanced text"));

        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("count versions");
        assert_eq!(version_count, 1);
    }

    #[test]
    fn save_and_get_versions() {
        let conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", None);

        conn.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![1, "version 1", "prompt 1", 200],
        )
        .expect("insert version 1");

        conn.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![1, "version 2", "prompt 2", 300],
        )
        .expect("insert version 2");

        let mut stmt = conn
            .prepare("SELECT id, history_entry_id, text, prompt, model_name, target, timestamp FROM transcription_versions WHERE history_entry_id = ?1 ORDER BY timestamp ASC")
            .expect("prepare query");

        let versions: Vec<TranscriptionVersion> = stmt
            .query_map(params![1], |row| {
                Ok(TranscriptionVersion {
                    id: row.get("id")?,
                    history_entry_id: row.get("history_entry_id")?,
                    text: row.get("text")?,
                    prompt: row.get("prompt")?,
                    model_name: row.get("model_name")?,
                    target: row.get("target")?,
                    timestamp: row.get("timestamp")?,
                })
            })
            .expect("query versions")
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].text, "version 1");
        assert_eq!(versions[0].prompt.as_deref(), Some("prompt 1"));
        assert_eq!(versions[1].text, "version 2");
        assert_eq!(versions[1].prompt.as_deref(), Some("prompt 2"));
        assert_eq!(versions[0].model_name, None);
        assert_eq!(versions[1].model_name, None);
        assert_eq!(versions[0].target, "post_processed");
    }

    #[test]
    fn restore_to_specific_version() {
        let conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", None);

        // Create two versions
        conn.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![1, "version 1 text", "prompt 1", 200],
        )
        .expect("insert version 1");
        conn.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
            params!["version 1 text", "prompt 1", 1],
        )
        .expect("update entry for v1");

        conn.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![1, "version 2 text", "prompt 2", 300],
        )
        .expect("insert version 2");
        conn.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
            params!["version 2 text", "prompt 2", 1],
        )
        .expect("update entry for v2");

        // Restore to version 1 (id=1 in versions table)
        let (v1_text, v1_prompt): (String, Option<String>) = conn
            .query_row(
                "SELECT text, prompt FROM transcription_versions WHERE id = 1",
                [],
                |row| Ok((row.get("text")?, row.get("prompt")?)),
            )
            .expect("get version 1");

        conn.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
            params![v1_text, v1_prompt, 1],
        )
        .expect("restore to v1");

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch entry")
            .expect("entry exists");

        assert_eq!(entry.post_processed_text.as_deref(), Some("version 1 text"));
        assert_eq!(entry.post_process_prompt.as_deref(), Some("prompt 1"));
        // Original transcription preserved
        assert_eq!(entry.transcription_text, "raw text");
    }

    #[test]
    fn restore_to_original() {
        let conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", Some("enhanced"));

        // Restore to original: set post_processed_text to NULL
        conn.execute(
            "UPDATE transcription_history SET post_processed_text = NULL, post_process_prompt = NULL WHERE id = ?1",
            params![1],
        )
        .expect("restore to original");

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch entry")
            .expect("entry exists");

        assert!(entry.post_processed_text.is_none());
        assert!(entry.post_process_prompt.is_none());
        assert_eq!(entry.transcription_text, "raw text");
    }

    #[test]
    fn versions_preserved_after_restore() {
        let conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", None);

        // Create two versions
        conn.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![1, "version 1", "prompt 1", 200],
        )
        .expect("insert version 1");
        conn.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![1, "version 2", "prompt 2", 300],
        )
        .expect("insert version 2");

        // Restore to original
        conn.execute(
            "UPDATE transcription_history SET post_processed_text = NULL, post_process_prompt = NULL WHERE id = ?1",
            params![1],
        )
        .expect("restore to original");

        // Versions should still be there
        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("count versions");
        assert_eq!(version_count, 2);

        // Restore to version 1 — versions still intact
        let v1_text: String = conn
            .query_row(
                "SELECT text FROM transcription_versions WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("get v1 text");
        conn.execute(
            "UPDATE transcription_history SET post_processed_text = ?1 WHERE id = ?2",
            params![v1_text, 1],
        )
        .expect("restore to v1");

        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("count versions again");
        assert_eq!(version_count, 2);
    }

    #[test]
    fn restore_nonexistent_version_fails() {
        let conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", None);

        // Try to look up a version that doesn't exist
        let result = conn.query_row(
            "SELECT text, prompt FROM transcription_versions WHERE id = ?1 AND history_entry_id = ?2",
            params![999, 1],
            |row| Ok((row.get::<_, String>("text")?, row.get::<_, Option<String>>("prompt")?)),
        );

        assert!(result.is_err());
    }

    #[test]
    fn update_entry_text_post_processed() {
        let mut conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", Some("enhanced text"));

        let timestamp = 200i64;
        let tx = conn.transaction().expect("begin transaction");
        tx.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![1, "manually edited", Option::<String>::None, Some("Manual edit"), "post_processed", timestamp],
        )
        .expect("insert version");
        tx.execute(
            "UPDATE transcription_history SET post_processed_text = ?1 WHERE id = ?2",
            params!["manually edited", 1],
        )
        .expect("update entry");
        tx.commit().expect("commit");

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch entry")
            .expect("entry exists");
        assert_eq!(
            entry.post_processed_text.as_deref(),
            Some("manually edited")
        );
        assert_eq!(entry.transcription_text, "raw text"); // unchanged

        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("count versions");
        assert_eq!(version_count, 1);

        // Check target field
        let target: String = conn
            .query_row(
                "SELECT target FROM transcription_versions WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("get target");
        assert_eq!(target, "post_processed");
    }

    #[test]
    fn update_entry_text_transcription() {
        let mut conn = setup_migrated_conn();
        insert_entry(&conn, 100, "raw text", None);

        let timestamp = 200i64;
        let tx = conn.transaction().expect("begin transaction");
        tx.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![1, "corrected raw text", Option::<String>::None, Some("Manual edit"), "transcription", timestamp],
        )
        .expect("insert version");
        tx.execute(
            "UPDATE transcription_history SET transcription_text = ?1 WHERE id = ?2",
            params!["corrected raw text", 1],
        )
        .expect("update entry");
        tx.commit().expect("commit");

        let entry = HistoryManager::get_latest_entry_with_conn(&conn)
            .expect("fetch entry")
            .expect("entry exists");
        assert_eq!(entry.transcription_text, "corrected raw text");
    }

    #[test]
    fn cascade_delete_removes_versions() {
        let conn = setup_migrated_conn();

        insert_entry(&conn, 100, "raw text", None);

        conn.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![1, "version 1", "prompt 1", 200],
        )
        .expect("insert version");

        // Delete the parent entry
        conn.execute("DELETE FROM transcription_history WHERE id = 1", [])
            .expect("delete entry");

        // Versions should be cascade-deleted
        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("count versions");
        assert_eq!(version_count, 0);
    }

    fn insert_tab(conn: &Connection, id: &str, title: &str, content: &str) {
        conn.execute(
            "INSERT INTO document_tabs (id, title, content, created_at, updated_at, is_archived) VALUES (?1, ?2, ?3, 100, 100, 0)",
            params![id, title, content],
        )
        .expect("insert tab");
    }

    #[test]
    fn ensure_tab_history_entry_creates_entry_and_links() {
        let conn = setup_migrated_conn();
        insert_tab(&conn, "tab-1", "My Tab", "hello world");

        let timestamp = Utc::now().timestamp();
        let file_name = "tab-tab-1";

        let tx_conn = &conn;
        tx_conn
            .execute(
                "INSERT INTO transcription_history (
                file_name, timestamp, saved, title, transcription_text,
                post_processed_text, post_process_prompt, post_process_requested, source
            ) VALUES (?1, ?2, 0, ?3, ?4, NULL, NULL, 0, 'text')",
                params![file_name, timestamp, "My Tab", "hello world"],
            )
            .expect("insert history entry");

        let entry_id = tx_conn.last_insert_rowid();
        tx_conn
            .execute(
                "UPDATE document_tabs SET history_entry_id = ?1 WHERE id = ?2",
                params![entry_id, "tab-1"],
            )
            .expect("link tab to entry");

        let linked_id: Option<i64> = conn
            .query_row(
                "SELECT history_entry_id FROM document_tabs WHERE id = 'tab-1'",
                [],
                |row| row.get(0),
            )
            .expect("read linked id");

        assert_eq!(linked_id, Some(entry_id));

        let source: String = conn
            .query_row(
                "SELECT source FROM transcription_history WHERE id = ?1",
                params![entry_id],
                |row| row.get(0),
            )
            .expect("read source");
        assert_eq!(source, "text");
    }

    #[test]
    fn ensure_tab_history_entry_is_idempotent() {
        let conn = setup_migrated_conn();
        insert_tab(&conn, "tab-2", "Tab Two", "some text");

        conn.execute(
            "INSERT INTO transcription_history (
                file_name, timestamp, saved, title, transcription_text,
                post_process_requested, source
            ) VALUES ('tab-tab-2', 100, 0, 'Tab Two', 'some text', 0, 'text')",
            [],
        )
        .expect("insert entry");
        let entry_id = conn.last_insert_rowid();

        conn.execute(
            "UPDATE document_tabs SET history_entry_id = ?1 WHERE id = 'tab-2'",
            params![entry_id],
        )
        .expect("link");

        let existing: Option<i64> = conn
            .query_row(
                "SELECT history_entry_id FROM document_tabs WHERE id = 'tab-2'",
                [],
                |row| row.get::<_, Option<i64>>(0),
            )
            .expect("read");

        assert_eq!(existing, Some(entry_id));

        let entry_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_history WHERE source = 'text'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(entry_count, 1);
    }

    #[test]
    fn save_tab_version_creates_version_row() {
        let mut conn = setup_migrated_conn();
        insert_tab(&conn, "tab-3", "Tab Three", "original");

        conn.execute(
            "INSERT INTO transcription_history (
                file_name, timestamp, saved, title, transcription_text,
                post_process_requested, source
            ) VALUES ('tab-tab-3', 100, 0, 'Tab Three', 'original', 0, 'text')",
            [],
        )
        .expect("insert entry");
        let entry_id = conn.last_insert_rowid();

        conn.execute(
            "UPDATE document_tabs SET history_entry_id = ?1 WHERE id = 'tab-3'",
            params![entry_id],
        )
        .expect("link");

        let tx = conn.transaction().expect("begin tx");
        tx.execute(
            "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, 'post_processed', ?5)",
            params![entry_id, "enhanced text", "Fix grammar", Some("gpt-4"), Utc::now().timestamp()],
        ).expect("insert version");
        tx.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
            params!["enhanced text", "Fix grammar", entry_id],
        ).expect("update entry");
        tx.commit().expect("commit");

        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = ?1",
                params![entry_id],
                |row| row.get(0),
            )
            .expect("count versions");
        assert_eq!(version_count, 1);

        let post_processed: Option<String> = conn
            .query_row(
                "SELECT post_processed_text FROM transcription_history WHERE id = ?1",
                params![entry_id],
                |row| row.get(0),
            )
            .expect("read post_processed");
        assert_eq!(post_processed.as_deref(), Some("enhanced text"));
    }

    #[test]
    fn close_tab_with_linked_entry_does_not_duplicate() {
        let conn = setup_migrated_conn();
        insert_tab(&conn, "tab-4", "Tab Four", "my content");

        conn.execute(
            "INSERT INTO transcription_history (
                file_name, timestamp, saved, title, transcription_text,
                post_process_requested, source
            ) VALUES ('tab-tab-4', 100, 0, 'Tab Four', 'initial content', 0, 'text')",
            [],
        )
        .expect("insert entry");
        let entry_id = conn.last_insert_rowid();

        conn.execute(
            "UPDATE document_tabs SET history_entry_id = ?1 WHERE id = 'tab-4'",
            params![entry_id],
        )
        .expect("link");

        conn.execute(
            "UPDATE transcription_history SET transcription_text = ?1 WHERE id = ?2",
            params!["my content", entry_id],
        )
        .expect("update entry text");
        conn.execute(
            "UPDATE document_tabs SET is_archived = 1 WHERE id = 'tab-4'",
            [],
        )
        .expect("archive tab");

        let total_entries: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_history WHERE source = 'text'",
                [],
                |row| row.get(0),
            )
            .expect("count entries");
        assert_eq!(total_entries, 1);

        let updated_text: String = conn
            .query_row(
                "SELECT transcription_text FROM transcription_history WHERE id = ?1",
                params![entry_id],
                |row| row.get(0),
            )
            .expect("read updated text");
        assert_eq!(updated_text, "my content");
    }
}
