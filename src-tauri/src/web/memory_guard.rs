use sysinfo::{System, SystemExt};

const GIB: u64 = 1024 * 1024 * 1024;
const DEFAULT_MEMORY_RESERVE_BYTES: u64 = 2 * GIB;
const MAX_GAME_MEMORY_ENV: &str = "DESKTOP_POSTFLOP_MAX_GAME_MEMORY_BYTES";

pub fn default_game_memory_limit() -> Option<u64> {
    let mut system = System::new_all();
    system.refresh_memory();

    default_game_memory_limit_for_available(system.available_memory())
}

pub fn default_game_memory_limit_for_available(available_bytes: u64) -> Option<u64> {
    if let Some(limit) = env_u64(MAX_GAME_MEMORY_ENV) {
        return Some(limit);
    }

    Some(game_memory_limit_for_available(available_bytes))
}

pub fn game_memory_limit_for_available(available_bytes: u64) -> u64 {
    let reserve = DEFAULT_MEMORY_RESERVE_BYTES.max(available_bytes / 4);
    available_bytes.saturating_sub(reserve)
}

pub fn check_memory_limit(estimated_bytes: u64, max_bytes: Option<u64>) -> Result<(), String> {
    let Some(max_bytes) = max_bytes else {
        return Ok(());
    };

    if estimated_bytes <= max_bytes {
        return Ok(());
    }

    Err(format!(
        "estimated game memory {} exceeds limit {}",
        format_bytes(estimated_bytes),
        format_bytes(max_bytes)
    ))
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name).ok()?.parse::<u64>().ok()
}

fn format_bytes(value: u64) -> String {
    if value >= GIB {
        format!("{:.2}GB", value as f64 / GIB as f64)
    } else {
        format!("{:.0}MB", value as f64 / (1024.0 * 1024.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_memory_limit_keeps_fractional_reserve_on_large_available_memory() {
        assert_eq!(game_memory_limit_for_available(16 * GIB), 12 * GIB);
    }

    #[test]
    fn game_memory_limit_keeps_minimum_reserve_on_moderate_available_memory() {
        assert_eq!(game_memory_limit_for_available(6 * GIB), 4 * GIB);
    }

    #[test]
    fn game_memory_limit_drops_to_zero_when_reserve_exceeds_available_memory() {
        assert_eq!(game_memory_limit_for_available(GIB), 0);
    }

    #[test]
    fn check_memory_limit_allows_missing_limit() {
        assert!(check_memory_limit(100, None).is_ok());
    }

    #[test]
    fn check_memory_limit_rejects_estimates_above_limit() {
        let error = check_memory_limit(3 * GIB, Some(2 * GIB)).unwrap_err();
        assert!(error.contains("3.00GB"));
        assert!(error.contains("2.00GB"));
    }
}
