# Word document conversion

Zupiq keeps imported DOC and DOCX originals on the user's device. The backend receives a temporary multipart upload, converts it to PDF for the local reader, returns the PDF bytes, and deletes its temporary working directory. It does not persist either file.

## Server requirement

Install LibreOffice on every API host:

```bash
sudo apt-get update
sudo apt-get install -y libreoffice-writer
soffice --version
```

The default executable is `soffice`. Override it when necessary:

```env
LIBREOFFICE_BIN=/usr/bin/soffice
DOCUMENT_CONVERSION_TIMEOUT_MS=90000
```

If LibreOffice is missing, `POST /api/documents/convert-to-pdf` returns HTTP 503 with code `DOCUMENT_CONVERTER_UNAVAILABLE`. Invalid or unreadable Word files return HTTP 422. Upload size follows `UPLOAD_MAX_SIZE_MB`.

Each conversion uses an isolated LibreOffice profile and temporary directory so simultaneous requests do not share process state. The directory is removed after success or failure.
