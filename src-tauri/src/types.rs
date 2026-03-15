use serde::Serialize;

#[derive(Clone, Serialize)]
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

#[derive(Clone, Serialize)]
pub struct ScanStartResponse {
    pub scan_id: String,
}

#[derive(Clone, Serialize)]
pub struct ScanProgressEvent {
    pub scan_id: String,
    pub stage: String,
    pub message: String,
    pub processed: usize,
    pub total: usize,
    pub done: bool,
    pub success: bool,
    pub result: Option<ScanResult>,
}
