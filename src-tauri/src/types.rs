use serde::Serialize;

#[derive(Serialize)]
pub struct ScanResult {
    pub total_images: usize,
    pub total_batches: usize,
}

#[derive(Serialize)]
pub struct GroupItem {
    pub id: String,
    pub label: String,
    pub group_type: String,
    pub date: Option<String>,
    pub size: i64,
    pub representative_path: String,
}

#[derive(Serialize)]
pub struct ImageItem {
    pub path: String,
    pub serial: i64,
    pub seed: i64,
}

#[derive(Serialize)]
pub struct RatingItem {
    pub group_id: String,
    pub rating: f64,
    pub matches: i64,
}
