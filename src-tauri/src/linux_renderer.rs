//! Preserve legacy WebKit compatibility while avoiding its 2.54 alpha fallback
//! regression on the tested AMD Wayland configuration.

#[link(name = "webkit2gtk-4.1")]
extern "C" {
    fn webkit_get_major_version() -> u32;
    fn webkit_get_minor_version() -> u32;
}

fn prefer_dma_buf(major: u32, minor: u32, wayland: bool, vendors: &[u32]) -> bool {
    (major > 2 || (major == 2 && minor >= 54))
        && wayland
        && !vendors.is_empty()
        && vendors.iter().all(|vendor| *vendor == 0x1002)
}

fn gpu_vendors() -> Vec<u32> {
    let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.strip_prefix("card").is_some_and(|suffix| {
                !suffix.is_empty() && suffix.bytes().all(|c| c.is_ascii_digit())
            })
        })
        .map(|entry| {
            std::fs::read_to_string(entry.path().join("device/vendor"))
                .ok()
                .and_then(|vendor| {
                    u32::from_str_radix(vendor.trim().trim_start_matches("0x"), 16).ok()
                })
                // Unknown devices retain the conservative fallback.
                .unwrap_or(0)
        })
        .collect()
}

pub fn configure() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }
    let wayland = match std::env::var("GDK_BACKEND") {
        Ok(backend) => backend.split(',').next() == Some("wayland"),
        Err(_) => std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland"),
    };
    // SAFETY: these stable public version getters need no GTK initialization
    // and exist on all WebKitGTK versions supported by this application.
    let (major, minor) = unsafe { (webkit_get_major_version(), webkit_get_minor_version()) };
    let allow = prefer_dma_buf(major, minor, wayland, &gpu_vendors());
    std::env::set_var(
        "WEBKIT_DISABLE_DMABUF_RENDERER",
        if allow { "0" } else { "1" },
    );
    eprintln!("[webkit-renderer] version={major}.{minor} wayland={wayland} dma_buf={allow}");
}

#[cfg(test)]
mod tests {
    use super::prefer_dma_buf;

    #[test]
    fn modern_amd_wayland_avoids_the_broken_fallback() {
        assert!(prefer_dma_buf(2, 54, true, &[0x1002, 0x1002]));
    }

    #[test]
    fn legacy_and_unverified_configurations_keep_the_fallback() {
        for (major, minor, wayland, vendors) in [
            (2, 52, true, vec![0x1002]),
            (2, 54, false, vec![0x1002]),
            (2, 54, true, vec![0x1002, 0x10de]),
            (2, 54, true, vec![0x8086]),
            (2, 54, true, vec![0]),
            (2, 54, true, vec![]),
        ] {
            assert!(!prefer_dma_buf(major, minor, wayland, &vendors));
        }
    }
}
