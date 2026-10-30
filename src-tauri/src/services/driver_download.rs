//! Fixed, reviewed dependency sets only; no user URLs or Maven resolution.
use super::{
    config_store::ConfigStore,
    task_manager::{TaskInfo, TaskManager},
};
use crate::models::driver_catalog::{DriverArtifact, DriverInstallation, InstallationSource};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadFile {
    pub file: String,
    pub url: String,
    pub sha256: String,
    pub checksum_source: String,
    pub size: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecipe {
    pub driver_definition_id: String,
    pub version: String,
    pub license: String,
    pub license_url: String,
    pub scope: String,
    pub files: Vec<DownloadFile>,
}
pub fn recipes() -> Vec<DownloadRecipe> {
    serde_json::from_str(include_str!("../../../src/shared/jdbc-downloads.json"))
        .expect("embedded JDBC download manifest")
}
pub fn validate_recipe(recipe: &DownloadRecipe) -> Result<(), String> {
    if recipe.files.is_empty() {
        return Err("Download has no dependency files".into());
    }
    let mut names = std::collections::HashSet::new();
    for file in &recipe.files {
        let url = url::Url::parse(&file.url).map_err(|_| "Invalid download URL")?;
        if url.scheme() != "https"
            || url.host_str() != Some("repo.maven.apache.org")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.path().starts_with("/maven2/")
            || file.file.contains(['/', '\\'])
            || !file.file.ends_with(".jar")
            || !names.insert(&file.file)
            || file.size == 0
            || file.size > 64 * 1024 * 1024
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid trusted JDBC download manifest".into());
        }
    }
    Ok(())
}
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .user_agent(concat!("VaporLensDB/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Could not initialize HTTPS downloader".into())
}

/// Own only this task's directory. Failed/cancelled jobs cannot leave a published set.
struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub async fn download(
    store: ConfigStore,
    manager: TaskManager,
    task_id: Uuid,
    recipe: DownloadRecipe,
    client: reqwest::Client,
    emit: impl Fn(&TaskInfo),
) -> Result<(), String> {
    let handle = manager.handle(task_id).await.map_err(String::from)?;
    let start = manager
        .start_task(task_id, "Downloading verified dependency set")
        .await
        .map_err(String::from)?;
    emit(&start);
    let id = format!("installation-{task_id}");
    let parent = store.config_dir().join("driver-artifacts");
    let staging = Staging(parent.join(format!(".download-{task_id}")));
    tokio::fs::create_dir_all(&staging.0)
        .await
        .map_err(|_| "Cannot create download staging directory")?;
    let mut current = 0;
    let total = recipe.files.iter().map(|f| f.size).sum();
    for file in &recipe.files {
        if handle.is_cancel_requested() {
            return Err("Download cancelled".into());
        }
        let response = tokio::select! {
            _ = handle.cancelled() => return Err("Download cancelled".into()),
            result = client.get(&file.url).send() => result.map_err(|_| "JDBC download network failure; retry or import local JARs")?,
        };
        if !response.status().is_success() {
            return Err(format!(
                "JDBC download failed (HTTP {})",
                response.status().as_u16()
            ));
        }
        if response
            .content_length()
            .is_some_and(|len| len != file.size)
        {
            return Err(format!("Unexpected file size: {}", file.file));
        }
        let mut stream = response.bytes_stream();
        let mut output = tokio::fs::File::create(staging.0.join(&file.file))
            .await
            .map_err(|_| "Cannot create staged JAR")?;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        let mut reported = current;
        loop {
            let next = tokio::select! {
                _ = handle.cancelled() => return Err("Download cancelled".into()),
                next = stream.next() => next,
            };
            let Some(chunk) = next else { break };
            let chunk =
                chunk.map_err(|_| "JDBC download interrupted; retry or import local JARs")?;
            size += chunk.len() as u64;
            if size > file.size {
                return Err(format!("Unexpected file size: {}", file.file));
            }
            hash.update(&chunk);
            output
                .write_all(&chunk)
                .await
                .map_err(|_| "Cannot write staged JAR")?;
            current += chunk.len() as u64;
            if current - reported >= 128 * 1024 {
                let progress = manager
                    .update_progress_with_total(task_id, current, Some(total), &file.file)
                    .await
                    .map_err(String::from)?;
                emit(&progress);
                reported = current;
            }
        }
        output
            .sync_all()
            .await
            .map_err(|_| "Cannot flush staged JAR")?;
        if size != file.size || format!("{:x}", hash.finalize()) != file.sha256 {
            return Err(format!("SHA-256 verification failed: {}", file.file));
        }
        let progress = manager
            .update_progress_with_total(
                task_id,
                current,
                Some(total),
                format!("Verified {}", file.file),
            )
            .await
            .map_err(String::from)?;
        emit(&progress);
    }
    if handle.is_cancel_requested() {
        return Err("Download cancelled".into());
    }
    // This is the commit point. A later cancellation cannot unpublish a usable installation.
    let target = parent.join(&id);
    let installation = DriverInstallation {
        id,
        driver_definition_id: recipe.driver_definition_id,
        label: recipe.version.clone(),
        version: Some(recipe.version),
        source: Some(InstallationSource {
            kind: "download".into(),
            urls: recipe.files.iter().map(|f| f.url.clone()).collect(),
            checksum_sources: recipe
                .files
                .iter()
                .map(|f| f.checksum_source.clone())
                .collect(),
            license: Some(recipe.license),
        }),
        artifacts: recipe
            .files
            .iter()
            .enumerate()
            .map(|(i, f)| DriverArtifact {
                path: target.join(&f.file).to_string_lossy().into_owned(),
                sha256: Some(f.sha256.clone()),
                role: if i == 0 { "primary" } else { "dependency" }.into(),
            })
            .collect(),
        java_requirement: "Java 21+ (bridge)".into(),
        validation: None,
    };
    let staged = staging.0.clone();
    tokio::task::spawn_blocking(move || publish_staged(&store, &staged, &target, &installation))
        .await
        .map_err(|_| "Installation publisher failed")??;
    Ok(())
}

/// Shared atomic directory/registry publication for local and downloaded JARs.
pub fn publish_staged(
    store: &ConfigStore,
    staged: &Path,
    target: &Path,
    installation: &DriverInstallation,
) -> Result<(), String> {
    if target.exists() {
        return Err("Installation already exists; immutable versions cannot be replaced".into());
    }
    std::fs::rename(staged, target).map_err(|_| "Cannot publish installation files")?;
    if let Err(error) = store.publish_installation(installation) {
        let _ = std::fs::remove_dir_all(target);
        return Err(String::from(error));
    }
    Ok(())
}

/// Manifest metadata is a version label, not publisher authentication or class validation.
pub fn local_version(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
    let manifest = archive.by_name("META-INF/MANIFEST.MF").ok()?;
    if manifest.size() > 64 * 1024 {
        return None;
    }
    let mut text = String::new();
    manifest.take(64 * 1024).read_to_string(&mut text).ok()?;
    for key in ["Implementation-Version: ", "Bundle-Version: "] {
        if let Some(value) = text
            .lines()
            .take_while(|l| !l.is_empty())
            .find_map(|l| l.strip_prefix(key))
        {
            return Some(
                value
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(100)
                    .collect(),
            );
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    struct Fixture {
        store: ConfigStore,
        manager: TaskManager,
    }
    impl Fixture {
        fn new() -> Self {
            Self {
                store: ConfigStore::new(
                    std::env::temp_dir().join(format!("vapor-download-{}", Uuid::new_v4())),
                )
                .unwrap(),
                manager: TaskManager::new(),
            }
        }
        async fn run(&self, recipe: DownloadRecipe) -> (Uuid, Result<(), String>) {
            let task = self
                .manager
                .create_task("driver.download:jdbc-postgresql", "fixture", None)
                .await;
            let result = download(
                self.store.clone(),
                self.manager.clone(),
                task.id,
                recipe,
                reqwest::Client::new(),
                |_| {},
            )
            .await;
            (task.id, result)
        }
        fn empty(&self) {
            assert!(self.store.list_driver_installations().unwrap().is_empty());
            if self.store.config_dir().join("driver-artifacts").exists() {
                assert_eq!(
                    std::fs::read_dir(self.store.config_dir().join("driver-artifacts"))
                        .unwrap()
                        .count(),
                    0
                );
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.store.config_dir());
        }
    }
    async fn server(status: &str, body: &'static [u8]) -> String {
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = socket.local_addr().unwrap();
        let status = status.to_owned();
        tokio::spawn(async move {
            // Multiple requests allow a complete dependency set to use one fixture.
            while let Ok((mut stream, _)) = socket.accept().await {
                let mut request = [0; 4096];
                let _ = stream.read(&mut request).await;
                let header = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                if stream.write_all(header.as_bytes()).await.is_ok() {
                    let _ = stream.write_all(body).await;
                }
            }
        });
        format!("http://{address}/driver.jar")
    }
    fn recipe(url: String) -> DownloadRecipe {
        let mut recipe = recipes().remove(0);
        recipe.files = vec![DownloadFile {
            file: "fixture.jar".into(),
            url,
            size: 3,
            sha256: format!("{:x}", Sha256::digest(b"jar")),
            checksum_source: "fixture".into(),
        }];
        recipe
    }

    #[test]
    fn manifest_contains_complete_reviewed_sets_and_only_trusted_https() {
        let manifest = recipes();
        assert_eq!(manifest.len(), 4);
        for recipe in &manifest {
            validate_recipe(recipe).unwrap();
            assert!(!recipe.license.is_empty());
        }
        assert_eq!(
            manifest
                .iter()
                .find(|r| r.driver_definition_id == "jdbc-mysql")
                .unwrap()
                .files
                .len(),
            2
        );
        let mut invalid = manifest[0].clone();
        invalid.files[0].url = "http://repo.maven.apache.org/maven2/driver.jar".into();
        assert!(validate_recipe(&invalid).is_err());
        invalid.files[0].url = "https://untrusted.invalid/maven2/driver.jar".into();
        assert!(validate_recipe(&invalid).is_err());
        invalid = manifest[0].clone();
        invalid.files.push(invalid.files[0].clone());
        assert!(validate_recipe(&invalid).is_err());
    }
    #[tokio::test]
    async fn success_publishes_complete_immutable_version_and_provenance() {
        let fixture = Fixture::new();
        let recipe = recipe(server("200 OK", b"jar").await);
        let (id, result) = fixture.run(recipe.clone()).await;
        result.unwrap();
        let first = fixture.store.list_driver_installations().unwrap().remove(0);
        assert_eq!(first.id, format!("installation-{id}"));
        assert_eq!(first.version.as_deref(), Some("42.7.14"));
        assert_eq!(first.source.as_ref().unwrap().kind, "download");
        assert!(first.validation.is_none());
        assert_eq!(std::fs::read(&first.artifacts[0].path).unwrap(), b"jar");
        let config = serde_json::from_value(serde_json::json!({
            "id":Uuid::new_v4(),"name":"Pinned download fixture","driverType":"postgres",
            "productId":"postgres","driverDefinitionId":"jdbc-postgresql",
            "driverPaths":[],"driverInstallationId":first.id,"connectionMode":"hostPort","host":"localhost",
            "port":5432,"username":"fixture","database":"fixture", "createdAt":chrono::Utc::now(),"updatedAt":chrono::Utc::now()
        })).unwrap();
        let pinned = fixture
            .store
            .create_connection(config, None, false)
            .unwrap();
        let (_, result) = fixture.run(recipe).await;
        result.unwrap();
        assert_eq!(fixture.store.list_driver_installations().unwrap().len(), 2);
        assert_eq!(std::fs::read(&first.artifacts[0].path).unwrap(), b"jar");
        let (runtime, _) = fixture.store.resolve_connection(&pinned).unwrap();
        assert_eq!(runtime.driver_installation_id, Some(first.id));
        assert_eq!(runtime.driver_paths, vec![first.artifacts[0].path.clone()]);
    }
    #[test]
    fn local_manifest_version_is_metadata_and_invalid_manifest_is_unknown() {
        use std::io::Write;
        let fixture = Fixture::new();
        let jar = fixture.store.config_dir().join("local.jar");
        for (manifest, expected) in [
            (
                "Manifest-Version: 1.0\r\nImplementation-Version: 7.2.1\r\n\r\n",
                Some("7.2.1"),
            ),
            (
                "Manifest-Version: 1.0\nBundle-Version: 8.0\n\n",
                Some("8.0"),
            ),
            ("Manifest-Version: 1.0\n\n", None),
        ] {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&jar).unwrap());
            zip.start_file(
                "META-INF/MANIFEST.MF",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            zip.write_all(manifest.as_bytes()).unwrap();
            zip.finish().unwrap();
            assert_eq!(local_version(&jar).as_deref(), expected);
        }
        std::fs::write(&jar, b"not a zip").unwrap();
        assert_eq!(local_version(&jar), None);
        assert_eq!(
            local_version(&fixture.store.config_dir().join("missing.jar")),
            None
        );
    }
    #[tokio::test]
    async fn wrong_digest_missing_dependency_and_http_failure_never_publish() {
        for variant in ["digest", "dependency", "http"] {
            let fixture = Fixture::new();
            let mut recipe = recipe(
                server(
                    if variant == "http" {
                        "404 Not Found"
                    } else {
                        "200 OK"
                    },
                    b"jar",
                )
                .await,
            );
            if variant == "digest" {
                recipe.files[0].sha256 = "0".repeat(64);
            }
            if variant == "dependency" {
                let mut dependency = recipe.files[0].clone();
                dependency.file = "missing.jar".into();
                dependency.url = server("404 Not Found", b"jar").await;
                recipe.files.push(dependency);
            }
            assert!(fixture.run(recipe).await.1.is_err());
            fixture.empty();
        }
    }
    #[tokio::test]
    async fn disconnected_network_fails_without_publishing_and_retry_works() {
        let fixture = Fixture::new();
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = socket.local_addr().unwrap();
        drop(socket);
        assert!(fixture
            .run(recipe(format!("http://{address}/offline")))
            .await
            .1
            .is_err());
        fixture.empty();
        fixture
            .run(recipe(server("200 OK", b"jar").await))
            .await
            .1
            .unwrap();
        assert_eq!(fixture.store.list_driver_installations().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn cancel_interrupts_a_stalled_request_without_a_partial_installation() {
        let fixture = Fixture::new();
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = socket.local_addr().unwrap();
        let (accepted, accept) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (_stream, _) = socket.accept().await.unwrap();
            let _ = accepted.send(());
            std::future::pending::<()>().await;
        });
        let task = fixture
            .manager
            .create_task("driver.download:jdbc-postgresql", "fixture", None)
            .await;
        let manager = fixture.manager.clone();
        let store = fixture.store.clone();
        let worker = tokio::spawn(async move {
            download(
                store,
                manager,
                task.id,
                recipe(format!("http://{address}/stalled")),
                reqwest::Client::new(),
                |_| {},
            )
            .await
        });
        accept.await.unwrap();
        fixture.manager.request_cancel(task.id).await.unwrap();
        let error = tokio::time::timeout(Duration::from_secs(2), worker)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(error.contains("cancelled"));
        server.abort();
        fixture.empty();
    }
}
