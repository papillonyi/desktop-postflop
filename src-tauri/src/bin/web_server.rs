use desktop_postflop::web::{app_with_state, SharedAppState};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tracing_subscriber::FmtSubscriber;

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:3000";
const BIND_ADDR_ENV: &str = "DESKTOP_POSTFLOP_BIND";

#[tokio::main]
async fn main() {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(tracing::Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber).expect("failed to set tracing subscriber");

    let app_state = SharedAppState::single_user();
    let app = app_with_state(app_state);

    let addr = bind_addr_from_env().expect("invalid web server bind address");
    let listener = TcpListener::bind(addr)
        .await
        .expect("failed to bind web server");

    tracing::info!("web server listening on http://{addr}");
    axum::serve(listener, app).await.expect("web server failed");
}

fn bind_addr_from_env() -> Result<SocketAddr, String> {
    bind_addr_from_env_value(std::env::var(BIND_ADDR_ENV).ok().as_deref())
}

fn bind_addr_from_env_value(value: Option<&str>) -> Result<SocketAddr, String> {
    let raw = value.unwrap_or(DEFAULT_BIND_ADDR);
    raw.parse::<SocketAddr>()
        .map_err(|err| format!("invalid {BIND_ADDR_ENV} value {raw:?}: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_addr_defaults_to_localhost_3000() {
        let addr = bind_addr_from_env_value(None).unwrap();
        assert_eq!(addr, "127.0.0.1:3000".parse::<SocketAddr>().unwrap());
    }

    #[test]
    fn bind_addr_can_be_overridden() {
        let addr = bind_addr_from_env_value(Some("0.0.0.0:30001")).unwrap();
        assert_eq!(addr, "0.0.0.0:30001".parse::<SocketAddr>().unwrap());
    }

    #[test]
    fn bind_addr_rejects_invalid_values() {
        let err = bind_addr_from_env_value(Some("not-an-address")).unwrap_err();
        assert!(err.contains("DESKTOP_POSTFLOP_BIND"));
    }
}
