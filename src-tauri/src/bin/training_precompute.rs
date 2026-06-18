fn main() {
    match desktop_postflop::training_precompute::CliOptions::parse_env()
        .and_then(desktop_postflop::training_precompute::run_cli)
    {
        Ok(()) => {}
        Err(err) => {
            eprintln!("error: {err}");
            std::process::exit(1);
        }
    }
}
