//! Transactional batch writes for the SQL plugin.
//!
//! `tauri-plugin-sql` exposes `execute`/`select` over an sqlx connection *pool*
//! and has no transaction support (tauri-apps/plugins-workspace#886). Issuing
//! `BEGIN` and `COMMIT` as separate `execute` calls is therefore unsafe: the
//! statements can be handed different pooled connections, so a failure halfway
//! through leaves partial data committed with no way to roll back.
//!
//! This command borrows the pool the plugin already opened, takes a single
//! connection from it, and runs every statement inside one real transaction.
//! It is the only piece of Rust in this application that exists for business
//! reasons rather than platform ones. Reads still go through the plugin.

use serde::{Deserialize, Serialize};
use sqlx::Executor;
use tauri::{command, State};
use tauri_plugin_sql::{DbInstances, DbPool};

/// Serialisable error so the frontend receives a readable message.
#[derive(Debug, Serialize)]
pub struct BatchError(String);

impl<E: std::error::Error> From<E> for BatchError {
    fn from(error: E) -> Self {
        BatchError(error.to_string())
    }
}

/// A single statement plus its bound parameters.
#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<serde_json::Value>,
}

type SqliteQuery<'q> = sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>;

fn bind_params<'q>(mut query: SqliteQuery<'q>, params: &'q [serde_json::Value]) -> SqliteQuery<'q> {
    for value in params {
        query = match value {
            serde_json::Value::Null => query.bind(None::<String>),
            serde_json::Value::Bool(b) => query.bind(*b),
            serde_json::Value::Number(n) => match n.as_i64() {
                Some(i) => query.bind(i),
                None => query.bind(n.as_f64()),
            },
            serde_json::Value::String(s) => query.bind(s.as_str()),
            // Arrays/objects are stored as JSON text (raw_json, conditions_json, ...).
            other => query.bind(other.to_string()),
        };
    }
    query
}

/// Runs every statement inside one transaction, rolling back on any failure.
/// Returns the total number of affected rows.
#[command]
pub async fn sql_batch(
    db_instances: State<'_, DbInstances>,
    db: String,
    statements: Vec<Statement>,
) -> Result<usize, BatchError> {
    let instances = db_instances.0.read().await;
    let pool = instances
        .get(&db)
        .ok_or_else(|| BatchError(format!("database not loaded: {db}")))?;

    // tauri-plugin-sql 2.4.0 ships its DbPool accessor methods commented out, so
    // the variant is matched directly. Only the `sqlite` feature is enabled, so
    // this match covers every variant that exists in this build.
    #[allow(unreachable_patterns)]
    let pool = match pool {
        DbPool::Sqlite(pool) => pool,
        _ => return Err(BatchError("sql_batch only supports sqlite".to_string())),
    };

    let mut tx = pool.begin().await?;
    let mut affected = 0usize;

    for statement in &statements {
        let query = bind_params(sqlx::query(&statement.sql), &statement.params);
        let result = tx.execute(query).await?;
        affected += result.rows_affected() as usize;
    }

    tx.commit().await?;
    Ok(affected)
}
