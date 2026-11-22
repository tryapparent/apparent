use super::*;
use crate::{Client, Credential, MAX_BYTES, MAX_FILE_BYTES, Scratch, publish_noreplace, snapshot_bounded, validate_assets_with_limit};
use std::time::Duration;

const LIMIT: u64 = MAX_BYTES;
const SUPPORT_ORIGIN: &str = "https://app.tryapparent.com/connect";

fn report_context(origin: &str, id: &str) -> Result<Context> {
    let context = Context {
        origin: origin.strip_suffix("/connect").unwrap_or(origin).to_owned(),
        account_id: "apparent-support".into(),
        capture_id: id.to_owned(),
        sender_grant_id: "explicit-report".into(),
    };
    context_valid(&context)?;
    Ok(context)
}

pub fn seal(bundle: &Path, output: &Path, origin: &str, id: &str, recipient: &str) -> Result<()> {
    let context = report_context(origin, id)?;
    let key: age::x25519::Recipient = recipient.parse()
        .map_err(|_| anyhow::anyhow!("Invalid support recipient"))?;
    let scratch = Scratch::new_output(output.parent().context("Missing output directory")?)?;
    let stage = scratch.0.join("bundle");
    let files = snapshot_bounded(bundle, &stage, LIMIT)?;
    let inner = Inner { version: 1, context, files };
    let descriptor = Zeroizing::new(serde_json::to_vec(&inner)?);
    let size: u64 = inner.files.iter().map(|asset| asset.size).sum();
    ensure!(descriptor.len() as u64 <= JSON_BYTES && size + descriptor.len() as u64 + 262144 <= LIMIT,
        "report_too_large");
    let ciphertext = scratch.0.join("report.age");
    let encryptor = age::Encryptor::with_recipients(std::iter::once(&key as &dyn age::Recipient))
        .map_err(|_| anyhow::anyhow!("Support encryption unavailable"))?;
    let mut encrypted = encryptor.wrap_output(new_private_file(&ciphertext)?)?;
    encrypted.write_all(&(descriptor.len() as u32).to_be_bytes())?;
    encrypted.write_all(&descriptor)?;
    for asset in &inner.files {
        let file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW)
            .open(stage.join(&asset.path))?;
        ensure!(io::copy(&mut file.take(asset.size + 1), &mut encrypted)? == asset.size,
            "Support asset changed");
    }
    let file = encrypted.finish()?;
    file.sync_all()?;
    ensure!(file.metadata()?.len() <= LIMIT, "report_too_large");
    publish_noreplace(&ciphertext, output)
}

pub fn open(input: &Path, output: &Path, origin: &str, id: &str, key_file: &Path) -> Result<()> {
    let context = report_context(origin, id)?;
    let key_bytes = Zeroizing::new(read_private(key_file, 4096)?);
    let text = std::str::from_utf8(&key_bytes)?;
    let mut keys = text.lines().filter(|line| !line.trim().is_empty() && !line.starts_with('#'));
    let key: age::x25519::Identity = keys.next().context("Missing support identity")?.trim().parse()
        .map_err(|_| anyhow::anyhow!("Invalid support identity"))?;
    ensure!(keys.next().is_none(), "Unexpected additional support identity");
    let mut file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(input)?;
    let metadata = file.metadata()?;
    ensure!(metadata.is_file() && metadata.len() <= LIMIT, "Invalid support ciphertext");
    let header = bounded_header(&mut file)?;
    let decryptor = age::Decryptor::new(io::Cursor::new(header).chain(file.take(LIMIT)))
        .map_err(|_| anyhow::anyhow!("Invalid support ciphertext"))?;
    let mut source = decryptor.decrypt(std::iter::once(&key as &dyn age::Identity))
        .map_err(|_| anyhow::anyhow!("Support report could not be decrypted"))?;
    let mut length = [0; 4];
    source.read_exact(&mut length)?;
    let length = u32::from_be_bytes(length) as usize;
    ensure!(length > 0 && length as u64 <= JSON_BYTES, "Invalid support archive");
    let mut descriptor = Zeroizing::new(vec![0; length]);
    source.read_exact(&mut descriptor)?;
    let inner: Inner = serde_json::from_slice(&descriptor)?;
    ensure!(inner.version == 1 && inner.context == context, "Wrong support report");
    validate_assets_with_limit(&inner.files, LIMIT)?;
    ensure!(inner.files.iter().map(|asset| asset.size).sum::<u64>() <= LIMIT, "Invalid support archive size");
    let scratch = Scratch::new_output(output.parent().context("Missing output directory")?)?;
    for asset in &inner.files {
        let path = scratch.0.join(&asset.path);
        private_dir(path.parent().context("Invalid support archive path")?)?;
        let mut destination = new_private_file(&path)?;
        ensure!(io::copy(&mut (&mut source).take(asset.size), &mut destination)? == asset.size,
            "Truncated support asset");
        destination.sync_all()?;
        ensure!(digest_file(&path)? == asset.sha256, "Support asset digest mismatch");
    }
    ensure!(source.read(&mut [0])? == 0, "Unexpected trailing support data");
    validate_bundle_references(&scratch.0, &inner.files)?;
    File::open(&scratch.0)?.sync_all()?;
    publish_noreplace(&scratch.0, output)
}

impl Client {
    fn support_credential(&self) -> Result<Credential> {
        let server = self.settings().server;
        ensure!(
            server == SUPPORT_ORIGIN || server == crate::settings::DEFAULT_SERVER,
            "Sign in to Apparent Connect to send a recording"
        );
        self.credential("upload", &server)
    }

    fn support_key(&self, credential: &Credential) -> Result<String> {
        let key = self.json_request(
            &credential.server, Some(credential), "GET", "/v1/support-reports/key",
            None, Duration::from_secs(10), &|| true,
        )?;
        key["recipient"].as_str().map(str::to_owned).context("Support reporting unavailable")
    }

    pub fn support_report_available(&self) -> Result<()> {
        self.support_key(&self.support_credential()?)?;
        Ok(())
    }

    pub fn submit_support_report(&self, bundle: &Path, archive: &Path, id: &str) -> Result<()> {
        report_context(SUPPORT_ORIGIN, id)?;
        let credential = self.support_credential()?;
        let key = self.support_key(&credential)?;
        if !archive.try_exists()? {
            seal(bundle, archive, SUPPORT_ORIGIN, id, &key)?;
        }
        let mut input = OpenOptions::new().read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(archive)?;
        let metadata = input.metadata()?;
        let size = metadata.len();
        ensure!(metadata.is_file() && size > 0 && size <= LIMIT, "Invalid support archive");
        let scratch = Scratch::new_output(archive.parent().context("Missing output directory")?)?;
        let mut files = Vec::new();
        for (index, remaining) in (0..size).step_by(MAX_FILE_BYTES as usize).enumerate() {
            let path = format!("support/part-{index}.age");
            let part = scratch.0.join(index.to_string());
            let mut file = new_private_file(&part)?;
            let expected = (size - remaining).min(MAX_FILE_BYTES);
            ensure!(io::copy(&mut (&mut input).take(expected), &mut file)? == expected, "Incomplete support archive");
            drop(file);
            files.push(Asset { path, size: expected, sha256: digest_file(&part)? });
        }
        let server = &credential.server;
        let route = format!("/v1/support-reports/{id}/capture");
        let reply = self.json_request(server, Some(&credential), "POST", &route,
            Some(serde_json::json!({"files": files})), Duration::from_secs(30), &|| true)?;
        ensure!(reply["id"].as_str() == Some(id), "Invalid support reservation");
        if reply["status"] == "ready" {
            return Ok(());
        }
        ensure!(reply["status"] == "pending", "Support report unavailable");
        for (index, file) in files.iter().enumerate() {
            self.request(server, Some(&credential), "PUT", &format!("{route}/files/{}",file.path),
                Some(&scratch.0.join(index.to_string())), &scratch.0.join(format!("ack-{index}")),
                crate::JSON_LIMIT, Duration::from_secs(60), &|| true)?;
        }
        let reply = self.json_request(server, Some(&credential), "POST", &format!("{route}/complete"),
            None, Duration::from_secs(30), &|| true)?;
        ensure!(reply["id"].as_str() == Some(id) && reply["status"] == "ready", "Support report did not complete");
        Ok(())
    }
}
