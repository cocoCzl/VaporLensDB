fn main() {
    // Keep macOS signing metadata in Cargo's dependency graph. Without this,
    // changing the entitlement plist can leave a locally cached release binary
    // signed with an earlier entitlement set.
    println!("cargo:rerun-if-changed=gen/apple/Entitlements.plist");
    tauri_build::build();

    #[cfg(target_os = "macos")]
    {
        let profile = std::env::var("PROFILE").unwrap_or("debug".to_string());
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let binary_path = std::path::Path::new(&manifest_dir)
            .join("target")
            .join(&profile)
            .join("vapor-lens-db");

        if binary_path.exists() {
            let entitlements_path = std::path::Path::new(&manifest_dir)
                .join("gen")
                .join("apple")
                .join("Entitlements.plist");

            if entitlements_path.exists() {
                let status = std::process::Command::new("codesign")
                    .args([
                        "--force",
                        "--deep",
                        "--sign",
                        "-",
                        "--entitlements",
                        entitlements_path.to_str().unwrap(),
                        binary_path.to_str().unwrap(),
                    ])
                    .status();

                match status {
                    Ok(s) if s.success() => {
                        println!("cargo:warning=Signed binary with macOS entitlements for dev");
                    }
                    _ => {
                        println!("cargo:warning=Failed to sign binary with entitlements");
                    }
                }
            }
        }
    }
}
