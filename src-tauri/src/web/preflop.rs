use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const POSITIONS: [&str; 6] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];
const DEFAULT_RANGE_ROOT: &str = "../training-ranges/6max";
const NOTE_RANGE_DERIVED: &str =
    "Frequencies are derived from terminal preflop range files, not solver EVs.";
const NOTE_BEST_EFFORT: &str =
    "Fold and nonterminal branch frequencies are best-effort when the tree omits ending folds.";

static DEFAULT_INDEX: OnceLock<Result<PreflopIndex, String>> = OnceLock::new();

#[derive(Debug, Clone)]
struct PreflopIndex {
    decision_nodes: Vec<DecisionNode>,
    range_file_count: usize,
}

#[derive(Debug, Clone)]
struct DecisionNode {
    actor: String,
    relative_path: PathBuf,
    actions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflopDecisionStartRequest {
    hero_position: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflopSummaryResponse {
    root: String,
    range_file_count: usize,
    decision_node_count: usize,
    hero_decision_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflopActionHistoryItem {
    actor: String,
    action: String,
    range: Option<String>,
    range_source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionFrequency {
    action: String,
    frequency: f64,
    inferred: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflopDecisionResponse {
    root: String,
    hero_position: String,
    node_path: String,
    hand_class: String,
    hand_cards: [u8; 2],
    history: Vec<PreflopActionHistoryItem>,
    actions: Vec<ActionFrequency>,
    notes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreflopErrorResponse {
    error: String,
}

#[derive(Debug)]
pub struct PreflopApiError {
    status: StatusCode,
    message: String,
}

impl PreflopApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for PreflopApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(PreflopErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
    }
}

pub async fn summary() -> Result<Json<PreflopSummaryResponse>, PreflopApiError> {
    let index = default_index()?;
    let mut hero_decision_counts = BTreeMap::new();
    for position in POSITIONS {
        hero_decision_counts.insert(position.to_string(), 0);
    }
    for node in &index.decision_nodes {
        if let Some(count) = hero_decision_counts.get_mut(&node.actor) {
            *count += 1;
        }
    }

    Ok(Json(PreflopSummaryResponse {
        root: display_path(&default_range_root()),
        range_file_count: index.range_file_count,
        decision_node_count: index.decision_nodes.len(),
        hero_decision_counts,
    }))
}

pub async fn decision_start(
    Json(req): Json<PreflopDecisionStartRequest>,
) -> Result<Json<PreflopDecisionResponse>, PreflopApiError> {
    validate_position(&req.hero_position)?;
    let root = default_range_root();
    let index = default_index()?;
    let mut rng = Lcg::new(random_seed());
    let mut candidates = index
        .decision_nodes
        .iter()
        .filter(|node| node.actor == req.hero_position)
        .collect::<Vec<_>>();

    while !candidates.is_empty() {
        let selected_index = rng.next_usize(candidates.len());
        let node = candidates.swap_remove(selected_index);
        let hand_weights = hand_weights_for_node(&root, node).map_err(|err| {
            PreflopApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to read preflop ranges: {err}"),
            )
        })?;
        let hand_class = match choose_weighted_hand(&hand_weights, &mut rng) {
            Some(hand_class) => hand_class,
            None => continue,
        };
        let actions = action_frequencies_for_hand(&root, node, &hand_class).map_err(|err| {
            PreflopApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to derive preflop frequencies: {err}"),
            )
        })?;
        if actions.is_empty() {
            continue;
        }

        return Ok(Json(PreflopDecisionResponse {
            root: display_path(&root),
            hero_position: req.hero_position,
            node_path: path_to_string(&node.relative_path),
            hand_cards: hand_class_to_cards(&hand_class)
                .map_err(|err| PreflopApiError::new(StatusCode::INTERNAL_SERVER_ERROR, err))?,
            hand_class,
            history: action_history_with_ranges(&root, &node.relative_path).map_err(|err| {
                PreflopApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to derive action history ranges: {err}"),
                )
            })?,
            actions,
            notes: vec![NOTE_RANGE_DERIVED.to_string(), NOTE_BEST_EFFORT.to_string()],
        }));
    }

    Err(PreflopApiError::new(
        StatusCode::NOT_FOUND,
        format!(
            "no preflop decisions are available for {}",
            req.hero_position
        ),
    ))
}

fn default_range_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(DEFAULT_RANGE_ROOT)
}

fn default_index() -> Result<&'static PreflopIndex, PreflopApiError> {
    DEFAULT_INDEX
        .get_or_init(|| build_index_from_root(&default_range_root()))
        .as_ref()
        .map_err(|err| {
            PreflopApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to load preflop ranges: {err}"),
            )
        })
}

fn build_index_from_root(root: &Path) -> Result<PreflopIndex, String> {
    let mut index = PreflopIndex {
        decision_nodes: Vec::new(),
        range_file_count: 0,
    };
    visit_range_tree(root, root, &mut index)?;
    index
        .decision_nodes
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(index)
}

fn visit_range_tree(root: &Path, dir: &Path, index: &mut PreflopIndex) -> Result<(), String> {
    let entries = sorted_entries(dir)?;
    let relative_path = dir
        .strip_prefix(root)
        .map_err(|err| {
            format!(
                "failed to derive relative path for {}: {err}",
                dir.display()
            )
        })?
        .to_path_buf();

    if let Some(actor) = relative_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| is_position(name))
    {
        let actions = entries
            .iter()
            .filter(|entry| entry.is_dir())
            .filter_map(|entry| {
                entry
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_string)
            })
            .filter(|name| is_action_component(name))
            .collect::<Vec<_>>();
        if !actions.is_empty() {
            index.decision_nodes.push(DecisionNode {
                actor: actor.to_string(),
                relative_path: relative_path.clone(),
                actions,
            });
        }
    }

    for entry in entries {
        if entry.is_dir() {
            visit_range_tree(root, &entry, index)?;
        } else if is_range_file(&entry) {
            index.range_file_count += 1;
        }
    }
    Ok(())
}

fn sorted_entries(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = fs::read_dir(dir)
        .map_err(|err| format!("failed to read {}: {err}", dir.display()))?
        .map(|entry| {
            entry
                .map(|entry| entry.path())
                .map_err(|err| format!("failed to read entry in {}: {err}", dir.display()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort();
    Ok(entries)
}

fn action_history_with_ranges(
    root: &Path,
    relative_path: &Path,
) -> Result<Vec<PreflopActionHistoryItem>, String> {
    let components = path_components(relative_path);
    let mut history = Vec::new();
    let mut branch_path = PathBuf::new();
    let mut index = 0;

    while index + 1 < components.len() {
        let actor = components[index].clone();
        let action = components[index + 1].clone();
        branch_path.push(&actor);
        branch_path.push(&action);

        let direct_path = root.join(&branch_path).join(format!("{actor}_range.txt"));
        let (range, range_source) = if direct_path.exists() {
            (
                Some(fs::read_to_string(&direct_path).map_err(|err| {
                    format!("failed to read range file {}: {err}", direct_path.display())
                })?),
                "direct".to_string(),
            )
        } else {
            let mut weights = BTreeMap::new();
            collect_descendant_actor_weights(&root.join(&branch_path), &actor, &mut weights)?;
            if weights.is_empty() {
                (None, "missing".to_string())
            } else {
                for weight in weights.values_mut() {
                    *weight = (*weight).min(1.0);
                }
                (Some(format_range_weights(&weights)), "derived".to_string())
            }
        };

        history.push(PreflopActionHistoryItem {
            actor,
            action,
            range,
            range_source,
        });
        index += 2;
    }

    Ok(history)
}

fn action_frequencies_for_hand(
    root: &Path,
    node: &DecisionNode,
    hand_class: &str,
) -> Result<Vec<ActionFrequency>, String> {
    let mut frequencies = Vec::new();
    let mut represented = 0.0;
    let mut fold_index = None;

    for action in &node.actions {
        let weight = branch_weights_for_action(root, node, action)?
            .get(hand_class)
            .copied()
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        represented += weight;
        if action == "Fold" {
            fold_index = Some(frequencies.len());
        }
        frequencies.push(ActionFrequency {
            action: action.clone(),
            frequency: weight,
            inferred: false,
        });
    }

    let residual = (1.0_f64 - represented).max(0.0);
    if residual > 0.000_000_1 {
        if let Some(index) = fold_index {
            frequencies[index].frequency += residual;
            frequencies[index].frequency = frequencies[index].frequency.min(1.0);
        } else {
            frequencies.push(ActionFrequency {
                action: "Fold".to_string(),
                frequency: residual,
                inferred: true,
            });
        }
    }

    frequencies.retain(|frequency| frequency.frequency > 0.000_000_1);
    Ok(frequencies)
}

fn hand_weights_for_node(
    root: &Path,
    node: &DecisionNode,
) -> Result<BTreeMap<String, f64>, String> {
    let mut weights = BTreeMap::new();
    for action in &node.actions {
        for (hand_class, weight) in branch_weights_for_action(root, node, action)? {
            let entry = weights.entry(hand_class).or_insert(0.0);
            *entry = (*entry + weight).min(1.0);
        }
    }
    Ok(weights)
}

fn branch_weights_for_action(
    root: &Path,
    node: &DecisionNode,
    action: &str,
) -> Result<BTreeMap<String, f64>, String> {
    let action_dir = root.join(&node.relative_path).join(action);
    let mut weights = BTreeMap::new();
    collect_descendant_actor_weights(&action_dir, &node.actor, &mut weights)?;
    for weight in weights.values_mut() {
        *weight = (*weight).min(1.0);
    }
    Ok(weights)
}

fn collect_descendant_actor_weights(
    dir: &Path,
    actor: &str,
    weights: &mut BTreeMap<String, f64>,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in sorted_entries(dir)? {
        if entry.is_dir() {
            collect_descendant_actor_weights(&entry, actor, weights)?;
        } else if entry
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == format!("{actor}_range.txt"))
        {
            for (hand_class, weight) in parse_range_file(&entry)? {
                *weights.entry(hand_class).or_insert(0.0) += weight;
            }
        }
    }
    Ok(())
}

fn parse_range_file(path: &Path) -> Result<BTreeMap<String, f64>, String> {
    let text = fs::read_to_string(path)
        .map_err(|err| format!("failed to read range file {}: {err}", path.display()))?;
    parse_range_text(&text)
}

fn parse_range_text(text: &str) -> Result<BTreeMap<String, f64>, String> {
    let mut weights = BTreeMap::new();
    for part in text
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        let (raw_hand, raw_weight) = part.split_once(':').unwrap_or((part, "1.0"));
        let hand_class = normalize_hand_class(raw_hand)
            .ok_or_else(|| format!("unsupported hand class in range: {raw_hand}"))?;
        let weight = raw_weight
            .parse::<f64>()
            .map_err(|_| format!("invalid range weight for {hand_class}: {raw_weight}"))?
            .clamp(0.0, 1.0);
        weights.insert(hand_class, weight);
    }
    Ok(weights)
}

fn format_range_weights(weights: &BTreeMap<String, f64>) -> String {
    weights
        .iter()
        .filter(|(_, weight)| **weight > 0.0)
        .map(|(hand_class, weight)| format!("{hand_class}:{weight:.3}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn normalize_hand_class(raw: &str) -> Option<String> {
    let chars = raw.chars().collect::<Vec<_>>();
    match chars.as_slice() {
        [rank] => rank_value(*rank).map(|_| raw.to_ascii_uppercase()),
        [rank1, rank2] if rank1.eq_ignore_ascii_case(rank2) => {
            rank_value(*rank1)?;
            Some(format!(
                "{}{}",
                rank1.to_ascii_uppercase(),
                rank2.to_ascii_uppercase()
            ))
        }
        [rank1, rank2, suffix] if matches!(suffix, 's' | 'S' | 'o' | 'O') => {
            let first = rank_value(*rank1)?;
            let second = rank_value(*rank2)?;
            if first == second {
                return None;
            }
            let (high, low) = if first > second {
                (*rank1, *rank2)
            } else {
                (*rank2, *rank1)
            };
            Some(format!(
                "{}{}{}",
                high.to_ascii_uppercase(),
                low.to_ascii_uppercase(),
                suffix.to_ascii_lowercase()
            ))
        }
        _ => None,
    }
}

fn hand_class_to_cards(hand_class: &str) -> Result<[u8; 2], String> {
    let normalized = normalize_hand_class(hand_class)
        .ok_or_else(|| format!("cannot convert invalid hand class to cards: {hand_class}"))?;
    let chars = normalized.chars().collect::<Vec<_>>();
    match chars.as_slice() {
        [rank1, rank2] => {
            let first = rank_value(*rank1).unwrap();
            let second = rank_value(*rank2).unwrap();
            Ok([card_id(first, 0), card_id(second, 1)])
        }
        [rank1, rank2, suffix] => {
            let first = rank_value(*rank1).unwrap();
            let second = rank_value(*rank2).unwrap();
            let second_suit = if *suffix == 's' { 0 } else { 1 };
            Ok([card_id(first, 0), card_id(second, second_suit)])
        }
        _ => Err(format!(
            "cannot convert invalid hand class to cards: {hand_class}"
        )),
    }
}

fn choose_weighted_hand(weights: &BTreeMap<String, f64>, rng: &mut Lcg) -> Option<String> {
    let total = weights
        .values()
        .copied()
        .filter(|weight| *weight > 0.0)
        .sum::<f64>();
    if total <= 0.0 {
        return None;
    }
    let mut ticket = rng.next_f64() * total;
    for (hand_class, weight) in weights {
        if *weight <= 0.0 {
            continue;
        }
        if ticket <= *weight {
            return Some(hand_class.clone());
        }
        ticket -= *weight;
    }
    weights
        .iter()
        .rev()
        .find(|(_, weight)| **weight > 0.0)
        .map(|(hand_class, _)| hand_class.clone())
}

fn is_position(value: &str) -> bool {
    POSITIONS.contains(&value)
}

fn is_action_component(value: &str) -> bool {
    matches!(value, "Call" | "Fold" | "AllIn") || parse_bb_amount(value).is_some()
}

fn parse_bb_amount(value: &str) -> Option<f64> {
    value
        .strip_suffix("bb")
        .and_then(|amount| amount.parse::<f64>().ok())
        .filter(|amount| *amount > 0.0)
}

fn is_range_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with("_range.txt"))
}

fn path_components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|component| component.as_os_str().to_str().map(str::to_string))
        .collect()
}

fn path_to_string(path: &Path) -> String {
    path_components(path).join("/")
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn rank_value(rank: char) -> Option<u8> {
    match rank.to_ascii_uppercase() {
        '2' => Some(0),
        '3' => Some(1),
        '4' => Some(2),
        '5' => Some(3),
        '6' => Some(4),
        '7' => Some(5),
        '8' => Some(6),
        '9' => Some(7),
        'T' => Some(8),
        'J' => Some(9),
        'Q' => Some(10),
        'K' => Some(11),
        'A' => Some(12),
        _ => None,
    }
}

fn card_id(rank: u8, suit: u8) -> u8 {
    rank * 4 + suit
}

fn validate_position(position: &str) -> Result<(), PreflopApiError> {
    if is_position(position) {
        Ok(())
    } else {
        Err(PreflopApiError::new(
            StatusCode::BAD_REQUEST,
            format!("invalid preflop position: {position}"),
        ))
    }
}

fn random_seed() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0)
}

#[derive(Debug)]
struct Lcg {
    state: u64,
}

impl Lcg {
    fn new(seed: u64) -> Self {
        Self {
            state: seed ^ 0x7f4a_7c15_9e37_79b9,
        }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.state
    }

    fn next_usize(&mut self, upper: usize) -> usize {
        (self.next_u64() as usize) % upper
    }

    fn next_f64(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_range(root: &Path, relative: &str, text: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn indexes_decision_nodes_and_ignores_metadata_files() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_range(root, "BTN/2.5bb/BB/Call/BTN_range.txt", "AA:1.0");
        write_range(root, "BTN/2.5bb/BB/Call/BB_range.txt", "KK:1.0");
        write_range(
            root,
            "BTN/2.5bb/BB/Call/BTN_range.txt:Zone.Identifier",
            "metadata",
        );
        write_range(root, "BTN/.DS_Store", "metadata");

        let index = build_index_from_root(root).unwrap();

        assert_eq!(index.range_file_count, 2);
        let btn = index
            .decision_nodes
            .iter()
            .find(|node| node.relative_path == PathBuf::from("BTN"))
            .unwrap();
        assert_eq!(btn.actor, "BTN");
        assert_eq!(btn.actions, vec!["2.5bb"]);
        let bb = index
            .decision_nodes
            .iter()
            .find(|node| node.relative_path == PathBuf::from("BTN/2.5bb/BB"))
            .unwrap();
        assert_eq!(bb.actor, "BB");
        assert_eq!(bb.actions, vec!["Call"]);
    }

    #[test]
    fn action_history_includes_direct_and_derived_ranges() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_range(root, "CO/2.5bb/CO_range.txt", "AA:1.0");
        write_range(root, "CO/2.5bb/BTN/Call/BTN_range.txt", "KK:0.25");
        write_range(
            root,
            "CO/2.5bb/BTN/Call/BB/13.0bb/BB/Call/BB_range.txt",
            "QQ:0.4",
        );
        write_range(
            root,
            "CO/2.5bb/BTN/Call/BB/13.0bb/BB/AllIn/BB_range.txt",
            "QQ:0.7",
        );

        let history =
            action_history_with_ranges(root, Path::new("CO/2.5bb/BTN/Call/BB/13.0bb/CO")).unwrap();

        assert_eq!(history.len(), 3);
        assert_eq!(history[0].actor, "CO");
        assert_eq!(history[0].action, "2.5bb");
        assert_eq!(history[0].range.as_deref(), Some("AA:1.0"));
        assert_eq!(history[0].range_source, "direct");
        assert_eq!(history[1].range.as_deref(), Some("KK:0.25"));
        assert_eq!(history[1].range_source, "direct");
        assert_eq!(history[2].range.as_deref(), Some("QQ:1.000"));
        assert_eq!(history[2].range_source, "derived");
    }

    #[test]
    fn computes_direct_action_weights_and_inferred_fold_residual() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_range(root, "BTN/2.5bb/BB/Call/BB_range.txt", "AA:0.25,KK:1.0");
        write_range(root, "BTN/2.5bb/BB/11.0bb/BB_range.txt", "AA:0.50");
        write_range(root, "BTN/2.5bb/BB/Call/BTN_range.txt", "QQ:1.0");

        let index = build_index_from_root(root).unwrap();
        let node = index
            .decision_nodes
            .iter()
            .find(|node| node.relative_path == PathBuf::from("BTN/2.5bb/BB"))
            .unwrap();
        let frequencies = action_frequencies_for_hand(root, node, "AA").unwrap();

        assert_eq!(
            frequencies
                .iter()
                .map(|frequency| (
                    frequency.action.as_str(),
                    frequency.frequency,
                    frequency.inferred
                ))
                .collect::<Vec<_>>(),
            vec![
                ("11.0bb", 0.50, false),
                ("Call", 0.25, false),
                ("Fold", 0.25, true)
            ]
        );
    }

    #[test]
    fn caps_descendant_branch_weights_at_one() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_range(
            root,
            "CO/2.5bb/BTN/Call/BB/13.0bb/CO/Call/CO_range.txt",
            "AA:0.70",
        );
        write_range(
            root,
            "CO/2.5bb/BTN/Call/BB/13.0bb/CO/Call/BTN/Call/CO_range.txt",
            "AA:0.60",
        );

        let index = build_index_from_root(root).unwrap();
        let node = index
            .decision_nodes
            .iter()
            .find(|node| node.relative_path == PathBuf::from("CO/2.5bb/BTN/Call/BB/13.0bb/CO"))
            .unwrap();
        let frequencies = action_frequencies_for_hand(root, node, "AA").unwrap();

        assert_eq!(frequencies.len(), 1);
        assert_eq!(frequencies[0].action, "Call");
        assert_eq!(frequencies[0].frequency, 1.0);
        assert!(!frequencies[0].inferred);
    }
}
