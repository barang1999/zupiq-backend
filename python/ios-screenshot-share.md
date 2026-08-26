# iOS Screenshot Share Extension

How ScamLens receives images shared from the iOS share sheet and sends them for analysis.

---

## Overview

The share flow has three stages:

1. **Share Extension** (`ScamLensShareExtension`) — intercepts the shared item, extracts image bytes, writes a payload JSON to an App Group container, then opens the main app via `scamlens://share`.
2. **Main App** — on receiving the URL, reads the payload JSON from the App Group container, uploads the file to R2, creates a scan, and polls for the result.
3. **Backend** — downloads the image from R2, normalises it to JPEG, and sends it to Gemini for analysis.

---

## Share Extension (`ShareViewController.swift`)

### App Group

Both the extension and the main app share a container identified by:

```swift
private let appGroupId = "group.com.scamlens.app.share"
private let payloadFilename = "SharedPayload.json"
```

The extension writes `SharedPayload.json` to this container; the main app reads it.

### Image extraction

The critical piece is how raw JPEG bytes are obtained from the `NSItemProvider`.

**Why `loadFileRepresentation` and `loadDataRepresentation` don't work:**

When photos are shared from Photos.app, iOS serialises the image data as an Apple Binary Property List (`bplist00`) regardless of which type identifier you request (`public.jpeg`, `public.image`, etc.). The resulting bytes are not a valid image and cannot be processed by any image library.

**The working approach — `loadItem(forTypeIdentifier:options:)`:**

```swift
provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] item, _ in
    defer { group.leave() }
    guard let self else { return }

    let image: UIImage?
    if let uiImage = item as? UIImage {
        image = uiImage
    } else if let data = item as? Data {
        image = UIImage(data: data)
    } else if let url = item as? URL, let data = try? Data(contentsOf: url) {
        image = UIImage(data: data)
    } else {
        image = nil
    }

    guard let image,
          let jpegData = image.jpegData(compressionQuality: 0.85),
          let saved = self.saveSharedData(jpegData, typeIdentifier: UTType.jpeg.identifier) else {
        return
    }
    collectedFiles.append(saved)
}
```

`loadItem` returns a `UIImage` object directly — bypassing iOS's file serialisation layer entirely. `jpegData(compressionQuality:)` then produces real JPEG bytes with an `FFD8FF` header.

**Why `loadObject(ofClass: UIImage.self)` also fails:**

`NSItemProvider.loadObject(ofClass: UIImage.self)` looks like the modern equivalent but returns `nil` for Photos-sourced images in a share extension context. `loadItem` is the only reliable API here.

### Saving to the App Group

`saveSharedData` writes the raw bytes to `SharedInbox/` inside the App Group container:

```swift
private func saveSharedData(_ data: Data, typeIdentifier: String) -> [String: Any]? {
    guard let containerURL = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupId) else { return nil }

    let inboxURL = containerURL.appendingPathComponent("SharedInbox", isDirectory: true)
    try? FileManager.default.createDirectory(at: inboxURL, withIntermediateDirectories: true)

    let ext = fallbackExtension(for: typeIdentifier)
    let filename = "shared\(ext)"
    let destinationURL = inboxURL.appendingPathComponent("\(UUID().uuidString)-\(filename)")

    try data.write(to: destinationURL, options: .atomic)
    return ["uri": destinationURL.absoluteString, "name": filename,
            "mimeType": mimeType(for: typeIdentifier, filename: filename), "size": data.count]
}
```

### Opening the main app

After writing the payload the extension opens the main app via a custom URL scheme:

```swift
extensionContext?.open(URL(string: "scamlens://share")!) { didOpen in
    // fallback: walk the responder chain to find UIApplication.openURL
}
```

---

## Backend image normalisation (`analysis.service.ts`)

Even with valid JPEG bytes arriving from the extension, Gemini occasionally rejects images or receives unusual formats. The backend normalises every image before sending it to Gemini.

### Pipeline

```
R2 download → magic-byte detection (file-type) → HEIC conversion (heic-convert) → resize + JPEG re-encode (sharp → jimp fallback)
```

```ts
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import Jimp from 'jimp';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';

if (fileBuffer && fileMimeType?.startsWith('image/')) {
    const detected = await fileTypeFromBuffer(fileBuffer);
    const detectedMime = detected?.mime ?? fileMimeType;

    // HEIC/HEIF → JPEG
    if (detectedMime === 'image/heic' || detectedMime === 'image/heif') {
        workingBuffer = Buffer.from(
            await heicConvert({ buffer: new Uint8Array(workingBuffer), format: 'JPEG', quality: 0.85 })
        );
    }

    // Resize + re-encode (sharp first, jimp fallback)
    try {
        fileBuffer = await sharp(workingBuffer)
            .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
    } catch {
        const image = await Jimp.read(workingBuffer);
        fileBuffer = await image
            .resize(Math.min(image.getWidth(), 2048), Jimp.AUTO)
            .quality(85)
            .getBufferAsync(Jimp.MIME_JPEG);
    }
}
```

### Gemini retry logic

Gemini returns `400 INVALID_ARGUMENT "Unable to process input image"` as a transient error. The backend retries up to 3 times with exponential backoff (1 s, 3 s):

```ts
const maxAttempts = 3;
const retryDelays = [1000, 3000];

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(geminiUrl, { ... });
    if (res.status === 503 || (res.status === 400 && body.includes('Unable to process input image'))) {
        if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, retryDelays[attempt - 1]));
            continue;
        }
        break;
    }
    // ...
}
```

---

## Debugging

### Confirming image bytes are real JPEG

Look for `[DBG] Downloaded` and `[DBG] Sending image to Gemini` in the backend logs:

```
[DBG] Downloaded storageKey=... size=... contentType=image/jpeg head8=FFD8FFE0   ← good
[DBG] Downloaded storageKey=... size=... contentType=image/jpeg head8=62706C69   ← bplist (bad)
```

`FFD8FF` = JPEG magic bytes. `62706C69` = `bpli` (start of `bplist00`).

A complete JPEG also ends with `FFD9` (EOI marker). The log shows `jpegComplete=true/false`.

### Common failure signatures

| Symptom | Cause |
|---|---|
| `head8=62706C6973743030` | Share extension sent bplist instead of image bytes |
| `sharp failed: Input buffer contains unsupported image format` | Image is not a recognised format (usually bplist) |
| `Could not find MIME for Buffer <null>` | jimp also cannot decode the buffer |
| Gemini 400 all 3 retries | Either bplist reaching Gemini, or a genuine Gemini transient error |
| `No native shared payload was found` | Share extension failed to write `SharedPayload.json` before opening the main app |

---

## iOS Build Notes

### React Native from source

`Podfile.properties.json` sets `"ios.buildReactNativeFromSource": "true"` to avoid a missing `facebook::react::Sealable` linker error that occurs with the precompiled xcframeworks.

### expo-modules-core Swift concurrency patch

`patches/expo-modules-core+57.0.10.patch` adds a `_WeakBox<T>: @unchecked Sendable` wrapper to `EventEmitter.swift` to satisfy Swift 6 strict concurrency rules. Apply automatically via `patch-package` in the `postinstall` script.
