use desktop_postflop::web::{app_with_state, SharedAppState};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tracing_subscriber::FmtSubscriber;

#[tokio::main]
async fn main() {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(tracing::Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber).expect("failed to set tracing subscriber");

    let app_state = SharedAppState::single_user();
    let app = app_with_state(app_state);

    let addr: SocketAddr = "127.0.0.1:3000".parse().expect("invalid address");
    let listener = TcpListener::bind(addr)
        .await
        .expect("failed to bind web server");

    tracing::info!("web server listening on http://{addr}");
    axum::serve(listener, app).await.expect("web server failed");
}
