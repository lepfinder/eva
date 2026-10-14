fn main() {
  tauri_build::build();

  #[cfg(target_os = "macos")]
  println!("cargo:rustc-link-lib=framework=LocalAuthentication");
  // AXUIElement* 在 HIServices 中，随 ApplicationServices umbrella framework 链接。
  #[cfg(target_os = "macos")]
  println!("cargo:rustc-link-lib=framework=ApplicationServices");
}
